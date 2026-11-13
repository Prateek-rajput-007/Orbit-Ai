import { getModel } from "../config/llmModels.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";
import {
    parseCodeArtifact,
    validateArtifactIntegrity,
    repairMissingReactImports,
} from "../utils/codeArtifact.js";
import {
    classifyProjectIntent,
    determineProjectRuntimeStrategy,
    PROJECT_INTENTS,
    PROJECT_RUNTIME_STRATEGIES,
} from "../utils/projectIntent.js";

export const codingAgent = async (state = {}) => {
    if (state?.isAborted?.()) {
        return {
            aiResponse: "",
            codeArtifact: null,
            retries: 0,
        };
    }
    const llm = getModel("coding");
    const conversationContext = formatConversationContext(state.history);
    const userPrompt = state?.prompt || "";
    const onToken = typeof state?.onToken === "function" ? state.onToken : null;
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    // Classify project intent: MODIFY_EXISTING_PROJECT, CREATE_NEW_PROJECT, GENERAL_CODING_QUESTION, AMBIGUOUS_INTENT
    const projectIntent = state?.projectIntent || classifyProjectIntent(userPrompt, state?.existingCodeArtifact, state?.history);

    // 1. Guard against ambiguous intent: ask for clarification without destroying or modifying project state
    if (projectIntent.intent === PROJECT_INTENTS.AMBIGUOUS_INTENT) {
        const clarification = projectIntent.clarificationPrompt ||
            `Would you like to update your existing project (${state?.existingCodeArtifact?.title || "current project"}), or create a brand new application from scratch? Please clarify so I can assist you accurately.`;
        return {
            ...state,
            aiResponse: clarification,
            codeArtifact: null,
            modelUsed: "orbit-intent-guard",
            providerUsed: "orbit-internal",
        };
    }

    // 2. Pure technical / conceptual questions: answer directly without creating or modifying a project artifact
    if (projectIntent.intent === PROJECT_INTENTS.GENERAL_CODING_QUESTION) {
        onStage?.("generating", "Formulating technical explanation...");
        const questionSystemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect.
The user is asking a technical, conceptual, or architectural question.
Provide a clear, concise, accurate explanation with code examples as appropriate.
Do NOT output a project JSON code artifact or file manifest. Output markdown directly.`;

        let answer = "";
        try {
            const result = await llm.invoke([
                { role: "system", content: questionSystemPrompt },
                { role: "user", content: `${conversationContext ? `Recent conversation context:\n${conversationContext}\n\n` : ""}Question:\n${userPrompt}` },
            ]);
            answer = extractText(result);
        } catch (err) {
            console.error("General coding question invoke failed:", err.message);
            answer = "I could not process your technical question at this moment. Please try again.";
        }

        return {
            ...state,
            aiResponse: answer,
            codeArtifact: null,
            modelUsed: llm.model,
            providerUsed: llm.provider || "groq",
            tokenUsage: { estimatedOutputTokens: Math.round(answer.length / 4) },
            retries: 0,
        };
    }

    // 3. For CREATE_NEW_PROJECT, isolate context completely: do not pass existing files or baseArtifactId
    const isNewProject = projectIntent.intent === PROJECT_INTENTS.CREATE_NEW_PROJECT;
    const existing = isNewProject ? null : state.existingCodeArtifact;
    const hasExisting = Boolean(
        existing &&
        Array.isArray(existing.files) &&
        existing.files.length > 0 &&
        !isNewProject
    );

    // Limit existing file context size to prevent exceeding LLM context windows
    const MAX_CONTEXT_FILE_BYTES = 75_000;
    const includedFiles = [];
    const omittedFiles = [];

    if (hasExisting) {
        // Prioritize entry file and key documents first
        const sortedFiles = [...existing.files].sort((a, b) => {
            const aIsEntry = a.path === existing.entryFile ? -1 : 0;
            const bIsEntry = b.path === existing.entryFile ? -1 : 0;
            if (aIsEntry !== bIsEntry) return aIsEntry - bIsEntry;
            return (a.size || 0) - (b.size || 0);
        });

        let accumulatedBytes = 0;
        for (const file of sortedFiles) {
            const fileBytes = Buffer.byteLength(file.content || "", "utf8");
            if (accumulatedBytes + fileBytes <= MAX_CONTEXT_FILE_BYTES) {
                includedFiles.push(file);
                accumulatedBytes += fileBytes;
            } else {
                omittedFiles.push(file);
            }
        }
    }

    const runtimeStrategy = projectIntent?.runtimeStrategy || determineProjectRuntimeStrategy(userPrompt, state?.existingCodeArtifact);
    const isReact = runtimeStrategy === PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION;

    const newReactProjectSystemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect building a modern, multi-file React application.
Your mission is to produce clean, modular, production-grade React applications that run directly inside our Sandpack browser runtime.

CRITICAL ARCHITECTURE & EXECUTION RULES:
1. NEVER produce truncated snippets, placeholders (e.g. "// TODO", "// rest of your code here", "..."), or pseudocode. Always provide the COMPLETE, WORKING code for every file.
2. PROFESSIONAL SEPARATION OF CONCERNS (NO "GOD COMPONENTS" & NO COOKIE-CUTTER CODE):
   - Never dump all state, storage, business logic, and DOM mutations into a single massive 'App.jsx'.
   - 'src/App.jsx' must be a clean, high-level orchestrator (~30-60 lines) coordinating layout, custom hooks, and presentational views.
   - Layer 1 — Pure Domain Engine ('src/utils/' or 'src/core/'):
     * Extract all business logic, math calculations, formula parsers, precision formatters, and data converters into standalone, pure JavaScript modules with ZERO React dependencies.
     * Pure functions are easy to test, robust against floating-point precision bugs, and fully decoupled from the UI.
   - Layer 2 — Custom Hooks ('src/hooks/'):
     * Encapsulate stateful logic, user actions, storage synchronization ('localStorage'), and window event listeners (e.g., keyboard shortcuts) in custom hooks (e.g., 'useCalculator.js', 'useTheme.js', 'useResume.js').
     * Components and 'App.jsx' simply consume the hook: 'const { display, formula, history, pressKey, clearAll } = useCalculator();'.
   - Layer 3 — Declarative Configurations ('src/constants/'):
     * Avoid hardcoding repetitive JSX buttons or form fields. Define layouts, button palettes, section schemas, or navigation menus as declarative arrays/objects (e.g., 'src/constants/keypadLayout.js', 'src/constants/resumeSections.js').
   - Layer 4 — Focused Presentational UI ('src/components/'):
     * Build clean, modular components (Atoms/Molecules) that accept props or render data-driven configs.
     * Decouple theme toggles: use a dedicated 'useTheme' hook or context rather than directly mutating 'document.documentElement' inside 'App.jsx'.
3. REQUIRED PROJECT STRUCTURE:
   - "package.json": Must declare valid JSON with "name", "version", and "dependencies" including "react": "^18.2.0" and "react-dom": "^18.2.0", plus any external libraries used (e.g. "lucide-react": "^0.263.1", "recharts": "^2.8.0", "date-fns": "^2.30.0").
   - "index.html": HTML entry document containing '<div id="root"></div>' and '<script type="module" src="/src/main.jsx"></script>'. Include '<script src="https://cdn.tailwindcss.com"></script>' in the head for Tailwind CSS styling.
   - "src/main.jsx": Application entry point using 'createRoot' from 'react-dom/client' to mount '<App />' into 'document.getElementById("root")'.
   - "src/App.jsx": Clean top-level orchestrator coordinating layout, custom hooks, and components.
   - "src/hooks/...": Custom hooks encapsulating state, persistence, and event listeners.
   - "src/utils/...": Pure domain logic, math engine, parsers, and helper functions.
   - "src/constants/...": Declarative configurations, button layouts, and schemas.
   - "src/components/...": Reusable presentational components.
   - "src/styles/index.css": Base styles, transitions, and custom utility classes.
4. PREMIUM VISUAL DESIGN & TAILWIND POLISH (Bolt.new / Lovable standards):
   - NEVER output raw unstyled HTML elements with default browser borders, grey backgrounds, or default serif fonts.
   - Every single component MUST have Tailwind styling: modern rounded corners ('rounded-2xl', 'rounded-xl'), soft elevations ('shadow-xl', 'shadow-md'), clean borders, and smooth transitions ('transition-all active:scale-95').
   - Use Lucide React icons (e.g. import { Moon, Sun, History, Trash2, RotateCcw, Copy, Check, Calculator } from "lucide-react") for professional iconography.
   - Every button, input form, selector, and filter must have ACTIVE working handlers. No dead click handlers.
   - Handle empty states and edge cases gracefully.
5. ADAPTIVE, FEATURE-RICH APPLICATION EXCELLENCE:
   - Never generate the exact same rigid template across different prompts. Adapt to the specific requirements:
   - For Calculators & Math Tools (e.g. "calculator", "calc", "math app"):
     * Architecture: 'src/utils/calculatorEngine.js' (pure evaluation, precision, formatters), 'src/hooks/useCalculator.js' (state, history, keyboard listener), 'src/constants/keypadLayout.js' (declarative button grid config), plus modular Display, Keypad, and History components.
     * Keypad: Proper CSS Grid ('grid grid-cols-4 gap-2.5 sm:gap-3') with squircle/rounded buttons. Color-code digits, operators, clear/backspace, and equals. Never render buttons in a single inline row!
     * Screen: Digital LCD display with formula breadcrumb and large formatted result.
     * Features: Calculation history drawer/log with click-to-recall, keyboard listeners (Enter, Backspace, Escape, numbers, operators), and theme support.
     * Adaptive depth: If prompt mentions scientific/advanced/SaaS, add mode toggling (Standard vs. Scientific with sin, cos, tan, sqrt, pow) or unit converters.
   - For Resume Builders & Document SaaS (e.g. "resume", "cv builder", "portfolio maker"):
     * Architecture: 'src/utils/resumeData.js' (schemas, sample profiles, export utilities), 'src/hooks/useResume.js' (CRUD on sections, local persistence), modular form sections, and switchable templates (Modern, Minimal, Executive).
   - For Dashboards & Productivity SaaS (e.g. "dashboard", "crm", "task board"):
     * Architecture: Custom hooks for data filtering/sorting, clean layout with sidebar/header, summary metric cards with trend badges, and interactive lists/tables.
6. SYNTAX INTEGRITY, MODULARITY & COMPLETION:
   - Ensure EVERY file is 100% syntactically complete.
   - All string literals, template strings, JSX tags, and brackets MUST be closed.
   - Keep project architecture modular yet concise (typically 5 to 9 focused, high-quality files). Consolidate related sub-forms/cards into clean, coherent modules rather than splitting into 20+ micro-files that risk token truncation.
   - Every file must have clean, complete imports and exports with zero broken syntax.
7. STRICT OUTPUT FORMAT:
   Return ONLY a valid JSON object with this exact structure:
   \`\`\`json
   {
     "title": "Short Descriptive Title",
     "description": "One sentence summary of the application",
     "summary": "Engineering summary: component architecture, features implemented, and key capabilities.",
     "entryFile": "src/main.jsx",
     "files": [
       {
         "path": "package.json",
         "content": "{\\n  \\"name\\": \\"orbit-app\\",\\n  \\"version\\": \\"1.0.0\\",\\n  \\"dependencies\\": {\\n    \\"react\\": \\"^18.2.0\\",\\n    \\"react-dom\\": \\"^18.2.0\\"\\n  }\\n}",
         "language": "json"
       },
       {
         "path": "index.html",
         "content": "<!DOCTYPE html>...",
         "language": "html"
       },
       {
         "path": "src/main.jsx",
         "content": "import React from 'react';...",
         "language": "jsx"
       },
       {
         "path": "src/App.jsx",
         "content": "export default function App() { ... }",
         "language": "jsx"
       },
       {
         "path": "src/hooks/useCalculator.js",
         "content": "export function useCalculator() { ... }",
         "language": "javascript"
       },
       {
         "path": "src/utils/calculatorEngine.js",
         "content": "export function evaluateExpression() { ... }",
         "language": "javascript"
       },
       {
         "path": "src/constants/keypadLayout.js",
         "content": "export const KEYPAD_BUTTONS = [ ... ];",
         "language": "javascript"
       },
       {
         "path": "src/styles/index.css",
         "content": "/* Custom CSS */",
         "language": "css"
       },
       {
         "path": "src/components/Display.jsx",
         "content": "export default function Display() { ... }",
         "language": "jsx"
       }
     ]
   }
   \`\`\`
   Do NOT omit the JSON code block. Output strictly valid JSON.`;

    const incrementalReactSystemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect modifying an existing React application.
The user wants to update, add features, create new components/templates, refactor, or style the existing React application.

CRITICAL INCREMENTAL UPDATE RULES:
1. DO NOT recreate unchanged files. ONLY emit operations for files that are created, updated, or deleted.
2. For any file you create or update, provide the COMPLETE, WORKING code. Never use placeholders (e.g. "// TODO", "// rest of your code here", "..."), truncated snippets, or diff notation.
3. Operations contract:
   - "update": Replaces the entire content of an existing file.
   - "create": Adds a new file to the project (e.g., 'src/components/NewTemplate.jsx', 'src/hooks/useNewFeature.js', 'src/utils/helper.js').
   - "delete": Removes an existing file from the project.
4. REACT ARCHITECTURE & CONVENTIONS:
   - Inspect the existing project files below to understand existing component hierarchy, state structure, props, and styling.
   - Respect Separation of Concerns: keep pure calculations/parsers in 'src/utils/', stateful hooks in 'src/hooks/', declarative configs in 'src/constants/', and presentational UI in 'src/components/'.
   - Avoid bloating 'src/App.jsx' into a monolithic file. Keep 'App.jsx' as a lightweight orchestrator.
   - Ensure all relative import paths are valid (e.g. from 'src/App.jsx' to './components/NewTemplate.jsx' or './hooks/useCustom.js').
   - If introducing a new external npm package, update 'package.json' to declare it in "dependencies".
   - Keep unchanged components and styling intact. Maintain high-quality Tailwind styling (modern rounded corners, CSS Grid layouts, soft elevations, active states). Never degrade styled UI to unstyled HTML.
5. STRICT OUTPUT FORMAT:
   Return ONLY a valid JSON object with this exact structure:
   \`\`\`json
   {
     "title": "${existing?.title || "Project Title"}",
     "description": "${existing?.description || "Project Description"}",
     "summary": "Engineering summary: detailed explanation of the changes made, files updated/added/deleted, and how to test the new features.",
     "operations": [
       {
         "type": "create",
         "path": "src/components/NewFeature.jsx",
         "content": "// Complete new component code..."
       },
       {
         "type": "update",
         "path": "src/App.jsx",
         "content": "// Complete updated App.jsx code..."
       }
     ]
   }
   \`\`\`
   Do NOT omit the JSON code block. Output strictly valid JSON.`;

    const newLegacyProjectSystemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect.
Your mission is to write complete, reliable, production-ready, beautiful code projects.

CRITICAL ARCHITECTURE & EXECUTION RULES:
1. NEVER produce truncated snippets, placeholders (e.g. "// TODO", "// rest of your code here", "..."), or pseudocode. Always provide the COMPLETE, WORKING code for every file.
2. BROWSER SANDBOX EXECUTION ENVIRONMENT:
   - Web applications execute directly in an in-browser sandbox iframe.
   - Do NOT use Node.js require() or unresolved bare npm imports (e.g. 'import React from "react"').
   - For UI libraries or utilities, use CDN scripts in HTML (e.g. https://cdn.tailwindcss.com, Chart.js, Lucide icons, or FontAwesome).
   - Write clean, modular Vanilla JavaScript. If multiple JS files are used, attach shared state/helpers to \`window\` (e.g., \`window.AppState = { ... }\`) rather than using import/export keywords that require a bundler.
3. COMPLETE INTERACTIVITY & STATE:
   - Provide an "index.html" as the entry point referencing <link rel="stylesheet" href="css/styles.css"> and <script src="js/script.js"></script>.
   - Ensure EVERY button, form submit, input filter, modal toggle, and tab in the UI has active event listeners with real working logic.
   - Wrap JavaScript initialization in \`document.addEventListener("DOMContentLoaded", () => { ... })\` or check element existence before attaching listeners to prevent null-element reference errors.
   - Persist application data/state in \`localStorage\` so the preview can be refreshed and tested interactively.
   - Keep sample datasets concise (3-5 realistic items) and UI logic cleanly modular so the complete application generates within token limits.
4. FOR BACKEND / UTILITIES:
   - When requested, provide complete file implementations (e.g., server.js, model.ts, solution.py).
5. STRICT OUTPUT FORMAT:
   Return ONLY a valid JSON object with this exact structure:
   \`\`\`json
   {
     "title": "Short Descriptive Title",
     "description": "One sentence summary of the project",
     "summary": "Engineering summary: key architectural choices, features implemented, and instructions to run or use it.",
     "entryFile": "index.html",
     "files": [
       {
         "path": "index.html",
         "content": "<!DOCTYPE html>... complete HTML markup ...",
         "language": "html"
       },
       {
         "path": "css/styles.css",
         "content": "/* Custom styles, transitions, animations */",
         "language": "css"
       },
       {
         "path": "js/script.js",
         "content": "// Complete working JavaScript logic...",
         "language": "javascript"
       }
     ]
   }
   \`\`\`
   Do NOT omit the JSON code block. Output strictly valid JSON.`;

    const incrementalLegacySystemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect modifying an existing code project.
The user wants to update, add features, refactor, or style the existing project.

CRITICAL INCREMENTAL UPDATE RULES:
1. DO NOT recreate unchanged files. ONLY emit operations for files that are created, updated, or deleted.
2. For any file you create or update, provide the COMPLETE, WORKING code. Never use placeholders (e.g. "// TODO", "// rest of your code here", "..."), truncated snippets, or diff notation.
3. Operations contract:
   - "update": Replaces the entire content of an existing file.
   - "create": Adds a new file to the project.
   - "delete": Removes an existing file from the project.
4. BROWSER SANDBOX EXECUTION ENVIRONMENT:
   - Web applications execute directly in an in-browser sandbox iframe.
   - Do NOT use Node.js require() or unresolved bare npm imports.
   - Use CDN scripts in HTML (e.g. https://cdn.tailwindcss.com, Lucide icons, Chart.js, etc.).
   - Wrap JavaScript initialization in document.addEventListener("DOMContentLoaded", () => { ... }).
   - Persist application data/state in localStorage.
5. STRICT OUTPUT FORMAT:
   Return ONLY a valid JSON object with this exact structure:
   \`\`\`json
   {
     "title": "${existing?.title || "Project Title"}",
     "description": "${existing?.description || "Project Description"}",
     "summary": "Engineering summary: detailed explanation of the changes made, files updated/added/deleted, and how to test the new features.",
     "operations": [
       {
         "type": "update",
         "path": "path/to/existing-file.js",
         "content": "// Complete updated file content..."
       },
       {
         "type": "create",
         "path": "path/to/new-component.js",
         "content": "// Complete new file content..."
       },
       {
         "type": "delete",
         "path": "path/to/obsolete-file.js"
       }
     ]
   }
   \`\`\`
   Do NOT omit the JSON code block. Output strictly valid JSON.`;

    let systemPrompt;
    if (isReact) {
        systemPrompt = hasExisting ? incrementalReactSystemPrompt : newReactProjectSystemPrompt;
    } else {
        systemPrompt = hasExisting ? incrementalLegacySystemPrompt : newLegacyProjectSystemPrompt;
    }

    let userMessage = "";
    if (hasExisting) {
        const fileManifest = includedFiles
            .map((f) => `### File: \`${f.path}\` (${f.language})\n\`\`\`${f.language}\n${f.content}\n\`\`\``)
            .join("\n\n");

        const omittedNotice = omittedFiles.length > 0
            ? `\n\n> Notice: The following ${omittedFiles.length} file(s) were omitted from the prompt due to context size limits: ${omittedFiles.map((f) => `\`${f.path}\``).join(", ")}. Do NOT modify omitted files unless explicitly asked.`
            : "";

        userMessage = `${conversationContext ? `Recent conversation context:\n${conversationContext}\n\n` : ""}EXISTING PROJECT CONTEXT:
Project Title: ${existing.title || (isReact ? "React Application" : "Web Application")}
Runtime: ${isReact ? "React (Sandpack Runtime)" : "Vanilla HTML/CSS/JS (Iframe Runtime)"}
Entry File: ${existing.entryFile || (isReact ? "src/main.jsx" : "index.html")}
Total Files: ${existing.files.length}

CURRENT PROJECT FILES:
${fileManifest}${omittedNotice}

USER REQUEST:
${userPrompt}`;
    } else {
        userMessage = `${conversationContext ? `Recent conversation context:\n${conversationContext}\n\n` : ""}User request:
${userPrompt}`;
    }

    let rawText = "";
    let retries = 0;

    onStage?.(
        "analyzing",
        hasExisting
            ? (isReact ? "Analyzing existing React component hierarchy and planning incremental changes..." : "Analyzing existing project structure and planning incremental changes...")
            : (isReact ? "Planning React application architecture & modular components..." : "Planning application architecture & multi-file structure...")
    );

    // Heartbeat: emit progress updates every 15 s so the frontend stage indicator stays alive
    const HEARTBEAT_MESSAGES = hasExisting
        ? (isReact
            ? [
                "Reviewing existing React components and dependencies...",
                "Applying incremental React file updates...",
                "Validating component imports and state management...",
                "Finalising project structure and preview...",
            ]
            : [
                "Reviewing existing project files...",
                "Applying incremental code updates...",
                "Validating component updates and styling...",
                "Finalising project structure...",
            ])
        : (isReact
            ? [
                "Setting up React project structure and package manifest...",
                "Building React components and modular UI...",
                "Implementing component state and event handlers...",
                "Finalising styling and responsive layouts...",
                "Completing React application code...",
            ]
            : [
                "Writing HTML structure and layout...",
                "Building CSS styles and responsive design...",
                "Generating JavaScript logic and interactions...",
                "Finalising data models and UI components...",
                "Completing application code...",
            ]);
    let heartbeatIdx = 0;
    let heartbeatTimer = null;
    const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
            if (state.isAborted?.()) { clearInterval(heartbeatTimer); return; }
            const msg = HEARTBEAT_MESSAGES[heartbeatIdx % HEARTBEAT_MESSAGES.length];
            onStage?.("generating", msg);
            heartbeatIdx++;
        }, 15_000);
    };
    const stopHeartbeat = () => { if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; } };

    try {
        onStage?.(
            "generating",
            hasExisting
                ? (isReact ? "Applying incremental React component updates..." : "Applying incremental file updates and generating new components...")
                : (isReact ? "Generating complete multi-file React application..." : "Generating complete HTML, CSS, and JavaScript project files...")
        );
        startHeartbeat();
        if (typeof llm.stream === "function") {
            const stream = await llm.stream([
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ]);
            for await (const chunk of stream) {
                if (state.isAborted?.()) {
                    console.log("Client aborted during coding generation stream; halting.");
                    break;
                }
                const textChunk = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
                rawText += textChunk;
                // Note: Raw code token streaming into the chat bubble is intentionally omitted for Coding Agent.
                // Stage-based SSE streaming powers the live progress card and reveals the full artifact upon bundling.
            }
        } else {
            const result = await llm.invoke([
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ]);
            rawText = extractText(result);
        }
        stopHeartbeat();
    } catch (err) {
        stopHeartbeat();
        console.warn("Coding Agent primary invoke failed, attempting simple prompt fallback:", err.message);
        retries++;
        try {
            startHeartbeat();
            const fallbackResult = await llm.invoke([
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage },
            ]);
            rawText = extractText(fallbackResult);
            stopHeartbeat();
        } catch (fallbackErr) {
            stopHeartbeat();
            console.error("Coding Agent fallback also failed:", fallbackErr.message);
            rawText = "";
        }
    }

    if (state.isAborted?.()) {
        console.log("Coding generation aborted before artifact parsing; halting.");
        return {
            ...state,
            codeArtifact: null,
            aiResponse: "",
        };
    }

    // If rawText is completely empty all providers failed (e.g. daily quota exhausted).
    // Throw so the controller emits a proper SSE error event instead of a blank response.
    if (!rawText || rawText.trim().length === 0) {
        throw new Error(
            "All AI providers are currently unavailable (likely due to rate limits or daily quota exhaustion). " +
            "Please wait a few minutes and try again, or try a shorter prompt.",
        );
    }

    onStage?.(
        "parsing",
        hasExisting
            ? "Validating updated files, applying security sandbox, and refreshing live preview..."
            : "Validating code files, applying security sandbox, and preparing live preview..."
    );
    let codeArtifact = parseCodeArtifact(rawText, userPrompt, existing, runtimeStrategy);

    // React Project Integrity Gate
    if (codeArtifact && codeArtifact.files && codeArtifact.files.length > 0) {
        const integrity = validateArtifactIntegrity(codeArtifact, runtimeStrategy);
        if (!integrity.valid) {
            console.warn(
                "Artifact produced integrity violations; attempting auto-repair:",
                integrity.errors.map((e) => e.message).join("; ")
            );
            const repaired = repairMissingReactImports(codeArtifact, integrity, runtimeStrategy);
            if (repaired && repaired.integrity?.valid) {
                codeArtifact = repaired;
            } else if (hasExisting) {
                console.warn("Unrepairable integrity violation in incremental turn; rolling back to prior valid artifact.");
                codeArtifact = existing;
            }
        }
    }

    // Build a comprehensive, helpful chat response for the user
    let aiResponse = "";
    if (codeArtifact && codeArtifact.files && codeArtifact.files.length > 0) {
        const fileListMarkdown = codeArtifact.files
            .map((f) => `- \`${f.path}\` (${f.language}, ${(f.size / 1024).toFixed(1)} KB)`)
            .join("\n");

        const previewNote = isReact
            ? (hasExisting
                ? "⚛️ **React Project Updated**: Sandpack live hot-reload preview is active in the side panel."
                : "⚛️ **React Application Ready**: Click **Preview** to launch the interactive multi-file workspace in Sandpack.")
            : (codeArtifact.previewType === "html"
                ? (hasExisting
                    ? "✨ **Live Preview Updated**: Click **Preview** in the artifact card to test your updated application."
                    : "✨ **Live Sandbox Preview Ready**: Click **Preview** in the artifact card to interact with the live application in the side panel.")
                : "📦 **Project Artifact Ready**: Inspect the source files below or click **Download ZIP**.");

        const headerTitle = hasExisting
            ? `### ${codeArtifact.title} (Updated)`
            : `### ${codeArtifact.title}`;

        const filesSectionTitle = hasExisting
            ? `#### Current Project Files (${codeArtifact.totalFiles} files)`
            : "#### Generated Project Files";

        aiResponse = `${headerTitle}\n\n${codeArtifact.description}\n\n${previewNote}\n\n${filesSectionTitle}\n${fileListMarkdown}`;

        // If the model had descriptive summary or advice, extract or append it
        if (codeArtifact.summary) {
            aiResponse += `\n\n${codeArtifact.summary}`;
        } else {
            const summaryMatch = rawText.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*?)"/);
            if (summaryMatch && summaryMatch[1]) {
                try {
                    aiResponse += `\n\n${JSON.parse(`"${summaryMatch[1]}"`)}`;
                } catch (_) {}
            } else {
                const nonJson = rawText.replace(/```[\s\S]*?```/g, "").replace(/\{[\s\S]*?\}/g, "").trim();
                if (nonJson.length > 20 && !nonJson.startsWith("{") && !nonJson.includes('"files"')) {
                    aiResponse += `\n\n${nonJson}`;
                }
            }
        }
    } else {
        aiResponse = rawText || "I generated the code based on your request, but could not produce a previewable project. Please review your request.";
    }

    const estTokens = Math.round(rawText.length / 4);

    return {
        ...state,
        aiResponse,
        codeArtifact: codeArtifact.files.length > 0 ? codeArtifact : null,
        modelUsed: llm.model,
        providerUsed: llm.provider || "groq",
        tokenUsage: { estimatedOutputTokens: estTokens },
        retries,
    };
};

export const coding = codingAgent;
