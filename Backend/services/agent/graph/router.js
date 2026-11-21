import { getModel } from "../config/llmModels.js";
import {
    SUPPORTED_AGENTS,
    AGENT_ALIASES,
    resolveAgentRoute,
    classifyTaskIntent,
    isCodingIntent,
    isPptIntent,
    isPdfIntent,
    isVisionIntent,
    hasPdfAttachment,
    hasImageAttachment,
} from "../utils/documentRouting.js";

// Backward compatibility exports for existing consumers and tests
export const supportedAgents = SUPPORTED_AGENTS;
export const agentAliases = AGENT_ALIASES;
export {
    resolveAgentRoute,
    classifyTaskIntent,
    isCodingIntent,
    isPptIntent,
    isPdfIntent,
    isVisionIntent,
    hasPdfAttachment,
    hasImageAttachment,
};

export const router = async (state) => {
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    // Evaluate deterministic routing priorities (Priorities 1, 2, 3, and default attachment handling)
    const routed = resolveAgentRoute(state);
    if (routed.agent) {
        return {
            ...state,
            agent: routed.agent,
            routingMetadata: routed,
        };
    }

    // Priority 4: Autonomous routing via router LLM for general prompts without attachments
    onStage?.("routing", "Analyzing request to select specialized agent...");
    let selected = "chat";
    try {
        const llm = getModel("router");
        const hasExistingProject =
            state?.existingCodeArtifact &&
            Array.isArray(state.existingCodeArtifact.files) &&
            state.existingCodeArtifact.files.length > 0;

        let projectContext = "No active code project in conversation";
        if (state.projectIntent?.intent === "CREATE_NEW_PROJECT") {
            projectContext = "Fresh Project Request: User requested building a brand new application from scratch.";
        } else if (hasExistingProject) {
            projectContext = `Active Project in Conversation: "${state.existingCodeArtifact.title || "Web Application"}" (files: ${(state.existingCodeArtifact.files || []).map((f) => f.path).join(", ")})`;
        }

        const prompt = `You are an agent router.

Available agents:
- chat: general conversation, writing, explanations, brainstorming, and day-to-day questions
- search: live web search, fact-checking, current events, and external research
- coding: software engineering, debugging, code generation, refactoring, and modifying/updating projects
- ppt: creating or editing slides, presentations, and deck content
- pdf: creating, generating, or analyzing PDF documents, cheat sheets, guides, and reports
- vision: analyzing attached images, or creating/generating new images, drawings, and illustrations

Rules:
1. If the user asks for coding, debugging, fixing code, architecture, or project implementation, choose coding.
2. If there is an active project in the conversation and the user asks to modify, style, update, fix, or add features to it (e.g. "add dark mode", "filter items", "change button color"), choose coding.
3. If the user asks for fresh facts, live web results, or research from external sources, choose search.
4. If the user wants a slide deck or presentation created or edited, choose ppt.
5. If the user wants a PDF document, cheat sheet, guide, or report created, choose pdf.
6. If the user wants an image, photo, drawing, or illustration created or generated, choose vision.
7. If the user asks general questions without specifying a document or code, choose chat.
8. If there is no clear match, default to chat.

Output format:
Return only one agent name with no extra words, punctuation, or explanation:
chat, search, coding, ppt, pdf, vision

Conversation Project Status:
${projectContext}

User request:
${state?.prompt ?? ""}
`;

        const result = await llm.invoke(prompt);
        const content = Array.isArray(result?.content)
            ? result.content.map((item) => item?.text ?? "").join("")
            : String(result?.content ?? "");

        const normalized = content.trim().toLowerCase().replace(/[^a-z]/g, "");
        const resolved = AGENT_ALIASES[normalized] || normalized;
        selected = SUPPORTED_AGENTS.has(resolved) ? resolved : "chat";
    } catch (error) {
        console.warn("Router LLM call failed, falling back to 'chat':", error.message);
        selected = "chat";
    }

    // Safety guard: if router chose vision without attachment and not image creation, route to chat.
    // If router chose pdf without attachment and not pdf creation/document inquiry, route to chat.
    const hasPdf = hasPdfAttachment(state);
    const hasImage = hasImageAttachment(state);
    if (!hasPdf && selected === "pdf" && !isPdfIntent(state.prompt)) {
        selected = "chat";
    }
    if (!hasImage && selected === "vision" && !isVisionIntent(state.prompt, state)) {
        selected = "chat";
    }

    return {
        ...state,
        agent: selected,
        routingMetadata: {
            agent: selected,
            priority: 4,
            reason: "Autonomous router LLM",
        },
    };
};
