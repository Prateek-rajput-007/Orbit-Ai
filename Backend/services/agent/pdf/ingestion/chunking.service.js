import crypto from "node:crypto";

/**
 * Tunable defaults for structure-aware document chunking.
 * Token estimation uses the standard heuristic: ~4 characters per token for English text.
 */
export const CHUNKING_DEFAULTS = {
    targetChunkTokens: 600,   // Target chunk size in estimated tokens (500-800 recommended)
    maxChunkTokens: 1000,     // Hard maximum ceiling for any single chunk
    overlapTokens: 100,       // Overlap between adjacent chunks (80-120 recommended)
    minChunkTokens: 40,       // Minimum tokens to avoid micro-chunks unless trailing
};

/**
 * Estimates token count for a text string using character-ratio heuristic.
 * 
 * Heuristic justification:
 * In modern subword tokenizers (BPE, SentencePiece) for English text,
 * 1 token ~= 3.8 to 4.2 characters (OpenAI / Gemini / Anthropic benchmarks).
 * Using Math.ceil(text.length / 4) provides a lightweight, deterministic token estimation
 * without introducing heavy native C++ tokenizer dependencies into the runtime.
 *
 * @param {string} text - Input text
 * @returns {number} Estimated token count
 */
export const estimateTokenCount = (text = "") => {
    if (!text || typeof text !== "string") return 0;
    const trimmed = text.trim();
    if (!trimmed) return 0;
    return Math.max(1, Math.ceil(trimmed.length / 4));
};

/**
 * Detects whether a single line is a structural heading or section title.
 * 
 * Recognized patterns:
 * 1. Markdown headings: # Heading, ## Subheading, etc.
 * 2. Numbered outline headings: 1. Executive Summary, 2.1 Technical Specs, A. Appendix
 * 3. Formal section labels: Section 4:, Chapter 2:, Part I:
 * 4. Short, uppercase or title-case standalone lines (< 80 chars)
 *
 * @param {string} line - A single line of text
 * @returns {string|null} Extracted heading title or null
 */
export const extractHeading = (line = "") => {
    if (!line || typeof line !== "string") return null;
    const clean = line.trim();
    if (!clean || clean.length < 3 || clean.length > 100) return null;

    // Markdown heading: # Title
    const mdMatch = clean.match(/^#{1,6}\s+(.+)$/);
    if (mdMatch) return mdMatch[1].trim();

    // Formal Section / Chapter: "Section 3: Risk Factors", "Chapter 1 - Introduction"
    const sectionMatch = clean.match(/^(?:Section|Chapter|Part|Appendix)\s+[A-Za-z0-9.:\-_ ]+$/i);
    if (sectionMatch) return clean;

    // Numbered outline: "1. Executive Summary", "2.1 Financial Results"
    const numberedMatch = clean.match(/^(\d+(?:\.\d+)*|[A-Z]\.)\s+([A-Z0-9][A-Za-z0-9 ,&/\-–—:]{2,80})$/);
    if (numberedMatch) return clean;

    // Uppercase header line: "EXECUTIVE SUMMARY", "RISK FACTORS AND CHALLENGES"
    if (clean.length >= 4 && clean.length <= 60 && clean === clean.toUpperCase() && /^[A-Z0-9\s,&/\-–—:]+$/.test(clean)) {
        return clean;
    }

    return null;
};

/**
 * Splits text into structural sentences while respecting abbreviations.
 *
 * @param {string} text - Input text block
 * @returns {string[]} Array of sentence strings
 */
export const splitIntoSentences = (text = "") => {
    if (!text || typeof text !== "string") return [];
    const trimmed = text.trim();
    if (!trimmed) return [];

    // Match punctuation followed by whitespace and an uppercase letter, or paragraph end
    const sentences = trimmed
        .replace(/([.!?])\s+([A-Z0-9])/g, "$1\n$2")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

    return sentences.length > 0 ? sentences : [trimmed];
};

/**
 * Computes deterministic SHA-256 hash slice for content verification and deduplication.
 *
 * @param {string} content - Text content
 * @returns {string} 16-character hex hash
 */
export const hashContent = (content = "") => {
    return crypto.createHash("sha256").update(content.trim()).digest("hex").slice(0, 16);
};

/**
 * Chunks a page-aware extracted document into structure-aware, overlapping segments.
 *
 * Guarantees:
 * 1. Preserves exact page boundaries (pageStart, pageEnd for every chunk).
 * 2. Records document-global character offsets (startOffset, endOffset).
 * 3. Detects nearest preceding section / heading for contextual grounding.
 * 4. Avoids empty chunks and prevents dropping non-whitespace text.
 * 5. Deterministic chunk IDs: `${documentId}_c${index.padStart(4, "0")}`.
 *
 * @param {object} extractedDoc - Extracted document with `pages: Array<{ pageNumber, text }>`
 * @param {object} [options] - Custom chunking parameters
 * @returns {Array<object>} Array of structured chunk objects
 */
export const chunkDocument = (extractedDoc = {}, options = {}) => {
    const documentId = extractedDoc.documentId || "doc_unknown";
    const pages = Array.isArray(extractedDoc.pages) ? extractedDoc.pages : [];
    
    if (pages.length === 0) {
        return [];
    }

    const targetTokens = options.targetChunkTokens || CHUNKING_DEFAULTS.targetChunkTokens;
    const maxTokens = options.maxChunkTokens || CHUNKING_DEFAULTS.maxChunkTokens;
    const overlapTokens = options.overlapTokens || CHUNKING_DEFAULTS.overlapTokens;
    const minTokens = options.minChunkTokens || CHUNKING_DEFAULTS.minChunkTokens;

    // Step 1: Flatten pages into positioned structural blocks (paragraphs, headers, tables)
    // while tracking each block's page number and document-global character offsets.
    const blocks = [];
    let globalOffset = 0;
    let currentHeading = extractedDoc.title || "Introduction";

    for (const page of pages) {
        const pageNum = Number(page.pageNumber) || 1;
        const pageText = typeof page.text === "string" ? page.text : "";
        if (!pageText.trim()) continue;

        // Split page by paragraph breaks (\n\n+) or major structural line breaks
        const rawParagraphs = pageText.split(/\n{2,}/);

        for (const rawPara of rawParagraphs) {
            const cleanPara = rawPara.trim();
            if (!cleanPara) continue;

            // Check if this paragraph is or begins with a section heading
            const lines = cleanPara.split("\n").map((l) => l.trim()).filter(Boolean);
            const firstLineHeading = lines.length > 0 ? extractHeading(lines[0]) : null;
            if (firstLineHeading) {
                currentHeading = firstLineHeading;
            }

            const blockTokens = estimateTokenCount(cleanPara);
            const blockStart = globalOffset;
            const blockEnd = globalOffset + cleanPara.length;
            globalOffset = blockEnd + 2; // account for paragraph delimiter

            blocks.push({
                text: cleanPara,
                pageNumber: pageNum,
                section: currentHeading,
                tokenCount: blockTokens,
                startOffset: blockStart,
                endOffset: blockEnd,
            });
        }
    }

    if (blocks.length === 0) {
        return [];
    }

    // Step 2: Assemble blocks into chunks respecting target and max token limits
    const chunks = [];
    let currentChunkBlocks = [];
    let currentTokens = 0;

    const finalizeChunk = (blockList) => {
        if (!blockList || blockList.length === 0) return null;

        const combinedText = blockList.map((b) => b.text).join("\n\n").trim();
        if (!combinedText) return null;

        const firstBlock = blockList[0];
        const lastBlock = blockList[blockList.length - 1];

        const chunkIndex = chunks.length;
        const chunkId = `${documentId}_c${String(chunkIndex + 1).padStart(4, "0")}`;
        const tokenCount = estimateTokenCount(combinedText);

        const chunk = {
            chunkId,
            documentId,
            chunkIndex,
            pageStart: firstBlock.pageNumber,
            pageEnd: lastBlock.pageNumber,
            section: firstBlock.section || currentHeading || "General",
            content: combinedText,
            tokenCount,
            characterCount: combinedText.length,
            startOffset: firstBlock.startOffset,
            endOffset: lastBlock.endOffset,
            contentHash: hashContent(combinedText),
            contentType: "TEXT",
        };

        chunks.push(chunk);
        return chunk;
    };

    // Helper: extracts trailing sentences from a block list to form the overlap context
    const getOverlapBlocks = (blockList, maxOverlapTokens) => {
        if (!blockList || blockList.length === 0) return [];
        const overlapList = [];
        let accumulatedTokens = 0;

        for (let i = blockList.length - 1; i >= 0; i--) {
            const b = blockList[i];
            if (accumulatedTokens + b.tokenCount <= maxOverlapTokens) {
                overlapList.unshift(b);
                accumulatedTokens += b.tokenCount;
            } else {
                break;
            }
        }
        return overlapList;
    };

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];

        // If a single block exceeds maxTokens (e.g. giant continuous unformatted text),
        // sub-divide it by sentences
        if (block.tokenCount > maxTokens) {
            const sentences = splitIntoSentences(block.text);
            let sentenceSubList = [];
            let sentenceTokens = 0;
            let sentenceOffset = block.startOffset;

            for (const sentence of sentences) {
                const sTokens = estimateTokenCount(sentence);
                if (sentenceTokens + sTokens > targetTokens && sentenceSubList.length > 0) {
                    // Flush existing chunk
                    if (currentChunkBlocks.length > 0) {
                        currentChunkBlocks.push(...sentenceSubList);
                        finalizeChunk(currentChunkBlocks);
                    } else {
                        finalizeChunk(sentenceSubList);
                    }
                    // Start next chunk with overlap
                    const overlap = getOverlapBlocks(sentenceSubList, overlapTokens);
                    currentChunkBlocks = [...overlap];
                    currentTokens = currentChunkBlocks.reduce((acc, b) => acc + b.tokenCount, 0);
                    sentenceSubList = [];
                    sentenceTokens = 0;
                }

                const sBlock = {
                    text: sentence,
                    pageNumber: block.pageNumber,
                    section: block.section,
                    tokenCount: sTokens,
                    startOffset: sentenceOffset,
                    endOffset: sentenceOffset + sentence.length,
                };
                sentenceOffset += sentence.length + 1;
                sentenceSubList.push(sBlock);
                sentenceTokens += sTokens;
            }

            if (sentenceSubList.length > 0) {
                currentChunkBlocks.push(...sentenceSubList);
                currentTokens += sentenceTokens;
            }
            continue;
        }

        // Standard block accumulation
        if (currentTokens + block.tokenCount > targetTokens && currentChunkBlocks.length > 0) {
            // Check if we should close the chunk
            finalizeChunk(currentChunkBlocks);

            // Carry over overlap blocks to next chunk for boundary continuity
            const overlap = getOverlapBlocks(currentChunkBlocks, overlapTokens);
            currentChunkBlocks = [...overlap, block];
            currentTokens = currentChunkBlocks.reduce((acc, b) => acc + b.tokenCount, 0);
        } else {
            currentChunkBlocks.push(block);
            currentTokens += block.tokenCount;
        }
    }

    // Flush remaining blocks
    if (currentChunkBlocks.length > 0) {
        // If remaining block is tiny and we already have a previous chunk, check whether to append
        if (currentTokens < minTokens && chunks.length > 0) {
            const lastChunk = chunks[chunks.length - 1];
            const remainingText = currentChunkBlocks.map((b) => b.text).join("\n\n").trim();
            const combinedContent = `${lastChunk.content}\n\n${remainingText}`;
            if (estimateTokenCount(combinedContent) <= maxTokens) {
                lastChunk.content = combinedContent;
                lastChunk.characterCount = combinedContent.length;
                lastChunk.tokenCount = estimateTokenCount(combinedContent);
                lastChunk.pageEnd = currentChunkBlocks[currentChunkBlocks.length - 1].pageNumber;
                lastChunk.endOffset = currentChunkBlocks[currentChunkBlocks.length - 1].endOffset;
                lastChunk.contentHash = hashContent(combinedContent);
            } else {
                finalizeChunk(currentChunkBlocks);
            }
        } else {
            finalizeChunk(currentChunkBlocks);
        }
    }

    return chunks;
};

