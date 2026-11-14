import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getModel } from "../config/llmModels.js";
import { getRecentConversationMessages } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";

export const chatAgent = async (state = {}) => {
    const primaryModel = getModel("chat");
    const fallbackModel = getModel("chat_fallback");
    const onToken = typeof state?.onToken === "function" ? state.onToken : null;
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    const systemPrompt = `You are a helpful AI assistant.

Answer the user's request clearly, thoroughly, and usefully.
When explaining concepts, exploring topics, or building roadmaps, deliver complete, well-structured sections and actionable conclusions. Never leave thoughts, code snippets, or sections abruptly unfinished.
Be friendly, professional, and practical.
If the request is ambiguous, ask a clarifying question.
If you are not sure, say so honestly.

Important guidelines:
- NEVER invent, hallucinate, or output fake image URLs or mock markdown images (such as fake Azure or DALL-E blob URLs).
- If the user asks to generate, create, or draw an image, describe what they should ask or reply in clear text without fake image links.
`;
    const messages = [
        new SystemMessage(systemPrompt),
    ];

    for (const msg of getRecentConversationMessages(state.history)) {
        if (msg.role === "user") {
            messages.push(new HumanMessage(msg.content));
        } else if (msg.role === "assistant") {
            messages.push(new AIMessage(msg.content));
        }
    }
    messages.push(new HumanMessage(state.prompt));

    onStage?.("generating", "Thinking...");

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
            onStage?.("generating", "Formulating response...");
        }, 8_000);
    };
    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    let fullText = "";
    let providerUsed = "groq";
    let modelUsed = primaryModel.model || "openai/gpt-oss-120b";

    startHeartbeat();
    try {
        if (typeof primaryModel.stream === "function") {
            const stream = await primaryModel.stream(messages);
            for await (const chunk of stream) {
                if (state.isAborted?.()) {
                    console.log("Client aborted during primary chat stream; halting.");
                    break;
                }
                const text = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
                if (text) {
                    stopHeartbeat();
                    fullText += text;
                    if (onToken) {
                        onToken(text);
                    }
                }
            }
        } else {
            const result = await primaryModel.invoke(messages);
            stopHeartbeat();
            fullText = extractText(result);
            if (onToken && fullText) {
                onToken(fullText);
            }
        }
    } catch (primaryErr) {
        stopHeartbeat();
        if (fullText.length > 0) {
            console.error("Chat streaming interrupted after partial output:", primaryErr.message);
            throw new Error("Generation stream was interrupted after partial output. Please retry your request.");
        }

        console.warn("Chat primary provider failed before token emission, triggering fallback:", primaryErr.message);
        onStage?.("fallback", "Primary provider unavailable; switching to backup model...");

        try {
            providerUsed = "google";
            modelUsed = fallbackModel.model || "gemini-3.5-flash";
            startHeartbeat();
            if (typeof fallbackModel.stream === "function") {
                const fallbackStream = await fallbackModel.stream(messages);
                for await (const chunk of fallbackStream) {
                    if (state.isAborted?.()) {
                        console.log("Client aborted during fallback chat stream; halting.");
                        break;
                    }
                    const text = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
                    if (text) {
                        stopHeartbeat();
                        fullText += text;
                        if (onToken) onToken(text);
                    }
                }
            } else {
                const fallbackResult = await fallbackModel.invoke(messages);
                stopHeartbeat();
                fullText = extractText(fallbackResult);
                if (onToken && fullText) onToken(fullText);
            }
        } catch (fallbackErr) {
            stopHeartbeat();
            if (fullText.length > 0) {
                throw new Error("Fallback stream was interrupted after partial output. Please retry your request.");
            }
            console.error("Chat fallback provider also failed:", fallbackErr.message);
            throw new Error("Unable to generate chat response. Please try again in a moment.");
        } finally {
            stopHeartbeat();
        }
    } finally {
        stopHeartbeat();
    }

    const cleanedResponse = fullText.trim();

    return {
        ...state,
        aiResponse: cleanedResponse || "I processed your request, but could not produce a response. Please try rephrasing.",
        modelUsed,
        providerUsed,
        fallbackTriggered: providerUsed !== "groq",
    };
};

export const chat = chatAgent;
