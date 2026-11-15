/**
 * @file visualEvidence.service.js
 * @description Bridges visual intelligence output (Tables, Charts, OCR) into searchable,
 * embeddable PDF chunks for hybrid retrieval and verifiable citation attribution (Phase 5).
 *
 * Guarantees:
 * 1. Preserves row and column relationships for tables in dense, contextual Markdown.
 * 2. Preserves axes, units, series, and observations for charts.
 * 3. Preserves 1-based pageStart and pageEnd attributes pointing to the authoritative original PDF page.
 * 4. Generates deterministic, stable chunk identifiers and SHA256 content hashes.
 * 5. Tags chunk metadata with contentType (TABLE, CHART, OCR_TEXT) and visualMetadata.
 */

import crypto from "node:crypto";
import { estimateTokenCount } from "../ingestion/chunking.service.js";
import { formatTableToMarkdown, formatChartToSearchableText } from "./visionExtraction.service.js";

/**
 * Computes deterministic SHA256 content hash.
 *
 * @param {string} text - Content string
 * @returns {string} 16-character hex hash
 */
export const hashVisualContent = (text = "") => {
    return crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
};

/**
 * Transforms an extracted table structure into a searchable PDF chunk.
 *
 * @param {object} table - Extracted table object
 * @param {object} params
 * @param {string} params.documentId - Orbit document ID
 * @param {number} [params.tableIndex=0] - 0-based index of table on page
 * @returns {object} Standardized PDF chunk
 */
export const createTableChunk = (table = {}, params = {}) => {
    const documentId = params.documentId || "doc_unknown";
    const pageNumber = typeof table.pageNumber === "number" ? table.pageNumber : 1;
    const tableIndex = typeof params.tableIndex === "number" ? params.tableIndex : 0;
    const chunkId = `${documentId}_p${pageNumber}_tbl_${tableIndex}`;
    const title = table.title || `Table on Page ${pageNumber}`;
    const markdown = table.markdown || formatTableToMarkdown(table);

    const headersList = Array.isArray(table.headers) ? table.headers.join(", ") : "";
    const rowSummary = Array.isArray(table.rows) ? `${table.rows.length} rows` : "";

    const content = `### Table: ${title} (Page ${pageNumber})
Columns: [${headersList}] (${rowSummary})

${markdown}
`.trim();

    const contentHash = hashVisualContent(content);
    const characterCount = content.length;
    const tokenCount = estimateTokenCount(content);

    return {
        chunkId,
        documentId,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        section: `Table: ${title}`,
        content,
        tokenCount,
        characterCount,
        startOffset: 0,
        endOffset: characterCount,
        contentHash,
        contentType: "TABLE",
        extractionMethod: "vision",
        visualMetadata: {
            title,
            headers: table.headers || [],
            rows: table.rows || [],
            markdown,
            confidence: table.confidence || "MEDIUM",
            source: table.source || "VISION",
        },
    };
};

/**
 * Transforms an extracted chart structure into a searchable PDF chunk.
 *
 * @param {object} chart - Extracted chart object
 * @param {object} params
 * @param {string} params.documentId - Orbit document ID
 * @param {number} [params.chartIndex=0] - 0-based index of chart on page
 * @returns {object} Standardized PDF chunk
 */
export const createChartChunk = (chart = {}, params = {}) => {
    const documentId = params.documentId || "doc_unknown";
    const pageNumber = typeof chart.pageNumber === "number" ? chart.pageNumber : 1;
    const chartIndex = typeof params.chartIndex === "number" ? params.chartIndex : 0;
    const chunkId = `${documentId}_p${pageNumber}_chart_${chartIndex}`;
    const title = chart.title || `Chart on Page ${pageNumber}`;
    const chartType = chart.chartType || "BAR";
    const searchableText = chart.searchableText || formatChartToSearchableText(chart);

    const content = `### Chart: ${title} (Page ${pageNumber}, Type: ${chartType})
${searchableText}
`.trim();

    const contentHash = hashVisualContent(content);
    const characterCount = content.length;
    const tokenCount = estimateTokenCount(content);

    return {
        chunkId,
        documentId,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        section: `Chart: ${title}`,
        content,
        tokenCount,
        characterCount,
        startOffset: 0,
        endOffset: characterCount,
        contentHash,
        contentType: "CHART",
        extractionMethod: "vision",
        visualMetadata: {
            title,
            chartType,
            xAxis: chart.xAxis || null,
            yAxis: chart.yAxis || null,
            series: chart.series || [],
            keyInsights: chart.keyInsights || [],
            confidence: chart.confidence || "MEDIUM",
            source: chart.source || "VISION",
        },
    };
};

/**
 * Transforms extracted OCR text for a scanned page into a searchable PDF chunk.
 *
 * @param {string} ocrText - Extracted OCR text
 * @param {object} params
 * @param {string} params.documentId - Orbit document ID
 * @param {number} params.pageNumber - 1-based page number
 * @returns {object|null} Standardized PDF chunk or null if empty
 */
export const createOcrChunk = (ocrText = "", params = {}) => {
    const clean = typeof ocrText === "string" ? ocrText.trim() : "";
    if (!clean) return null;

    const documentId = params.documentId || "doc_unknown";
    const pageNumber = typeof params.pageNumber === "number" ? params.pageNumber : 1;
    const chunkId = `${documentId}_p${pageNumber}_ocr`;
    const title = `Scanned Page ${pageNumber}`;

    const content = `### Scanned Content: ${title}
${clean}
`.trim();

    const contentHash = hashVisualContent(content);
    const characterCount = content.length;
    const tokenCount = estimateTokenCount(content);

    return {
        chunkId,
        documentId,
        pageStart: pageNumber,
        pageEnd: pageNumber,
        section: title,
        content,
        tokenCount,
        characterCount,
        startOffset: 0,
        endOffset: characterCount,
        contentHash,
        contentType: "OCR_TEXT",
        extractionMethod: "ocr",
        visualMetadata: {
            title,
            isOcr: true,
            source: "VISION_OCR",
        },
    };
};

/**
 * Aggregates visual extraction results across a document into searchable PDF chunks.
 *
 * @param {Array<object>} visualResults - Array of results from extractPageVisualIntelligence
 * @param {object} params
 * @param {string} params.documentId - Document ID
 * @returns {Array<object>} Formatted visual chunks
 */
export const compileVisualChunks = (visualResults = [], params = {}) => {
    if (!Array.isArray(visualResults)) return [];
    const documentId = params.documentId || "doc_unknown";
    const visualChunks = [];

    for (const res of visualResults) {
        if (!res || res.status !== "SUCCESS") continue;
        const pageNum = res.pageNumber || 1;

        // 1. Process Tables
        if (Array.isArray(res.tables)) {
            res.tables.forEach((tbl, idx) => {
                const chunk = createTableChunk(tbl, { documentId, tableIndex: idx });
                if (chunk) visualChunks.push(chunk);
            });
        }

        // 2. Process Charts
        if (Array.isArray(res.charts)) {
            res.charts.forEach((ch, idx) => {
                const chunk = createChartChunk(ch, { documentId, chartIndex: idx });
                if (chunk) visualChunks.push(chunk);
            });
        }

        // 3. Process Scanned OCR Text
        if (res.ocrText && res.ocrText.trim()) {
            const chunk = createOcrChunk(res.ocrText, { documentId, pageNumber: pageNum });
            if (chunk) visualChunks.push(chunk);
        }
    }

    return visualChunks;
};
