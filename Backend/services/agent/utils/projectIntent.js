/**
 * Project Intent Classification Module for Orbit Coding Agent.
 *
 * Deterministically classifies user intent into one of four states:
 * 1. MODIFY_EXISTING_PROJECT: Modify, extend, style, or fix the current project.
 * 2. CREATE_NEW_PROJECT: Start a brand-new, independent project without inheriting files.
 * 3. GENERAL_CODING_QUESTION: Technical or conceptual explanation without project mutation.
 * 4. AMBIGUOUS_INTENT: Unclear whether user intends to modify or replace; requires clarification.
 */

export const PROJECT_INTENTS = {
    MODIFY_EXISTING_PROJECT: "MODIFY_EXISTING_PROJECT",
    CREATE_NEW_PROJECT: "CREATE_NEW_PROJECT",
    GENERAL_CODING_QUESTION: "GENERAL_CODING_QUESTION",
    AMBIGUOUS_INTENT: "AMBIGUOUS_INTENT",
};

export const PROJECT_RUNTIME_STRATEGIES = {
    REACT_APPLICATION: "REACT_APPLICATION",
    LEGACY_WEB_APPLICATION: "LEGACY_WEB_APPLICATION",
};

/**
 * Checks if a CodeArtifact is already a React application.
 */
export function isArtifactReactProject(artifact) {
    if (!artifact || !Array.isArray(artifact.files) || artifact.files.length === 0) {
        return false;
    }
    return artifact.files.some((f) => {
        const pathLower = (f.path || "").toLowerCase();
        if (
            pathLower.endsWith(".jsx") ||
            pathLower.endsWith(".tsx") ||
            pathLower.includes("components/") ||
            pathLower.includes("src/app.") ||
            pathLower.includes("src/main.")
        ) {
            return true;
        }
        if (pathLower === "package.json" && typeof f.content === "string") {
            try {
                const pkg = JSON.parse(f.content);
                const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                if (all.react || all["react-dom"]) return true;
            } catch {
                // fall through
            }
        }
        if (typeof f.content === "string") {
            if (/from\s+["']react["']/.test(f.content) || /from\s+["']react-dom(\/client)?["']/.test(f.content)) {
                return true;
            }
        }
        return false;
    });
}

/**
 * Deterministically decides whether to use modern React generation or legacy HTML/CSS/JS.
 *
 * @param {string} promptText
 * @param {object|null} existingArtifact
 * @returns {"REACT_APPLICATION"|"LEGACY_WEB_APPLICATION"}
 */
export function determineProjectRuntimeStrategy(promptText = "", existingArtifact = null) {
    const cleanPrompt = (promptText || "").trim();

    // 1. Check if an existing project is being modified
    const hasExisting = Boolean(
        existingArtifact &&
        Array.isArray(existingArtifact.files) &&
        existingArtifact.files.length > 0
    );

    if (hasExisting) {
        // Explicit request to migrate existing project to React
        const isMigrationToReact = /\b(convert|migrate|rewrite|upgrade|switch)\b.*\b(to\s+react|in\s+react|into\s+react)\b/i.test(cleanPrompt);
        if (isMigrationToReact) {
            return PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION;
        }

        // Preserve runtime of active project
        return isArtifactReactProject(existingArtifact)
            ? PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION
            : PROJECT_RUNTIME_STRATEGIES.LEGACY_WEB_APPLICATION;
    }

    // 2. New project requests:
    // Check for explicit signals requesting vanilla / plain HTML / static website
    const hasWithoutReact = /\b(without|no|not)\s+react\b/i.test(cleanPrompt);
    const isExplicitLegacy =
        hasWithoutReact ||
        /\b(vanilla\s+(javascript|js)|plain\s+(html|javascript|js)|pure\s+(html|js)|simple\s+(html\s+)?landing\s+page|static\s+(website|webpage|page|site)|html\s+(and|&)\s+css\s+only|no\s+frameworks?)\b/i.test(cleanPrompt);
    const mentionsReact = !hasWithoutReact && /\b(react|jsx|nextjs|spa)\b/i.test(cleanPrompt);

    if (isExplicitLegacy && !mentionsReact) {
        return PROJECT_RUNTIME_STRATEGIES.LEGACY_WEB_APPLICATION;
    }

    // Modern application requests default to React
    return PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION;
}

/**
 * Patterns matching pure technical/conceptual questions that should not modify or create projects.
 */
const GENERAL_QUESTION_PATTERNS = [
    /^(explain|what\s+is|what\s+are|how\s+does|how\s+do|why\s+is|why\s+are|tell\s+me\s+about|what\s+does\s+.*\s+mean|difference\s+between|compare\s+.*\s+and)\b/i,
    /\b(how\s+do\s+react\s+hooks\s+work|what\s+is\s+the\s+difference\s+between\s+usememo\s+and\s+usecallback|explain\s+closures(\s+in\s+javascript)?|how\s+does\s+a\s+react\s+component\s+lifecycle\s+work)\b/i,
];

/**
 * Technical terms commonly queried in informational questions.
 */
const TECHNICAL_EXPLANATION_TOPICS = [
    /\b(react\s+hooks?|usememo|usecallback|usestate|useeffect|lifecycle|closure|closures|prototype|prototypal|hoisting|event\s+loop|promise|promises|async\s+await|garbage\s+collection|virtual\s+dom|redux|jwt|cors|csrf|xss|sql\s+injection|rest\s+api|graphql|css\s+grid|flexbox|box\s+model)\b/i,
];

/**
 * Strong explicit signals for starting a completely new project.
 */
const EXPLICIT_NEW_PROJECT_PATTERNS = [
    /\b(completely\s+new|brand\s+new|from\s+scratch|fresh\s+project|fresh\s+application|fresh\s+app|start\s+fresh|start\s+over|start\s+from\s+scratch)\b/i,
    /\b(forget|ignore|discard|drop)\s+(the\s+)?(previous|last|old|current|existing)?\s*([a-zA-Z0-9_-]+\s+)?(todo|calculator|weather|app|application|project)?\s*(and|,|\.)?\s*(build|create|make|start|generate)\b/i,
    /\bstart\s+a\s+(completely\s+)?different\s+(application|app|project|website)\s+(unrelated|independent)\b/i,
    /\b(create|build|make|start)\s+(a\s+)?(completely\s+)?new\s+([a-zA-Z0-9_-]+\s+)?(calculator|weather|e-commerce|ecommerce|portfolio|blog|dashboard|game|chat|crm|tracker|app|application|project|website)\s+(from\s+scratch|instead)\b/i,
    /\b(start|build|create)\s+a\s+fresh\s+project\s+for\b/i,
];

/**
 * Patterns indicating modification of the active project, EVEN if the word "new" is used
 * (e.g., "add a new component", "create a new page in my existing app").
 */
const MODIFICATION_SUB_ELEMENT_PATTERNS = [
    /\b(add|create|insert|build|include)\s+(a\s+)?new\s+(component|page|view|tab|route|modal|button|card|section|filter|input|form|hook|helper|feature|function|file)\b/i,
    /\bin\s+(the|this|my|our)\s+(current|existing)?\s*(app|application|project|code|dashboard|site)\b/i,
    /\bto\s+(the|this|my|our)\s+(current|existing)?\s*(app|application|project|code|dashboard|site)\b/i,
    /\bfor\s+(the|this|my|our)\s+(current|existing)?\s*(app|application|project|code|dashboard|site)\b/i,
    /\bkeep\s+(the|all|my)?\s*(current|existing)?\s*.*\s*but\s+(add|create|change|update|fix)\b/i,
    /\bpreserve\s+(all\s+)?(existing|current)?\s*(functionality|features?|logic|styles?|code)?\b/i,
];

/**
 * General modification action verbs and project styling/logic terms.
 */
const GENERAL_MODIFICATION_PATTERNS = [
    /\b(add|update|modify|change|fix|style|tweak|improve|refactor|integrate|extend|enhance|remove|delete)\s+(dark\s*mode|theme|task\s*filters?|filters?|button|layout|styling|css|styles|component|modal|sidebar|navbar|header|footer|responsive|mobile|login|form|search|table|grid|state|persistence|localstorage|bug|error)\b/i,
    /\b(add\s+dark\s*mode|add\s+task\s*filters?|change\s+the\s+primary\s+button\s+styling|fix\s+the\s+mobile\s+layout|update\s+the\s+login\s+form|fix\s+the\s+bug)\b/i,
];

/**
 * Ambiguous requests that don't specify whether to update or replace.
 */
const AMBIGUOUS_PATTERNS = [
    /^(build|create|make)\s+another\s+(dashboard|app|application|project|page|view)$/i,
    /^(make|create|build)\s+a\s+different\s+version(\s+of\s+this)?$/i,
    /^change\s+the\s+application$/i,
    /^(create|add)\s+a\s+new\s+page$/i,
];

/**
 * Classifies the user request into an explicit project intent.
 *
 * @param {string} promptText The user's input prompt.
 * @param {object|null} existingArtifact The latest valid CodeArtifact in the conversation.
 * @param {Array|null} history Conversation history.
 * @returns {{
 *   intent: string,
 *   confidence: number,
 *   reason: string,
 *   shouldUseExistingArtifact: boolean,
 *   clarificationPrompt?: string
 * }}
 */
export function classifyProjectIntent(promptText = "", existingArtifact = null, history = []) {
    const cleanPrompt = (promptText || "").trim();
    const runtimeStrategy = determineProjectRuntimeStrategy(cleanPrompt, existingArtifact);

    const hasExisting = Boolean(
        existingArtifact &&
        Array.isArray(existingArtifact.files) &&
        existingArtifact.files.length > 0
    );

    // If there is no existing artifact in the conversation, the request is either a general question or a new project
    if (!hasExisting) {
        // Check for general coding question
        const isQuestion = GENERAL_QUESTION_PATTERNS.some((p) => p.test(cleanPrompt));
        const hasTopic = TECHNICAL_EXPLANATION_TOPICS.some((p) => p.test(cleanPrompt));
        if (isQuestion && hasTopic) {
            return {
                intent: PROJECT_INTENTS.GENERAL_CODING_QUESTION,
                confidence: 0.95,
                reason: "Pure technical explanation requested with no existing project.",
                shouldUseExistingArtifact: false,
                runtimeStrategy,
            };
        }

        return {
            intent: PROJECT_INTENTS.CREATE_NEW_PROJECT,
            confidence: 1.0,
            reason: "No prior project artifact exists in this conversation.",
            shouldUseExistingArtifact: false,
            runtimeStrategy,
        };
    }

    // --- Active Project Exists: Determine Intent ---

    // 1. General Technical Question check
    const isQuestionStarter = GENERAL_QUESTION_PATTERNS.some((p) => p.test(cleanPrompt));
    const hasTechnicalTopic = TECHNICAL_EXPLANATION_TOPICS.some((p) => p.test(cleanPrompt));
    const hasModificationAction = MODIFICATION_SUB_ELEMENT_PATTERNS.some((p) => p.test(cleanPrompt)) ||
                                  GENERAL_MODIFICATION_PATTERNS.some((p) => p.test(cleanPrompt));

    if (isQuestionStarter && hasTechnicalTopic && !hasModificationAction) {
        return {
            intent: PROJECT_INTENTS.GENERAL_CODING_QUESTION,
            confidence: 0.95,
            reason: "User asked a general coding/architectural question without requesting project changes.",
            shouldUseExistingArtifact: false,
            runtimeStrategy,
        };
    }

    // 2. Ambiguous request check
    const isAmbiguous = AMBIGUOUS_PATTERNS.some((p) => p.test(cleanPrompt));
    if (isAmbiguous) {
        const title = existingArtifact.title || "existing application";
        return {
            intent: PROJECT_INTENTS.AMBIGUOUS_INTENT,
            confidence: 0.5,
            reason: "Request is ambiguous between updating the current project and starting a new project.",
            shouldUseExistingArtifact: false,
            runtimeStrategy,
            clarificationPrompt: `Would you like to update your current project (**${title}**) with this change, or create a completely new project from scratch? Please let me know how you'd like to proceed.`,
        };
    }

    // 3. Explicit Modification Guard (e.g. "add a new component", "create a new page in my existing app")
    const isExplicitSubElement = MODIFICATION_SUB_ELEMENT_PATTERNS.some((p) => p.test(cleanPrompt));
    if (isExplicitSubElement) {
        return {
            intent: PROJECT_INTENTS.MODIFY_EXISTING_PROJECT,
            confidence: 0.95,
            reason: "User requested adding a new sub-element or feature to the existing project.",
            shouldUseExistingArtifact: true,
            runtimeStrategy,
        };
    }

    // 4. Explicit New Project check
    const isExplicitNewProject = EXPLICIT_NEW_PROJECT_PATTERNS.some((p) => p.test(cleanPrompt));
    if (isExplicitNewProject) {
        return {
            intent: PROJECT_INTENTS.CREATE_NEW_PROJECT,
            confidence: 0.98,
            reason: "User explicitly requested starting a brand-new project from scratch or replacing previous work.",
            shouldUseExistingArtifact: false,
            runtimeStrategy,
        };
    }

    // 5. General modification patterns
    const isGeneralModification = GENERAL_MODIFICATION_PATTERNS.some((p) => p.test(cleanPrompt));
    if (isGeneralModification) {
        return {
            intent: PROJECT_INTENTS.MODIFY_EXISTING_PROJECT,
            confidence: 0.9,
            reason: "User requested styling, features, or bug fixes on the active project.",
            shouldUseExistingArtifact: true,
            runtimeStrategy,
        };
    }

    // 6. Check for creation of a completely different application domain
    // E.g. prompt has "build a calculator", "create a weather app", "make a snake game"
    // and mentions neither the existing project nor sub-components.
    const isBuildNewApp = /\b(create|build|make|generate)\s+(a\s+|an\s+)?([a-zA-Z0-9_-]+\s+)?(calculator|weather|snake|e-commerce|ecommerce|portfolio|blog|game|chat|crm|tracker|app|application|website)\b/i.test(cleanPrompt);
    const existingTitleLower = (existingArtifact.title || "").toLowerCase();
    const promptLower = cleanPrompt.toLowerCase();
    const mentionsExistingTitle = existingTitleLower.length > 3 && promptLower.includes(existingTitleLower);

    if (isBuildNewApp && !mentionsExistingTitle && !isExplicitSubElement) {
        // If the prompt explicitly asks to build an application in another domain without mentioning the existing project
        return {
            intent: PROJECT_INTENTS.CREATE_NEW_PROJECT,
            confidence: 0.85,
            reason: "User requested building a different application domain without referencing the existing project.",
            shouldUseExistingArtifact: false,
            runtimeStrategy,
        };
    }

    // Default when active project exists: modify existing project safely
    return {
        intent: PROJECT_INTENTS.MODIFY_EXISTING_PROJECT,
        confidence: 0.75,
        reason: "Follow-up request in conversation with active project defaults to modifying existing project.",
        shouldUseExistingArtifact: true,
        runtimeStrategy,
    };
}

