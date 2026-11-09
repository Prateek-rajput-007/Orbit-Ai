/**
 * Cleans and normalizes parsed deck data into a strict schema.
 */
export const normalizeDeck = (data = {}, userPrompt = "") => {
    const rawTitle = data.deckTitle || data.title || userPrompt.slice(0, 50) || "Presentation Deck";
    const deckTitle = String(rawTitle).trim();
    const summary = typeof data.summary === "string" ? data.summary.trim() : "";

    const rawSlides = Array.isArray(data.slides) ? data.slides : [];
    const slides = rawSlides.map((slide, index) => {
        const slideNumber = Number(slide.slideNumber) || index + 1;
        const title = String(slide.title || `Slide ${slideNumber}`).trim();
        const subtitle = slide.subtitle ? String(slide.subtitle).trim() : "";
        const rawBullets = Array.isArray(slide.bullets)
            ? slide.bullets
            : (typeof slide.content === "string" ? slide.content.split("\n") : []);
        const bullets = rawBullets
            .map((b) => String(b).replace(/^[•\-\*\d\.\s]+/, "").trim())
            .filter(Boolean);

        return {
            slideNumber,
            title,
            subtitle,
            bullets: bullets.length > 0 ? bullets : ["Overview and strategic insights."],
            speakerNotes: slide.speakerNotes ? String(slide.speakerNotes).trim() : "",
        };
    });

    return {
        deckTitle,
        summary,
        slides: slides.length > 0 ? slides : createFallbackDeck(userPrompt).slides,
    };
};

/**
 * Synthesizes a structured slide deck from unformatted text or prompt.
 */
export const createFallbackDeck = (userPrompt = "", rawText = "") => {
    const title = userPrompt ? userPrompt.slice(0, 45) : "Orbit Executive Deck";
    const cleanLines = rawText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const bullets = cleanLines.length > 0
        ? cleanLines.slice(0, 5)
        : ["Key strategic objective", "Implementation considerations", "Expected outcomes"];

    return {
        deckTitle: title,
        summary: "Executive slide deck generated from your prompt.",
        slides: [
            {
                slideNumber: 1,
                title,
                subtitle: "Strategic Presentation & Executive Briefing",
                bullets: ["Prepared with Orbit AI", "Executive Summary", "Key Strategic Initiatives"],
                speakerNotes: "Welcome everyone. Today we'll review the core focus and actionable insights.",
            },
            {
                slideNumber: 2,
                title: "Core Insights & Analysis",
                subtitle: "Strategic Overview",
                bullets,
                speakerNotes: "Here are the primary insights and considerations relevant to our goals.",
            },
            {
                slideNumber: 3,
                title: "Action Items & Next Steps",
                subtitle: "Execution Roadmap",
                bullets: [
                    "Align cross-functional stakeholders on milestone delivery",
                    "Finalize technical architecture and rollout timeline",
                    "Monitor KPIs and iterative feedback loops",
                ],
                speakerNotes: "Closing with prioritized next steps for execution and stakeholder signoff.",
            },
        ],
    };
};

/**
 * Defensively extracts and parses JSON slide deck from raw LLM output.
 * Handles pure JSON, fenced markdown code blocks, conversational prefixes, and malformed strings.
 */
export const parseDeckJson = (text, userPrompt = "") => {
    if (!text || typeof text !== "string") {
        return createFallbackDeck(userPrompt);
    }

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(text.trim());
        if (parsed && (Array.isArray(parsed.slides) || parsed.deckTitle)) {
            return normalizeDeck(parsed, userPrompt);
        }
    } catch (_) {}

    // 2. Extract from markdown code fences: ```json ... ``` or ``` ... ```
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
        try {
            const parsed = JSON.parse(codeBlockMatch[1].trim());
            if (parsed && (Array.isArray(parsed.slides) || parsed.deckTitle)) {
                return normalizeDeck(parsed, userPrompt);
            }
        } catch (_) {}
    }

    // 3. Slice outermost { ... }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
            if (parsed && (Array.isArray(parsed.slides) || parsed.deckTitle)) {
                return normalizeDeck(parsed, userPrompt);
            }
        } catch (_) {}
    }

    // 4. Fallback from plain text
    return createFallbackDeck(userPrompt, text);
};
