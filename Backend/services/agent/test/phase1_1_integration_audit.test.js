import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";
import { geminiMultimodal, groqFast } from "../config/llmModels.js";
import {
    extractPdfMetadata,
    cachePdfDocument,
    getCachedPdfDocument,
    getConversationDocumentIds,
    invalidatePdfDocumentCache,
} from "../utils/extractPdf.js";
import {
    chunkDocument,
    estimateTokenCount,
    extractHeading,
    splitIntoSentences,
} from "../pdf/ingestion/chunking.service.js";
import {
    ingestPdfDocument,
    formatDocumentOutline,
    formatGroundedContext,
    findRelevantChunks,
} from "../pdf/ingestion/pdfIngestion.service.js";
import { pdfAgent } from "../agents/pdf-agent.js";

/**
 * Creates actual in-memory PDF fixtures using pdf-lib.
 */
async function createBinaryPdf({ pageCount = 1, getPageContent = null, fileName = "doc.pdf" }) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= pageCount; i++) {
        const page = doc.addPage([612, 792]);
        const text = typeof getPageContent === "function"
            ? getPageContent(i)
            : `Section ${i}: Performance Analysis on Page ${i}\nRevenue grew by ${i * 12} percent with strong operating margins.`;

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

describe("Orbit PDF Agent — Phase 1.1 Ingestion Integration & Reliability Audit", () => {
    const testRedisStore = new Map();
    const testSetStore = new Map();

    const origSet = redis.set;
    const origGet = redis.get;
    const origDel = redis.del;
    const origSadd = redis.sadd;
    const origSmembers = redis.smembers;
    const origExpire = redis.expire;
    const origGeminiInvoke = geminiMultimodal?.invoke;
    const origGroqInvoke = groqFast?.invoke;

    before(() => {
        if (geminiMultimodal) {
            geminiMultimodal.invoke = async () => ({
                content: "Executive summary for the analyzed PDF document [Page 1].",
            });
        }
        if (groqFast) {
            groqFast.invoke = async () => ({
                content: "Detailed answer using structured document context [Page 1].",
            });
        }
        redis.set = async (key, val) => {
            testRedisStore.set(key, val);
            return "OK";
        };
        redis.get = async (key) => {
            return testRedisStore.get(key) || null;
        };
        redis.del = async (key) => {
            testRedisStore.delete(key);
            testSetStore.delete(key);
            return 1;
        };
        redis.sadd = async (key, member) => {
            if (!testSetStore.has(key)) testSetStore.set(key, new Set());
            testSetStore.get(key).add(member);
            return 1;
        };
        redis.smembers = async (key) => {
            const s = testSetStore.get(key);
            return s ? Array.from(s) : [];
        };
        redis.expire = async () => 1;
    });

    after(() => {
        if (geminiMultimodal && origGeminiInvoke) {
            geminiMultimodal.invoke = origGeminiInvoke;
        }
        if (groqFast && origGroqInvoke) {
            groqFast.invoke = origGroqInvoke;
        }
        redis.set = origSet;
        redis.get = origGet;
        redis.del = origDel;
        redis.sadd = origSadd;
        redis.smembers = origSmembers;
        redis.expire = origExpire;
        try {
            redis.disconnect();
        } catch {}
    });

    // =========================================================================
    // SECTION 1: VERIFY REAL UPLOAD-TO-AGENT FLOW
    // =========================================================================

    test("1.1 Execution Flow: Ingestion pipeline executes during normal PDF Agent turn", async () => {
        const fixture = await createBinaryPdf({
            pageCount: 2,
            getPageContent: (i) => `Section ${i}: Core Orbit Architecture Page ${i}`,
            fileName: "ArchitectureSpecs.pdf",
        });

        // Execute pdfAgent directly with fresh attachment payload
        const agentState = {
            conversationId: "conv_audit_flow_1",
            prompt: "Summarize this architecture document",
            attachment: {
                name: fixture.name,
                mimeType: fixture.mimeType,
                data: fixture.data,
            },
        };

        const result = await pdfAgent(agentState);

        // Verify pdfDocument output schema populated by ingestPdfDocument
        assert.ok(result.pdfDocument, "pdfDocument metadata must be returned in state");
        assert.equal(result.pdfDocument.fileName, "ArchitectureSpecs.pdf");
        assert.equal(result.pdfDocument.pageCount, 2);
        assert.ok(result.pdfDocument.documentId.startsWith("doc_"));
        assert.ok(typeof result.pdfDocument.totalChunks === "number" && result.pdfDocument.totalChunks >= 1);
        assert.equal(result.pdfDocument.status, "READY");
        assert.equal(result.pdfDocument.isScanned, false);
    });

    // =========================================================================
    // SECTION 2: VERIFY DOCUMENT ISOLATION & MULTI-DOCUMENT CONVERSATIONS
    // =========================================================================

    test("2.1 Document Isolation: Two PDFs in the same conversation do not overwrite each other", async () => {
        const convId = "conv_multi_doc_iso_2";

        const doc1Fixture = await createBinaryPdf({
            pageCount: 2,
            getPageContent: (i) => `QuarterlyReport: Q1 Financial Analysis Page ${i}`,
            fileName: "QuarterlyReport.pdf",
        });

        const doc2Fixture = await createBinaryPdf({
            pageCount: 3,
            getPageContent: (i) => `TechnicalRoadmap: 2026 Engine Upgrades Page ${i}`,
            fileName: "TechnicalRoadmap.pdf",
        });

        // Ingest Doc 1
        const ingested1 = await ingestPdfDocument(doc1Fixture, { conversationId: convId });
        assert.equal(ingested1.fileName, "QuarterlyReport.pdf");

        // Ingest Doc 2 in the same conversation
        const ingested2 = await ingestPdfDocument(doc2Fixture, { conversationId: convId });
        assert.equal(ingested2.fileName, "TechnicalRoadmap.pdf");
        assert.notEqual(ingested1.documentId, ingested2.documentId);

        // Verify that Doc 1 is STILL preserved in cache by its documentId
        const retrievedDoc1 = await getCachedPdfDocument(convId, ingested1.documentId);
        assert.ok(retrievedDoc1, "Doc 1 must remain retrievable by its documentId");
        assert.equal(retrievedDoc1.fileName, "QuarterlyReport.pdf");
        assert.equal(retrievedDoc1.pageCount, 2);

        // Verify that Doc 2 is retrievable by its documentId
        const retrievedDoc2 = await getCachedPdfDocument(convId, ingested2.documentId);
        assert.ok(retrievedDoc2, "Doc 2 must remain retrievable by its documentId");
        assert.equal(retrievedDoc2.fileName, "TechnicalRoadmap.pdf");
        assert.equal(retrievedDoc2.pageCount, 3);

        // Verify active/latest document points to Doc 2
        const latestDoc = await getCachedPdfDocument(convId);
        assert.equal(latestDoc.fileName, "TechnicalRoadmap.pdf");

        // Verify conversation tracks both document IDs
        const docIds = await getConversationDocumentIds(convId);
        assert.ok(docIds.includes(ingested1.documentId));
        assert.ok(docIds.includes(ingested2.documentId));
    });

    test("2.2 Multi-turn targeting: Follow-up question referencing an older document by name selects the older document", async () => {
        const convId = "conv_older_doc_query_3";

        const doc1 = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 2, getPageContent: () => "Guidance: 25% ARR growth in Fiscal2025.", fileName: "Fiscal2025.pdf" }),
            { conversationId: convId }
        );

        const doc2 = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 2, getPageContent: () => "Q1 update: Capex increased by 10%.", fileName: "Q1Update.pdf" }),
            { conversationId: convId }
        );

        // Ask a question targeting the older document (Fiscal2025)
        const agentStateOlderDoc = {
            conversationId: convId,
            prompt: "What was the projected ARR growth in Fiscal2025?",
            attachment: null,
            history: [],
        };

        const result = await pdfAgent(agentStateOlderDoc);

        // Must target Fiscal2025 document, NOT the latest Q1Update document
        assert.equal(result.pdfDocument.fileName, "Fiscal2025.pdf");
        assert.equal(result.pdfDocument.documentId, doc1.documentId);
    });

    test("2.3 Cross-conversation isolation: Two different conversations remain strictly isolated", async () => {
        const convA = "conv_isolated_A";
        const convB = "conv_isolated_B";

        const docA = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 1, getPageContent: () => "Confidential Client Alpha Data", fileName: "Alpha.pdf" }),
            { conversationId: convA }
        );

        const docB = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 1, getPageContent: () => "Confidential Client Beta Data", fileName: "Beta.pdf" }),
            { conversationId: convB }
        );

        const fromA = await getCachedPdfDocument(convA);
        const fromB = await getCachedPdfDocument(convB);

        assert.equal(fromA.fileName, "Alpha.pdf");
        assert.equal(fromB.fileName, "Beta.pdf");
        assert.notEqual(fromA.documentId, fromB.documentId);
    });

    test("2.4 Cache Cleanup: Invalidation removes all document keys for that conversation", async () => {
        const convId = "conv_cleanup_test_4";

        const doc1 = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 1, fileName: "Temp1.pdf" }),
            { conversationId: convId }
        );
        const doc2 = await ingestPdfDocument(
            await createBinaryPdf({ pageCount: 1, fileName: "Temp2.pdf" }),
            { conversationId: convId }
        );

        // Verify presence before cleanup
        assert.ok(await getCachedPdfDocument(convId, doc1.documentId));
        assert.ok(await getCachedPdfDocument(convId, doc2.documentId));

        // Purge conversation cache
        await invalidatePdfDocumentCache(convId);

        // Verify complete removal
        assert.equal(await getCachedPdfDocument(convId), null);
        assert.equal(await getCachedPdfDocument(convId, doc1.documentId), null);
        assert.equal(await getCachedPdfDocument(convId, doc2.documentId), null);
        assert.deepEqual(await getConversationDocumentIds(convId), []);
    });

    // =========================================================================
    // SECTION 3: VERIFY REAL 50-PAGE PDF FIXTURE PROCESSING
    // =========================================================================

    test("3.1 50-Page Fixture In-Depth: Preserves all pages, 1-based indexing, offsets, and final page text", async () => {
        const fixture50 = await createBinaryPdf({
            pageCount: 50,
            getPageContent: (pageNum) => `--- Chapter ${pageNum} ---\nSection ${pageNum}: Detailed topic review on page ${pageNum}. Final metric: ${pageNum * 100} units.`,
            fileName: "AnnualReport50Pages.pdf",
        });

        const ingested = await ingestPdfDocument(fixture50, { targetChunkTokens: 50 });

        assert.equal(ingested.pageCount, 50);
        assert.equal(ingested.extractedPages, 50);
        assert.equal(ingested.failedPages, 0);
        assert.equal(ingested.status, "READY");

        // Verify page sequence 1..50
        assert.equal(ingested.pages[0].pageNumber, 1);
        assert.equal(ingested.pages[49].pageNumber, 50);

        // Verify final page content is explicitly present in page list and chunks
        assert.ok(ingested.pages[49].text.includes("Chapter 50"));
        assert.ok(ingested.pages[49].text.includes("5000 units"));

        const lastChunk = ingested.chunks[ingested.chunks.length - 1];
        assert.ok(lastChunk.pageEnd === 50);
        assert.ok(lastChunk.content.includes("5000 units"));

        // Verify monotonic offsets across all chunks
        for (let i = 0; i < ingested.chunks.length - 1; i++) {
            const current = ingested.chunks[i];
            const next = ingested.chunks[i + 1];
            assert.ok(current.startOffset < current.endOffset, `Chunk ${i} startOffset must be < endOffset`);
            assert.ok(next.startOffset >= current.startOffset, `Chunk ${i + 1} startOffset must not precede chunk ${i}`);
        }
    });

    // =========================================================================
    // SECTION 4: LARGE DOCUMENT CONTEXT HANDLING & PRE-VECTOR MATCHER AUDIT
    // =========================================================================

    test("4.1 Pre-Vector Matcher: Explicit page queries resolve exact page chunk", () => {
        const chunks = [
            { chunkId: "c1", pageStart: 1, pageEnd: 5, section: "Intro", content: "Introduction" },
            { chunkId: "c2", pageStart: 6, pageEnd: 15, section: "Tech", content: "Tech architecture" },
            { chunkId: "c3", pageStart: 40, pageEnd: 45, section: "Financials", content: "Page 42 Financials: Net Income was $850M" },
            { chunkId: "c4", pageStart: 46, pageEnd: 50, section: "Conclusion", content: "Conclusion" },
        ];

        const matchPage42 = findRelevantChunks(chunks, "What is the net income reported on page 42?", 2);
        assert.equal(matchPage42.length, 1);
        assert.equal(matchPage42[0].chunkId, "c3");
        assert.ok(matchPage42[0].content.includes("$850M"));
    });

    test("4.2 Pre-Vector Matcher: Late document section queries resolve without truncation", () => {
        const chunks = [
            { chunkId: "c1", pageStart: 1, pageEnd: 2, section: "1. Overview", content: "Overview" },
            { chunkId: "c2", pageStart: 3, pageEnd: 4, section: "2. Operations", content: "Operations" },
            { chunkId: "c3", pageStart: 48, pageEnd: 50, section: "10. Environmental Impact", content: "Carbon neutrality reached 94% in emissions reduction." },
        ];

        const matchLate = findRelevantChunks(chunks, "tell me about the environmental impact", 2);
        assert.equal(matchLate[0].chunkId, "c3");
        assert.ok(matchLate[0].content.includes("Carbon neutrality"));
    });

    test("4.3 Pre-Vector Matcher Limitation: Semantic paraphrase without verbatim words falls back to top chunks", () => {
        const chunks = [
            { chunkId: "c1", pageStart: 1, pageEnd: 2, section: "General", content: "Orbit company overview." },
            { chunkId: "c2", pageStart: 3, pageEnd: 4, section: "Legal", content: "Liquidity mitigation strategies against bankruptcy risk." },
        ];

        // Query uses "going broke" instead of "liquidity / bankruptcy"
        const result = findRelevantChunks(chunks, "how does the firm avoid going broke?", 2);
        // Pre-vector keyword matcher cannot find semantic match; returns fallback candidate chunks
        assert.ok(result.length > 0, "Pre-vector matcher provides safe fallback candidate chunks");
    });

    // =========================================================================
    // SECTION 5: REDIS RELIABILITY AUDIT
    // =========================================================================

    test("5.1 Redis Reliability: cacheStatus is accurately reported as CACHED on valid Redis write", async () => {
        const fixture = await createBinaryPdf({ pageCount: 1, fileName: "StatusCheck.pdf" });
        const result = await ingestPdfDocument(fixture, { conversationId: "conv_status_cached_5" });

        assert.equal(result.status, "READY");
        assert.equal(result.cacheStatus, "CACHED");
        assert.equal(result.warnings.some((w) => w.includes("cache write failed")), false);
    });

    test("5.2 Redis Reliability: Failed Redis write does not crash ingestion and reports CACHE_FAILED with warning", async () => {
        // Temporarily stub redis.set to throw an error
        const mockSet = redis.set;
        redis.set = async () => {
            throw new Error("Simulated Redis network disconnection");
        };

        try {
            const fixture = await createBinaryPdf({ pageCount: 1, fileName: "Failover.pdf" });
            const result = await ingestPdfDocument(fixture, { conversationId: "conv_failover_test_6" });

            // Ingestion must still complete in memory
            assert.equal(result.status, "READY");
            assert.equal(result.cacheStatus, "CACHE_FAILED");
            assert.ok(result.warnings.some((w) => w.includes("cache write failed")));
        } finally {
            redis.set = mockSet;
        }
    });
});
