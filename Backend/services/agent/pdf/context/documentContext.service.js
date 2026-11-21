/**
 * @file documentContext.service.js
 * @description Centralized, shared document context orchestration service for Cross-Agent RAG.
 * Allows Coding Agent, PPT Agent, Chat Agent, and other agents to query and ground responses
 * in documents uploaded within a conversation.
 *
 * Guarantees:
 * 1. Reuses existing PDF ingestion, hybrid retrieval, grounding, and citation services. Zero code duplication.
 * 2. Idempotent: Reuses existing indexed document IDs, content hashes, and embeddings; never re-ingests unnecessarily.
 * 3. Multi-Document Safe: Resolves explicit document names or flags ambiguity; never silently defaults to latest.
 * 4. Multi-Tenant Scoped: Enforces authenticated userId and conversationId across all lookups and queries.
 * 5. Distinct Statuses: Emits READY, PARTIAL, NO_DOCUMENTS, NO_RELEVANT_CONTEXT, AMBIGUOUS_DOCUMENT, FAILED.
 * 6. Evidence Preservation: Retains OCR, table, chart, and visual metadata across all retrieved chunks.
 */

import {
    extractPdfMetadata,
    getCachedPdfDocument,
    getConversationDocumentIds,
    generateDocumentId,
} from "../../utils/extractPdf.js";
import { ingestPdfDocument } from "../ingestion/pdfIngestion.service.js";
import {
    executeHybridRetrieval,
    resolveTargetDocument,
    preprocessQuery,
} from "../retrieval/hybridRetrieval.service.js";
import {
    buildGroundedContext,
    DEFAULT_MAX_CONTEXT_TOKENS,
} from "../answer/groundedContext.service.js";

/**
 * Enumeration of distinct document context resolution statuses.
 */
export const CONTEXT_STATUS = {
    READY: "READY",
    PARTIAL: "PARTIAL",
    NO_DOCUMENTS: "NO_DOCUMENTS",
    NO_RELEVANT_CONTEXT: "NO_RELEVANT_CONTEXT",
    AMBIGUOUS_DOCUMENT: "AMBIGUOUS_DOCUMENT",
    FAILED: "FAILED",
};

export const DEFAULT_CONTEXT_TOP_K = 6;
export const DEFAULT_CONTEXT_MAX_TOKENS = 4000;

/**
 * Creates a JSON-serializable Map wrapper that retains Map methods (.get, .set, .has, instanceof Map)
 * while producing a clean plain dictionary on JSON.stringify() or LangGraph state serialization.
 *
 * @param {Map<string, object>} [map=new Map()] - Base source map
 * @returns {Map<string, object>} Enhanced serializable Map
 */
export const createSerializableSourceMap = (map = new Map()) => {
    const target = map instanceof Map ? map : new Map();
    target.toJSON = function () {
        return Object.fromEntries(this);
    };
    return target;
};

/**
 * Formats structured citation records from the grounded sources list.
 *
 * @param {Array<object>} sourcesList - Sources list from buildGroundedContext
 * @returns {Array<object>} Structured citation records
 */
export const formatCitationRecords = (sourcesList = []) => {
    if (!Array.isArray(sourcesList)) return [];

    return sourcesList.map((s, idx) => ({
        citationNumber: idx + 1,
        sourceId: s.sourceId,
        documentId: s.documentId,
        documentName: s.documentName,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        section: s.section || "General",
        contentType: s.contentType || "TEXT",
        extractionMethod: s.extractionMethod || "text",
        visualMetadata: s.visualMetadata || null,
        snippet: typeof s.content === "string" ? s.content.slice(0, 160).trim() : "",
    }));
};

/**
 * Normalizes document metadata into a consistent summary object.
 *
 * @param {object} doc - Document data
 * @returns {object} Normalized document summary
 */
export const normalizeDocumentSummary = (doc = {}) => {
    if (!doc) return null;
    return {
        documentId: doc.documentId || "",
        fileName: doc.fileName || doc.name || "Document.pdf",
        fileSize: doc.fileSize || "",
        pageCount: doc.pageCount || 1,
        title: doc.title || (doc.fileName || "Document").replace(/\.pdf$/i, ""),
        dataUrl: doc.dataUrl || "",
        status: doc.status || "READY",
        totalChunks: doc.totalChunks || (Array.isArray(doc.chunks) ? doc.chunks.length : 0),
        isScanned: Boolean(doc.isScanned),
        requiresOcr: Boolean(doc.requiresOcr),
        tablesDetected: doc.tablesDetected || 0,
        chartsDetected: doc.chartsDetected || 0,
        ocrPagesProcessed: doc.ocrPagesProcessed || 0,
        visualExtractionStatus: doc.visualExtractionStatus || "SKIPPED",
    };
};

/**
 * Orchestrates shared document context retrieval for any consumer agent.
 *
 * Flow:
 * 1. Validates authenticated userId and conversationId (tenant boundary).
 * 2. If a fresh PDF attachment is supplied:
 *    - Checks if already cached/indexed for this conversation to prevent duplicate work.
 *    - If new, ingests via ingestPdfDocument, storing chunks, embeddings, and Redis cache.
 * 3. Resolves the target document for the conversation:
 *    - Respects explicit selectedDocumentId if provided.
 *    - Uses resolveTargetDocument to match document names mentioned in the prompt.
 *    - Flags AMBIGUOUS_DOCUMENT if multiple documents exist and query is non-specific.
 * 4. Runs executeHybridRetrieval (Atlas Vector Search + MongoDB $text + RRF).
 * 5. Packs candidate chunks into token-budgeted grounded context via buildGroundedContext.
 * 6. Returns structured result with distinct status, citations, telemetry, and evidence.
 *
 * @param {object} params
 * @param {string} params.query - User question or instruction prompt
 * @param {string} params.userId - Authenticated user ID (required)
 * @param {string} params.conversationId - Conversation ID (required)
 * @param {object} [params.attachment] - Optional PDF attachment in current turn
 * @param {string} [params.selectedDocumentId] - Explicit document ID override
 * @param {string} [params.agentType="general"] - Consuming agent identifier (e.g. "coding", "ppt")
 * @param {object} [params.options] - Configuration options
 * @param {number} [params.options.topK=6] - Max chunks to retrieve
 * @param {number} [params.options.maxContextTokens=4000] - Token budget for grounded context
 * @param {boolean} [params.options.generateEmbeddings=true] - Whether to generate vector embeddings
 * @param {any} [params.options.embeddingClient] - Embedding client override (for testing)
 * @param {any} [params.options.memoryStore] - In-memory vector store override (for offline tests)
 * @returns {Promise<object>} Complete Document Context Result
 */
export async function getDocumentContext(params = {}) {
    const startTime = Date.now();
    const {
        query = "",
        userId,
        conversationId,
        attachment = null,
        selectedDocumentId = null,
        agentType = "general",
        options = {},
    } = params;

    const warnings = [];

    // 1. Enforce strict multi-tenant authentication barrier
    if (!userId || !conversationId) {
        const emptyMap = createSerializableSourceMap();
        return {
            status: CONTEXT_STATUS.FAILED,
            hasContext: false,
            document: null,
            documents: [],
            groundedContext: "",
            sourceMap: emptyMap,
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: null,
            isTruncated: false,
            error: "getDocumentContext requires authenticated userId and conversationId",
            warnings: ["Missing userId or conversationId"],
            durationMs: Date.now() - startTime,
        };
    }

    const convIdStr = String(conversationId);
    const userIdStr = String(userId);
    const topK = options.topK || DEFAULT_CONTEXT_TOP_K;
    const maxContextTokens = options.maxContextTokens || DEFAULT_CONTEXT_MAX_TOKENS;

    let targetDoc = null;
    let availableDocs = [];

    // 2. Handle incoming PDF attachment if provided in current turn
    const isPdfAttachment = Boolean(
        attachment &&
        (attachment.mimeType === "application/pdf" ||
         attachment.mimetype === "application/pdf" ||
         attachment.name?.toLowerCase().endsWith(".pdf") ||
         attachment.originalname?.toLowerCase().endsWith(".pdf"))
    );

    if (isPdfAttachment) {
        try {
            // Check if document was already ingested/cached to avoid redundant processing
            const fileName = attachment.name || attachment.originalname || "document.pdf";
            const byteLength = attachment.buffer?.length || (attachment.data ? Buffer.byteLength(attachment.data, "base64") : 0);
            const rawBuffer = attachment.buffer || (attachment.data ? Buffer.from(attachment.data, "base64") : null);
            const expectedDocId = generateDocumentId(fileName, byteLength, rawBuffer);

            const existingCached = await getCachedPdfDocument(convIdStr, expectedDocId);

            if (existingCached && existingCached.documentId === expectedDocId && existingCached.status !== "FAILED") {
                targetDoc = existingCached;
            } else {
                // Ingest newly attached document
                const ingested = await ingestPdfDocument(attachment, {
                    conversationId: convIdStr,
                    userId: userIdStr,
                    generateEmbeddings: options.generateEmbeddings !== false,
                    embeddingClient: options.embeddingClient,
                    enableVision: options.enableVision !== undefined ? options.enableVision : true,
                });

                if (ingested.status === "FAILED") {
                    return {
                        status: CONTEXT_STATUS.FAILED,
                        hasContext: false,
                        document: normalizeDocumentSummary(ingested),
                        documents: [normalizeDocumentSummary(ingested)],
                        groundedContext: "",
                        sourceMap: createSerializableSourceMap(),
                        sourcesById: {},
                        sourcesList: [],
                        citations: [],
                        retrievedChunks: [],
                        retrievalTelemetry: null,
                        isTruncated: false,
                        error: `PDF ingestion failed: ${(ingested.warnings || []).join("; ") || "Unreadable PDF file"}`,
                        warnings: ingested.warnings || [],
                        durationMs: Date.now() - startTime,
                    };
                }

                targetDoc = ingested;
            }
        } catch (ingestErr) {
            console.error("[DocumentContext] Attachment ingestion exception:", ingestErr.message);
            return {
                status: CONTEXT_STATUS.FAILED,
                hasContext: false,
                document: null,
                documents: [],
                groundedContext: "",
                sourceMap: createSerializableSourceMap(),
                sourcesById: {},
                sourcesList: [],
                citations: [],
                retrievedChunks: [],
                retrievalTelemetry: null,
                isTruncated: false,
                error: `PDF ingestion exception: ${ingestErr.message}`,
                warnings: [ingestErr.message],
                durationMs: Date.now() - startTime,
            };
        }
    }

    // 3. Resolve target document from conversation if not determined by fresh attachment
    if (!targetDoc) {
        try {
            if (selectedDocumentId) {
                // Strict targeted document lookup: do not silently fall back to active document
                const specificDoc = await getCachedPdfDocument(convIdStr, selectedDocumentId);
                if (specificDoc) {
                    targetDoc = specificDoc;
                } else {
                    return {
                        status: CONTEXT_STATUS.NO_DOCUMENTS,
                        hasContext: false,
                        document: null,
                        documents: availableDocs,
                        groundedContext: "",
                        sourceMap: createSerializableSourceMap(),
                        sourcesById: {},
                        sourcesList: [],
                        citations: [],
                        retrievedChunks: [],
                        retrievalTelemetry: null,
                        isTruncated: false,
                        error: `Selected document '${selectedDocumentId}' not found in conversation`,
                        warnings: [`Selected document '${selectedDocumentId}' not found`],
                        durationMs: Date.now() - startTime,
                    };
                }
            } else {
                const targetResolution = await resolveTargetDocument(convIdStr, query, null);
                availableDocs = (targetResolution.availableDocs || []).map(normalizeDocumentSummary);

                if (targetResolution.isAmbiguous && availableDocs.length > 1) {
                    return {
                        status: CONTEXT_STATUS.AMBIGUOUS_DOCUMENT,
                        hasContext: false,
                        document: null,
                        documents: availableDocs,
                        groundedContext: "",
                        sourceMap: createSerializableSourceMap(),
                        sourcesById: {},
                        sourcesList: [],
                        citations: [],
                        retrievedChunks: [],
                        retrievalTelemetry: null,
                        isTruncated: false,
                        error: null,
                        warnings: ["Multiple documents available in conversation without specific reference."],
                        durationMs: Date.now() - startTime,
                    };
                }

                if (targetResolution.targetDocumentId) {
                    targetDoc = await getCachedPdfDocument(convIdStr, targetResolution.targetDocumentId);
                }

                if (!targetDoc) {
                    // Check default active document pointer
                    targetDoc = await getCachedPdfDocument(convIdStr);
                }
            }
        } catch (resolveErr) {
            console.warn("[DocumentContext] Target document resolution warning:", resolveErr.message);
        }
    }

    // 4. If no documents exist in conversation, return distinct NO_DOCUMENTS status
    if (!targetDoc) {
        return {
            status: CONTEXT_STATUS.NO_DOCUMENTS,
            hasContext: false,
            document: null,
            documents: [],
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: null,
            isTruncated: false,
            error: null,
            warnings: ["No documents found for this conversation"],
            durationMs: Date.now() - startTime,
        };
    }

    // 4.1 Strict Multi-Tenant Ownership Barrier on Resolved Document
    if (targetDoc.userId && String(targetDoc.userId) !== userIdStr) {
        return {
            status: CONTEXT_STATUS.FAILED,
            hasContext: false,
            document: null,
            documents: [],
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: null,
            isTruncated: false,
            error: `Access denied: document '${targetDoc.documentId}' belongs to another user`,
            warnings: ["Cross-tenant document access blocked"],
            durationMs: Date.now() - startTime,
        };
    }

    const docSummary = normalizeDocumentSummary(targetDoc);
    if (!availableDocs.some((d) => d.documentId === docSummary.documentId)) {
        availableDocs.push(docSummary);
    }

    // 4.2 Early empty / whitespace query handling
    if (!query || typeof query !== "string" || !query.trim()) {
        return {
            status: CONTEXT_STATUS.NO_RELEVANT_CONTEXT,
            hasContext: false,
            document: docSummary,
            documents: availableDocs,
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: null,
            isTruncated: false,
            error: null,
            warnings: ["Empty query provided"],
            durationMs: Date.now() - startTime,
        };
    }

    // 5. Execute Hybrid Retrieval (Vector + $text + RRF)
    let retrievalResult = null;
    try {
        retrievalResult = await executeHybridRetrieval({
            query,
            userId: userIdStr,
            conversationId: convIdStr,
            documentId: docSummary.documentId,
            options: {
                limit: topK,
                embeddingClient: options.embeddingClient,
                memoryStore: options.memoryStore,
            },
        });
    } catch (retrievalErr) {
        console.error("[DocumentContext] Hybrid retrieval exception:", retrievalErr.message);
        return {
            status: CONTEXT_STATUS.FAILED,
            hasContext: false,
            document: docSummary,
            documents: availableDocs,
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: null,
            isTruncated: false,
            error: `Retrieval failed: ${retrievalErr.message}`,
            warnings: [retrievalErr.message],
            durationMs: Date.now() - startTime,
        };
    }

    if (retrievalResult?.status === "FAILED") {
        return {
            status: CONTEXT_STATUS.FAILED,
            hasContext: false,
            document: docSummary,
            documents: availableDocs,
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: retrievalResult.telemetry || null,
            isTruncated: false,
            error: retrievalResult.error || "Hybrid retrieval branch failure",
            warnings: [`Retrieval failure: ${retrievalResult.error}`],
            durationMs: Date.now() - startTime,
        };
    }

    // 6. Gather candidate chunks for grounded context
    const candidateChunks = Array.isArray(retrievalResult?.results) ? retrievalResult.results : [];

    // Fallback if hybrid search returned 0 but cached document has chunks (e.g. offline query mismatch)
    if (candidateChunks.length === 0 && Array.isArray(targetDoc.chunks) && targetDoc.chunks.length > 0) {
        // If clean prompt has keywords, check if any chunks match
        const { processedQuery } = preprocessQuery(query);
        const lowerQ = processedQuery.toLowerCase();
        const matched = targetDoc.chunks.filter((c) =>
            typeof c.content === "string" && c.content.toLowerCase().includes(lowerQ)
        );
        if (matched.length > 0) {
            candidateChunks.push(...matched.slice(0, topK));
        }
    }

    // If still 0 chunks found, return distinct NO_RELEVANT_CONTEXT
    if (candidateChunks.length === 0) {
        return {
            status: CONTEXT_STATUS.NO_RELEVANT_CONTEXT,
            hasContext: false,
            document: docSummary,
            documents: availableDocs,
            groundedContext: "",
            sourceMap: createSerializableSourceMap(),
            sourcesById: {},
            sourcesList: [],
            citations: [],
            retrievedChunks: [],
            retrievalTelemetry: retrievalResult?.telemetry || null,
            isTruncated: false,
            error: null,
            warnings: ["No relevant chunks found matching query"],
            durationMs: Date.now() - startTime,
        };
    }

    // 7. Format into token-budgeted grounded context
    const grounded = buildGroundedContext(candidateChunks, {
        maxTokens: maxContextTokens,
        defaultDocumentName: docSummary.fileName,
        defaultDocumentId: docSummary.documentId,
    });

    const serializableMap = createSerializableSourceMap(grounded.sourceMap);
    const citations = formatCitationRecords(grounded.sourcesList);

    // Determine final status
    let status = CONTEXT_STATUS.READY;
    if (
        retrievalResult?.status === "PARTIAL" ||
        docSummary.status === "PARTIAL" ||
        docSummary.visualExtractionStatus === "PARTIAL" ||
        grounded.isTruncated
    ) {
        status = CONTEXT_STATUS.PARTIAL;
    }

    return {
        status,
        hasContext: true,
        document: docSummary,
        documents: availableDocs,
        groundedContext: grounded.contextText,
        sourceMap: serializableMap,
        sourcesById: Object.fromEntries(serializableMap),
        sourcesList: grounded.sourcesList,
        citations,
        retrievedChunks: candidateChunks,
        retrievalTelemetry: retrievalResult?.telemetry || null,
        isTruncated: grounded.isTruncated,
        error: null,
        warnings,
        durationMs: Date.now() - startTime,
    };
}

