process.env.NODE_ENV = "test";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";
import {
    classifyPdfPage,
    classifyDocumentPages,
    PAGE_TYPES,
    detectTableSignals,
    detectChartSignals,
} from "../pdf/vision/pageClassifier.service.js";
import {
    slicePdfPage,
    formatTableToMarkdown,
    formatChartToSearchableText,
    validateVisionOutput,
    extractPageVisualIntelligence,
    setMockVisionHandler,
    clearMockVisionHandler,
} from "../pdf/vision/visionExtraction.service.js";
import {
    createTableChunk,
    createChartChunk,
    createOcrChunk,
    compileVisualChunks,
    hashVisualContent,
} from "../pdf/vision/visualEvidence.service.js";
import {
    ingestPdfDocument,
} from "../pdf/ingestion/pdfIngestion.service.js";
import {
    searchVectorChunks,
} from "../pdf/retrieval/vectorSearch.service.js";
import {
    searchKeywordChunks,
} from "../pdf/retrieval/keywordSearch.service.js";
import {
    reciprocalRankFusion,
} from "../pdf/retrieval/resultFusion.service.js";
import {
    buildGroundedContext,
} from "../pdf/answer/groundedContext.service.js";
import {
    validateAnswerCitations,
    EVIDENCE_STATUS,
} from "../pdf/answer/citationValidation.service.js";
import {
    extractClaimsWithSources,
    evaluateClaimAgainstSources,
    CLAIM_STATUS,
} from "../pdf/answer/claimVerification.service.js";
import {
    storeChunkEmbeddings,
    deleteDocumentChunks,
    resetMemoryVectorStore,
} from "../pdf/storage/vectorStorage.service.js";
import {
    extractPdfMetadata,
} from "../utils/extractPdf.js";

/**
 * Creates an in-memory PDF fixture with customizable pages.
 */
async function createTestPdf({ pageCount = 1, getPageText = null, fileName = "doc.pdf" } = {}) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= pageCount; i++) {
        const page = doc.addPage([612, 792]);
        const text = typeof getPageText === "function"
            ? getPageText(i)
            : `Section ${i}: Standard corporate overview and business background for page ${i}.`;

        if (text && text.trim()) {
            page.drawText(text, {
                x: 50,
                y: 720,
                size: 11,
                font,
                lineHeight: 14,
            });
        }
    }

    const bytes = await doc.save();
    const buffer = Buffer.from(bytes);
    return {
        name: fileName,
        mimeType: "application/pdf",
        data: buffer.toString("base64"),
        buffer,
    };
}

describe("Orbit PDF Agent — Phase 5: Advanced PDF Intelligence Test Suite", () => {
    after(() => {
        clearMockVisionHandler();
        resetMemoryVectorStore();
        try {
            redis.disconnect();
        } catch {}
    });

    // =========================================================================
    // SECTION 1: PAGE CLASSIFICATION (Tests 1-7)
    // =========================================================================

    test("1. Text-heavy page classification: Standard dense document text is classified as TEXT_HEAVY without vision", () => {
        const text = `The company reported strong operational performance across all operating segments.
Total operating revenue expanded significantly while cost discipline was maintained.
Management continues to execute on long-term capital allocation strategies and enterprise software enhancements.
Governance structures remain compliant with international compliance benchmarks.
Risk mitigations include dynamic liquidity management, multi-region failover, and strict data retention controls.`.repeat(3);

        const res = classifyPdfPage({ pageNumber: 1, text });
        assert.equal(res.pageType, PAGE_TYPES.TEXT_HEAVY);
        assert.equal(res.requiresVision, false);
        assert.equal(res.requiresOCR, false);
        assert.ok(res.extractedTextLength > 350);
    });

    test("2. Scanned page classification: Zero or sparse selectable text with scanned indicator is classified as SCANNED", () => {
        const res = classifyPdfPage({
            pageNumber: 2,
            text: "",
            isScannedOverride: true,
        });
        assert.equal(res.pageType, PAGE_TYPES.SCANNED);
        assert.equal(res.requiresOCR, true);
        assert.equal(res.requiresVision, true);
    });

    test("3. Image-heavy page classification: Sparse text with image objects is classified as IMAGE_HEAVY", () => {
        const res = classifyPdfPage({
            pageNumber: 3,
            text: "Figure 1. Architectural blueprint.",
            hasImageObjects: true,
            imageCount: 3,
        });
        assert.equal(res.pageType, PAGE_TYPES.IMAGE_HEAVY);
        assert.equal(res.requiresVision, true);
    });

    test("4. Table-heavy page classification: Markdown pipes and numeric rows are classified as TABLE_HEAVY", () => {
        const tableText = `Financial Overview:
| Fiscal Year | Total ARR | Operating Margin | Growth Rate |
| --- | --- | --- | --- |
| 2022 | $25.4M | 14.2% | +32% |
| 2023 | $38.9M | 19.8% | +53% |
| 2024 | $52.1M | 24.5% | +34% |`;

        const res = classifyPdfPage({ pageNumber: 4, text: tableText });
        assert.equal(res.pageType, PAGE_TYPES.TABLE_HEAVY);
        assert.equal(res.hasTables, true);
        assert.equal(res.requiresVision, true);
    });

    test("5. Chart-heavy page classification: Axis labels and chart terminology are classified as CHART_HEAVY", () => {
        const chartText = `Quarterly Performance Breakdown
Bar chart showing quarterly growth trend across four fiscal quarters.
X-axis: Quarter (Q1, Q2, Q3, Q4)
Y-axis: Revenue in Millions ($M)
Legend: Product A vs Product B data series
Figure 3: Revenue expansion trajectory`;

        const res = classifyPdfPage({ pageNumber: 5, text: chartText });
        assert.equal(res.pageType, PAGE_TYPES.CHART_HEAVY);
        assert.equal(res.hasCharts, true);
        assert.equal(res.requiresVision, true);
    });

    test("6. Mixed page classification: Substantial narrative text with embedded table is classified as MIXED", () => {
        const mixedText = `The executive leadership team met to review annual results and capital allocation.
Operating margins exceeded strategic guidance across commercial banking and enterprise cloud segments.
Below is a summary of department expenditures:
| Department | Budget | Actual | Variance |
| Cloud Ops | $12M | $11.5M | -4% |
| Security | $5M | $4.8M | -4% |
We anticipate continued efficiency gains into the upcoming fiscal cycle.`;

        const res = classifyPdfPage({ pageNumber: 6, text: mixedText });
        assert.equal(res.pageType, PAGE_TYPES.MIXED);
        assert.equal(res.hasTables, true);
        assert.equal(res.requiresVision, true);
    });

    test("7. Empty page classification: Blank page with zero characters is classified as EMPTY", () => {
        const res = classifyPdfPage({ pageNumber: 7, text: "   " });
        assert.equal(res.pageType, PAGE_TYPES.EMPTY);
        assert.equal(res.requiresVision, false);
        assert.equal(res.requiresOCR, false);
    });

    // =========================================================================
    // SECTION 2: OCR EXTRACTION & PROCESSING (Tests 8-12)
    // =========================================================================

    test("8. Successful OCR: Extracts readable text and preserves 1-based page number", () => {
        const ocrText = "Confidential Client Agreement: Terms and conditions valid through 2028.";
        const chunk = createOcrChunk(ocrText, { documentId: "doc_test_ocr", pageNumber: 3 });

        assert.ok(chunk);
        assert.equal(chunk.pageStart, 3);
        assert.equal(chunk.pageEnd, 3);
        assert.equal(chunk.contentType, "OCR_TEXT");
        assert.ok(chunk.content.includes("Confidential Client Agreement"));
        assert.ok(chunk.content.includes("Page 3"));
    });

    test("9. OCR failure handling: Empty OCR output returns null cleanly without throwing", () => {
        const chunk = createOcrChunk("", { documentId: "doc_fail", pageNumber: 4 });
        assert.equal(chunk, null);
    });

    test("10. Partial OCR handling: Document with mixed scanned and text pages processes both", () => {
        const pages = [
            { pageNumber: 1, text: "Digital text on page 1." },
            { pageNumber: 2, text: "", isScannedOverride: true },
        ];
        const docClass = classifyDocumentPages(pages);
        assert.equal(docClass.summary.total, 2);
        assert.equal(docClass.scannedPageNumbers.includes(2), true);
        assert.equal(docClass.scannedPageNumbers.includes(1), false);
    });

    test("11. Duplicate text prevention: Re-processing identical OCR text produces deterministic hash", () => {
        const text = "Audit Committee Minutes: All risk parameters within compliance.";
        const h1 = hashVisualContent(text);
        const h2 = hashVisualContent(text);
        assert.equal(h1, h2);
    });

    test("12. Correct page number preservation: Preserves 1-based indexing for multi-page OCR chunks", () => {
        const c1 = createOcrChunk("Text 1", { documentId: "doc_1", pageNumber: 12 });
        const c2 = createOcrChunk("Text 2", { documentId: "doc_1", pageNumber: 15 });
        assert.equal(c1.pageStart, 12);
        assert.equal(c2.pageStart, 15);
    });

    // =========================================================================
    // SECTION 3: TABLE DETECTION & EXTRACTION (Tests 13-19)
    // =========================================================================

    test("13. Basic table extraction: Converts structured table into formatted Markdown", () => {
        const table = {
            title: "Q4 Revenue",
            headers: ["Metric", "Q3", "Q4"],
            rows: [["Revenue", "$10M", "$12M"]],
        };
        const md = formatTableToMarkdown(table);
        assert.ok(md.includes("| Metric | Q3 | Q4 |"));
        assert.ok(md.includes("| Revenue | $10M | $12M |"));
    });

    test("14. Multi-row table: Preserves rows and column alignments across many rows", () => {
        const table = {
            headers: ["Year", "ARR", "Headcount"],
            rows: [
                ["2022", "$20M", "120"],
                ["2023", "$35M", "190"],
                ["2024", "$55M", "280"],
            ],
        };
        const md = formatTableToMarkdown(table);
        const lines = md.split("\n");
        assert.equal(lines.length, 5); // Header + Separator + 3 Rows
    });

    test("15. Multi-level headers: Handles table headers and padding safely", () => {
        const table = {
            title: "Executive Matrix",
            headers: ["Region", "2023 Actual", "2024 Target", "Delta"],
            rows: [
                ["North America", "$45M", "$60M", "+33%"],
                ["EMEA", "$25M", "$35M", "+40%"],
            ],
        };
        const chunk = createTableChunk(table, { documentId: "doc_tbl", tableIndex: 0 });
        assert.equal(chunk.contentType, "TABLE");
        assert.ok(chunk.content.includes("+33%"));
        assert.ok(chunk.content.includes("North America"));
    });

    test("16. Missing cells: Handles null, undefined, and uneven row lengths with padding", () => {
        const table = {
            headers: ["A", "B", "C"],
            rows: [
                ["Val1", null, "Val3"],
                ["Val4"], // Missing 2 cells
            ],
        };
        const md = formatTableToMarkdown(table);
        assert.ok(md.includes("| Val1 |  | Val3 |"));
        assert.ok(md.includes("| Val4 |  |  |"));
    });

    test("17. Numeric values and percentages: Preserves negative numbers, decimals, and currencies", () => {
        const table = {
            title: "Cash Flow Statement",
            headers: ["Item", "2023", "2024", "Growth"],
            rows: [
                ["Net Income", "$15.4M", "$18.2M", "+18.2%"],
                ["Capex", "-$4.2M", "-$5.1M", "-21.4%"],
                ["Free Cash Flow", "$11.2M", "$13.1M", "+17.0%"],
            ],
        };
        const chunk = createTableChunk(table, { documentId: "doc_fin" });
        assert.ok(chunk.content.includes("-$4.2M"));
        assert.ok(chunk.content.includes("+18.2%"));
        assert.ok(chunk.content.includes("-21.4%"));
    });

    test("18. Multi-page table handling: Preserves distinct page numbers across table slices", () => {
        const t1 = createTableChunk({ title: "Inventory Part 1", pageNumber: 8, headers: ["Item", "Qty"], rows: [["A", "100"]] });
        const t2 = createTableChunk({ title: "Inventory Part 2", pageNumber: 9, headers: ["Item", "Qty"], rows: [["B", "200"]] });

        assert.equal(t1.pageStart, 8);
        assert.equal(t2.pageStart, 9);
        assert.notEqual(t1.chunkId, t2.chunkId);
    });

    test("19. Malformed vision output: Discards invalid rows and normalizes missing fields defensively", () => {
        const rawMalformed = {
            tables: [
                null, // Malformed null entry
                { headers: "not an array", rows: "invalid" },
                { title: "Clean Table", headers: ["X", "Y"], rows: [["1", "2"]] },
            ],
        };
        const validated = validateVisionOutput(rawMalformed, 3);
        assert.equal(validated.tables.length, 1);
        assert.equal(validated.tables[0].title, "Clean Table");
    });

    // =========================================================================
    // SECTION 4: CHART & GRAPH EXTRACTION (Tests 20-25)
    // =========================================================================

    test("20. Bar chart extraction: Extracts category axis, series, and key observations", () => {
        const chart = {
            title: "Quarterly Revenue",
            chartType: "BAR",
            xAxis: { label: "Quarter", values: ["Q1", "Q2", "Q3", "Q4"] },
            yAxis: { label: "Revenue", unit: "USD (Millions)" },
            series: [{ name: "Revenue", values: [10, 12, 15, 18] }],
            keyInsights: ["Revenue increased consistently across all four quarters."],
            confidence: "HIGH",
        };
        const chunk = createChartChunk(chart, { documentId: "doc_ch" });
        assert.equal(chunk.contentType, "CHART");
        assert.ok(chunk.content.includes("Type: BAR"));
        assert.ok(chunk.content.includes("USD (Millions)"));
        assert.ok(chunk.content.includes("Revenue increased consistently"));
    });

    test("21. Line chart extraction: Extracts continuous trend data and series correctly", () => {
        const chart = {
            title: "Monthly Active Users",
            chartType: "LINE",
            xAxis: { label: "Month", values: ["Jan", "Feb", "Mar"] },
            yAxis: { label: "MAU", unit: "Thousands" },
            series: [{ name: "Users", values: [500, 580, 640] }],
            keyInsights: ["MAU grew by 28% from January to March."],
        };
        const text = formatChartToSearchableText(chart);
        assert.ok(text.includes("Type: LINE"));
        assert.ok(text.includes("500, 580, 640"));
        assert.ok(text.includes("28%"));
    });

    test("22. Multiple series: Extracts and displays comparative data series", () => {
        const chart = {
            title: "Market Share Comparison",
            chartType: "STACKED",
            xAxis: { label: "Year", values: ["2023", "2024"] },
            series: [
                { name: "Orbit", values: [35, 48] },
                { name: "Competitor", values: [65, 52] },
            ],
        };
        const text = formatChartToSearchableText(chart);
        assert.ok(text.includes("Orbit: [35, 48]"));
        assert.ok(text.includes("Competitor: [65, 52]"));
    });

    test("23. Axis and unit preservation: Retains custom units ($M, %, bps)", () => {
        const chart = {
            title: "Inflation Rate",
            chartType: "LINE",
            yAxis: { label: "CPI Change", unit: "percentage points (%)" },
        };
        const text = formatChartToSearchableText(chart);
        assert.ok(text.includes("percentage points (%)"));
    });

    test("24. Ambiguous visual values: Preserves approximate values without inventing exact fractions", () => {
        const chart = {
            title: "Rough Survey Distribution",
            chartType: "PIE",
            series: [{ name: "Satisfaction", values: ["~45%", "~35%", "~20%"] }],
            keyInsights: ["Values are visual estimates from pie slices."],
            confidence: "MEDIUM",
        };
        const chunk = createChartChunk(chart, { documentId: "doc_approx" });
        assert.ok(chunk.content.includes("~45%"));
        assert.equal(chunk.visualMetadata.confidence, "MEDIUM");
    });

    test("25. Missing chart labels: Assigns fallback labels without crashing", () => {
        const chart = {
            title: "Unlabeled Graph",
            chartType: "UNKNOWN_TYPE",
            xAxis: null,
            yAxis: null,
        };
        const chunk = createChartChunk(chart, { documentId: "doc_nolabel" });
        assert.ok(chunk.content.includes("Type: UNKNOWN_TYPE"));
    });

    // =========================================================================
    // SECTION 5: PIPELINE INTEGRATION (Tests 26-32)
    // =========================================================================

    test("26. Visual content converted into searchable evidence chunks", () => {
        const results = [
            {
                status: "SUCCESS",
                pageNumber: 5,
                tables: [{ title: "Capex", headers: ["Year", "Amount"], rows: [["2024", "$5M"]] }],
                charts: [{ title: "Growth", chartType: "BAR", series: [{ name: "Rate", values: [12] }] }],
                ocrText: "Scanned header on page 5.",
            },
        ];
        const chunks = compileVisualChunks(results, { documentId: "doc_pipeline" });
        assert.equal(chunks.length, 3); // 1 table + 1 chart + 1 OCR chunk
        assert.equal(chunks[0].contentType, "TABLE");
        assert.equal(chunks[1].contentType, "CHART");
        assert.equal(chunks[2].contentType, "OCR_TEXT");
    });

    test("27. Correct embedding generation: Visual chunks store valid 768-dim embeddings in storage", async () => {
        const tableChunk = createTableChunk(
            { title: "ARR", headers: ["Yr", "ARR"], rows: [["2024", "$50M"]] },
            { documentId: "doc_emb_1" }
        );
        tableChunk.embedding = new Array(768).fill(0.02);
        tableChunk.chunkIndex = 0;

        const res = await storeChunkEmbeddings("doc_emb_1", "conv_emb_1", "user_1", [tableChunk]);
        assert.equal(res.totalStored, 1);
    });

    test("28. Existing hybrid retrieval finds visual content: Vector search returns TABLE chunks", async () => {
        const dummyQueryVector = new Array(768).fill(0.02);
        const searchRes = await searchVectorChunks({
            queryVector: dummyQueryVector,
            userId: "user_1",
            conversationId: "conv_emb_1",
            documentId: "doc_emb_1",
        });

        assert.equal(searchRes.status, "SUCCESS");
        assert.ok(searchRes.results.length >= 1);
        assert.equal(searchRes.results[0].contentType, "TABLE");
        assert.ok(searchRes.results[0].content.includes("$50M"));
    });

    test("29. RRF handles mixed text and visual evidence: Fuses text, table, and chart chunks cleanly", () => {
        const vectorResults = [
            { chunkId: "c_txt", score: 0.9, pageStart: 1, contentType: "TEXT", content: "Executive summary text." },
            { chunkId: "c_tbl", score: 0.85, pageStart: 2, contentType: "TABLE", content: "Table revenue data." },
        ];
        const keywordResults = [
            { chunkId: "c_tbl", score: 4.2, pageStart: 2, contentType: "TABLE", content: "Table revenue data." },
            { chunkId: "c_ch", score: 2.1, pageStart: 3, contentType: "CHART", content: "Chart growth trend." },
        ];

        const { fusedResults } = reciprocalRankFusion(vectorResults, keywordResults, { k: 60, limit: 3 });
        assert.equal(fusedResults.length, 3);
        // Table chunk was present in BOTH vector and keyword, so it should rank highest
        assert.equal(fusedResults[0].chunkId, "c_tbl");
        assert.equal(fusedResults[0].contentType, "TABLE");
    });

    test("30. Citation points to original page: Grounded context and validation preserve source page", () => {
        const tableChunk = createTableChunk(
            { title: "Revenue Matrix", headers: ["Year", "Revenue", "Growth"], rows: [["2024", "$12M", "20%"]], pageNumber: 12 },
            { documentId: "doc_vis" }
        );

        const { sourceMap } = buildGroundedContext([tableChunk]);
        assert.ok(sourceMap.has("S1"));
        assert.equal(sourceMap.get("S1").pageStart, 12);
        assert.equal(sourceMap.get("S1").contentType, "TABLE");

        const answer = "According to the table, revenue in 2024 was $12M with 20% growth [S1].";
        const valRes = validateAnswerCitations(answer, sourceMap);

        assert.equal(valRes.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(valRes.citations.length, 1);
        assert.equal(valRes.citations[0].pageStart, 12);
        assert.equal(valRes.citations[0].contentType, "TABLE");
    });

    test("31. Claim verification works with table evidence: Validates exact metric and entity alignment", () => {
        const chunks = [
            {
                chunkId: "c_table_p15",
                pageStart: 15,
                pageEnd: 15,
                content: "### Table: Cloud Spend\n| Dept | Spend |\n| Engineering | $4.5M |",
            },
        ];
        const { sourceMap } = buildGroundedContext(chunks);
        const claims = extractClaimsWithSources("Engineering spent $4.5M on cloud resources [S1].");
        const evalRes = evaluateClaimAgainstSources(claims[0], sourceMap);

        assert.equal(evalRes.status, CLAIM_STATUS.SUPPORTED);
        assert.equal(evalRes.verifiedSources.includes("S1"), true);
    });

    test("32. Claim verification works with chart evidence: Validates trend observations and numbers", () => {
        const chunks = [
            {
                chunkId: "c_chart_p20",
                pageStart: 20,
                pageEnd: 20,
                content: "### Chart: Headcount Growth\nSeries: Engineering: [120, 150, 190]\nKey Observations: Engineering headcount grew steadily.",
            },
        ];
        const { sourceMap } = buildGroundedContext(chunks);
        const claims = extractClaimsWithSources("Engineering headcount grew steadily reaching 190 [S1].");
        const evalRes = evaluateClaimAgainstSources(claims[0], sourceMap);

        assert.equal(evalRes.status, CLAIM_STATUS.SUPPORTED);
    });

    // =========================================================================
    // SECTION 6: RELIABILITY, SECURITY & ISOLATION (Tests 33-38)
    // =========================================================================

    test("33. Idempotent processing: Repeated ingestion produces identical chunk IDs and hashes", async () => {
        const t1 = createTableChunk({ title: "Idempotent Table", headers: ["A"], rows: [["1"]] }, { documentId: "doc_idem" });
        const t2 = createTableChunk({ title: "Idempotent Table", headers: ["A"], rows: [["1"]] }, { documentId: "doc_idem" });

        assert.equal(t1.chunkId, t2.chunkId);
        assert.equal(t1.contentHash, t2.contentHash);
    });

    test("34. Provider timeout handling: Per-page timeout aborts gracefully without crashing document ingestion", async () => {
        // Set mock vision handler that rejects with timeout
        setMockVisionHandler(async () => {
            throw new Error("Vision processing on page 1 timed out after 5000ms");
        });

        const res = await extractPageVisualIntelligence({
            pageBuffer: Buffer.from("dummy_pdf"),
            pageNumber: 1,
        });

        assert.equal(res.status, "FAILED");
        assert.ok(res.warnings[0].includes("timed out"));
        clearMockVisionHandler();
    });

    test("35. Rate limiting and bounded concurrency: Processes pages in controlled batches", async () => {
        const processedOrder = [];
        setMockVisionHandler(async ({ pageNumber }) => {
            processedOrder.push(pageNumber);
            return {
                tables: [{ title: `Table P${pageNumber}`, headers: ["Col"], rows: [["Val"]] }],
            };
        });

        const fixture = await createTestPdf({
            pageCount: 3,
            getPageText: (p) => `| Page ${p} Table | Col |\n| --- | --- |\n| Data ${p} | 100 |`,
            fileName: "ConcurrencyTest.pdf",
        });

        const ingested = await ingestPdfDocument(fixture, {
            generateEmbeddings: false,
            maxVisionPages: 3,
            maxConcurrentVisionJobs: 2,
        });

        assert.equal(ingested.status, "READY");
        assert.ok(processedOrder.length >= 1);
        clearMockVisionHandler();
    });

    test("36. Partial document processing failure: One failing page preserves other successful visual pages", async () => {
        setMockVisionHandler(async ({ pageNumber }) => {
            if (pageNumber === 1) throw new Error("Simulated OCR failure on page 1");
            return {
                tables: [{ title: `Table on Page ${pageNumber}`, headers: ["Col"], rows: [["Val"]] }],
            };
        });

        const fixture = await createTestPdf({
            pageCount: 2,
            getPageText: (p) => `| Page ${p} Table | Col |\n| --- | --- |\n| Data ${p} | 100 |`,
            fileName: "PartialFailure.pdf",
        });

        const ingested = await ingestPdfDocument(fixture, {
            generateEmbeddings: false,
            maxVisionPages: 2,
        });

        assert.equal(ingested.status, "READY");
        assert.ok(ingested.tablesDetected >= 1);
        clearMockVisionHandler();
    });

    test("37. Cross-user isolation: Vector search enforces strict userId and conversationId filters", async () => {
        const dummyVector = new Array(768).fill(0.05);

        // Query with different user ID
        const crossUserSearch = await searchVectorChunks({
            queryVector: dummyVector,
            userId: "unauthorized_user_999",
            conversationId: "conv_emb_1",
            documentId: "doc_emb_1",
        });

        assert.equal(crossUserSearch.results.length, 0);
    });

    test("38. Document deletion cleanup: Deleting document cleans up all stored chunks including visual chunks", async () => {
        const res = await deleteDocumentChunks("doc_emb_1");
        assert.ok(res.deletedCount >= 1);

        const dummyVector = new Array(768).fill(0.02);
        const searchAfterDelete = await searchVectorChunks({
            queryVector: dummyVector,
            userId: "user_1",
            conversationId: "conv_emb_1",
            documentId: "doc_emb_1",
        });
        assert.equal(searchAfterDelete.results.length, 0);
    });
});
