import { getModel } from "../config/llmModels.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";
import { parseDeckJson } from "../utils/parseDeck.js";
import { generatePptxFile } from "../utils/generatePptx.js";

export const pptAgent = async (state = {}) => {
    const llm = getModel("ppt");
    const conversationContext = formatConversationContext(state.history);
    const userPrompt = state?.prompt ?? "";
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    onStage?.("generating", "Structuring executive presentation outline and slide deck...");

    const PPT_HEARTBEAT_MESSAGES = [
        "Structuring presentation outline and narrative arc...",
        "Crafting high-impact slide titles and executive bullets...",
        "Designing speaker talking points...",
        "Compiling native PowerPoint (.pptx) presentation file...",
    ];
    let heartbeatIdx = 0;
    let heartbeatTimer = null;
    const startHeartbeat = () => {
        heartbeatTimer = setInterval(() => {
            if (state.isAborted?.()) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                return;
            }
            const msg = PPT_HEARTBEAT_MESSAGES[heartbeatIdx % PPT_HEARTBEAT_MESSAGES.length];
            onStage?.("generating", msg);
            heartbeatIdx++;
        }, 8_000);
    };
    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    const prompt = `You are a world-class executive presentation designer and slide architect.
Your mission is to produce a polished, high-impact presentation deck based on the user request.

Return a STRICT JSON object conforming to this exact schema (no additional text outside JSON):
{
  "deckTitle": "Short, punchy presentation title (3-7 words)",
  "summary": "Concise 1-2 sentence executive summary of the deck.",
  "slides": [
    {
      "slideNumber": 1,
      "title": "Title of First Slide",
      "subtitle": "Compelling subtitle or tag",
      "bullets": [
        "Executive bullet 1",
        "Executive bullet 2",
        "Executive bullet 3"
      ],
      "speakerNotes": "1-2 sentences of key talking points for the presenter."
    }
  ]
}

Guidelines for slides:
- Slide 1: Must be the Title Slide with a clear title and subtitle.
- Slides 2 to 6+: Cover problem statement, core value proposition, key architecture/features/data, business impact/metrics, and next steps/conclusion.
- Bullets: Keep each bullet concise, professional, and actionable (under 15 words per bullet). Avoid walls of text.
- Presenter Notes: Provide crisp talking points.

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User request:
${userPrompt}
`;

    let rawText = "";
    startHeartbeat();
    try {
        const result = await llm.invoke(prompt);
        rawText = extractText(result);
        stopHeartbeat();
    } catch (error) {
        stopHeartbeat();
        console.error("PPT Agent LLM call failed:", error.message);
        rawText = "";
    } finally {
        stopHeartbeat();
    }

    onStage?.("parsing", "Compiling slides and generating downloadable PowerPoint file...");
    const deckData = parseDeckJson(rawText, userPrompt);

    // Compile native PowerPoint presentation
    let presentationFile = null;
    try {
        presentationFile = await generatePptxFile(deckData);
    } catch (error) {
        console.error("Failed to compile PPTX file:", error.message);
    }

    // Format human-readable markdown response
    const markdownOutline = deckData.slides
        .map((slide) => {
            const subtitleLine = slide.subtitle ? `*${slide.subtitle}*\n` : "";
            const bulletsLines = slide.bullets.map((b) => `- ${b}`).join("\n");
            return `#### Slide ${slide.slideNumber}: ${slide.title}\n${subtitleLine}${bulletsLines}`;
        })
        .join("\n\n");

    const aiResponse = `# 📊 ${deckData.deckTitle}

${deckData.summary || "I've structured your presentation deck below. You can preview the slides interactively or download the native .pptx file."}

---

${markdownOutline}
`;

    return {
        ...state,
        aiResponse: aiResponse.trim() || `Generated presentation: ${deckData.deckTitle}`,
        slides: deckData.slides,
        presentationFile,
    };
};

export const ppt = pptAgent;
