import { getModel } from "../config/llmModels.js";
import { searchWeb } from "../config/tavily.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";

export const searchAgent = async (state = {}) => {
    const onToken = typeof state?.onToken === "function" ? state.onToken : null;
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    const query = state.prompt?.trim();
    if (!query) {
        throw new Error("A search query is required");
    }

    onStage?.("searching", `Searching the live web for "${query}"...`);

    const wantsImages = /\b(images?|pictures?|photos?|visuals?|illustrations?)\b|\b(show|find|search for)\s+(me\s+)?(an?\s+)?(image|picture|photo)\b/i.test(query);
    const conversationContext = formatConversationContext(state.history);

    // Formulate clean search query for Tavily:
    // If current query relies on coreferential pronouns (e.g. "there", "it", "they", "that"),
    // include the immediate prior user topic (up to 120 chars) so Tavily resolves the entity.
    let searchQuery = query;
    const hasCoreference = /\b(there|it|he|she|they|that|this|these|those|then|same)\b/i.test(query);
    if (hasCoreference && Array.isArray(state.history) && state.history.length > 0) {
        const lastUserMsg = [...state.history].reverse().find((m) => m.role === "user");
        if (lastUserMsg && typeof lastUserMsg.content === "string") {
            const cleanLast = lastUserMsg.content.trim().slice(0, 120);
            searchQuery = `${cleanLast} ${query}`;
        }
    }

    let heartbeatTimer = null;
    const startHeartbeat = (stage = "synthesizing", message = "Synthesizing live web results...") => {
        heartbeatTimer = setInterval(() => {
            if (state.isAborted?.()) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                return;
            }
            onStage?.(stage, message);
        }, 8_000);
    };
    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    let webResults;
    if (Array.isArray(state.mockResults)) {
        webResults = { results: state.mockResults };
    } else {
        startHeartbeat("searching", "Extracting verified web content from authoritative sources...");
        try {
            webResults = await searchWeb(searchQuery, { includeImages: wantsImages });
            stopHeartbeat();
        } catch (searchErr) {
            stopHeartbeat();
            console.error("Live web search tool error:", searchErr.message);
            const errMsg = `I encountered an issue searching the live web for **${query}**: ${searchErr.message}. Please check your query or try again.`;
            if (onToken) onToken(errMsg);
            return {
                ...state,
                searchResults: [],
                images: [],
                aiResponse: errMsg,
                modelUsed: "none",
                providerUsed: "none",
            };
        } finally {
            stopHeartbeat();
        }
    }

    if (state.isAborted?.()) {
        console.log("Client aborted during Tavily search phase; halting.");
        return {
            ...state,
            searchResults: [],
            images: [],
            aiResponse: "",
        };
    }

    const sources = webResults?.results?.slice(0, 5) ?? [];
    const images = wantsImages ? (webResults?.images ?? [])
        .map((image) => {
            const url = typeof image === "string" ? image : image?.url;
            if (!url) return null;
            try {
                const parsedUrl = new URL(url);
                if (parsedUrl.protocol !== "https:") return null;
                return {
                    url: parsedUrl.href,
                    description: typeof image === "object" ? image.description ?? "" : "",
                };
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .slice(0, 6) : [];

    if (!sources.length) {
        const fallbackMsg = `I couldn't find reliable web results for **${query}**. Try rephrasing your search.`;
        if (onToken) onToken(fallbackMsg);
        return {
            ...state,
            searchResults: [],
            images,
            aiResponse: fallbackMsg,
        };
    }

    onStage?.("synthesizing", `Analyzing ${sources.length} sources and drafting cited response...`);

    // Optimize excerpt limit to 800 chars per source to conserve Groq TPM quota while preserving factual detail
    const sourceContext = sources
        .map(({ title, url, content, published_date }, index) =>
            `[${index + 1}] ${title ?? "Untitled source"}\nURL: ${url}\n` +
            `${published_date ? `Published: ${published_date}\n` : ""}` +
            `Excerpt: ${(content ?? "").slice(0, 800)}`,
        )
        .join("\n\n");

    const prompt = `You are a web research assistant. Answer the user's question concisely using only the search results below.

Start directly with the answer. Cite factual claims using the matching numbered source, such as [1]. Never invent facts, citations, or URLs. If the sources do not establish an answer, say so honestly.

User request:
${query}

${conversationContext ? `Recent conversation:\n${conversationContext.slice(-600)}\n` : ""}
Web search results:
${sourceContext}
`;

    const primaryModel = getModel("search");
    const fallbackModel = getModel("search_fallback");

    let answer = "";
    let providerUsed = "groq";
    let modelUsed = primaryModel.model || "openai/gpt-oss-120b";

    startHeartbeat("synthesizing", "Drafting fact-checked response with citations...");
    try {
        if (typeof primaryModel.stream === "function") {
            const stream = await primaryModel.stream(prompt);
            for await (const chunk of stream) {
                if (state.isAborted?.()) {
                    console.log("Client aborted during primary search stream; halting.");
                    break;
                }
                const text = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
                if (text) {
                    stopHeartbeat();
                    answer += text;
                    if (onToken) onToken(text);
                }
            }
        } else {
            const result = await primaryModel.invoke(prompt);
            stopHeartbeat();
            answer = extractText(result);
            if (onToken && answer) onToken(answer);
        }
    } catch (primaryErr) {
        stopHeartbeat();
        // Safe Fallback Rule: If any tokens were already sent to client, NEVER append a secondary full response.
        if (answer.length > 0) {
            console.error("Primary search stream failed after partial output:", primaryErr.message);
            throw new Error("Generation stream was interrupted after partial output. Please retry your request.");
        }

        console.warn("Primary search provider failed before token emission, triggering fallback:", primaryErr.message);
        onStage?.("fallback", "Primary provider unavailable; switching to backup model...");

        try {
            providerUsed = "google";
            modelUsed = fallbackModel.model || "gemini-3.5-flash";
            startHeartbeat("synthesizing", "Drafting cited response with backup model...");
            if (typeof fallbackModel.stream === "function") {
                const fallbackStream = await fallbackModel.stream(prompt);
                for await (const chunk of fallbackStream) {
                    if (state.isAborted?.()) {
                        console.log("Client aborted during fallback search stream; halting.");
                        break;
                    }
                    const text = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
                    if (text) {
                        stopHeartbeat();
                        answer += text;
                        if (onToken) onToken(text);
                    }
                }
            } else {
                const fallbackResult = await fallbackModel.invoke(prompt);
                stopHeartbeat();
                answer = extractText(fallbackResult);
                if (onToken && answer) onToken(answer);
            }
        } catch (fallbackErr) {
            stopHeartbeat();
            if (answer.length > 0) {
                throw new Error("Fallback stream was interrupted after partial output. Please retry your request.");
            }
            console.error("Fallback provider also failed:", fallbackErr.message);
            throw new Error("Unable to synthesize search results. Please try again in a moment.");
        } finally {
            stopHeartbeat();
        }
    } finally {
        stopHeartbeat();
    }

    const cleanAnswer = answer.trim() || `I reviewed the web search results for "${query}", but could not produce a response.`;
    const sourceList = sources
        .map(({ title, url }, index) => `[${index + 1}] [${title ?? url}](${url})`)
        .join("\n");
    const sourceSection = `\n\n**Sources**\n${sourceList}`;

    if (onToken && sourceList) {
        onToken(sourceSection);
    }

    return {
        ...state,
        searchResults: sources.map(({ title, url, content, published_date }) => ({
            title: title ?? "Untitled source",
            url,
            content: (content ?? "").slice(0, 1000),
            published_date: published_date ?? null,
        })),
        images,
        aiResponse: `${cleanAnswer}${sourceSection}`,
        modelUsed,
        providerUsed,
        fallbackTriggered: providerUsed !== "groq",
    };
};

export const search = searchAgent;
