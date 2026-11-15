/**
 * @file pageClassifier.service.js
 * @description Page-level visual content classifier for the Orbit PDF Agent (Phase 5).
 *
 * Classifies individual PDF pages into one of eight distinct architectural categories:
 * - TEXT_HEAVY: Standard narrative/body text, articles, policies.
 * - IMAGE_HEAVY: Photo or graphic dominant with sparse text.
 * - SCANNED: Scanned paper, photo of document, or zero digital selectable text.
 * - TABLE_HEAVY: Dense tabular data, financial spreadsheets, grids.
 * - CHART_HEAVY: Data visualisations, bar/line/pie charts, plots.
 * - MIXED: Mixed layout containing substantial body text and tables/charts/images.
 * - EMPTY: Blank page (zero characters, zero media).
 * - UNKNOWN: Unparseable or corrupt page.
 *
 * Guarantees:
 * 1. 1-based page numbering throughout.
 * 2. Does NOT classify low-text pages as scanned unless visual/density indicators confirm it.
 * 3. Does NOT send every page to vision models; only selectively flags pages requiring vision or OCR.
 */

export const PAGE_TYPES = {
    TEXT_HEAVY: "TEXT_HEAVY",
    IMAGE_HEAVY: "IMAGE_HEAVY",
    SCANNED: "SCANNED",
    TABLE_HEAVY: "TABLE_HEAVY",
    CHART_HEAVY: "CHART_HEAVY",
    MIXED: "MIXED",
    EMPTY: "EMPTY",
    UNKNOWN: "UNKNOWN",
};

// Thresholds for deterministic heuristics
export const CLASSIFICATION_THRESHOLDS = {
    EMPTY_CHAR_LIMIT: 5,
    SCANNED_MAX_CHARS: 60,
    TEXT_HEAVY_MIN_CHARS: 350,
    TABLE_INDICATOR_MIN_COUNT: 2,
    CHART_KEYWORD_MIN_COUNT: 2,
};

/**
 * Detects table-like structural patterns in raw extracted page text.
 *
 * @param {string} text - Raw page text
 * @returns {{ hasTables: boolean, tableScore: number, matchDetails: string[] }}
 */
export const detectTableSignals = (text = "") => {
    if (!text || typeof text !== "string") {
        return { hasTables: false, tableScore: 0, matchDetails: [] };
    }

    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const matchDetails = [];
    let tableScore = 0;

    // 1. Markdown table pipes: | col1 | col2 |
    const pipeLines = lines.filter((l) => (l.match(/\|/g) || []).length >= 2);
    if (pipeLines.length >= 2) {
        tableScore += pipeLines.length * 2;
        matchDetails.push(`markdown_pipes (${pipeLines.length} lines)`);
    }

    // 2. ASCII border/grid lines: +---+---+ or +===+===+
    const gridLines = lines.filter((l) => /^\+[-=+]{3,}\+/.test(l));
    if (gridLines.length >= 1) {
        tableScore += gridLines.length * 3;
        matchDetails.push(`ascii_grid (${gridLines.length} lines)`);
    }

    // 3. Tab-separated columnar values
    const tabLines = lines.filter((l) => (l.match(/\t/g) || []).length >= 2);
    if (tabLines.length >= 2) {
        tableScore += tabLines.length * 2;
        matchDetails.push(`tab_columns (${tabLines.length} lines)`);
    }

    // 4. Repeated aligned numeric rows (e.g. "Year 2023   $12.5M   18.4%")
    const numericRowPattern = /(?:[A-Za-z0-9_.-]+\s{2,})+(?:\$?\d+(?:,\d{3})*(?:\.\d+)?%?|\bN\/A\b)/;
    const alignedRows = lines.filter((l) => numericRowPattern.test(l));
    if (alignedRows.length >= 3) {
        tableScore += alignedRows.length;
        matchDetails.push(`aligned_numeric_rows (${alignedRows.length} lines)`);
    }

    return {
        hasTables: tableScore >= CLASSIFICATION_THRESHOLDS.TABLE_INDICATOR_MIN_COUNT,
        tableScore,
        matchDetails,
    };
};

/**
 * Detects chart, plot, and graphical visualization cues in page text or captions.
 *
 * @param {string} text - Raw page text
 * @returns {{ hasCharts: boolean, chartScore: number, matchDetails: string[] }}
 */
export const detectChartSignals = (text = "") => {
    if (!text || typeof text !== "string") {
        return { hasCharts: false, chartScore: 0, matchDetails: [] };
    }

    const lower = text.toLowerCase();
    const matchDetails = [];
    let chartScore = 0;

    // 1. Explicit chart type mentions
    const chartTypes = [
        "bar chart", "line chart", "pie chart", "scatter plot", "area chart",
        "stacked bar", "histogram", "bubble chart", "waterfall chart", "heat map", "heatmap"
    ];
    for (const ct of chartTypes) {
        if (lower.includes(ct)) {
            chartScore += 3;
            matchDetails.push(ct);
        }
    }

    // 2. Axis and visualization terminology
    const axisRegex = /\b(?:x-axis|y-axis|horizontal axis|vertical axis|axis label|data series|legend)\b/gi;
    const axisMatches = lower.match(axisRegex) || [];
    if (axisMatches.length > 0) {
        chartScore += axisMatches.length * 2;
        matchDetails.push(`axis_cues (${axisMatches.length})`);
    }

    // 3. Caption patterns: Figure 1:, Chart 3.2:, Plot A:
    const figurePattern = /\b(?:figure|fig\.|chart|plot)\s*\d+[:.-]/gi;
    const figureMatches = lower.match(figurePattern) || [];
    if (figureMatches.length > 0) {
        chartScore += figureMatches.length * 2;
        matchDetails.push(`figure_captions (${figureMatches.length})`);
    }

    // 4. Growth/trend phrases with parenthetical percentages common in chart legends
    const trendPattern = /\b(?:growth trend|quarterly trend|market share|breakdown)\s*(?:\([%a-z0-9\s-]+\))?/gi;
    const trendMatches = lower.match(trendPattern) || [];
    if (trendMatches.length > 0) {
        chartScore += trendMatches.length;
        matchDetails.push(`trend_phrases (${trendMatches.length})`);
    }

    return {
        hasCharts: chartScore >= CLASSIFICATION_THRESHOLDS.CHART_KEYWORD_MIN_COUNT,
        chartScore,
        matchDetails,
    };
};

/**
 * Classifies an individual PDF page based on extracted text length, structural cues, and visual signals.
 *
 * @param {object} params
 * @param {number} params.pageNumber - 1-based page number
 * @param {string} [params.text=""] - Extracted digital text
 * @param {boolean} [params.hasImageObjects=false] - Whether PDF objects indicate raster images
 * @param {number} [params.imageCount=0] - Number of embedded raster images
 * @param {boolean} [params.isScannedOverride=false] - Explicit external scanned flag
 * @returns {object} Page classification metadata
 */
export const classifyPdfPage = (params = {}) => {
    const pageNumber = typeof params.pageNumber === "number" ? Math.max(1, params.pageNumber) : 1;
    const text = typeof params.text === "string" ? params.text.trim() : "";
    const charCount = text.length;
    const tokenEstimate = Math.max(0, Math.ceil(charCount / 4));
    const imageCount = typeof params.imageCount === "number" ? Math.max(0, params.imageCount) : 0;
    const hasImages = params.hasImageObjects === true || imageCount > 0;
    const extractionWarnings = [];

    // Analyze structural table & chart signals
    const tableSignals = detectTableSignals(text);
    const chartSignals = detectChartSignals(text);

    let pageType = PAGE_TYPES.UNKNOWN;
    let requiresOCR = false;
    let requiresVision = false;

    // Rule 1: EMPTY
    if (charCount <= CLASSIFICATION_THRESHOLDS.EMPTY_CHAR_LIMIT && !hasImages && !params.isScannedOverride) {
        pageType = PAGE_TYPES.EMPTY;
        extractionWarnings.push(`Page ${pageNumber} is blank or contains no extractable content.`);
    }
    // Rule 2: SCANNED (Zero or near-zero text where explicit scanned flag or image scan is detected)
    else if (
        params.isScannedOverride ||
        (charCount === 0 && hasImages)
    ) {
        pageType = PAGE_TYPES.SCANNED;
        requiresOCR = true;
        requiresVision = true;
        extractionWarnings.push(`Page ${pageNumber} has insufficient digital text and appears scanned; OCR required.`);
    }
    // Rule 3: IMAGE_HEAVY (Sparse text accompanied by raster image elements)
    else if (hasImages && charCount < 140) {
        pageType = PAGE_TYPES.IMAGE_HEAVY;
        requiresVision = true;
    }
    // Rule 4: TABLE_HEAVY (Tabular grids / markdown tables without substantial narrative text)
    else if (tableSignals.hasTables && tableSignals.tableScore >= 3) {
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const nonTableLines = lines.filter((l) => !l.includes("|") && !/^\+[-=+]{3,}\+/.test(l));
        const nonTableCharCount = nonTableLines.join(" ").length;

        if (nonTableCharCount >= 140) {
            pageType = PAGE_TYPES.MIXED;
            requiresVision = true;
        } else {
            pageType = PAGE_TYPES.TABLE_HEAVY;
            requiresVision = true;
        }
    }
    // Rule 5: CHART_HEAVY (Chart visualizations / plots / axis cues without substantial narrative text)
    else if (chartSignals.hasCharts && chartSignals.chartScore >= 3) {
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const nonChartLines = lines.filter((l) => !detectChartSignals(l).hasCharts);
        const nonChartCharCount = nonChartLines.join(" ").length;

        if (nonChartCharCount >= 140) {
            pageType = PAGE_TYPES.MIXED;
            requiresVision = true;
        } else {
            pageType = PAGE_TYPES.CHART_HEAVY;
            requiresVision = true;
        }
    }
    // Rule 6: MIXED (Substantial narrative body text AND graphics/images)
    else if (
        charCount >= 180 &&
        (tableSignals.hasTables || chartSignals.hasCharts || hasImages)
    ) {
        pageType = PAGE_TYPES.MIXED;
        requiresVision = true;
    }
    // Rule 7: TEXT_HEAVY (Dominant readable text without dense tables/charts)
    else if (charCount >= CLASSIFICATION_THRESHOLDS.TEXT_HEAVY_MIN_CHARS || charCount > 50) {
        pageType = PAGE_TYPES.TEXT_HEAVY;
        requiresVision = false;
        requiresOCR = false;
    } else {
        pageType = PAGE_TYPES.UNKNOWN;
    }

    return {
        pageNumber,
        pageType,
        extractedTextLength: charCount,
        tokenEstimate,
        hasImages,
        imageCount,
        hasTables: tableSignals.hasTables,
        tableScore: tableSignals.tableScore,
        hasCharts: chartSignals.hasCharts,
        chartScore: chartSignals.chartScore,
        requiresOCR,
        requiresVision,
        processingStatus: requiresVision || requiresOCR ? "PENDING" : "SKIPPED",
        extractionWarnings,
    };
};

/**
 * Classifies all pages of a parsed PDF document and returns document-wide aggregation metrics.
 *
 * @param {Array<object>} pages - Array of extracted page objects from extractPdfMetadata
 * @param {object} [options] - Aggregation options
 * @returns {{
 *   classifiedPages: Array<object>,
 *   summary: object,
 *   scannedPageNumbers: number[],
 *   tablePageNumbers: number[],
 *   chartPageNumbers: number[],
 *   visionCandidatePages: number[]
 * }}
 */
export const classifyDocumentPages = (pages = [], options = {}) => {
    if (!Array.isArray(pages)) {
        return {
            classifiedPages: [],
            summary: {},
            scannedPageNumbers: [],
            tablePageNumbers: [],
            chartPageNumbers: [],
            visionCandidatePages: [],
        };
    }

    const classifiedPages = pages.map((page, idx) => {
        const pageNum = typeof page.pageNumber === "number" ? page.pageNumber : idx + 1;
        return classifyPdfPage({
            pageNumber: pageNum,
            text: page.text || "",
            hasImageObjects: Boolean(page.hasImageObjects || page.hasImages),
            imageCount: page.imageCount || 0,
            isScannedOverride: Boolean(page.isScannedOverride),
        });
    });

    const summary = {
        total: classifiedPages.length,
        TEXT_HEAVY: 0,
        IMAGE_HEAVY: 0,
        SCANNED: 0,
        TABLE_HEAVY: 0,
        CHART_HEAVY: 0,
        MIXED: 0,
        EMPTY: 0,
        UNKNOWN: 0,
        requiresOCRCount: 0,
        requiresVisionCount: 0,
    };

    const scannedPageNumbers = [];
    const tablePageNumbers = [];
    const chartPageNumbers = [];
    const visionCandidatePages = [];

    for (const cp of classifiedPages) {
        if (summary[cp.pageType] !== undefined) {
            summary[cp.pageType]++;
        } else {
            summary.UNKNOWN++;
        }

        if (cp.requiresOCR) {
            summary.requiresOCRCount++;
            scannedPageNumbers.push(cp.pageNumber);
        }

        if (cp.hasTables) {
            tablePageNumbers.push(cp.pageNumber);
        }

        if (cp.hasCharts) {
            chartPageNumbers.push(cp.pageNumber);
        }

        if (cp.requiresVision) {
            summary.requiresVisionCount++;
            visionCandidatePages.push(cp.pageNumber);
        }
    }

    return {
        classifiedPages,
        summary,
        scannedPageNumbers,
        tablePageNumbers,
        chartPageNumbers,
        visionCandidatePages,
    };
};
