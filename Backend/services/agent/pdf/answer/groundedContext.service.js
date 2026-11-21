/**
 * @file groundedContext.service.js
 * @description Prepares and formats retrieved PDF chunks into a token-budgeted,
 * source-tagged grounded context for LLM answer generation.
 *
 * Guarantees:
 * 1. Assigns stable, deterministic citation identifiers ([S1], [S2], ...).
 * 2. Preserves chunk metadata (documentId, chunkId, pageStart, pageEnd, section, content).
 * 3. Deduplicates identical chunks or content.
 * 4. Respects configurable token/character budgets and records truncation diagnostics.
 * 5. Sanitizes untrusted PDF text into structured XML source blocks.
 */

export const DEFAULT_MAX_CONTEXT_TOKENS = 8000;
export const CHARS_PER_TOKEN_ESTIMATE = 4;

/**
 * Strips potential prompt-injection delimiters from untrusted document text.
 *
 * @param {string} text - Raw chunk content
 * @returns {string} Sanitized content
 */
export const sanitizeUntrustedText = (text = "") => {
    if (!text || typeof text !== "string") return "";
    return text
        .replace(/<\/source>/gi, "&lt;/source&gt;")
        .replace(/<source[^>]*>/gi, "&lt;source&gt;")
        .replace(/={3,}\s*(?:END|VERIFIED|START|BEGIN)?\s*DOCUMENT\s*CONTEXT[^=]*={0,}/gi, (match) => {
            return match.replace(/={3,}/g, "==\\=");
        })
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ""); // Remove control chars
};

/**
 * Builds grounded context from an array of retrieved or extracted chunks.
 *
 * @param {Array<object>} chunks - Retrieved PDF chunks
 * @param {object} [options] - Configuration options
 * @param {number} [options.maxTokens=8000] - Token budget
 * @param {string} [options.defaultDocumentName="Document.pdf"] - Fallback document name
 * @param {string} [options.defaultDocumentId=""] - Fallback document ID
 * @returns {{
 *   contextText: string,
 *   sourceMap: Map<string, object>,
 *   sourcesList: Array<object>,
 *   isTruncated: boolean,
 *   retainedCount: number,
 *   totalCandidateCount: number,
 *   estimatedTokens: number
 * }}
 */
export const buildGroundedContext = (chunks = [], options = {}) => {
    const maxTokens = Math.max(500, options.maxTokens || DEFAULT_MAX_CONTEXT_TOKENS);
    const maxChars = maxTokens * CHARS_PER_TOKEN_ESTIMATE;
    const defaultDocName = options.defaultDocumentName || "Document.pdf";
    const defaultDocId = options.defaultDocumentId || "";

    const sourceMap = new Map();
    const sourcesList = [];
    const seenHashes = new Set();
    const seenChunkIds = new Set();

    if (!Array.isArray(chunks) || chunks.length === 0) {
        return {
            contextText: "No document evidence available.",
            sourceMap,
            sourcesList,
            isTruncated: false,
            retainedCount: 0,
            totalCandidateCount: 0,
            estimatedTokens: 0,
        };
    }

    let accumulatedChars = 0;
    let isTruncated = false;
    let sourceIndex = 1;

    for (const chunk of chunks) {
        if (!chunk || typeof chunk !== "object") continue;

        const content = chunk.content || chunk.text || "";
        const cleanContent = content.trim();
        if (!cleanContent) continue;

        // Deduplication by chunkId and contentHash / text hash
        const chunkId = chunk.chunkId || `chunk_${sourceIndex}`;
        const contentHash = chunk.contentHash || cleanContent.slice(0, 60);

        if (seenChunkIds.has(chunkId) || seenHashes.has(contentHash)) {
            continue;
        }

        const estimatedChunkChars = cleanContent.length + 150; // include source wrapper overhead
        if (accumulatedChars + estimatedChunkChars > maxChars && sourcesList.length > 0) {
            isTruncated = true;
            break; // Token budget reached
        }

        seenChunkIds.add(chunkId);
        seenHashes.add(contentHash);

        const sourceId = `S${sourceIndex}`;
        const pageStart = typeof chunk.pageStart === "number" ? chunk.pageStart : (chunk.page || 1);
        const pageEnd = typeof chunk.pageEnd === "number" ? chunk.pageEnd : pageStart;
        const section = (chunk.section || "General").trim();
        const documentId = chunk.documentId || defaultDocId;
        const documentName = chunk.fileName || chunk.documentName || defaultDocName;

        const sourceMetadata = {
            sourceId,
            citationNumber: sourceIndex,
            documentId,
            documentName,
            chunkId,
            pageStart,
            pageEnd,
            section,
            content: cleanContent,
            contentHash,
            tokenCount: chunk.tokenCount || Math.ceil(cleanContent.length / CHARS_PER_TOKEN_ESTIMATE),
            rrfScore: chunk.rrfScore || null,
            sources: chunk.sources || ["retrieval"],
            contentType: chunk.contentType || "TEXT",
            extractionMethod: chunk.extractionMethod || "text",
            visualMetadata: chunk.visualMetadata || null,
        };

        sourceMap.set(sourceId, sourceMetadata);
        sourcesList.push(sourceMetadata);
        accumulatedChars += estimatedChunkChars;
        sourceIndex++;
    }

    // Build structured XML-like source blocks for clear distinction from instructions
    const sourceBlocks = sourcesList.map((s) => {
        const sanitized = sanitizeUntrustedText(s.content);
        const pageRange = s.pageStart === s.pageEnd ? `Page ${s.pageStart}` : `Pages ${s.pageStart}-${s.pageEnd}`;
        const typeAttr = s.contentType && s.contentType !== "TEXT" ? ` type="${s.contentType}"` : "";
        return `<source id="${s.sourceId}" document="${s.documentName}" pages="${pageRange}" section="${s.section}"${typeAttr}>\n${sanitized}\n</source>`;
    });

    const contextText = sourceBlocks.join("\n\n");
    const totalCandidateCount = chunks.length;
    const retainedCount = sourcesList.length;
    const estimatedTokens = Math.ceil(accumulatedChars / CHARS_PER_TOKEN_ESTIMATE);

    return {
        contextText,
        sourceMap,
        sourcesList,
        isTruncated,
        retainedCount,
        totalCandidateCount,
        estimatedTokens,
    };
};

