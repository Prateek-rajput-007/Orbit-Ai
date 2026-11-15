import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";
import {
    extractPdfMetadata,
    extractPdfPages,
    formatFileSize,
    generateDocumentId,
    cachePdfDocument,
    getCachedPdfDocument,
    invalidatePdfDocumentCache,
} from "../utils/extractPdf.js";
import {
    chunkDocument,
    estimateTokenCount,
    extractHeading,
    splitIntoSentences,
    hashContent,
    CHUNKING_DEFAULTS,
} from "../pdf/ingestion/chunking.service.js";
import {
    ingestPdfDocument,
    formatDocumentOutline,
    formatGroundedContext,
    findRelevantChunks,
} from "../pdf/ingestion/pdfIngestion.service.js";

/**
 * Helper to generate real in-memory PDF fixtures using pdf-lib.
 */
async function generatePdfFixture({ pageCount = 1, getPageText = null }) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= pageCount; i++) {
        const page = doc.addPage([612, 792]);
        const text = typeof getPageText === "function"
            ? getPageText(i)
            : `Section ${i}: Performance Analysis on Page ${i}\nRevenue grew by ${i * 12} percent with strong margin expansion.`;

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
        name: `test-fixture-${pageCount}p.pdf`,
        mimeType: "application/pdf",
        data: buffer.toString("base64"),
        buffer,
    };
}

describe("Orbit PDF Agent — Phase 1 Test Suite", () => {
    after(() => {
        try {
            redis.disconnect();
        } catch {}
    });

    // =========================================================================
    // CATEGORY 1: EXTRACTION TESTS (1-9)
    // =========================================================================

    test("Test 1: One-page PDF extraction preserves page boundaries and metadata", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 1,
            getPageText: () => "Executive Summary: Orbit AI platform demonstrates 99.9% uptime and zero latency spikes.",
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.pageCount, 1);
        assert.equal(result.status, "READY");
        assert.equal(result.extractedPages, 1);
        assert.equal(result.failedPages, 0);
        assert.equal(result.pages.length, 1);
        assert.equal(result.pages[0].pageNumber, 1);
        assert.equal(result.pages[0].hasText, true);
        assert.ok(result.pages[0].text.includes("Orbit AI platform"));
        assert.ok(result.text.includes("Orbit AI platform"));
        assert.ok(result.documentId.startsWith("doc_"));
    });

    test("Test 2: Multi-page PDF (5 pages) preserves sequential page numbers and distinct content", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 5,
            getPageText: (pageNum) => `Chapter ${pageNum}: Key Architectural Insights for Module ${pageNum}. Details on page ${pageNum}.`,
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.pageCount, 5);
        assert.equal(result.pages.length, 5);
        assert.equal(result.extractedPages, 5);

        for (let i = 0; i < 5; i++) {
            const page = result.pages[i];
            assert.equal(page.pageNumber, i + 1);
            assert.ok(page.text.includes(`Chapter ${i + 1}`));
            assert.equal(page.hasText, true);
            assert.ok(page.characterCount > 10);
            assert.ok(page.tokenEstimate > 2);
        }
    });

    test("Test 3: 50-page PDF extraction without silent content loss", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 50,
            getPageText: (pageNum) => `--- Chapter ${pageNum} ---\nAnnual Report Page ${pageNum} detailed financial records and risk factors.`,
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.pageCount, 50);
        assert.equal(result.pages.length, 50);
        assert.equal(result.extractedPages, 50);
        assert.equal(result.failedPages, 0);

        // Verify page 1 and page 50 are both fully present
        assert.equal(result.pages[0].pageNumber, 1);
        assert.ok(result.pages[0].text.includes("Chapter 1"));
        assert.equal(result.pages[49].pageNumber, 50);
        assert.ok(result.pages[49].text.includes("Chapter 50"));

        // Verify total characters reflects all 50 pages
        assert.ok(result.totalCharacters > 2500);
        assert.equal(result.status, "READY");
    });

    test("Test 4: Empty page handling marks hasText: false without throwing", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 2,
            getPageText: (pageNum) => (pageNum === 1 ? "Page 1 Content with valid text" : ""),
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.pageCount, 2);
        assert.equal(result.pages[0].hasText, true);
        assert.equal(result.pages[1].hasText, false);
        assert.equal(result.pages[1].characterCount, 0);
        assert.equal(result.pages[1].extractionMethod, "empty");
        assert.ok(result.pages[1].warnings.length > 0);
        assert.equal(result.status, "PARTIAL");
    });

    test("Test 5: Scanned / image-only PDF detection sets isScanned and requiresOcr", async () => {
        // Generates a 3-page PDF with zero extractable text (simulating pure scanned image pages)
        const fixture = await generatePdfFixture({
            pageCount: 3,
            getPageText: () => "",
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.pageCount, 3);
        assert.equal(result.extractedPages, 0);
        assert.equal(result.isScanned, true);
        assert.equal(result.requiresOcr, true);
        assert.equal(result.status, "FAILED");
        assert.ok(result.warnings.some((w) => w.includes("scanned") || w.includes("OCR")));
    });

    test("Test 6: Malformed or corrupt PDF buffer is caught defensively without crashing", async () => {
        const corruptFixture = {
            name: "corrupt.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("NOT_A_VALID_PDF_HEADER_DATA_12345").toString("base64"),
        };

        const result = await extractPdfMetadata(corruptFixture);
        assert.equal(result.status, "FAILED");
        assert.equal(result.extractedPages, 0);
        assert.equal(result.text, "");
        assert.ok(result.warnings.length > 0);
    });

    test("Test 7: Partially extractable PDF reports PARTIAL status with valid pages preserved", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 3,
            getPageText: (pageNum) => (pageNum === 2 ? "" : `Page ${pageNum} has valid legal text`),
        });

        const result = await extractPdfMetadata(fixture);
        assert.equal(result.status, "PARTIAL");
        assert.equal(result.extractedPages, 2);
        assert.equal(result.failedPages, 1);
        assert.equal(result.pages[0].hasText, true);
        assert.equal(result.pages[1].hasText, false);
        assert.equal(result.pages[2].hasText, true);
    });

    test("Test 8: Accurate 1-based page numbering across all pages", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 4,
            getPageText: (pageNum) => `Sequential page ${pageNum}`,
        });

        const result = await extractPdfMetadata(fixture);
        const numbers = result.pages.map((p) => p.pageNumber);
        assert.deepEqual(numbers, [1, 2, 3, 4]);
    });

    test("Test 9: Extraction failure handling on null, empty, or missing data", async () => {
        const emptyResult = await extractPdfMetadata({ name: "empty.pdf", data: "" });
        assert.equal(emptyResult.status, "FAILED");
        assert.equal(emptyResult.pages.length, 0);
        assert.equal(emptyResult.text, "");

        const nullResult = await extractPdfMetadata(null);
        assert.equal(nullResult.status, "FAILED");
    });

    // =========================================================================
    // CATEGORY 2: CHUNKING TESTS (10-20)
    // =========================================================================

    test("Test 10: Short paragraph chunking preserves full text into single chunk", () => {
        const extracted = {
            documentId: "doc_test_10",
            title: "Short Doc",
            pages: [
                { pageNumber: 1, text: "Orbit provides unified multi-agent coding and document intelligence." },
            ],
        };

        const chunks = chunkDocument(extracted);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].pageStart, 1);
        assert.equal(chunks[0].pageEnd, 1);
        assert.equal(chunks[0].chunkIndex, 0);
        assert.ok(chunks[0].content.includes("unified multi-agent"));
    });

    test("Test 11: Long paragraph exceeding maxChunkTokens splits cleanly at sentence boundaries", () => {
        // Construct a long paragraph with 40 distinct sentences
        const sentences = [];
        for (let i = 1; i <= 40; i++) {
            sentences.push(`Sentence ${i}: Artificial intelligence architectures require durable state management, low-latency caching, and verifiable source citations.`);
        }
        const longParagraph = sentences.join(" ");

        const extracted = {
            documentId: "doc_test_11",
            title: "Long Text",
            pages: [{ pageNumber: 1, text: longParagraph }],
        };

        const chunks = chunkDocument(extracted, {
            targetChunkTokens: 150,
            maxChunkTokens: 250,
            overlapTokens: 30,
        });

        assert.ok(chunks.length > 1, `Expected multiple chunks, got ${chunks.length}`);
        for (const chunk of chunks) {
            assert.ok(chunk.tokenCount <= 260, `Chunk token count ${chunk.tokenCount} exceeded max`);
            assert.ok(chunk.content.trim().length > 0);
            assert.equal(chunk.pageStart, 1);
            assert.equal(chunk.pageEnd, 1);
        }
    });

    test("Test 12: Multiple sections and headings preservation", () => {
        const text = [
            "# 1. Executive Summary",
            "Orbit AI was founded to democratize multi-agent engineering workflows.",
            "",
            "## 2. Infrastructure Architecture",
            "The backend runs Express on Node.js with distributed Redis pub/sub and MongoDB persistence.",
            "",
            "### 3. Security & Validation",
            "All incoming requests are validated against magic bytes and size thresholds.",
        ].join("\n");

        const extracted = {
            documentId: "doc_test_12",
            title: "System Architecture",
            pages: [{ pageNumber: 1, text }],
        };

        const chunks = chunkDocument(extracted, { targetChunkTokens: 50, maxChunkTokens: 100 });
        assert.ok(chunks.length >= 2);

        // Sections should be detected and assigned
        const sections = chunks.map((c) => c.section);
        assert.ok(sections.some((s) => s.includes("Executive Summary") || s.includes("1.")));
    });

    test("Test 13: Lists and bullet points preservation", () => {
        const listText = [
            "Core Agent Capabilities:",
            "- Search Agent with real-time web citations",
            "- Coding Agent with React Sandpack live canvas",
            "- PDF Agent with page-aware RAG extraction",
            "- PPT Agent with downloadable presentations",
        ].join("\n");

        const extracted = {
            documentId: "doc_test_13",
            title: "Feature List",
            pages: [{ pageNumber: 1, text: listText }],
        };

        const chunks = chunkDocument(extracted);
        assert.equal(chunks.length, 1);
        assert.ok(chunks[0].content.includes("- Search Agent"));
        assert.ok(chunks[0].content.includes("- PPT Agent"));
    });

    test("Test 14: Table-like content preservation", () => {
        const tableText = [
            "Financial Results Matrix:",
            "| Quarter | Revenue | Operating Income | Margin |",
            "|---------|---------|------------------|--------|",
            "| Q1 2026 | $12.4B  | $3.2B            | 25.8%  |",
            "| Q2 2026 | $14.1B  | $3.9B            | 27.6%  |",
            "| Q3 2026 | $15.8B  | $4.5B            | 28.4%  |",
        ].join("\n");

        const extracted = {
            documentId: "doc_test_14",
            title: "Q3 Earnings",
            pages: [{ pageNumber: 2, text: tableText }],
        };

        const chunks = chunkDocument(extracted);
        assert.equal(chunks.length, 1);
        assert.ok(chunks[0].content.includes("| Q3 2026 | $15.8B"));
        assert.equal(chunks[0].pageStart, 2);
    });

    test("Test 15: Content spanning multiple pages accurately records pageStart and pageEnd", () => {
        const extracted = {
            documentId: "doc_test_15",
            title: "Multi-page Story",
            pages: [
                { pageNumber: 3, text: "Section 3 begins on page three with a detailed analysis of market dynamics." },
                { pageNumber: 4, text: "Continuing from page three, the market analysis extends into international customer segments." },
            ],
        };

        const chunks = chunkDocument(extracted, { targetChunkTokens: 200 });
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].pageStart, 3);
        assert.equal(chunks[0].pageEnd, 4);
    });

    test("Test 16: Overlap correctness preserves continuity between adjacent chunks", () => {
        const paragraphs = [
            "Paragraph 1: Distributed caching provides sub-millisecond retrieval of session data.",
            "Paragraph 2: Redis cluster handles horizontal scaling across geographic zones.",
            "Paragraph 3: Write-through cache invalidation prevents stale state anomalies.",
            "Paragraph 4: Sentinel failover guarantees 99.99% high availability.",
        ];

        const extracted = {
            documentId: "doc_test_16",
            title: "Caching Guide",
            pages: [{ pageNumber: 1, text: paragraphs.join("\n\n") }],
        };

        const chunks = chunkDocument(extracted, {
            targetChunkTokens: 25,
            maxChunkTokens: 40,
            overlapTokens: 15,
        });

        assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
        // Adjacent chunks should share overlap content
        if (chunks.length >= 2) {
            const chunk1Words = chunks[0].content.split(/\s+/);
            const chunk2Words = chunks[1].content.split(/\s+/);
            const overlapExists = chunk1Words.some((w) => w.length > 5 && chunk2Words.includes(w));
            assert.ok(overlapExists, "Adjacent chunks should share overlap context");
        }
    });

    test("Test 17: No empty chunks generated from whitespace or blank sections", () => {
        const extracted = {
            documentId: "doc_test_17",
            title: "Gapped Document",
            pages: [
                { pageNumber: 1, text: "   \n\n\t  " },
                { pageNumber: 2, text: "Valid content on page 2" },
                { pageNumber: 3, text: "\n\n\n" },
            ],
        };

        const chunks = chunkDocument(extracted);
        assert.equal(chunks.length, 1);
        assert.equal(chunks[0].pageStart, 2);
        assert.ok(chunks[0].content.trim().length > 0);
    });

    test("Test 18: No content silently lost during chunking", () => {
        const items = ["Apple", "Banana", "Cherry", "Date", "Elderberry", "Fig", "Grape"];
        const extracted = {
            documentId: "doc_test_18",
            title: "Fruit Catalog",
            pages: [{ pageNumber: 1, text: items.map((f) => `Product: ${f} is available.`).join("\n\n") }],
        };

        const chunks = chunkDocument(extracted, { targetChunkTokens: 15, maxChunkTokens: 30 });
        const allChunkContent = chunks.map((c) => c.content).join(" ");

        for (const fruit of items) {
            assert.ok(allChunkContent.includes(fruit), `Content word "${fruit}" was lost in chunking`);
        }
    });

    test("Test 19: Stable chunk identifiers and deterministic content hashes", () => {
        const extracted = {
            documentId: "doc_idempotency_19",
            title: "Stable Doc",
            pages: [{ pageNumber: 1, text: "Deterministic chunking generates identical hashes." }],
        };

        const run1 = chunkDocument(extracted);
        const run2 = chunkDocument(extracted);

        assert.equal(run1.length, run2.length);
        assert.equal(run1[0].chunkId, run2[0].chunkId);
        assert.equal(run1[0].contentHash, run2[0].contentHash);
        assert.equal(run1[0].chunkId, "doc_idempotency_19_c0001");
    });

    test("Test 20: Accurate startOffset and endOffset document-global character ranges", () => {
        const extracted = {
            documentId: "doc_offsets_20",
            title: "Offset Testing",
            pages: [
                { pageNumber: 1, text: "First section text." },
                { pageNumber: 2, text: "Second section text." },
            ],
        };

        const chunks = chunkDocument(extracted, { targetChunkTokens: 5, maxChunkTokens: 10 });
        assert.ok(chunks.length >= 1);
        for (const chunk of chunks) {
            assert.ok(typeof chunk.startOffset === "number" && chunk.startOffset >= 0);
            assert.ok(typeof chunk.endOffset === "number" && chunk.endOffset > chunk.startOffset);
        }
    });

    // =========================================================================
    // CATEGORY 3: INTEGRATION & PIPELINE TESTS (21-27)
    // =========================================================================

    test("Test 21: Existing PDF upload payload shape is fully preserved (backward compatibility)", async () => {
        const fixture = await generatePdfFixture({ pageCount: 1 });
        const legacyDoc = await extractPdfMetadata(fixture);

        // Required legacy keys
        assert.ok("fileName" in legacyDoc);
        assert.ok("fileSize" in legacyDoc);
        assert.ok("pageCount" in legacyDoc);
        assert.ok("title" in legacyDoc);
        assert.ok("text" in legacyDoc);
        assert.ok("previewText" in legacyDoc);
        assert.ok("dataUrl" in legacyDoc);
    });

    test("Test 22: Ingestion service orchestrates extraction, chunking, and statistics", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 3,
            getPageText: (i) => `Section ${i}: Key finding number ${i}. All facts are verified on page ${i}.`,
        });

        const ingested = await ingestPdfDocument(fixture);
        assert.equal(ingested.pageCount, 3);
        assert.equal(ingested.status, "READY");
        assert.ok(ingested.totalChunks >= 1);
        assert.ok(ingested.avgChunkTokens > 0);
        assert.ok(ingested.chunks.length === ingested.totalChunks);
        assert.equal(ingested.isScanned, false);
        assert.equal(ingested.requiresOcr, false);
    });

    test("Test 23: Short document formatGroundedContext injects explicit [Page X] boundary markers", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 2,
            getPageText: (i) => `Content for Page ${i}`,
        });

        const ingested = await ingestPdfDocument(fixture);
        const context = formatGroundedContext(ingested, { maxContextTokens: 5000 });

        assert.ok(context.includes("--- [Page 1] ---"));
        assert.ok(context.includes("--- [Page 2] ---"));
        assert.ok(context.includes("Content for Page 1"));
        assert.ok(context.includes("Content for Page 2"));
    });

    test("Test 24: Long document ingestion preserves all 50 pages without hard 35,000-char truncation", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 50,
            getPageText: (i) => `Section ${i}: Comprehensive analysis for Quarter ${i}. Revenue reached $${i * 10}M.`,
        });

        const ingested = await ingestPdfDocument(fixture, { targetChunkTokens: 25 });
        assert.equal(ingested.pageCount, 50);
        assert.equal(ingested.extractedPages, 50);
        assert.equal(ingested.totalChunks, 50);
        assert.equal(ingested.chunks[0].pageStart, 1);
        assert.equal(ingested.chunks[ingested.chunks.length - 1].pageEnd, 50);

        // Verify outline covers both beginning and late pages
        const outline = formatDocumentOutline(ingested, 30);
        assert.ok(outline.includes("Document Structure:"));
        assert.ok(outline.includes("50 pages"));

        // Case B: When token budget is tight (e.g. 200 tokens), provides structural outline + executive sections
        const groundedTight = formatGroundedContext(ingested, { maxContextTokens: 200 });
        assert.ok(groundedTight.includes("Document Structure:"));
        assert.ok(groundedTight.includes("Executive Overview"));

        // Case A: When token budget is generous, preserves all 50 page markers without arbitrary slicing
        const groundedFull = formatGroundedContext(ingested, { maxContextTokens: 5000 });
        assert.ok(groundedFull.includes("--- [Page 1] ---"));
        assert.ok(groundedFull.includes("--- [Page 50] ---"));
        assert.ok(!groundedFull.includes("slice(0, 35000)"));
    });

    test("Test 25: Partial extraction status handling when some pages are blank", async () => {
        const fixture = await generatePdfFixture({
            pageCount: 4,
            getPageText: (i) => (i % 2 === 0 ? "" : `Page ${i} contains valid text`),
        });

        const ingested = await ingestPdfDocument(fixture);
        assert.equal(ingested.status, "PARTIAL");
        assert.equal(ingested.extractedPages, 2);
        assert.equal(ingested.failedPages, 2);
    });

    test("Test 26: Duplicate ingestion produces identical chunk IDs and hashes (idempotency)", async () => {
        const fixture = await generatePdfFixture({ pageCount: 2 });
        const ingested1 = await ingestPdfDocument(fixture);
        const ingested2 = await ingestPdfDocument(fixture);

        assert.equal(ingested1.documentId, ingested2.documentId);
        assert.equal(ingested1.totalChunks, ingested2.totalChunks);
        assert.equal(ingested1.chunks[0].chunkId, ingested2.chunks[0].chunkId);
        assert.equal(ingested1.chunks[0].contentHash, ingested2.chunks[0].contentHash);
    });

    test("Test 27: Targeted chunk retrieval resolves explicit page references (findRelevantChunks)", () => {
        const chunks = [
            { chunkId: "c1", pageStart: 1, pageEnd: 1, section: "Intro", content: "Introduction to Orbit" },
            { chunkId: "c2", pageStart: 2, pageEnd: 2, section: "Architecture", content: "Architecture specifications" },
            { chunkId: "c3", pageStart: 3, pageEnd: 3, section: "Financials", content: "Financial results: ARR reached $42M" },
            { chunkId: "c4", pageStart: 4, pageEnd: 4, section: "Risks", content: "Risk factors and mitigations" },
        ];

        // Explicit page query
        const page3Matches = findRelevantChunks(chunks, "What happened on page 3?", 2);
        assert.equal(page3Matches.length, 1);
        assert.equal(page3Matches[0].pageStart, 3);
        assert.ok(page3Matches[0].content.includes("$42M"));

        // Keyword query
        const riskMatches = findRelevantChunks(chunks, "tell me about the risks", 2);
        assert.equal(riskMatches[0].section, "Risks");
    });
});
