import {
    extractPdfPages,
    cachePdfDocument,
    getCachedPdfDocument,
    getConversationDocumentIds,
    invalidatePdfDocumentCache,
} from "../../utils/extractPdf.js";
import { chunkDocument, estimateTokenCount } from "./chunking.service.js";
import {
    generateEmbeddingsBatch,
    getEmbeddingModel,
    getEmbeddingDimensions,
} from "../embeddings/embedding.service.js";
import {
    storeChunkEmbeddings,
    getExistingDocumentChunks,
    deleteDocumentChunks,
    deleteConversationChunks,
} from "../storage/vectorStorage.service.js";
import { slicePdfPage, extractPageVisualIntelligence } from "../vision/visionExtraction.service.js";
import { compileVisualChunks } from "../vision/visualEvidence.service.js";

/**
 * Orchestrates the full page-aware PDF ingestion pipeline:
 * 1. Extraction: preserves 1-based page boundaries, text, character counts, and table indicators.
 * 2. Validation: checks for empty pages, scanned image PDFs, and malformed files.
 * 3. Chunking: splits document into structure-aware, overlapping chunks with pageStart/pageEnd.
 * 4. Statistics: computes document-level metrics (totalChunks, estimatedTokens, avgChunkTokens).
 * 5. Caching: persists normalized ingestion result in Redis for fast multi-turn access.
 *
 * @param {object} attachment - PDF attachment payload { name, mimeType, data (base64) } or buffer
 * @param {object} [options] - Ingestion configuration options
 * @param {string} [options.conversationId] - Optional Orbit conversation ID for Redis caching
 * @param {number} [options.targetChunkTokens] - Target chunk size in tokens (default: 600)
 * @param {number} [options.maxChunkTokens] - Max chunk ceiling in tokens (default: 1000)
 * @param {number} [options.overlapTokens] - Overlap in tokens (default: 100)
 * @returns {Promise<object>} Complete normalized ingestion result
 */
export const ingestPdfDocument = async (attachment = {}, options = {}) => {
    const startTime = Date.now();
    const conversationId = options.conversationId || null;

    // Step 1: Page-aware extraction
    const extracted = await extractPdfPages(attachment);

    const enableVision = options.enableVision !== undefined ? options.enableVision : true;
    const maxVisionPages = options.maxVisionPages || 5;
    const maxConcurrentVisionJobs = options.maxConcurrentVisionJobs || 2;
    const perPageTimeoutMs = options.perPageTimeoutMs || 12_000;

    let tablesDetected = 0;
    let chartsDetected = 0;
    let ocrPagesProcessed = 0;
    let visualExtractionStatus = "SKIPPED";
    const visualChunks = [];

    const isScannedDoc = Boolean(extracted.isScanned || extracted.requiresOcr);

    // Step 2: Validate extraction result
    if (
        (extracted.status === "FAILED" && (!isScannedDoc || !extracted.rawBuffer || !enableVision)) ||
        !extracted.pages ||
        extracted.pages.length === 0
    ) {
        return {
            ...extracted,
            totalChunks: 0,
            chunks: [],
            tablesDetected: 0,
            chartsDetected: 0,
            ocrPagesProcessed: 0,
            visualExtractionStatus: "SKIPPED",
            ingestionDurationMs: Date.now() - startTime,
            processedAt: new Date().toISOString(),
        };
    }

    // Step 2.5: Selective Visual Content & OCR Processing (Phase 5)
    if (enableVision && extracted.rawBuffer && extracted.pages.length > 0) {
        const candidatePages = extracted.pages.filter(
            (p) =>
                p.requiresOCR ||
                p.requiresVision ||
                p.pageType === "TABLE_HEAVY" ||
                p.pageType === "CHART_HEAVY" ||
                p.pageType === "SCANNED"
        );

        if (candidatePages.length > 0) {
            visualExtractionStatus = "PROCESSING";
            const pagesToProcess = candidatePages.slice(0, maxVisionPages);
            const visualResults = [];

            for (let i = 0; i < pagesToProcess.length; i += maxConcurrentVisionJobs) {
                const batch = pagesToProcess.slice(i, i + maxConcurrentVisionJobs);
                const batchPromises = batch.map(async (page) => {
                    const pageNumber = page.pageNumber;
                    const slicedBuffer = await slicePdfPage(extracted.rawBuffer, pageNumber);
                    if (!slicedBuffer) return null;

                    return extractPageVisualIntelligence({
                        pageBuffer: slicedBuffer,
                        pageNumber,
                        mimeType: "application/pdf",
                        classifiedPage: page,
                        options: {
                            timeoutMs: perPageTimeoutMs,
                            visionModel: options.visionModel,
                        },
                    });
                });

                const batchResults = await Promise.all(batchPromises);
                for (const r of batchResults) {
                    if (r) visualResults.push(r);
                }
            }

            // Compile into searchable visual chunks
            const compiled = compileVisualChunks(visualResults, { documentId: extracted.documentId });
            visualChunks.push(...compiled);

            // Update document stats and page records
            for (const res of visualResults) {
                const targetPage = extracted.pages.find((p) => p.pageNumber === res.pageNumber);
                if (res.status === "SUCCESS") {
                    if (targetPage) {
                        targetPage.processingStatus = "PROCESSED";
                        if (res.ocrText && res.ocrText.trim()) {
                            targetPage.text = (targetPage.text ? `${targetPage.text}\n\n` : "") + res.ocrText;
                            targetPage.characterCount = targetPage.text.length;
                            targetPage.hasText = true;
                            ocrPagesProcessed++;
                        }
                    }
                    if (Array.isArray(res.tables)) tablesDetected += res.tables.length;
                    if (Array.isArray(res.charts)) chartsDetected += res.charts.length;
                } else if (res.status === "FAILED") {
                    if (targetPage) {
                        targetPage.processingStatus = "FAILED";
                        if (Array.isArray(res.warnings)) {
                            targetPage.extractionWarnings = [...(targetPage.extractionWarnings || []), ...res.warnings];
                        }
                    }
                }
            }

            const anySuccess = visualResults.some((r) => r.status === "SUCCESS");
            const anyFailure = visualResults.some((r) => r.status === "FAILED");

            if (anySuccess && anyFailure) {
                visualExtractionStatus = "PARTIAL";
            } else if (anySuccess) {
                visualExtractionStatus = "READY";
            } else if (visualResults.length > 0) {
                visualExtractionStatus = "FAILED";
            }

            if (ocrPagesProcessed > 0) {
                extracted.extractedPages = extracted.pages.filter((p) => p.hasText).length;
                extracted.failedPages = Math.max(0, extracted.pageCount - extracted.extractedPages);

                if (extracted.failedPages === 0) {
                    extracted.status = "READY";
                    extracted.isScanned = false;
                    extracted.requiresOcr = false;
                } else if (extracted.extractedPages > 0) {
                    extracted.status = "PARTIAL";
                    extracted.isScanned = false; // Partial readable text available
                    extracted.requiresOcr = true; // Remaining pages still require OCR
                    if (!extracted.warnings) extracted.warnings = [];
                    extracted.warnings.push(`${extracted.failedPages} of ${extracted.pageCount} pages could not be extracted.`);
                }
            }
        }
    }

    // Step 3: Structure-aware chunking (avoiding duplicating pages already covered by dedicated OCR chunks)
    const pagesForTextChunking = extracted.pages.filter((p) => {
        const hasOcrChunk = visualChunks.some((vc) => vc.contentType === "OCR_TEXT" && vc.pageStart === p.pageNumber);
        if (hasOcrChunk && p.pageType === "SCANNED") {
            return false;
        }
        return true;
    });

    const textChunks = chunkDocument({ ...extracted, pages: pagesForTextChunking }, {
        targetChunkTokens: options.targetChunkTokens,
        maxChunkTokens: options.maxChunkTokens,
        overlapTokens: options.overlapTokens,
    });

    // Merge standard text chunks and visual evidence chunks
    const chunks = [...textChunks, ...visualChunks];

    const totalChunks = chunks.length;
    const avgChunkTokens = totalChunks > 0
        ? Math.round(chunks.reduce((acc, c) => acc + c.tokenCount, 0) / totalChunks)
        : 0;

    // Step 4: Batch Embedding Generation & Durable Vector Storage (Phase 2)
    let embeddingStatus = "SKIPPED";
    let embeddedChunks = 0;
    let failedChunks = 0;
    let reusedChunks = 0;
    const embeddingModel = getEmbeddingModel();
    const embeddingDimensions = getEmbeddingDimensions();
    const warnings = [...(extracted.warnings || [])];

    const shouldEmbed = options.generateEmbeddings !== false && (!extracted.isScanned || ocrPagesProcessed > 0) && chunks.length > 0;

    if (shouldEmbed) {
        embeddingStatus = "EMBEDDING";
        const userId = options.userId || "anonymous";

        try {
            // Idempotency check: inspect existing persisted chunks for this document
            const existingChunkMap = await getExistingDocumentChunks(extracted.documentId);
            const chunksToEmbed = [];
            const chunksToEmbedIndices = [];

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                const existing = existingChunkMap.get(chunk.chunkId);

                // If unchanged contentHash and identical model & dimensions, reuse existing embedding
                if (
                    existing &&
                    existing.contentHash === chunk.contentHash &&
                    existing.embeddingModel === embeddingModel &&
                    Array.isArray(existing.embedding) &&
                    existing.embedding.length === embeddingDimensions
                ) {
                    chunk.embedding = existing.embedding;
                    chunk.embeddingModel = existing.embeddingModel;
                    chunk.embeddingDimensions = existing.embeddingDimensions;
                    reusedChunks++;
                } else {
                    chunksToEmbed.push(chunk.content);
                    chunksToEmbedIndices.push(i);
                }
            }

            // Generate embeddings for new / modified chunks in batches
            if (chunksToEmbed.length > 0) {
                const batchSize = options.batchSize || 20;
                const generatedVectors = await generateEmbeddingsBatch(chunksToEmbed, {
                    batchSize,
                    client: options.embeddingClient,
                    dimensions: embeddingDimensions,
                });

                for (let k = 0; k < chunksToEmbedIndices.length; k++) {
                    const chunkIdx = chunksToEmbedIndices[k];
                    chunks[chunkIdx].embedding = generatedVectors[k];
                    chunks[chunkIdx].embeddingModel = embeddingModel;
                    chunks[chunkIdx].embeddingDimensions = embeddingDimensions;
                }
            }

            // Persist embedded chunks into MongoDB vector store
            await storeChunkEmbeddings(
                extracted.documentId,
                conversationId || "unassigned",
                userId,
                chunks
            );

            embeddedChunks = chunks.filter(
                (c) => Array.isArray(c.embedding) && c.embedding.length === embeddingDimensions
            ).length;
            failedChunks = totalChunks - embeddedChunks;

            if (embeddedChunks === totalChunks) {
                embeddingStatus = "EMBEDDED";
            } else if (embeddedChunks > 0) {
                embeddingStatus = "PARTIAL";
            } else {
                embeddingStatus = "FAILED";
            }
        } catch (embErr) {
            console.warn("[PDF Ingestion] Embedding pipeline error:", embErr.message);
            embeddingStatus = "FAILED";
            warnings.push(`Embedding generation failed: ${embErr.message}`);
        }
    }

    let cacheStatus = "SKIPPED";

    // Step 5: Cache in Redis for multi-turn conversational access
    if (conversationId) {
        const cacheSuccess = await cachePdfDocument(conversationId, {
            ...extracted,
            userId: options.userId || null,
            totalChunks,
            avgChunkTokens,
            chunks,
            warnings,
            embeddingStatus,
            embeddedChunks,
            failedChunks,
            reusedChunks,
            embeddingModel,
            embeddingDimensions,
            tablesDetected,
            chartsDetected,
            ocrPagesProcessed,
            visualExtractionStatus,
        });
        cacheStatus = cacheSuccess ? "CACHED" : "CACHE_FAILED";
        if (!cacheSuccess) {
            warnings.push("Redis document cache write failed; multi-turn access may be limited to local memory.");
        }
    }

    const ingestionResult = {
        ...extracted,
        totalChunks,
        avgChunkTokens,
        chunks,
        warnings,
        cacheStatus,
        embeddingStatus,
        embeddedChunks,
        failedChunks,
        reusedChunks,
        embeddingModel,
        embeddingDimensions,
        tablesDetected,
        chartsDetected,
        ocrPagesProcessed,
        visualExtractionStatus,
        ingestionDurationMs: Date.now() - startTime,
        processedAt: new Date().toISOString(),
    };

    return ingestionResult;
};

/**
 * Formats a clean, executive document outline (Table of Contents) from the ingested document.
 * This provides the LLM with structural awareness of the entire document without flooding
 * the context window with raw text.
 *
 * @param {object} ingestedDoc - Ingested document object
 * @param {number} [maxItems=25] - Max outline items to include
 * @returns {string} Formatted Markdown outline
 */
export const formatDocumentOutline = (ingestedDoc = {}, maxItems = 25) => {
    if (!ingestedDoc) return "";
    const fileName = ingestedDoc.fileName || "Document.pdf";
    const pageCount = ingestedDoc.pageCount || 1;
    const totalChunks = ingestedDoc.totalChunks || 0;
    const chunks = Array.isArray(ingestedDoc.chunks) ? ingestedDoc.chunks : [];

    const lines = [
        `### Document Structure: "${fileName}" (${pageCount} pages, ${totalChunks} indexed sections)`,
    ];

    if (ingestedDoc.isScanned) {
        lines.push("- **Warning**: This document has no extractable digital text (scanned/image-only).");
        return lines.join("\n");
    }

    // Deduplicate section headings by page
    const seenSections = new Set();
    const sectionList = [];

    for (const chunk of chunks) {
        const key = `p${chunk.pageStart}:${chunk.section}`;
        if (!seenSections.has(key) && chunk.section && chunk.section !== "General") {
            seenSections.add(key);
            sectionList.push({
                page: chunk.pageStart,
                section: chunk.section,
            });
            if (sectionList.length >= maxItems) break;
        }
    }

    if (sectionList.length > 0) {
        lines.push("Key Sections & Chapters:");
        for (const item of sectionList) {
            lines.push(`- **[Page ${item.page}]**: ${item.section}`);
        }
    } else {
        lines.push(`- All ${pageCount} pages indexed across ${totalChunks} structured chunks.`);
    }

    return lines.join("\n");
};

/**
 * Builds grounded context for the LLM based on document size and structure:
 * - For small/medium documents (<= maxContextTokens): returns full text with page delimiters.
 * - For large documents (> maxContextTokens): returns the executive outline and primary section chunks
 *   without blind arbitrary character truncation.
 *
 * @param {object} ingestedDoc - Ingested document bundle
 * @param {object} [options] - Options
 * @param {number} [options.maxContextTokens=12000] - Token budget for direct prompt injection
 * @returns {string} Formatted context string
 */
export const formatGroundedContext = (ingestedDoc = {}, options = {}) => {
    if (!ingestedDoc) return "";
    const maxTokens = options.maxContextTokens || 12000;
    const pages = Array.isArray(ingestedDoc.pages) ? ingestedDoc.pages : [];
    const chunks = Array.isArray(ingestedDoc.chunks) ? ingestedDoc.chunks : [];

    if (pages.length === 0) {
        return ingestedDoc.text || "";
    }

    const totalEstimatedTokens = ingestedDoc.estimatedTokens || estimateTokenCount(ingestedDoc.text);

    // Case A: Document fits comfortably within model context budget
    if (totalEstimatedTokens <= maxTokens) {
        const formattedPages = pages
            .filter((p) => p.hasText)
            .map((p) => `--- [Page ${p.pageNumber}] ---\n${p.text}`)
            .join("\n\n");
        return formattedPages;
    }

    // Case B: Document exceeds budget - assemble structural outline + first executive sections
    const outline = formatDocumentOutline(ingestedDoc);
    const executiveChunks = [];
    let accumulatedTokens = estimateTokenCount(outline);

    for (const chunk of chunks) {
        if (accumulatedTokens + chunk.tokenCount > maxTokens) break;
        executiveChunks.push(`--- [Page ${chunk.pageStart}${chunk.pageEnd > chunk.pageStart ? `-${chunk.pageEnd}` : ""}] Section: ${chunk.section} ---\n${chunk.content}`);
        accumulatedTokens += chunk.tokenCount;
    }

    const contextBody = [
        outline,
        "\nExecutive Overview & Initial Sections:",
        ...executiveChunks,
        `\n[Note: Document contains ${ingestedDoc.pageCount} pages and ${chunks.length} sections. Full indexed chunks are available for retrieval.]`,
    ].join("\n\n");

    return contextBody;
};

/**
 * Deterministic helper to find targeted chunks for a user query (Phase 1 pre-vector matcher).
 * Prioritizes chunks matching explicit page references (e.g. "page 4", "p. 12") or section keywords.
 *
 * @param {Array<object>} chunks - Ingested document chunks
 * @param {string} query - User search prompt
 * @param {number} [topK=6] - Max chunks to return
 * @returns {Array<object>} Selected high-relevance chunks
 */
export const findRelevantChunks = (chunks = [], query = "", topK = 6) => {
    if (!Array.isArray(chunks) || chunks.length === 0 || !query) return [];

    const cleanQuery = query.toLowerCase();

    // Check for explicit page number queries: "page 3", "page 12", "p. 4"
    const pageMatch = cleanQuery.match(/\b(?:page|p\.?)\s*(\d+)\b/i);
    const requestedPage = pageMatch ? parseInt(pageMatch[1], 10) : null;

    if (requestedPage !== null) {
        const pageChunks = chunks.filter((c) => requestedPage >= c.pageStart && requestedPage <= c.pageEnd);
        if (pageChunks.length > 0) {
            return pageChunks.slice(0, topK);
        }
    }

    // Token-based keyword score
    const queryTokens = cleanQuery
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2);

    if (queryTokens.length === 0) {
        return chunks.slice(0, topK);
    }

    const scored = chunks.map((chunk) => {
        let score = 0;
        const lowerContent = chunk.content.toLowerCase();
        const lowerSection = (chunk.section || "").toLowerCase();

        for (const token of queryTokens) {
            if (lowerSection.includes(token)) score += 3;
            if (lowerContent.includes(token)) score += 1;
        }

        return { chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const results = scored.filter((s) => s.score > 0).slice(0, topK).map((s) => s.chunk);

    return results.length > 0 ? results : chunks.slice(0, topK);
};

export {
    getCachedPdfDocument,
    getConversationDocumentIds,
    invalidatePdfDocumentCache,
    deleteDocumentChunks,
    deleteConversationChunks,
};

