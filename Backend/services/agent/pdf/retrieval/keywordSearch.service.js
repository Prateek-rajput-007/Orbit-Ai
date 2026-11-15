import PdfChunk, {
    ATLAS_KEYWORD_INDEX_NAME,
} from "../../models/pdfChunk.model.js";
import {
    isMongoConnected,
    isMemoryFallbackAllowed,
    getMemoryVectorStore,
} from "../storage/vectorStorage.service.js";

export const DEFAULT_KEYWORD_TOP_K = 8;

/**
 * Normalizes query string for keyword search (removes punctuation, preserves quotes and technical tokens).
 *
 * @param {string} query - Raw user query
 * @returns {string} Sanitized query string for MongoDB $text search matching
 */
export const sanitizeKeywordQuery = (query = "") => {
    if (!query || typeof query !== "string") return "";
    return query
        .replace(/[\r\n\t]/g, " ")
        .replace(/[""]/g, '"') // Normalize smart quotes
        .replace(/[^\w\s\-."']/gi, " ")
        .trim();
};

/**
 * Calculates in-memory TF-weighted keyword relevance score for test environments.
 *
 * @param {string} content - Chunk text
 * @param {string} section - Chunk section heading
 * @param {string[]} queryTokens - Tokenized query terms
 * @returns {number} Score
 */
export const calculateKeywordScore = (content = "", section = "", queryTokens = []) => {
    if (queryTokens.length === 0) return 0;
    const lowerContent = (content || "").toLowerCase();
    const lowerSection = (section || "").toLowerCase();
    let score = 0;

    for (const token of queryTokens) {
        if (!token || token.length < 2) continue;
        const lowerToken = token.toLowerCase();

        // Exact matches in section headings receive highest weight (boost 4x)
        if (lowerSection.includes(lowerToken)) {
            score += 4.0;
        }

        // Count term occurrences in content with term frequency weighting
        let matches = 0;
        let pos = lowerContent.indexOf(lowerToken);
        while (pos !== -1 && matches < 10) {
            matches++;
            pos = lowerContent.indexOf(lowerToken, pos + lowerToken.length);
        }
        if (matches > 0) {
            // Term frequency weighting with saturation: score = (matches * 2.2) / (matches + 1.2)
            score += (matches * 2.2) / (matches + 1.2);
        }
    }

    return Number(score.toFixed(4));
};

/**
 * Executes keyword search over persisted PDF chunks.
 * Uses MongoDB native full-text index with TF-based $meta: "textScore" weighting.
 *
 * Guarantees:
 * 1. Enforces database-level ownership filtering (userId, conversationId, optional documentId).
 * 2. Never loads the entire collection into application memory.
 * 3. Supports exact terms, technical terms, company names, and multi-word phrases.
 * 4. Preserves chunk metadata and emits normalized textScore rankings.
 *
 * @param {object} params - Search parameters
 * @param {string} params.query - Search prompt or keyword phrase
 * @param {string} params.userId - Authenticated user ID (required)
 * @param {string} params.conversationId - Conversation ID (required)
 * @param {string} [params.documentId] - Optional targeted document ID
 * @param {number} [params.limit=8] - Max results to return
 * @param {any} [params.memoryStore] - In-memory store fallback for unit tests
 * @returns {Promise<{ results: Array<object>, durationMs: number, status: string, error?: string }>}
 */
export const searchKeywordChunks = async (params = {}) => {
    const startTime = Date.now();
    const {
        query,
        userId,
        conversationId,
        documentId = null,
        limit = DEFAULT_KEYWORD_TOP_K,
        memoryStore = null,
    } = params;

    if (!userId) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "FAILED",
            error: "searchKeywordChunks requires an authenticated userId",
        };
    }
    if (!conversationId) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "FAILED",
            error: "searchKeywordChunks requires a valid conversationId",
        };
    }

    const cleanQuery = sanitizeKeywordQuery(query);
    if (!cleanQuery) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "NO_RESULTS",
        };
    }

    const safeLimit = Math.max(1, Math.min(50, limit));
    const userIdStr = String(userId);
    const convIdStr = String(conversationId);

    // MongoDB Database-Engine Text Search
    if (isMongoConnected()) {
        try {
            const filter = {
                userId: userIdStr,
                conversationId: convIdStr,
                $text: { $search: cleanQuery },
            };
            if (documentId) {
                filter.documentId = String(documentId);
            }

            const docs = await PdfChunk.find(
                filter,
                {
                    chunkId: 1,
                    documentId: 1,
                    conversationId: 1,
                    userId: 1,
                    chunkIndex: 1,
                    pageStart: 1,
                    pageEnd: 1,
                    section: 1,
                    content: 1,
                    tokenCount: 1,
                    characterCount: 1,
                    contentHash: 1,
                    embeddingModel: 1,
                    contentType: 1,
                    extractionMethod: 1,
                    visualMetadata: 1,
                    score: { $meta: "textScore" },
                }
            )
                .sort({ score: { $meta: "textScore" } })
                .limit(safeLimit)
                .lean();

            const results = docs.map((doc, rank) => ({
                chunkId: doc.chunkId,
                documentId: doc.documentId,
                conversationId: doc.conversationId,
                userId: doc.userId,
                chunkIndex: doc.chunkIndex,
                pageStart: doc.pageStart,
                pageEnd: doc.pageEnd,
                section: doc.section || "General",
                content: doc.content,
                tokenCount: doc.tokenCount || 0,
                characterCount: doc.characterCount || 0,
                contentHash: doc.contentHash,
                embeddingModel: doc.embeddingModel,
                contentType: doc.contentType || "TEXT",
                extractionMethod: doc.extractionMethod || "text",
                visualMetadata: doc.visualMetadata || null,
                score: typeof doc.score === "number" ? doc.score : 0,
                keywordRank: rank + 1,
                source: "keyword",
            }));

            return {
                results,
                durationMs: Date.now() - startTime,
                status: results.length > 0 ? "SUCCESS" : "NO_RESULTS",
            };
        } catch (dbErr) {
            console.warn("[KeywordSearch] MongoDB $text query error:", dbErr.message);
            if (!isMemoryFallbackAllowed() && !memoryStore) {
                return {
                    results: [],
                    durationMs: Date.now() - startTime,
                    status: "FAILED",
                    error: `Database keyword search failed: ${dbErr.message}`,
                };
            }
        }
    }

    // In-memory test store fallback (for unit tests and offline development)
    if (isMemoryFallbackAllowed() || memoryStore) {
        const store = memoryStore instanceof Map ? memoryStore : getMemoryVectorStore();
        const storedChunks = Array.from(store.values());

        const queryTokens = cleanQuery
            .split(/\s+/)
            .filter((t) => t.length > 1);

        const candidates = [];
        for (const item of storedChunks) {
            if (item.userId !== userIdStr) continue;
            if (item.conversationId !== convIdStr) continue;
            if (documentId && item.documentId !== String(documentId)) continue;

            const score = calculateKeywordScore(item.content, item.section, queryTokens);
            if (score > 0) {
                candidates.push({
                    chunkId: item.chunkId,
                    documentId: item.documentId,
                    conversationId: item.conversationId,
                    userId: item.userId,
                    chunkIndex: item.chunkIndex,
                    pageStart: item.pageStart,
                    pageEnd: item.pageEnd,
                    section: item.section || "General",
                    content: item.content,
                    tokenCount: item.tokenCount || 0,
                    characterCount: item.characterCount || 0,
                    contentHash: item.contentHash,
                    embeddingModel: item.embeddingModel,
                    contentType: item.contentType || "TEXT",
                    extractionMethod: item.extractionMethod || "text",
                    visualMetadata: item.visualMetadata || null,
                    score,
                    source: "keyword",
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        const results = candidates.slice(0, safeLimit).map((c, i) => ({
            ...c,
            keywordRank: i + 1,
        }));

        return {
            results,
            durationMs: Date.now() - startTime,
            status: results.length > 0 ? "SUCCESS" : "NO_RESULTS",
        };
    }

    return {
        results: [],
        durationMs: Date.now() - startTime,
        status: "FAILED",
        error: "MongoDB connection is unavailable for keyword search",
    };
};

