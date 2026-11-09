import { getModel } from "../config/llmModels.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";
import { parseCodeArtifact } from "../utils/codeArtifact.js";

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

    const systemPrompt = `You are Orbit's Senior Staff Software Engineer and Coding Architect.
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

    const userMessage = `${conversationContext ? `Recent conversation context:\n${conversationContext}\n\n` : ""}User request:
${userPrompt}`;

    let rawText = "";
    let retries = 0;

    onStage?.("analyzing", "Planning application architecture & multi-file structure...");

    // Heartbeat: emit progress updates every 15 s so the frontend stage indicator stays alive
    // during long generations (PaisaPilot-scale apps can take 60–120 s to generate ~23K tokens).
    const HEARTBEAT_MESSAGES = [
        "Writing HTML structure and layout...",
        "Building CSS styles and responsive design...",
        "Generating JavaScript logic and interactions...",
        "Finalising data models and UI components...",
        "Completing application code...",
    ];
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
        onStage?.("generating", "Generating complete HTML, CSS, and JavaScript project files...");
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

    onStage?.("parsing", "Validating code files, applying security sandbox, and preparing live preview...");
    const codeArtifact = parseCodeArtifact(rawText, userPrompt);

    // Build a comprehensive, helpful chat response for the user
    let aiResponse = "";
    if (codeArtifact && codeArtifact.files && codeArtifact.files.length > 0) {
        const fileListMarkdown = codeArtifact.files
            .map((f) => `- \`${f.path}\` (${f.language}, ${(f.size / 1024).toFixed(1)} KB)`)
            .join("\n");

        const previewNote = codeArtifact.previewType === "html"
            ? "✨ **Live Sandbox Preview Ready**: Click **Preview** in the artifact card to interact with the live application in the side panel."
            : "📦 **Project Artifact Ready**: Inspect the source files below or click **Download ZIP**.";

        aiResponse = `### ${codeArtifact.title}\n\n${codeArtifact.description}\n\n${previewNote}\n\n#### Generated Project Files\n${fileListMarkdown}`;

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
