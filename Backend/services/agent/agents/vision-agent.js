import { HumanMessage } from "@langchain/core/messages";
import { getModel } from "../config/llmModels.js";
import { searchWeb } from "../config/tavily.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";
import {
    extractImageMetadata,
    cacheVisionImage,
    getCachedVisionImage,
} from "../utils/extractImage.js";

export const isCreateImageIntent = (prompt = "") => {
    const text = String(prompt || "").trim();
    if (/\b(in|of|about|from|on|inside|describe|explain|detail|what|who|where|how|why|is|are|was|were)\s+.*\b(this|that|the|my|our)\s+(image|picture|photo)\b/i.test(text)) {
        return false;
    }
    return /\b(create|generate|make|draw|paint|render|produce|show|find|fetch|search|get)\b.*\b(image|picture|photo|illustration|drawing|artwork|portrait|sketch|wallpaper)\b/i.test(text) ||
           /\b(image|picture|photo|illustration|drawing)\b.*\b(of|for)\s+[a-z0-9]/i.test(text) ||
           /^(a\s+)?[a-z0-9_-]+\s+(image|picture|photo|illustration|wallpaper)s?$/i.test(text) ||
           /^(draw|paint)\s+(a|an|the)?\s+[a-z0-9]/i.test(text);
};

export const visionAgent = async (state = {}) => {
    const conversationId = state?.conversationId;
    const userPrompt = state?.prompt ?? "";
    const conversationContext = formatConversationContext(state.history);
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    const VISION_HEARTBEAT_MESSAGES = [
        "Analyzing image composition and visual hierarchy...",
        "Identifying UI components, text labels, and structures...",
        "Evaluating technical details and layout elements...",
        "Synthesizing high-signal technical description...",
    ];
    let heartbeatIdx = 0;
    let heartbeatTimer = null;
    const startHeartbeat = (stage = "analyzing", customMessages = VISION_HEARTBEAT_MESSAGES) => {
        heartbeatTimer = setInterval(() => {
            if (state.isAborted?.()) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                return;
            }
            const msg = customMessages[heartbeatIdx % customMessages.length];
            onStage?.(stage, msg);
            heartbeatIdx++;
        }, 8_000);
    };
    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    // Case 1: Image Request without attachment (Tavily Image Search)
    // Examples: "Create a image for cat", "Show me an image of a red sports car", "Cat image"
    if (!state.attachment && isCreateImageIntent(userPrompt)) {
        const cleanSubject = userPrompt
            .replace(/^(create|generate|make|draw|paint|show|find|fetch|render)\s+(an?\s+)?(image|picture|photo|illustration|drawing)\s+(of|for)?\s*/i, "")
            .replace(/\b(image|picture|photo)\b/gi, "")
            .trim() || "image";

        onStage?.("searching", `Searching for curated visual references for "${cleanSubject}"...`);

        let foundImages = [];
        try {
            const searchRes = await searchWeb(cleanSubject, { includeImages: true });
            foundImages = (searchRes.images ?? [])
                .map((img) => {
                    const url = typeof img === "string" ? img : img?.url;
                    if (!url) return null;
                    try {
                        const parsed = new URL(url);
                        if (parsed.protocol !== "https:") return null;
                        return {
                            url: parsed.href,
                            description: typeof img === "object" ? img.description ?? cleanSubject : cleanSubject,
                        };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean)
                .slice(0, 1);
        } catch (err) {
            console.warn("Tavily image search failed:", err.message);
        }

        if (foundImages.length > 0) {
            const primaryImage = foundImages[0];
            if (conversationId && primaryImage) {
                await cacheVisionImage(conversationId, {
                    fileName: `${cleanSubject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}.jpg`,
                    fileSize: "Web Image",
                    mimeType: "image/jpeg",
                    dataUrl: primaryImage.url,
                    lastAnalysis: `Curated high-resolution image of ${cleanSubject}`,
                    uploadedAt: Date.now(),
                });
            }

            return {
                ...state,
                aiResponse: `Here is a high-resolution image for **${cleanSubject}**:`,
                images: [primaryImage],
                suggestedQuestions: [],
            };
        }

        // If Tavily returned 0 images, provide helpful guidance
        return {
            ...state,
            aiResponse: `I searched for images of **${cleanSubject}**, but couldn't find matching high-resolution results. You can also upload your own image using the paperclip icon (📎) for me to inspect and analyze.`,
            images: [],
            suggestedQuestions: [],
        };
    }

    // Case 2: Fresh image attachment uploaded on this turn
    if (state.attachment && state.attachment.mimeType.startsWith("image/")) {
        const imgMeta = extractImageMetadata(state.attachment);
        const llm = getModel("vision");

        onStage?.("analyzing", `Inspecting image "${imgMeta.fileName}" (${imgMeta.fileSize})...`);

        const prompt = `You are an expert visual intelligence and technical vision assistant.
Analyze the attached image ("${imgMeta.fileName}", ${imgMeta.fileSize}) and fulfill the user's request.

Guidelines:
- If this is a UI or wireframe screenshot: Describe the visual hierarchy, layout, components, and styling details.
- If this is a diagram or architecture flow: Detail the flow, nodes, and relationships.
- If this is code, terminal, or error: Identify the exact root cause and provide clear fixes.
- If this contains text or tables: Transcribe key text and structured values accurately.
- Keep your explanation structured, clear, and high-signal.

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User request:
${userPrompt || "Please analyze this image in detail and describe its core components, structure, and content."}
`;

        let aiResponse = "";
        startHeartbeat("analyzing");
        try {
            const result = await llm.invoke([
                new HumanMessage({
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: imgMeta.dataUrl,
                            },
                        },
                    ],
                }),
            ]);
            aiResponse = extractText(result);
            stopHeartbeat();
        } catch (error) {
            stopHeartbeat();
            console.error("Vision primary LLM call failed:", error.message);
            // Fallback: try secondary Groq text model with description notice
            try {
                const fallbackLlm = getModel("chat");
                const fallbackRes = await fallbackLlm.invoke(
                    `The user uploaded an image "${imgMeta.fileName}" (${imgMeta.fileSize}) with the prompt: "${userPrompt}". 
A temporary vision service spike occurred. Acknowledge the uploaded file and advise them on what you can help with once demand stabilizes.`
                );
                aiResponse = extractText(fallbackRes);
            } catch (fallbackErr) {
                aiResponse = `I received your image ("${imgMeta.fileName}", ${imgMeta.fileSize}), but encountered a temporary capacity spike. Please try re-sending your question in a moment.`;
            }
        } finally {
            stopHeartbeat();
        }

        if (!aiResponse || !aiResponse.trim()) {
            aiResponse = `I have inspected your image ("${imgMeta.fileName}", ${imgMeta.fileSize}). Please specify what aspects you would like me to analyze in detail.`;
        }

        if (conversationId && imgMeta.data) {
            await cacheVisionImage(conversationId, {
                fileName: imgMeta.fileName,
                fileSize: imgMeta.fileSize,
                mimeType: imgMeta.mimeType,
                data: imgMeta.data,
                dataUrl: imgMeta.dataUrl,
                lastAnalysis: aiResponse,
                uploadedAt: Date.now(),
            });
        }

        return {
            ...state,
            aiResponse,
            imageAttachment: {
                fileName: imgMeta.fileName,
                fileSize: imgMeta.fileSize,
                mimeType: imgMeta.mimeType,
                dataUrl: imgMeta.dataUrl,
            },
            suggestedQuestions: [],
        };
    }

    // Case 3: Multi-turn follow-up without re-uploading the image
    // Check Redis vision image cache for this conversation
    const cachedImage = conversationId ? await getCachedVisionImage(conversationId) : null;
    if (cachedImage && cachedImage.dataUrl) {
        const llm = getModel("vision");
        onStage?.("analyzing", `Examining image context for "${cachedImage.fileName}"...`);

        const prompt = `You are an expert visual intelligence assistant.
The user is asking a follow-up question regarding the image "${cachedImage.fileName}" (${cachedImage.fileSize}) previously uploaded in this conversation.
Inspect the image below and answer their question accurately and thoroughly.

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
${cachedImage.lastAnalysis ? `Prior Image Analysis Summary:\n${cachedImage.lastAnalysis.slice(0, 500)}\n` : ""}

User follow-up question:
${userPrompt}
`;

        let aiResponse = "";
        startHeartbeat("analyzing");
        try {
            const result = await llm.invoke([
                new HumanMessage({
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "image_url",
                            image_url: {
                                url: cachedImage.dataUrl,
                            },
                        },
                    ],
                }),
            ]);
            aiResponse = extractText(result);
            stopHeartbeat();
        } catch (error) {
            stopHeartbeat();
            console.warn("Vision follow-up LLM failed, falling back to cached context:", error.message);
            try {
                // Fallback to text LLM using cached prior analysis
                const fallbackLlm = getModel("chat");
                const fallbackPrompt = `You are a visual intelligence assistant.
The user is asking a follow-up about the previously uploaded image "${cachedImage.fileName}":
"${userPrompt}"

Prior analysis of the image:
${cachedImage.lastAnalysis || "No prior summary available."}

Conversation context:
${conversationContext}

Answer the user's question based on the prior visual analysis.`;
                const result = await fallbackLlm.invoke(fallbackPrompt);
                aiResponse = extractText(result);
            } catch (fallbackError) {
                console.warn("Vision fallback LLM also failed, utilizing cached analysis directly:", fallbackError.message);
                aiResponse = `Based on the previously uploaded image **${cachedImage.fileName}** (${cachedImage.fileSize}), here is the prior visual inspection:\n\n${cachedImage.lastAnalysis || "Image context is retained in memory."}`;
            }
        } finally {
            stopHeartbeat();
        }

        if (!aiResponse || !aiResponse.trim()) {
            aiResponse = `Based on the previously uploaded image **${cachedImage.fileName}** (${cachedImage.fileSize}), here is the prior visual inspection:\n\n${cachedImage.lastAnalysis || "Image context is retained in memory."}`;
        }

        if (conversationId) {
            await cacheVisionImage(conversationId, {
                ...cachedImage,
                lastAnalysis: aiResponse,
                lastFollowUpAt: Date.now(),
            });
        }

        return {
            ...state,
            aiResponse,
            imageAttachment: {
                fileName: cachedImage.fileName,
                fileSize: cachedImage.fileSize,
                mimeType: cachedImage.mimeType,
                dataUrl: cachedImage.dataUrl,
            },
            suggestedQuestions: [],
        };
    }

    // Case 4: History exists but no cached image found in Redis
    if (Array.isArray(state.history) && state.history.length > 0) {
        onStage?.("synthesizing", "Reviewing visual context from prior conversation...");
        const llm = getModel("chat");
        const prompt = `You are a visual intelligence assistant.
The user is asking a follow-up question regarding an image previously discussed in this conversation.
Answer their question accurately based on the prior conversation context.
If their question requires seeing specific visual details that were not discussed, answer what you can and invite them to re-attach the image using the paperclip icon (📎).

Conversation context:
${conversationContext}

User follow-up question:
${userPrompt}
`;
        const result = await llm.invoke(prompt);
        const aiResponse = extractText(result) || "I reviewed the prior conversation context, but could not produce a response. Please attach the image again if needed.";
        return {
            ...state,
            aiResponse,
            suggestedQuestions: [],
        };
    }

    // Case 5: No attachment and no conversation history
    return {
        ...state,
        aiResponse: "Please attach an image (JPEG, PNG, or WebP) using the paperclip icon (📎) below so I can examine, analyze, and describe it for you.",
        suggestedQuestions: [],
    };
};

export const imageGen = visionAgent;
export const vision = visionAgent;
