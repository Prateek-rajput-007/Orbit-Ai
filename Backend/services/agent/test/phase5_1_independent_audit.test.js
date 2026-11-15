process.env.NODE_ENV = "test";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";
import {
    classifyPdfPage,
    classifyDocumentPages,
    PAGE_TYPES,
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
    storeChunkEmbeddings,
    deleteDocumentChunks,
    deleteConversationChunks,
    resetMemoryVectorStore,
} from "../pdf/storage/vectorStorage.service.js";
import {
    extractPdfMetadata,
} from "../utils/extractPdf.js";
import Message from "../../chat/models/message-model.js";

async function createAuditTestPdf({ pages = [] } = {}) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    for (let i = 0; i < pages.length; i++) {
        const spec = pages[i];
        const page = doc.addPage([612, 792]);

        if (spec.image) {
            const img = await doc.embedPng(Buffer.from(png1x1, "base64"));
            page.drawImage(img, { x: 50, y: 500, width: 100, height: 100 });
        }

        if (spec.text && spec.text.trim()) {
            page.drawText(spec.text, {
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
        name: "audit_fixture.pdf",
        mimeType: "application/pdf",
        data: buffer.toString("base64"),
        buffer,
    };
}

describe("Orbit PDF Agent — Phase 5.1: Independent Implementation Audit Suite", () => {
    before(() => {
        resetMemoryVectorStore();
    });

    after(async () => {
        clearMockVisionHandler();
        resetMemoryVectorStore();
        try {
            redis.disconnect();
        } catch {}
    });

    // 1. Audit Page Classification Logic
    test("1. Distinction between EMPTY and SCANNED pages: Blank page without images is classified as EMPTY", () => {
        const emptyRes = classifyPdfPage({
            pageNumber: 1,
            text: "",
            hasImageObjects: false,
            imageCount: 0,
            isScannedOverride: false,
        });
        assert.equal(emptyRes.pageType, PAGE_TYPES.EMPTY);
        assert.equal(emptyRes.requiresOCR, false);
        assert.equal(emptyRes.requiresVision, false);
    });

    test("2. Distinction between EMPTY and SCANNED pages: Zero text with embedded image is classified as SCANNED", () => {
        const scannedRes = classifyPdfPage({
            pageNumber: 2,
            text: "",
            hasImageObjects: true,
            imageCount: 1,
            isScannedOverride: true,
        });
        assert.equal(scannedRes.pageType, PAGE_TYPES.SCANNED);
        assert.equal(scannedRes.requiresOCR, true);
        assert.equal(scannedRes.requiresVision, true);
    });

    test("3. Sparse text with image objects is classified as IMAGE_HEAVY", () => {
        const imgRes = classifyPdfPage({
            pageNumber: 3,
            text: "Figure 1: Diagram showing server architecture.",
            hasImageObjects: true,
            imageCount: 1,
        });
        assert.equal(imgRes.pageType, PAGE_TYPES.IMAGE_HEAVY);
        assert.equal(imgRes.requiresVision, true);
    });

    test("4. Dense markdown table with little prose is classified as TABLE_HEAVY", () => {
        const tableText = `| Metric | Q1 | Q2 |
| --- | --- | --- |
| Revenue | $10M | $12M |
| Margin | 40% | 42% |`;
        const tblRes = classifyPdfPage({
            pageNumber: 4,
            text: tableText,
        });
        assert.equal(tblRes.pageType, PAGE_TYPES.TABLE_HEAVY);
        assert.equal(tblRes.requiresVision, true);
    });

    test("5. Chart signals with axis cues and little prose are classified as CHART_HEAVY", () => {
        const chartText = `Figure 2: Global market breakdown
X-Axis: Operating Regions (US, EU, APAC)
Y-Axis: Revenue in USD Millions [Unit: M$]
Data series: AWS, Azure, Google Cloud`;
        const chartRes = classifyPdfPage({
            pageNumber: 5,
            text: chartText,
        });
        assert.equal(chartRes.pageType, PAGE_TYPES.CHART_HEAVY);
        assert.equal(chartRes.requiresVision, true);
    });

    test("6. Substantial narrative text (>=180 chars) with table is classified as MIXED", () => {
        const mixedText = `The executive committee met on Thursday to review quarterly financial metrics and strategic business initiatives across enterprise business units. Overall operating performance remained solid across core segments.
| Unit | ARR | Growth |
| Cloud | $120M | +24% |
| Retail | $80M | +12% |`;
        const mixedRes = classifyPdfPage({
            pageNumber: 6,
            text: mixedText,
        });
        assert.equal(mixedRes.pageType, PAGE_TYPES.MIXED);
        assert.equal(mixedRes.requiresVision, true);
    });

    test("7. Dense text page without tables or images is classified as TEXT_HEAVY", () => {
        const textHeavy = "Orbit is an agentic AI operating environment providing multi-agent coordination, document intelligence, interactive artifacts, and resilient background workflow automation. ".repeat(4);
        const txtRes = classifyPdfPage({
            pageNumber: 7,
            text: textHeavy,
        });
        assert.equal(txtRes.pageType, PAGE_TYPES.TEXT_HEAVY);
        assert.equal(txtRes.requiresVision, false);
    });

    test("8. Real PDF structure extraction correctly identifies embedded images vs blank pages", async () => {
        const fixture = await createAuditTestPdf({
            pages: [
                { text: "" }, // Page 1: Empty (no text, no image)
                { text: "", image: true }, // Page 2: Scanned (no text, has image)
                { text: "Short text caption under a diagram.", image: true }, // Page 3: Image-heavy
                { text: "Long narrative text ".repeat(30) }, // Page 4: Text-heavy
            ],
        });

        const extracted = await extractPdfMetadata(fixture);
        assert.equal(extracted.pages.length, 4);
        assert.equal(extracted.pages[0].pageType, PAGE_TYPES.EMPTY);
        assert.equal(extracted.pages[1].pageType, PAGE_TYPES.SCANNED);
        assert.equal(extracted.pages[2].pageType, PAGE_TYPES.IMAGE_HEAVY);
        assert.equal(extracted.pages[3].pageType, PAGE_TYPES.TEXT_HEAVY);
    });

    // 2. OCR and Text Deduplication Verification
    test("9. Scanned page OCR creates dedicated OCR_TEXT chunk without duplicate generic TEXT chunk", async () => {
        const fixture = await createAuditTestPdf({
            pages: [{ text: "", image: true }],
        });

        setMockVisionHandler(async ({ pageNumber }) => ({
            contentType: "OCR_TEXT",
            ocrText: "Recovered OCR invoice total: $14,250.00 due March 2025.",
            tables: [],
            charts: [],
            confidence: "HIGH",
        }));

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_audit_ocr",
            userId: "user_audit_1",
            generateEmbeddings: false,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.ocrPagesProcessed, 1);
        assert.equal(ingestRes.visualExtractionStatus, "READY");

        // Verify chunks contain exactly 1 OCR_TEXT chunk and no duplicate TEXT chunk for page 1
        const ocrChunks = ingestRes.chunks.filter((c) => c.contentType === "OCR_TEXT");
        const textChunks = ingestRes.chunks.filter((c) => c.contentType === "TEXT");
        assert.equal(ocrChunks.length, 1);
        assert.equal(textChunks.length, 0); // No duplicate generic TEXT chunk
        assert.ok(ocrChunks[0].content.includes("$14,250.00"));
    });

    test("10. Scanned document with OCR text proceeds to embedding generation instead of being skipped", async () => {
        const fixture = await createAuditTestPdf({
            pages: [{ text: "", image: true }],
        });

        setMockVisionHandler(async () => ({
            contentType: "OCR_TEXT",
            ocrText: "Quarterly Audit Report 2025: Net operating income reached $4.8M.",
            tables: [],
            charts: [],
            confidence: "HIGH",
        }));

        // Mock embedding client
        const mockEmbeddingClient = {
            embedQuery: async () => new Array(768).fill(0.015),
            embedDocuments: async (docs) => docs.map(() => new Array(768).fill(0.015)),
        };

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_audit_emb",
            userId: "user_audit_1",
            generateEmbeddings: true,
            embeddingClient: mockEmbeddingClient,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.isScanned, false); // Updated after successful OCR
        assert.equal(ingestRes.embeddingStatus, "EMBEDDED");
        assert.ok(ingestRes.embeddedChunks >= 1);
    });

    // 3. Table & Chart Quality Verification
    test("11. Table normalization preserves negative numbers, currencies, percentages, and decimals", () => {
        const table = {
            title: "Financial Performance",
            headers: ["Quarter", "Revenue", "Margin", "Variance"],
            rows: [
                ["Q1", "$1,240.50", "42.5%", "+14.2%"],
                ["Q2", "-$15.40", "-2.1%", "-18.5%"],
                ["Q3", "(25.00)", "0.0%", "N/A"],
            ],
            confidence: "HIGH",
        };

        const chunk = createTableChunk(table, { documentId: "doc_tbl_audit", tableIndex: 0 });
        assert.equal(chunk.contentType, "TABLE");
        assert.ok(chunk.content.includes("-$15.40"));
        assert.ok(chunk.content.includes("42.5%"));
        assert.ok(chunk.content.includes("(25.00)"));
        assert.equal(chunk.visualMetadata.headers.length, 4);
    });

    test("12. Chart normalization captures structure, series, units, and objective observations", () => {
        const chart = {
            title: "Market Share Trend",
            chartType: "LINE",
            xAxis: { label: "Year", values: ["2023", "2024", "2025"] },
            yAxis: { label: "Market Share", unit: "%" },
            series: [
                { name: "Platform A", values: [25, 32, 40] },
                { name: "Platform B", values: [45, 38, 30] },
            ],
            keyInsights: ["Platform A grew from 25% to 40% over two years."],
            confidence: "HIGH",
        };

        const chunk = createChartChunk(chart, { documentId: "doc_chart_audit", chartIndex: 0 });
        assert.equal(chunk.contentType, "CHART");
        assert.ok(chunk.content.includes("Unit: %"));
        assert.ok(chunk.content.includes("Platform A: [25, 32, 40]"));
        assert.ok(chunk.content.includes("Platform A grew from 25% to 40%"));
    });

    // 4. Hybrid Retrieval & Grounded Context Integration
    test("13. Visual chunks can be indexed, retrieved via vector search, and cited with original page", async () => {
        const tableChunk = createTableChunk(
            {
                title: "Executive Compensation",
                headers: ["Executive", "Base", "Bonus"],
                rows: [["CEO", "$1,000,000", "$2,500,000"]],
                confidence: "HIGH",
            },
            { documentId: "doc_comp_1" }
        );
        tableChunk.embedding = new Array(768).fill(0.03);
        tableChunk.chunkIndex = 0;

        await storeChunkEmbeddings("doc_comp_1", "conv_comp_1", "user_comp_1", [tableChunk]);

        const searchRes = await searchVectorChunks({
            queryVector: new Array(768).fill(0.03),
            userId: "user_comp_1",
            conversationId: "conv_comp_1",
            documentId: "doc_comp_1",
        });

        assert.equal(searchRes.status, "SUCCESS");
        assert.ok(searchRes.results.length >= 1);
        assert.equal(searchRes.results[0].contentType, "TABLE");

        // Build grounded context
        const context = buildGroundedContext(searchRes.results, {
            defaultDocumentName: "compensation.pdf",
            defaultDocumentId: "doc_comp_1",
        });

        assert.ok(context.contextText.includes('type="TABLE"'));
        assert.ok(context.sourceMap.has("S1"));
        assert.equal(context.sourceMap.get("S1").contentType, "TABLE");

        // Validate citations
        const valRes = validateAnswerCitations({
            rawText: "The CEO received a base salary of $1,000,000 and a bonus of $2,500,000 [S1].",
            sourceMap: context.sourceMap,
            query: "What was the CEO's compensation?",
        });

        assert.equal(valRes.citations.length, 1);
        assert.equal(valRes.citations[0].contentType, "TABLE");
        assert.equal(valRes.citations[0].citationNumber, 1);
        assert.equal(valRes.citations[0].pageStart, 1);
    });

    // 5. Tenant Isolation and Cleanup Verification
    test("14. Cross-user multi-tenant isolation: User A cannot retrieve User B's visual chunks", async () => {
        const secretChunk = createTableChunk(
            {
                title: "Confidential Metrics",
                headers: ["Metric", "Secret"],
                rows: [["Project X", "Redacted"]],
            },
            { documentId: "doc_secret_1" }
        );
        secretChunk.embedding = new Array(768).fill(0.05);

        await storeChunkEmbeddings("doc_secret_1", "conv_user_a", "user_A", [secretChunk]);

        // Attempt retrieval as user_B
        const searchAsB = await searchVectorChunks({
            queryVector: new Array(768).fill(0.05),
            userId: "user_B",
            conversationId: "conv_user_b",
        });

        assert.equal(searchAsB.results.length, 0);
    });

    test("15. Document deletion purges all visual chunks from vector storage", async () => {
        const chartChunk = createChartChunk(
            {
                title: "Quarterly Burn Rate",
                chartType: "BAR",
                series: [{ name: "Burn", values: [100, 120] }],
            },
            { documentId: "doc_purge_1" }
        );
        chartChunk.embedding = new Array(768).fill(0.04);

        await storeChunkEmbeddings("doc_purge_1", "conv_purge_1", "user_purge_1", [chartChunk]);

        const delRes = await deleteDocumentChunks("doc_purge_1");
        assert.ok(delRes.deletedCount >= 1);

        const verifySearch = await searchVectorChunks({
            queryVector: new Array(768).fill(0.04),
            userId: "user_purge_1",
            conversationId: "conv_purge_1",
            documentId: "doc_purge_1",
        });
        assert.equal(verifySearch.results.length, 0);
    });

    test("16. Conversation deletion purges all document chunks for that conversation", async () => {
        const chunk1 = createTableChunk({ title: "T1", headers: ["H"], rows: [["V"]] }, { documentId: "doc_conv_del_1" });
        chunk1.embedding = new Array(768).fill(0.06);
        await storeChunkEmbeddings("doc_conv_del_1", "conv_to_delete", "user_del", [chunk1]);

        const delConvRes = await deleteConversationChunks("conv_to_delete");
        assert.ok(delConvRes.deletedCount >= 1);
    });

    // 6. Message Model Citation Schema Verification
    test("17. Message model schema explicitly includes contentType, extractionMethod, and visualMetadata in citations", () => {
        const citationsPath = Message.schema.path("citations");
        assert.ok(citationsPath, "citations schema path exists");

        const subSchema = citationsPath.schema;
        assert.ok(subSchema.path("contentType"), "contentType exists on citation subdocument");
        assert.ok(subSchema.path("extractionMethod"), "extractionMethod exists on citation subdocument");
        assert.ok(subSchema.path("visualMetadata"), "visualMetadata exists on citation subdocument");
    });

    // 7. Phase 5.2 Document-Level OCR Status & Edge Cases
    test("18. Scenario A (Complete OCR success): 3 scanned pages all succeed -> status READY, failedPages 0, isScanned false", async () => {
        const fixture = await createAuditTestPdf({
            pages: [
                { text: "", image: true },
                { text: "", image: true },
                { text: "", image: true },
            ],
        });

        setMockVisionHandler(async ({ pageNumber }) => ({
            contentType: "OCR_TEXT",
            ocrText: `Recovered OCR text for scanned page ${pageNumber}.`,
            tables: [],
            charts: [],
            confidence: "HIGH",
        }));

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_ocr_scen_a",
            userId: "user_audit_1",
            generateEmbeddings: false,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.status, "READY");
        assert.equal(ingestRes.visualExtractionStatus, "READY");
        assert.equal(ingestRes.ocrPagesProcessed, 3);
        assert.equal(ingestRes.failedPages, 0);
        assert.equal(ingestRes.extractedPages, 3);
        assert.equal(ingestRes.isScanned, false);
        assert.equal(ingestRes.requiresOcr, false);
        assert.equal(ingestRes.chunks.length, 3);
    });

    test("19. Scenario B (Partial OCR success): 3 scanned pages, 2 succeed, 1 fails -> status PARTIAL, visualExtractionStatus PARTIAL", async () => {
        const fixture = await createAuditTestPdf({
            pages: [
                { text: "", image: true },
                { text: "", image: true },
                { text: "", image: true },
            ],
        });

        setMockVisionHandler(async ({ pageNumber }) => {
            if (pageNumber === 3) {
                throw new Error("OCR provider timeout on page 3");
            }
            return {
                contentType: "OCR_TEXT",
                ocrText: `Recovered OCR text for scanned page ${pageNumber}.`,
                tables: [],
                charts: [],
                confidence: "HIGH",
            };
        });

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_ocr_scen_b",
            userId: "user_audit_1",
            generateEmbeddings: false,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.status, "PARTIAL");
        assert.equal(ingestRes.visualExtractionStatus, "PARTIAL");
        assert.equal(ingestRes.ocrPagesProcessed, 2);
        assert.equal(ingestRes.failedPages, 1);
        assert.equal(ingestRes.extractedPages, 2);
        assert.equal(ingestRes.requiresOcr, true);

        // Failed page is marked FAILED and not silently PROCESSED
        const page3 = ingestRes.pages.find((p) => p.pageNumber === 3);
        assert.equal(page3.processingStatus, "FAILED");
        assert.equal(page3.hasText, false);

        // Successful chunks available
        const ocrChunks = ingestRes.chunks.filter((c) => c.contentType === "OCR_TEXT");
        assert.equal(ocrChunks.length, 2);
    });

    test("20. Scenario C (Complete OCR failure): All scanned pages fail -> status FAILED, visualExtractionStatus FAILED", async () => {
        const fixture = await createAuditTestPdf({
            pages: [
                { text: "", image: true },
                { text: "", image: true },
            ],
        });

        setMockVisionHandler(async () => {
            throw new Error("All provider requests failed 503");
        });

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_ocr_scen_c",
            userId: "user_audit_1",
            generateEmbeddings: false,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.status, "FAILED");
        assert.equal(ingestRes.visualExtractionStatus, "FAILED");
        assert.equal(ingestRes.ocrPagesProcessed, 0);
        assert.equal(ingestRes.failedPages, 2);
        assert.equal(ingestRes.isScanned, true);
        assert.equal(ingestRes.chunks.length, 0);
    });

    test("21. Scenario D (Mixed native text and scanned): Preserves native text chunks, adds OCR chunk for scanned, 0 duplicates", async () => {
        const fixture = await createAuditTestPdf({
            pages: [
                { text: "Executive summary for the board of directors with native selectable text." }, // Page 1: native text
                { text: "", image: true }, // Page 2: scanned invoice
            ],
        });

        setMockVisionHandler(async ({ pageNumber }) => {
            if (pageNumber === 2) {
                return {
                    contentType: "OCR_TEXT",
                    ocrText: "Scanned Invoice: Vendor ABC Corp, total $8,500.",
                    tables: [],
                    charts: [],
                    confidence: "HIGH",
                };
            }
            return null;
        });

        const ingestRes = await ingestPdfDocument(fixture, {
            conversationId: "conv_ocr_scen_d",
            userId: "user_audit_1",
            generateEmbeddings: false,
        });

        clearMockVisionHandler();

        assert.equal(ingestRes.status, "READY");
        assert.equal(ingestRes.ocrPagesProcessed, 1);

        const textChunks = ingestRes.chunks.filter((c) => c.contentType === "TEXT");
        const ocrChunks = ingestRes.chunks.filter((c) => c.contentType === "OCR_TEXT");

        assert.equal(textChunks.length, 1);
        assert.equal(textChunks[0].pageStart, 1);
        assert.ok(textChunks[0].content.includes("Executive summary"));

        assert.equal(ocrChunks.length, 1);
        assert.equal(ocrChunks[0].pageStart, 2);
        assert.ok(ocrChunks[0].content.includes("ABC Corp"));

        // No duplicate chunks for page 2
        const page2Chunks = ingestRes.chunks.filter((c) => c.pageStart === 2);
        assert.equal(page2Chunks.length, 1);
        assert.equal(page2Chunks[0].contentType, "OCR_TEXT");
    });
});

