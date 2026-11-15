import PdfChunk, {
    ATLAS_VECTOR_INDEX_NAME,
} from "../../models/pdfChunk.model.js";
import {
    isMongoConnected,
    isMemoryFallbackAllowed,
    getMemoryVectorStore,
} from "../storage/vectorStorage.service.js";

export const DEFAULT_VECTOR_TOP_K = 8;
export const DEFAULT_NUM_CANDIDATES = 50;

/**
 * Calculates cosine similarity between two numeric vectors.
 *
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity (-1 to 1)
 */
export const cosineSimilarity = (a = [], b = []) => {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) {
        return 0;
    }
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : Math.max(-1, Math.min(1, dot / denominator));
};

/**
 * Executes semantic vector search over persisted PDF chunks.
 * Uses MongoDB Atlas $vectorSearch when connected, or deterministic in-memory vector store in tests.
 *
 * Guarantees:
 * 1. Enforces strict multi-tenant database pre-filtering (userId, conversationId, optional documentId).
 * 2. Never exposes another user's document chunks.
 * 3. Returns chunk metadata with normalized similarity scores.
 * 4. Catches Atlas index unavailable or disconnected errors defensively.
 *
 * @param {object} params - Search parameters
 * @param {number[]} params.queryVector - 768-dimensional query embedding
 * @param {string} params.userId - Authenticated user ID (required)
 * @param {string} params.conversationId - Conversation ID (required)
 * @param {string} [params.documentId] - Optional targeted document ID
 * @param {number} [params.limit=8] - Max results to return
 * @param {number} [params.numCandidates=50] - Atlas vector candidate count
 * @param {string} [params.indexName] - Atlas vector search index name override
 * @returns {Promise<{ results: Array<object>, durationMs: number, status: string, error?: string }>}
 */
export const searchVectorChunks = async (params = {}) => {
    const startTime = Date.now();
    const {
        queryVector,
        userId,
        conversationId,
        documentId = null,
        limit = DEFAULT_VECTOR_TOP_K,
        numCandidates = DEFAULT_NUM_CANDIDATES,
        indexName = ATLAS_VECTOR_INDEX_NAME,
        memoryStore = null,
    } = params;

    // Strict validation
    if (!userId) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "FAILED",
            error: "searchVectorChunks requires an authenticated userId",
        };
    }
    if (!conversationId) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "FAILED",
            error: "searchVectorChunks requires a valid conversationId",
        };
    }
    if (!Array.isArray(queryVector) || queryVector.length === 0) {
        return {
            results: [],
            durationMs: Date.now() - startTime,
            status: "FAILED",
            error: "searchVectorChunks requires a non-empty queryVector array",
        };
    }

    const safeLimit = Math.max(1, Math.min(50, limit));
    const safeCandidates = Math.max(safeLimit, Math.min(200, numCandidates));
    const userIdStr = String(userId);
    const convIdStr = String(conversationId);

    // MongoDB Atlas $vectorSearch Pipeline
    if (isMongoConnected()) {
        try {
            const preFilter = {
                userId: { $eq: userIdStr },
                conversationId: { $eq: convIdStr },
            };
            if (documentId) {
                preFilter.documentId = { $eq: String(documentId) };
            }

            const pipeline = [
                {
                    $vectorSearch: {
                        index: indexName,
                        path: "embedding",
                        queryVector,
                        numCandidates: safeCandidates,
                        limit: safeLimit,
                        filter: preFilter,
                    },
                },
                {
                    $project: {
                        _id: 1,
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
                        score: { $meta: "vectorSearchScore" },
                    },
                },
            ];

            const rawResults = await PdfChunk.aggregate(pipeline);

            const results = rawResults.map((doc, rank) => ({
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
                vectorRank: rank + 1,
                source: "vector",
            }));

            return {
                results,
                durationMs: Date.now() - startTime,
                status: results.length > 0 ? "SUCCESS" : "NO_RESULTS",
            };
        } catch (dbErr) {
            console.warn("[VectorSearch] MongoDB Atlas $vectorSearch error:", dbErr.message);
            // If offline or search index not ready on this cluster, attempt fallback if allowed
            if (!isMemoryFallbackAllowed() && !memoryStore) {
                return {
                    results: [],
                    durationMs: Date.now() - startTime,
                    status: "FAILED",
                    error: `Atlas Vector Search failed: ${dbErr.message}`,
                };
            }
        }
    }

    // In-memory test store fallback (for unit tests and offline development)
    if (isMemoryFallbackAllowed() || memoryStore) {
        const candidates = [];
        const store = memoryStore instanceof Map ? memoryStore : getMemoryVectorStore();
        const storedChunks = Array.from(store.values());

        for (const item of storedChunks) {
            // Check ownership and multi-tenant isolation
            if (item.userId !== userIdStr) continue;
            if (item.conversationId !== convIdStr) continue;
            if (documentId && item.documentId !== String(documentId)) continue;
            if (!Array.isArray(item.embedding)) continue;

            const score = cosineSimilarity(queryVector, item.embedding);
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
                source: "vector",
            });
        }

        candidates.sort((a, b) => b.score - a.score);
        const results = candidates.slice(0, safeLimit).map((c, i) => ({
            ...c,
            vectorRank: i + 1,
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
        error: "MongoDB connection is unavailable for vector search",
    };
};

