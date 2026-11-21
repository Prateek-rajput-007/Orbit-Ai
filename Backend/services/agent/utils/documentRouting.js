/**
 * @file documentRouting.js
 * @description Intelligent Document-Aware Routing and Task Intent Classification for Orbit.
 * Enables Cross-Agent RAG routing so that uploaded documents and conversation document context
 * are correctly directed to Coding Agent, PPT Agent, or PDF Agent based on deterministic priorities:
 *
 * Priority 1: Explicit User Selection (agentMode !== "auto")
 * Priority 2: Explicit Task Intent (Coding / App Building, Presentation / Slides, PDF Analysis / Creation)
 * Priority 3: Existing Conversation Context (Follow-up project modifications, slide additions, document Q&A)
 * Priority 4: Default Routing (PDF attachment -> PDF Agent, Image -> Vision Agent, else Router LLM)
 */

export const SUPPORTED_AGENTS = new Set(["chat", "search", "coding", "pdf", "ppt", "vision"]);

export const AGENT_ALIASES = {
    image: "vision",
    images: "vision",
    picture: "vision",
    code: "coding",
    programming: "coding",
    presentation: "ppt",
    slides: "ppt",
    deck: "ppt",
};

/**
 * Checks if the state payload carries one or more PDF attachments.
 *
 * @param {object} state - LangGraph state
 * @returns {boolean} True if PDF attachment is detected
 */
export function hasPdfAttachment(state = {}) {
    if (!state) return false;

    const isPdf = (att) => Boolean(
        att &&
        (att.mimeType === "application/pdf" ||
         att.mimetype === "application/pdf" ||
         att.name?.toLowerCase().endsWith(".pdf") ||
         att.originalname?.toLowerCase().endsWith(".pdf"))
    );

    if (isPdf(state.attachment)) return true;
    if (Array.isArray(state.attachments) && state.attachments.some(isPdf)) return true;
    return false;
}

/**
 * Checks if the state payload carries an image attachment.
 *
 * @param {object} state - LangGraph state
 * @returns {boolean} True if image attachment is detected
 */
export function hasImageAttachment(state = {}) {
    if (!state) return false;

    const isImage = (att) => Boolean(
        att &&
        (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(att.mimeType) ||
         ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(att.mimetype) ||
         /\.(jpe?g|png|webp|gif)$/i.test(att.name || att.originalname || ""))
    );

    if (isImage(state.attachment)) return true;
    if (Array.isArray(state.attachments) && state.attachments.some(isImage)) return true;
    return false;
}

/**
 * Deterministically checks if a prompt expresses software engineering, application-building,
 * or code-generation intent. Guards against false positives from non-coding uses of the word "code".
 *
 * @param {string} prompt - User request
 * @returns {boolean} True if coding/application intent is detected
 */
export function isCodingIntent(prompt = "") {
    if (!prompt || typeof prompt !== "string") return false;
    const clean = prompt.trim();
    if (!clean) return false;

    // 1. Guard against non-coding uses of "code" (e.g. zip code, promo code, error code)
    // and questions asking about code snippets inside a document.
    const isInformationalCodeQuestion =
        /\b(postal\s*code|zip\s*code|promo\s*code|discount\s*code|coupon\s*code|area\s*code|error\s*code|code\s*of\s*(conduct|ethics)|dress\s*code)\b/i.test(clean) ||
        /^(what|where|who|explain|show|find|does)\s+.*\b(code\s+(snippet|example|sample|block|fragment|on\s+page))\b/i.test(clean);

    if (isInformationalCodeQuestion) {
        return false;
    }

    // 2. Explicit application, dashboard, or tool building
    // e.g. "Build a dashboard using these metrics", "Create a React application", "Develop a web app", "Build a React todo app"
    const isAppBuild = /\b(build|create|develop|code|implement|make|generate|construct|program|scaffold)\b.*\b(dashboard|app|application|website|webpage|page|portal|tool|calculator|widget|prototype|crm|tracker|landing\s*page|frontend|ui|interface|backend|api)\b/i.test(clean);

    // 3. Explicit React / framework construction
    // e.g. "Create this in React", "Build a component using React"
    const isReactConstruction = /\b(in\s+react|using\s+react|with\s+react|react\s+dashboard|react\s+component|react\s+app)\b/i.test(clean) &&
        /\b(build|create|make|code|generate|implement|design|develop)\b/i.test(clean);

    // 4. Code writing / script generation instructions
    // e.g. "Write a script to parse the figures", "Give me the code to implement..."
    const isCodeGeneration = /\b(write|generate|give\s+me|create|implement)\b.*\b(the\s+)?(code|script|program|function|algorithm)\s+(to|for|that)\b/i.test(clean);

    return isAppBuild || isReactConstruction || isCodeGeneration;
}

/**
 * Deterministically checks if a prompt expresses presentation, slide-deck, or PowerPoint intent.
 *
 * @param {string} prompt - User request
 * @returns {boolean} True if presentation/PPT intent is detected
 */
export function isPptIntent(prompt = "") {
    if (!prompt || typeof prompt !== "string") return false;
    const clean = prompt.trim();
    if (!clean) return false;

    // 1. Explicit presentation creation verbs + target
    // e.g. "Create an executive presentation", "Generate 10 slides from this report", "Make a pitch deck"
    const isPresentationCreation = /\b(create|generate|make|build|prepare|design|structure|produce|outline|draft)\b.*\b(presentation|slides?|slide\s*deck|deck|powerpoint|pitch\s*deck|keynote|pptx)\b/i.test(clean);

    // 2. Explicit slide count phrases (e.g. "10 slides", "six slides", "5-slide deck")
    const hasSlideCount = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\s*(-\s*)?(slides?|slide\s*deck)\b/i.test(clean);

    // 3. Known high-confidence executive deck phrases
    const isExecutiveDeck = /\b(executive\s+presentation|summary\s+deck|presentation\s+deck|pitch\s+deck|slide\s+deck)\b/i.test(clean);

    // 4. Conversion of documents into presentations
    // e.g. "Turn this report into a presentation", "Convert this PDF to slides"
    const isConversionToPpt = /\b(turn|convert|transform)\b.*\b(into|to)\b.*\b(presentation|slides?|deck|powerpoint|pitch\s*deck)\b/i.test(clean);

    // 5. Slide modification in follow-ups
    // e.g. "Add a conclusion slide", "Update slide 3", "Change the slide theme", "Change theme or slide design"
    const isSlideModification = /\b(add|insert|create|include)\b.*\b(slide|conclusion\s*slide|summary\s*slide|title\s*slide)\b/i.test(clean) ||
        /\b(update|change|edit|modify)\s+slide\s+\d+\b/i.test(clean) ||
        /\b(update|change|edit|modify|redesign)\b.*\b(presentation|slide|slides|deck)\s*(theme|design|style|color|layout)\b/i.test(clean) ||
        /\b(change|update|switch)\s+(the\s+)?(theme|slide\s+design|presentation\s+style)\b/i.test(clean);

    return isPresentationCreation || hasSlideCount || isExecutiveDeck || isConversionToPpt || isSlideModification;
}

/**
 * Deterministically checks if a prompt expresses PDF document creation or document-specific analysis.
 *
 * @param {string} prompt - User request
 * @returns {boolean} True if PDF generation or document question intent is detected
 */
export function isPdfIntent(prompt = "") {
    if (!prompt || typeof prompt !== "string") return false;
    const clean = prompt.trim();
    if (!clean) return false;

    // 1. Explicit request to generate / compile a new PDF document or cheat sheet
    const isCreatePdf = /\b(create|generate|make|build|export|write|compile|prepare)\b.*\b(pdf|cheat\s*sheet|document|handout|report)\b/i.test(clean) ||
        /\bpdf\b.*\b(interview|question|cheat\s*sheet|guide|report|summary)\b/i.test(clean);

    // 2. Explicit question / inquiry about an existing document or document evidence
    const isDocQuestion = /\b(summarize|summary\s+of)\s+(this|the|my)?\s*(document|pdf|report|paper|file|attachment|whitepaper)\b/i.test(clean) ||
        /\b(in|from|according\s+to)\s+(this|the)\s+(document|pdf|report|paper|file)\b/i.test(clean) ||
        /\bexplain\s+(this|the)\s+(chart|table|graph|figure|diagram|section)\b/i.test(clean) ||
        /\bcompare\s+(these|the)\s+(financial\s+)?(figures|numbers|metrics|data|tables|charts)\b/i.test(clean) ||
        /\b(what|who|where|how|why|does|is|are)\b.*\b(on\s+page\s+\d+|in\s+section\s+\d+|in\s+table\s+\d+)\b/i.test(clean) ||
        /\bwhat\s+does\s+page\s+\d+\s+say\b/i.test(clean);

    return isCreatePdf || isDocQuestion;
}

/**
 * Deterministically checks if a prompt expresses image creation or visual analysis.
 *
 * @param {string} prompt - User request
 * @param {object} [state={}] - LangGraph state
 * @returns {boolean} True if image/vision intent is detected
 */
export function isVisionIntent(prompt = "", state = {}) {
    if (hasImageAttachment(state)) {
        return true;
    }
    const clean = (prompt || "").trim();
    const isImageQuery = /\b(in|of|about|from|on|inside|describe|explain|detail|what|who|where|how|why|is|are|was|were)\s+.*\b(this|that|the|my|our)\s+(image|picture|photo)\b/i.test(clean);
    const isCreateImage = !isImageQuery && (
        /\b(create|generate|make|draw|paint|render|produce|show|find|fetch|search|get)\b.*\b(image|picture|photo|illustration|drawing|artwork|portrait|sketch|wallpaper)\b/i.test(clean) ||
        /\b(image|picture|photo|illustration|drawing)\b.*\b(of|for)\s+[a-z0-9]/i.test(clean) ||
        /^(a\s+)?[a-z0-9_-]+\s+(image|picture|photo|illustration|wallpaper)s?$/i.test(clean) ||
        /^(draw|paint)\s+(a|an|the)?\s+[a-z0-9]/i.test(clean)
    );
    return isCreateImage;
}

/**
 * Classifies task intent from prompt and conversation context.
 *
 * @param {string} prompt - User request
 * @param {object} [context={}] - Context metadata (attachments, active project, history)
 * @returns {{
 *   intent: "coding" | "ppt" | "pdf" | "vision" | null,
 *   confidence: number,
 *   reason: string
 * }}
 */
export function classifyTaskIntent(prompt = "", context = {}) {
    const cleanPrompt = (prompt || "").trim();

    // 1. Coding Intent takes precedence if building an application or code
    if (isCodingIntent(cleanPrompt)) {
        return {
            intent: "coding",
            confidence: 0.95,
            reason: "Explicit application-building or code-generation intent",
        };
    }

    // 2. PPT Intent
    if (isPptIntent(cleanPrompt)) {
        return {
            intent: "ppt",
            confidence: 0.95,
            reason: "Explicit presentation or slide-deck generation intent",
        };
    }

    // 3. PDF Intent (Creation or Document Q&A)
    if (isPdfIntent(cleanPrompt)) {
        return {
            intent: "pdf",
            confidence: 0.9,
            reason: "Explicit PDF creation or document-specific inquiry",
        };
    }

    // 4. Vision Intent
    if (isVisionIntent(cleanPrompt, context)) {
        return {
            intent: "vision",
            confidence: 0.9,
            reason: "Image creation or visual analysis intent",
        };
    }

    return {
        intent: null,
        confidence: 0.0,
        reason: "No explicit deterministic intent detected",
    };
}

/**
 * Resolves the target agent destination following Orbit's 4-tier routing priority:
 *
 * Priority 1: Explicit user agent selection (agentMode !== "auto")
 * Priority 2: Explicit task intent (Coding, PPT, PDF, Vision)
 * Priority 3: Existing conversation context (Follow-ups to active projects, slides, documents)
 * Priority 4: Default routing (PDF attachment -> PDF, Image -> Vision, else Router LLM)
 *
 * @param {object} state - LangGraph state object
 * @returns {{
 *   agent: string | null,
 *   priority: number,
 *   reason: string
 * }}
 */
export function resolveAgentRoute(state = {}) {
    const prompt = (state?.prompt || "").trim();
    const hasPdf = hasPdfAttachment(state);
    const hasImage = hasImageAttachment(state);

    // =========================================================================
    // PRIORITY 1: Explicit user agent selection
    // =========================================================================
    if (state?.agentMode && state.agentMode !== "auto") {
        const resolved = AGENT_ALIASES[state.agentMode] || state.agentMode;
        if (SUPPORTED_AGENTS.has(resolved)) {
            return {
                agent: resolved,
                priority: 1,
                reason: `Explicit user selection: ${state.agentMode}`,
            };
        }
    }

    // =========================================================================
    // PRIORITY 2: Explicit task intent (evaluated on current prompt)
    // =========================================================================
    const taskIntent = classifyTaskIntent(prompt, state);
    if (taskIntent.intent) {
        return {
            agent: taskIntent.intent,
            priority: 2,
            reason: taskIntent.reason,
        };
    }

    // Pure conceptual coding question with active project intent
    if (state?.projectIntent?.intent === "GENERAL_CODING_QUESTION") {
        return {
            agent: "chat",
            priority: 2,
            reason: "Pure conceptual coding question without project mutation",
        };
    }

    // =========================================================================
    // PRIORITY 3: Existing conversation context (Follow-ups)
    // =========================================================================
    const hasExistingProject = Boolean(
        state?.existingCodeArtifact &&
        Array.isArray(state.existingCodeArtifact.files) &&
        state.existingCodeArtifact.files.length > 0
    );

    // 3.1 Follow-up modification to active code project
    if (hasExistingProject) {
        const isProjectModification =
            state.projectIntent?.intent === "MODIFY_EXISTING_PROJECT" ||
            /\b(add|update|modify|change|fix|style|tweak|improve|refactor|remove|delete)\b/i.test(prompt) ||
            /\b(filter|button|dark\s*mode|theme|layout|navbar|sidebar|component|table|chart|modal|page)\b/i.test(prompt);

        if (isProjectModification) {
            return {
                agent: "coding",
                priority: 3,
                reason: "Follow-up modification to active conversation code project",
            };
        }
    }

    // 3.2 Follow-up to active slide deck
    if (state?.slides && Array.isArray(state.slides) && state.slides.length > 0) {
        const isSlideFollowUp = /\b(slide|conclusion|next\s+step|presentation|theme)\b/i.test(prompt);
        if (isSlideFollowUp) {
            return {
                agent: "ppt",
                priority: 3,
                reason: "Follow-up modification to active presentation slide deck",
            };
        }
    }

    // =========================================================================
    // PRIORITY 4: Default routing
    // =========================================================================
    // 4.1 If a PDF attachment is present, default ordinary queries to PDF Agent
    if (hasPdf) {
        return {
            agent: "pdf",
            priority: 4,
            reason: "PDF attachment present with default document handling",
        };
    }

    // 4.2 If an image attachment is present, default to Vision Agent
    if (hasImage) {
        return {
            agent: "vision",
            priority: 4,
            reason: "Image attachment present with default vision handling",
        };
    }

    // 4.3 Needs autonomous router LLM evaluation
    return {
        agent: null,
        priority: 4,
        reason: "Requires router LLM evaluation",
    };
}
