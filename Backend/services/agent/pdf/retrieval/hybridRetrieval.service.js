import { generateQueryEmbedding } from "./queryEmbedding.service.js";
import { searchVectorChunks, DEFAULT_VECTOR_TOP_K } from "./vectorSearch.service.js";
import { searchKeywordChunks, DEFAULT_KEYWORD_TOP_K } from "./keywordSearch.service.js";
import { reciprocalRankFusion, DEFAULT_RRF_K, DEFAULT_FUSED_TOP_K } from "./resultFusion.service.js";
import {
    getCachedPdfDocument,
    getConversationDocumentIds,
} from "../../utils/extractPdf.js";

export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 10_000;

/**
 * Normalizes query string for retrieval while preserving numbers, technical identifiers, and quotes.
 *
 * @param {string} query - Raw user query
 * @returns {{ processedQuery: string, requestedPage: number | null, isExplicitPage: boolean }}
 */
export const preprocessQuery = (query = "") => {
    if (!query || typeof query !== "string") {
        return { processedQuery: "", requestedPage: null, isExplicitPage: false };
    }

    const clean = query.replace(/[\r\n\t]+/g, " ").trim();

    // Check for explicit page references: "page 3", "page 12", "p. 4"
    const pageMatch = clean.match(/\b(?:page|p\.?)\s*(\d+)\b/i);
    const requestedPage = pageMatch ? parseInt(pageMatch[1], 10) : null;

    return {
        processedQuery: clean,
        requestedPage,
        isExplicitPage: requestedPage !== null,
    };
};

/**
 * Resolves the targeted PDF document for retrieval across a conversation.
 *
 * Guarantees:
 * 1. If user explicitly mentions a file name, targets that document.
 * 2. If exactly one document exists in the conversation, targets that document.
 * 3. If multiple documents exist and query is ambiguous, flags as AMBIGUOUS without silent selection.
 *
 * @param {string} conversationId - Orbit conversation ID
 * @param {string} query - User prompt
 * @param {string} [explicitDocId] - Explicit document ID if already resolved
 * @returns {Promise<{ targetDocumentId: string | null, targetFileName: string | null, isAmbiguous: boolean, availableDocs: Array<object> }>}
 */
export const resolveTargetDocument = async (conversationId, query = "", explicitDocId = null) => {
    if (!conversationId) {
        return { targetDocumentId: explicitDocId || null, targetFileName: null, isAmbiguous: false, availableDocs: [] };
    }

    if (explicitDocId) {
        const doc = await getCachedPdfDocument(conversationId, explicitDocId);
        return {
            targetDocumentId: explicitDocId,
            targetFileName: doc?.fileName || null,
            isAmbiguous: false,
            availableDocs: doc ? [doc] : [],
        };
    }

    const docIds = await getConversationDocumentIds(conversationId).catch(() => []);
    if (docIds.length === 0) {
        // Fallback to primary conversation cache key
        const activeDoc = await getCachedPdfDocument(conversationId);
        return {
            targetDocumentId: activeDoc?.documentId || null,
            targetFileName: activeDoc?.fileName || null,
            isAmbiguous: false,
            availableDocs: activeDoc ? [activeDoc] : [],
        };
    }

    if (docIds.length === 1) {
        const singleDoc = await getCachedPdfDocument(conversationId, docIds[0]);
        return {
            targetDocumentId: docIds[0],
            targetFileName: singleDoc?.fileName || null,
            isAmbiguous: false,
            availableDocs: singleDoc ? [singleDoc] : [],
        };
    }

    // Multiple documents: check if query explicitly references one by name
    const lowerQuery = (query || "").toLowerCase();
    const availableDocs = [];
    let matchedDoc = null;

    for (const id of docIds) {
        const candidate = await getCachedPdfDocument(conversationId, id);
        if (candidate) {
            availableDocs.push(candidate);
            const baseName = candidate.fileName?.replace(/\.pdf$/i, "").toLowerCase();
            if (baseName && baseName.length >= 3 && lowerQuery.includes(baseName)) {
                matchedDoc = candidate;
            }
        }
    }

    if (matchedDoc) {
        return {
            targetDocumentId: matchedDoc.documentId,
            targetFileName: matchedDoc.fileName,
            isAmbiguous: false,
            availableDocs,
        };
    }

    // Ambiguous multi-document state: multiple documents exist, but query mentions none
    return {
        targetDocumentId: null,
        targetFileName: null,
        isAmbiguous: true,
        availableDocs,
    };
};

/**
 * Executes high-performance hybrid retrieval (Semantic Vector + MongoDB $text Keyword + Reciprocal Rank Fusion).
 *
 * Guarantees:
 * 1. Enforces strict multi-tenant ownership in all database queries (userId, conversationId, documentId).
 * 2. Runs vector and keyword branches in parallel with timeout safeguards.
 * 3. Gracefully degrades to partial retrieval if one branch fails.
 * 4. Merges duplicates and ranks chunks using principled Reciprocal Rank Fusion (RRF).
 * 5. Emits comprehensive, confidential retrieval telemetry.
 *
 * @param {object} params - Retrieval parameters
 * @param {string} params.query - User question or search prompt
 * @param {string} params.userId - Authenticated user ID (required)
 * @param {string} params.conversationId - Conversation ID (required)
 * @param {string} [params.documentId] - Optional targeted document ID
 * @param {object} [params.options] - Configuration overrides
 * @param {number} [params.options.limit=6] - Max final hybrid chunks to return
 * @param {number} [params.options.vectorTopK=8] - Vector branch top-K
 * @param {number} [params.options.keywordTopK=8] - Keyword branch top-K
 * @param {number} [params.options.rrfK=60] - RRF constant factor
 * @param {number} [params.options.timeoutMs=10000] - Branch timeout in milliseconds
 * @param {any} [params.options.embeddingClient] - Embedding client override (for testing)
 * @param {any} [params.options.memoryStore] - Memory store override (for offline tests)
 * @returns {Promise<{ results: Array<object>, status: string, telemetry: object, targetDocumentId: string | null }>}
 */
export const executeHybridRetrieval = async (params = {}) => {
    const overallStartTime = Date.now();
    const {
        query,
        userId,
        conversationId,
        documentId = null,
        options = {},
    } = params;

    const limit = options.limit || DEFAULT_FUSED_TOP_K;
    const vectorTopK = options.vectorTopK || DEFAULT_VECTOR_TOP_K;
    const keywordTopK = options.keywordTopK || DEFAULT_KEYWORD_TOP_K;
    const rrfK = options.rrfK || DEFAULT_RRF_K;
    const timeoutMs = options.timeoutMs || DEFAULT_RETRIEVAL_TIMEOUT_MS;

    // 1. Validate Required Identity
    if (!userId || !conversationId) {
        return {
            results: [],
            status: "FAILED",
            error: "executeHybridRetrieval requires authenticated userId and conversationId",
            targetDocumentId: documentId,
            telemetry: {
                totalDurationMs: Date.now() - overallStartTime,
                status: "FAILED",
                vectorCount: 0,
                keywordCount: 0,
                finalCount: 0,
            },
        };
    }

    // 2. Preprocess Query
    const { processedQuery, requestedPage, isExplicitPage } = preprocessQuery(query);
    if (!processedQuery) {
        return {
            results: [],
            status: "NO_RESULTS",
            targetDocumentId: documentId,
            telemetry: {
                totalDurationMs: Date.now() - overallStartTime,
                status: "NO_RESULTS",
                vectorCount: 0,
                keywordCount: 0,
                finalCount: 0,
            },
        };
    }

    // 3. Resolve Targeted Document
    const docResolution = await resolveTargetDocument(conversationId, processedQuery, documentId);
    if (docResolution.isAmbiguous) {
        return {
            results: [],
            status: "AMBIGUOUS_DOCUMENT",
            targetDocumentId: null,
            availableDocs: docResolution.availableDocs.map((d) => ({
                documentId: d.documentId,
                fileName: d.fileName,
                pageCount: d.pageCount,
            })),
            telemetry: {
                totalDurationMs: Date.now() - overallStartTime,
                status: "AMBIGUOUS_DOCUMENT",
                vectorCount: 0,
                keywordCount: 0,
                finalCount: 0,
            },
        };
    }

    const effectiveDocId = docResolution.targetDocumentId || documentId;

    // 3. Generate Query Embedding
    let queryVector = null;
    let queryEmbeddingDurationMs = 0;
    try {
        const embRes = await generateQueryEmbedding(processedQuery, {
            client: options.embeddingClient,
        });
        queryVector = embRes.vector;
        queryEmbeddingDurationMs = embRes.durationMs;
    } catch (embErr) {
        console.warn("[HybridRetrieval] Query embedding generation failed:", embErr.message);
    }

    // 4. Parallel Retrieval with Timeout Protection
    const withTimeout = (promise, label) => {
        return Promise.race([
            promise,
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
            ),
        ]);
    };

    const vectorPromise = queryVector
        ? withTimeout(
              searchVectorChunks({
                  queryVector,
                  userId,
                  conversationId,
                  documentId: effectiveDocId,
                  limit: vectorTopK,
                  memoryStore: options.memoryStore,
              }),
              "VectorSearch"
          )
        : Promise.resolve({ results: [], status: "FAILED", error: "Missing query vector" });

    const keywordPromise = withTimeout(
        searchKeywordChunks({
            query: processedQuery,
            userId,
            conversationId,
            documentId: effectiveDocId,
            limit: keywordTopK,
            memoryStore: options.memoryStore,
        }),
        "KeywordSearch"
    );

    const [vectorOutcome, keywordOutcome] = await Promise.allSettled([
        vectorPromise,
        keywordPromise,
    ]);

    const vectorSuccess = vectorOutcome.status === "fulfilled" && vectorOutcome.value?.status !== "FAILED";
    const keywordSuccess = keywordOutcome.status === "fulfilled" && keywordOutcome.value?.status !== "FAILED";

    const vectorResults = vectorSuccess ? vectorOutcome.value.results || [] : [];
    const keywordResults = keywordSuccess ? keywordOutcome.value.results || [] : [];

    const vectorSearchDurationMs = vectorOutcome.status === "fulfilled" ? vectorOutcome.value.durationMs || 0 : 0;
    const keywordSearchDurationMs = keywordOutcome.status === "fulfilled" ? keywordOutcome.value.durationMs || 0 : 0;

    // 5. Result Fusion via Reciprocal Rank Fusion (RRF)
    const { fusedResults, durationMs: fusionDurationMs } = reciprocalRankFusion(
        vectorResults,
        keywordResults,
        { k: rrfK, limit }
    );

    // 6. Explicit Page Re-ranking: if query asks for a specific page, prioritize that page's chunk
    let finalResults = fusedResults;
    if (isExplicitPage && requestedPage !== null) {
        const pageChunks = fusedResults.filter(
            (c) => requestedPage >= c.pageStart && requestedPage <= c.pageEnd
        );
        const otherChunks = fusedResults.filter(
            (c) => requestedPage < c.pageStart || requestedPage > c.pageEnd
        );
        finalResults = [...pageChunks, ...otherChunks].slice(0, limit);
    }

    // 7. Status Resolution
    let status = "SUCCESS";
    if (!vectorSuccess && !keywordSuccess) {
        status = "FAILED";
    } else if (finalResults.length === 0 && vectorSuccess && keywordSuccess) {
        status = "NO_RESULTS";
    } else if (!vectorSuccess || !keywordSuccess) {
        status = "PARTIAL";
    } else if (finalResults.length === 0) {
        status = "NO_RESULTS";
    }

    const telemetry = {
        totalDurationMs: Date.now() - overallStartTime,
        queryEmbeddingDurationMs,
        vectorSearchDurationMs,
        keywordSearchDurationMs,
        fusionDurationMs,
        vectorCount: vectorResults.length,
        keywordCount: keywordResults.length,
        finalCount: finalResults.length,
        status,
        targetDocumentId: effectiveDocId,
        targetFileName: docResolution.targetFileName,
        requestedPage,
    };

    return {
        results: finalResults,
        status,
        telemetry,
        targetDocumentId: effectiveDocId,
    };
};

