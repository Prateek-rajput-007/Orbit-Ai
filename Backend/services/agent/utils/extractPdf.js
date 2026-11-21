import crypto from "node:crypto";
import { PDFParse } from "pdf-parse";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";
import { classifyPdfPage } from "../pdf/vision/pageClassifier.service.js";

/**
 * Formats raw byte count into human-readable string (KB/MB).
 *
 * @param {number} bytes - Size in bytes
 * @returns {string} Human readable formatted size
 */
export const formatFileSize = (bytes = 0) => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Generates a deterministic document ID from file metadata and buffer bytes.
 *
 * @param {string} fileName - Original file name
 * @param {number} byteLength - Total size in bytes
 * @param {Buffer} [buffer] - Document buffer for hashing
 * @returns {string} Stable document ID (e.g. "doc_a1b2c3d4e5f6")
 */
export const generateDocumentId = (fileName = "document.pdf", byteLength = 0, buffer = null) => {
    const hash = crypto.createHash("sha256");
    hash.update(fileName);
    hash.update(String(byteLength));
    if (buffer && Buffer.isBuffer(buffer) && buffer.length > 0) {
        // Hash first and last 4KB for deterministic high-speed identification
        const head = buffer.subarray(0, Math.min(4096, buffer.length));
        const tail = buffer.subarray(Math.max(0, buffer.length - 4096));
        hash.update(head);
        hash.update(tail);
    }
    return `doc_${hash.digest("hex").slice(0, 12)}`;
};

/**
 * Extracts clean page-by-page text and comprehensive metadata from a PDF attachment or buffer.
 *
 * Guarantees:
 * 1. Preserves exact page boundaries (1-based page numbers).
 * 2. Emits per-page character counts, token estimates, and table presence indicators.
 * 3. Gracefully reports empty pages, scanned image-only pages, and partial extractions without crashing.
 * 4. Retains 100% backward compatibility with legacy `extractPdfMetadata` consumers.
 *
 * @param {object} attachment - { name, mimeType, data (base64 string) } OR { buffer: Buffer, name: string }
 * @returns {Promise<object>} Complete page-aware extraction result
 */
export const extractPdfMetadata = async (attachment = {}) => {
    const safeAttachment = (attachment && typeof attachment === "object") ? attachment : {};
    const fileName = safeAttachment.name || safeAttachment.originalname || "document.pdf";
    let buffer = null;

    if (safeAttachment.buffer && Buffer.isBuffer(safeAttachment.buffer)) {
        buffer = safeAttachment.buffer;
    } else if (typeof safeAttachment.data === "string" && safeAttachment.data.trim()) {
        try {
            buffer = Buffer.from(safeAttachment.data, "base64");
        } catch {
            buffer = null;
        }
    }

    const dataUrl = safeAttachment.data
        ? `data:application/pdf;base64,${safeAttachment.data}`
        : buffer
        ? `data:application/pdf;base64,${buffer.toString("base64")}`
        : null;

    if (!buffer || buffer.length === 0) {
        const documentId = generateDocumentId(fileName, 0);
        return {
            documentId,
            fileName,
            fileSize: "0 KB",
            pageCount: 1,
            title: fileName.replace(/\.pdf$/i, ""),
            text: "",
            previewText: "",
            dataUrl: null,
            status: "FAILED",
            extractedPages: 0,
            failedPages: 1,
            totalCharacters: 0,
            estimatedTokens: 0,
            isScanned: false,
            requiresOcr: false,
            warnings: ["Attachment data is empty or missing"],
            pages: [],
            chunks: [],
        };
    }

    const byteLength = buffer.length;
    const fileSize = formatFileSize(byteLength);
    const documentId = generateDocumentId(fileName, byteLength, buffer);

    try {
        const parser = new PDFParse({ data: buffer });
        const info = await parser.getInfo().catch((err) => {
            console.warn("[PDFParse] Failed to read PDF info metadata:", err.message);
            return null;
        });
        const textResult = await parser.getText().catch((err) => {
            console.warn("[PDFParse] Failed to extract textResult:", err.message);
            return null;
        });
        await parser.destroy().catch(() => {});

        const reportedTotal = Number(info?.total) || Number(textResult?.total) || 1;
        const title = info?.info?.Title?.trim() || fileName.replace(/\.pdf$/i, "");
        const rawPages = Array.isArray(textResult?.pages) ? textResult.pages : [];

        // Inspect PDF document resources for embedded raster images (XObjects)
        const pageImageMap = new Map();
        try {
            const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
            const docPages = pdfDoc.getPages();
            for (let i = 0; i < docPages.length; i++) {
                const res = docPages[i].node.Resources();
                const xObject = res ? res.lookup(PDFName.of("XObject")) : null;
                let imgCount = 0;
                if (xObject instanceof PDFDict) {
                    imgCount = xObject.dict.size;
                }
                pageImageMap.set(i + 1, imgCount);
            }
        } catch {
            // Non-blocking fallback if pdf-lib inspection fails on non-standard stream
        }

        // Build structured page-aware representations
        const pages = [];
        let totalChars = 0;
        let emptyPageCount = 0;
        const warnings = [];

        if (rawPages.length > 0) {
            for (let idx = 0; idx < rawPages.length; idx++) {
                const rawPage = rawPages[idx];
                const pageNumber = Number(rawPage.num) || idx + 1;
                const pageText = typeof rawPage.text === "string" ? rawPage.text.trim() : "";
                const charCount = pageText.length;
                totalChars += charCount;

                const hasText = charCount > 0;
                if (!hasText) {
                    emptyPageCount++;
                }

                const pageImgCount = pageImageMap.get(pageNumber) || 0;
                const hasImages = pageImgCount > 0;

                const classification = classifyPdfPage({
                    pageNumber,
                    text: pageText,
                    hasImageObjects: hasImages,
                    imageCount: pageImgCount,
                    isScannedOverride: !hasText && hasImages,
                });

                pages.push({
                    pageNumber,
                    text: pageText,
                    characterCount: charCount,
                    tokenEstimate: Math.max(0, Math.ceil(charCount / 4)),
                    hasText,
                    hasTables: classification.hasTables,
                    hasCharts: classification.hasCharts,
                    hasImages: classification.hasImages,
                    pageType: classification.pageType,
                    extractedTextLength: classification.extractedTextLength,
                    requiresOCR: classification.requiresOCR,
                    requiresVision: classification.requiresVision,
                    processingStatus: classification.processingStatus,
                    extractionMethod: hasText ? "text" : "empty",
                    warnings: hasText ? classification.extractionWarnings : [`Page ${pageNumber} has no extractable text`],
                    extractionWarnings: classification.extractionWarnings,
                });
            }
        } else if (textResult?.text && textResult.text.trim()) {
            // Fallback for single page or un-delimited parser return
            const clean = textResult.text.trim();
            totalChars = clean.length;
            const singleImgCount = pageImageMap.get(1) || 0;
            const singleClass = classifyPdfPage({
                pageNumber: 1,
                text: clean,
                hasImageObjects: singleImgCount > 0,
                imageCount: singleImgCount,
            });
            pages.push({
                pageNumber: 1,
                text: clean,
                characterCount: clean.length,
                tokenEstimate: Math.max(0, Math.ceil(clean.length / 4)),
                hasText: true,
                hasTables: singleClass.hasTables,
                hasCharts: singleClass.hasCharts,
                hasImages: singleClass.hasImages,
                pageType: singleClass.pageType,
                extractedTextLength: singleClass.extractedTextLength,
                requiresOCR: singleClass.requiresOCR,
                requiresVision: singleClass.requiresVision,
                processingStatus: singleClass.processingStatus,
                extractionMethod: "text",
                warnings: [],
                extractionWarnings: singleClass.extractionWarnings,
            });
        }

        const pageCount = pages.length > 0 ? pages.length : reportedTotal;
        const extractedPages = pages.filter((p) => p.hasText).length;
        const failedPages = Math.max(0, pageCount - extractedPages);
        const combinedText = pages.map((p) => p.text).filter(Boolean).join("\n\n");
        const estimatedTokens = Math.max(0, Math.ceil(totalChars / 4));

        // Detection of scanned / image-only PDFs
        const isScanned = pageCount > 0 && extractedPages === 0;
        const requiresOcr = isScanned || (pageCount > 1 && extractedPages / pageCount < 0.2);

        if (isScanned) {
            warnings.push("Document appears to be a scanned image or photo without embedded digital text; OCR extraction is recommended.");
        } else if (emptyPageCount > 0) {
            warnings.push(`${emptyPageCount} of ${pageCount} pages contain no extractable digital text.`);
        }

        let status = "READY";
        if (isScanned || extractedPages === 0) {
            status = "FAILED";
        } else if (emptyPageCount > 0 || failedPages > 0) {
            status = "PARTIAL";
        }

        return {
            documentId,
            fileName,
            fileSize,
            pageCount,
            title,
            text: combinedText,
            previewText: combinedText.slice(0, 350),
            dataUrl,
            status,
            extractedPages,
            failedPages,
            totalCharacters: totalChars,
            estimatedTokens,
            isScanned,
            requiresOcr,
            warnings,
            pages,
            pageClassifications: {
                total: pages.length,
                TEXT_HEAVY: pages.filter((p) => p.pageType === "TEXT_HEAVY").length,
                TABLE_HEAVY: pages.filter((p) => p.pageType === "TABLE_HEAVY").length,
                CHART_HEAVY: pages.filter((p) => p.pageType === "CHART_HEAVY").length,
                SCANNED: pages.filter((p) => p.pageType === "SCANNED").length,
                IMAGE_HEAVY: pages.filter((p) => p.pageType === "IMAGE_HEAVY").length,
                MIXED: pages.filter((p) => p.pageType === "MIXED").length,
                EMPTY: pages.filter((p) => p.pageType === "EMPTY").length,
                UNKNOWN: pages.filter((p) => p.pageType === "UNKNOWN").length,
            },
            rawBuffer: buffer,
            chunks: [],
        };
    } catch (err) {
        console.warn("[PDF Extraction] Parsing exception caught:", err.message);
        return {
            documentId,
            fileName,
            fileSize,
            pageCount: 1,
            title: fileName.replace(/\.pdf$/i, ""),
            text: "",
            previewText: "",
            dataUrl,
            status: "FAILED",
            extractedPages: 0,
            failedPages: 1,
            totalCharacters: 0,
            estimatedTokens: 0,
            isScanned: false,
            requiresOcr: false,
            warnings: [`PDF extraction error: ${err.message}`],
            pages: [],
            chunks: [],
        };
    }
};

/**
 * Alias to support standard page-aware naming conventions.
 */
export const extractPdfPages = extractPdfMetadata;

// In-memory fallback cache for zero-downtime offline resilience and fast test execution
const localMemoryCache = new Map();
const localMemorySets = new Map();

/**
 * Caches extracted PDF metadata, pages, and chunks in Redis for fast multi-turn access.
 * Implements multi-document isolation per conversation using both active pointer and documentId keys,
 * backed by in-memory caching for offline resilience.
 *
 * @param {string} conversationId - Orbit conversation ID
 * @param {object} docData - Full document data bundle
 * @returns {Promise<boolean>} True if cache write succeeded, false otherwise
 */
export const cachePdfDocument = async (conversationId, docData) => {
    if (!conversationId || !docData) return false;
    const { rawBuffer, ...cacheableDoc } = docData;
    const serialized = JSON.stringify(cacheableDoc);
    const ttl = 24 * 60 * 60; // 24 hours

    // Always update local memory cache for resilience
    localMemoryCache.set(`pdf-doc-${conversationId}`, serialized);
    if (docData.documentId) {
        localMemoryCache.set(`pdf-doc-${conversationId}-${docData.documentId}`, serialized);
        if (!localMemorySets.has(conversationId)) {
            localMemorySets.set(conversationId, new Set());
        }
        localMemorySets.get(conversationId).add(docData.documentId);
    }

    try {
        const operations = [
            redis.set(`pdf-doc-${conversationId}`, serialized, "EX", ttl),
        ];

        if (docData.documentId) {
            operations.push(
                redis.set(`pdf-doc-${conversationId}-${docData.documentId}`, serialized, "EX", ttl)
            );
            operations.push(
                redis.sadd(`pdf-docs-${conversationId}`, docData.documentId)
            );
            operations.push(
                redis.expire(`pdf-docs-${conversationId}`, ttl)
            );
        }

        await Promise.all(operations);
        return true;
    } catch (err) {
        console.warn("[Redis] Unable to cache PDF document to Redis (using memory fallback):", err.message);
        return false;
    }
};

/**
 * Retrieves cached PDF document data for a conversation from Redis or memory fallback.
 * Supports targeted retrieval by documentId while defaulting to the latest active document.
 *
 * @param {string} conversationId - Orbit conversation ID
 * @param {string} [documentId] - Optional specific document ID
 * @returns {Promise<object|null>} Cached document data or null
 */
export const getCachedPdfDocument = async (conversationId, documentId = null) => {
    if (!conversationId) return null;

    // Targeted document lookup: return only the requested document, or null if not found
    if (documentId) {
        try {
            const specificRaw = await redis.get(`pdf-doc-${conversationId}-${documentId}`);
            if (specificRaw) return JSON.parse(specificRaw);
        } catch {}
        const localSpecific = localMemoryCache.get(`pdf-doc-${conversationId}-${documentId}`);
        return localSpecific ? JSON.parse(localSpecific) : null;
    }

    // Active/latest document lookup
    try {
        const key = `pdf-doc-${conversationId}`;
        const raw = await redis.get(key);
        if (raw) return JSON.parse(raw);
    } catch {}

    const localRaw = localMemoryCache.get(`pdf-doc-${conversationId}`);
    return localRaw ? JSON.parse(localRaw) : null;
};

/**
 * Retrieves all document IDs associated with a conversation.
 *
 * @param {string} conversationId - Orbit conversation ID
 * @returns {Promise<string[]>} Array of document IDs
 */
export const getConversationDocumentIds = async (conversationId) => {
    if (!conversationId) return [];
    try {
        const ids = await redis.smembers(`pdf-docs-${conversationId}`);
        if (Array.isArray(ids) && ids.length > 0) return ids;
    } catch {}

    const localSet = localMemorySets.get(conversationId);
    return localSet ? Array.from(localSet) : [];
};

/**
 * Invalidates and purges all cached PDF documents associated with a conversation.
 *
 * @param {string} conversationId - Orbit conversation ID
 */
export const invalidatePdfDocumentCache = async (conversationId) => {
    if (!conversationId) return;

    // Purge local memory cache
    localMemoryCache.delete(`pdf-doc-${conversationId}`);
    const localSet = localMemorySets.get(conversationId);
    if (localSet) {
        for (const docId of localSet) {
            localMemoryCache.delete(`pdf-doc-${conversationId}-${docId}`);
        }
        localMemorySets.delete(conversationId);
    }

    try {
        const docIds = await redis.smembers(`pdf-docs-${conversationId}`).catch(() => []);
        const keysToDelete = [
            `pdf-doc-${conversationId}`,
            `pdf-docs-${conversationId}`,
        ];

        if (Array.isArray(docIds)) {
            for (const docId of docIds) {
                keysToDelete.push(`pdf-doc-${conversationId}-${docId}`);
            }
        }

        await Promise.all(keysToDelete.map((k) => redis.del(k)));
    } catch (err) {
        console.warn("[Redis] Unable to invalidate cached PDF document in Redis:", err.message);
    }
};
