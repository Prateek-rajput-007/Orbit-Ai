import { getModel } from "../config/llmModels.js";

const supportedAgents = new Set(["chat", "search", "coding", "pdf", "ppt", "vision"]);
const agentAliases = {
    image: "vision",
    images: "vision",
    picture: "vision",
    code: "coding",
    programming: "coding",
    presentation: "ppt",
    slides: "ppt",
    deck: "ppt",
};

export const router = async (state) => {
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    // 1. Explicit user selection
    if (state.agentMode && state.agentMode !== "auto") {
        const resolved = agentAliases[state.agentMode] || state.agentMode;
        const agent = supportedAgents.has(resolved) ? resolved : "chat";
        return { ...state, agent };
    }

    // 2. Attachment-driven routing
    if (state.attachment) {
        const agent = state.attachment.mimeType === "application/pdf" ? "pdf" : "vision";
        return { ...state, agent };
    }

    // 2.5 Explicit intent check for PDF generation
    const isCreatePdf = /\b(create|generate|make|build|export|write)\b.*\b(pdf|cheat\s*sheet|document|handout)\b/i.test(state.prompt || "") ||
                        /\bpdf\b.*\b(interview|question|cheat\s*sheet|guide|report|summary)\b/i.test(state.prompt || "");
    if (isCreatePdf) {
        return { ...state, agent: "pdf" };
    }

    // 2.6 Explicit intent check for image generation / retrieval
    const cleanPrompt = (state.prompt || "").trim();
    const isImageQuery = /\b(in|of|about|from|on|inside|describe|explain|detail|what|who|where|how|why|is|are|was|were)\s+.*\b(this|that|the|my|our)\s+(image|picture|photo)\b/i.test(cleanPrompt);
    const isCreateImage = !isImageQuery && (
        /\b(create|generate|make|draw|paint|render|produce|show|find|fetch|search|get)\b.*\b(image|picture|photo|illustration|drawing|artwork|portrait|sketch|wallpaper)\b/i.test(cleanPrompt) ||
        /\b(image|picture|photo|illustration|drawing)\b.*\b(of|for)\s+[a-z0-9]/i.test(cleanPrompt) ||
        /^(a\s+)?[a-z0-9_-]+\s+(image|picture|photo|illustration|wallpaper)s?$/i.test(cleanPrompt) ||
        /^(draw|paint)\s+(a|an|the)?\s+[a-z0-9]/i.test(cleanPrompt)
    );
    if (isCreateImage) {
        return { ...state, agent: "vision" };
    }

    // 3. Autonomous routing via router LLM
    onStage?.("routing", "Analyzing request to select specialized agent...");
    let selected = "chat";
    try {
        const llm = getModel("router");
        const prompt = `You are an agent router.

Available agents:
- chat: general conversation, writing, explanations, brainstorming, and day-to-day questions
- search: live web search, fact-checking, current events, and external research
- coding: software engineering, debugging, code generation, refactoring, and project work
- ppt: creating or editing slides, presentations, and deck content
- pdf: creating, generating, or analyzing PDF documents, cheat sheets, guides, and reports
- vision: analyzing attached images, or creating/generating new images, drawings, and illustrations

Rules:
1. If the user asks for coding, debugging, fixing code, architecture, or project implementation, choose coding.
2. If the user asks for fresh facts, live web results, or research from external sources, choose search.
3. If the user wants a slide deck or presentation created or edited, choose ppt.
4. If the user wants a PDF document, cheat sheet, guide, or report created, choose pdf.
5. If the user wants an image, photo, drawing, or illustration created or generated, choose vision.
6. If the user asks general questions without specifying a document or code, choose chat.
7. If there is no clear match, default to chat.

Output format:
Return only one agent name with no extra words, punctuation, or explanation:
chat, search, coding, ppt, pdf, vision

User request:
${state?.prompt ?? ""}
`;

        const result = await llm.invoke(prompt);
        const content = Array.isArray(result?.content)
            ? result.content.map((item) => item?.text ?? "").join("")
            : String(result?.content ?? "");

        const normalized = content.trim().toLowerCase().replace(/[^a-z]/g, "");
        const resolved = agentAliases[normalized] || normalized;
        selected = supportedAgents.has(resolved) ? resolved : "chat";
    } catch (error) {
        console.warn("Router LLM call failed, falling back to 'chat':", error.message);
        selected = "chat";
    }

    // Safety guard: if router chose vision without attachment, route to chat.
    // If router chose pdf without attachment and it is not a PDF creation request, route to chat.
    if (!state.attachment && selected === "pdf" && !isCreatePdf) {
        selected = "chat";
    }
    if (!state.attachment && selected === "vision" && !isCreateImage) {
        selected = "chat";
    }

    return {
        ...state,
        agent: selected,
    };
};
