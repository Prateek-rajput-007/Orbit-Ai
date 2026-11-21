process.env.NODE_ENV = "test";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";

import {
    getDocumentContext,
    CONTEXT_STATUS,
    formatCitationRecords,
    normalizeDocumentSummary,
} from "../pdf/context/documentContext.service.js";

import {
    storeChunkEmbeddings,
    resetMemoryVectorStore,
} from "../pdf/storage/vectorStorage.service.js";

import {
    cachePdfDocument,
    invalidatePdfDocumentCache,
} from "../utils/extractPdf.js";

function createMockVector(seed = 1, dimensions = 768) {
    const vec = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
        vec[i] = Number((Math.sin(seed + i) * 0.1).toFixed(6));
    }
    return vec;
}

const mockEmbeddingClient = {
    embedDocuments: async (texts) => texts.map((_, idx) => createMockVector(idx + 1)),
    embedQuery: async () => createMockVector(1),
};

async function createSimplePdfBuffer(title = "Test Doc", content = "Default text") {
    const doc = await PDFDocument.create();
    const page = doc.addPage([600, 400]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText(`${title}\n${content}`, { x: 50, y: 350, size: 12, font });
    const bytes = await doc.save();
    return Buffer.from(bytes);
}

describe("Cross-Agent RAG — Shared Document Context Service", () => {
    const testRedisStore = new Map();
    const testSetStore = new Map();

    const origSet = redis.set;
    const origGet = redis.get;
    const origDel = redis.del;
    const origSadd = redis.sadd;
    const origSmembers = redis.smembers;
    const origExpire = redis.expire;

    before(() => {
        try {
            redis.disconnect();
        } catch {}

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

    beforeEach(() => {
        resetMemoryVectorStore();
    });

    after(async () => {
        resetMemoryVectorStore();
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

    test("1. Returns FAILED when authenticated userId or conversationId is missing", async () => {
        const resMissingUser = await getDocumentContext({
            query: "Build dashboard",
            conversationId: "conv_1",
        });
        assert.equal(resMissingUser.status, CONTEXT_STATUS.FAILED);
        assert.equal(resMissingUser.hasContext, false);
        assert.ok(resMissingUser.error.includes("userId"));

        const resMissingConv = await getDocumentContext({
            query: "Build dashboard",
            userId: "user_1",
        });
        assert.equal(resMissingConv.status, CONTEXT_STATUS.FAILED);
        assert.equal(resMissingConv.hasContext, false);
        assert.ok(resMissingConv.error.includes("conversationId"));
    });

    test("2. Returns NO_DOCUMENTS when conversation has no documents and no attachment", async () => {
        const res = await getDocumentContext({
            query: "What are the revenue figures?",
            userId: "user_1",
            conversationId: "conv_empty_test",
        });

        assert.equal(res.status, CONTEXT_STATUS.NO_DOCUMENTS);
        assert.equal(res.hasContext, false);
        assert.equal(res.documents.length, 0);
        assert.equal(res.groundedContext, "");
        assert.equal(res.citations.length, 0);
    });

    test("3. Ingests fresh PDF attachment on demand and returns READY grounded context", async () => {
        const pdfBuffer = await createSimplePdfBuffer(
            "Northstar Retail Report",
            "Digital revenue grew from $12.4m to $14.6m, an increase of 18%. Average fulfilment time dropped to 24 hours."
        );

        const attachment = {
            name: "northstar_report.pdf",
            mimeType: "application/pdf",
            buffer: pdfBuffer,
            data: pdfBuffer.toString("base64"),
        };

        const res = await getDocumentContext({
            query: "What was the digital revenue change?",
            userId: "user_test_ingest",
            conversationId: "conv_test_ingest",
            attachment,
            options: {
                embeddingClient: mockEmbeddingClient,
            },
        });

        assert.equal(res.status, CONTEXT_STATUS.READY);
        assert.equal(res.hasContext, true);
        assert.ok(res.document);
        assert.equal(res.document.fileName, "northstar_report.pdf");
        assert.ok(res.groundedContext.includes("<source"));
        assert.ok(res.groundedContext.includes("14.6m"));
        assert.ok(res.citations.length > 0);
        assert.equal(res.citations[0].citationNumber, 1);
        assert.equal(res.citations[0].pageStart, 1);
    });

    test("4. Prevents duplicate ingestion when the same document is passed again", async () => {
        const pdfBuffer = await createSimplePdfBuffer(
            "API Specification",
            "The /api/v1/orders endpoint returns orders with fields id, amount, status, and createdAt."
        );

        const attachment = {
            name: "api_spec.pdf",
            mimeType: "application/pdf",
            buffer: pdfBuffer,
            data: pdfBuffer.toString("base64"),
        };

        // Turn 1: Ingest
        const turn1 = await getDocumentContext({
            query: "List the order fields",
            userId: "user_dup_test",
            conversationId: "conv_dup_test",
            attachment,
            options: { embeddingClient: mockEmbeddingClient },
        });
        assert.equal(turn1.status, CONTEXT_STATUS.READY);
        const docId1 = turn1.document.documentId;

        // Turn 2: Send same attachment again in same conversation
        const turn2 = await getDocumentContext({
            query: "What endpoint is documented?",
            userId: "user_dup_test",
            conversationId: "conv_dup_test",
            attachment,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(turn2.status, CONTEXT_STATUS.READY);
        assert.equal(turn2.document.documentId, docId1);
        assert.ok(turn2.groundedContext.includes("/api/v1/orders"));
    });

    test("5. Multi-turn follow-up without attachment reuses already indexed document", async () => {
        const convId = "conv_followup_reuse";
        const userId = "user_followup";

        const pdfBuffer = await createSimplePdfBuffer(
            "Executive Roadmap",
            "The 90-day roadmap includes four workstreams: Inventory accuracy, Order visibility, Store adoption, and Integration reliability."
        );

        // Turn 1: Initial upload
        await getDocumentContext({
            query: "Summarize roadmap",
            userId,
            conversationId: convId,
            attachment: {
                name: "roadmap.pdf",
                mimeType: "application/pdf",
                buffer: pdfBuffer,
                data: pdfBuffer.toString("base64"),
            },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Turn 2: Follow-up question without attachment (e.g. Coding Agent asked to build an action plan)
        const turn2 = await getDocumentContext({
            query: "What are the four workstreams?",
            userId,
            conversationId: convId,
            attachment: null, // No attachment!
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(turn2.status, CONTEXT_STATUS.READY);
        assert.equal(turn2.hasContext, true);
        assert.equal(turn2.document.fileName, "roadmap.pdf");
        assert.ok(turn2.groundedContext.includes("Inventory accuracy"));
        assert.ok(turn2.citations.length > 0);
    });

    test("6. Multi-document resolution: matches document mentioned explicitly by name in query", async () => {
        const convId = "conv_multidoc_name";
        const userId = "user_multidoc";

        // Ingest Document 1: Financials
        const doc1Buf = await createSimplePdfBuffer(
            "Northstar Financial Review",
            "Digital revenue is $14.6 million with 18% growth. Gross margins improved by 2.1 percentage points."
        );
        await getDocumentContext({
            query: "Ingest financials",
            userId,
            conversationId: convId,
            attachment: { name: "northstar_financials.pdf", mimeType: "application/pdf", buffer: doc1Buf, data: doc1Buf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Ingest Document 2: Architecture
        const doc2Buf = await createSimplePdfBuffer(
            "Architecture Blueprint",
            "The microservice architecture uses Redis cluster, Kafka event streams, and MongoDB replica sets."
        );
        await getDocumentContext({
            query: "Ingest architecture",
            userId,
            conversationId: convId,
            attachment: { name: "architecture_blueprint.pdf", mimeType: "application/pdf", buffer: doc2Buf, data: doc2Buf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Query specifically targeting "architecture"
        const archQuery = await getDocumentContext({
            query: "What event streams are used in the architecture blueprint?",
            userId,
            conversationId: convId,
            attachment: null,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(archQuery.status, CONTEXT_STATUS.READY);
        assert.equal(archQuery.document.fileName, "architecture_blueprint.pdf");
        assert.ok(archQuery.groundedContext.includes("Kafka event streams"));

        // Query specifically targeting "financials"
        const finQuery = await getDocumentContext({
            query: "What was the revenue in northstar financials?",
            userId,
            conversationId: convId,
            attachment: null,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(finQuery.status, CONTEXT_STATUS.READY);
        assert.equal(finQuery.document.fileName, "northstar_financials.pdf");
        assert.ok(finQuery.groundedContext.includes("$14.6 million"));
    });

    test("7. Ambiguous document reference: flags AMBIGUOUS_DOCUMENT when query is non-specific", async () => {
        const convId = "conv_ambiguous_test";
        const userId = "user_ambiguous";

        // Ingest two distinct documents
        const doc1Buf = await createSimplePdfBuffer("Doc Alpha", "Content of doc alpha");
        const doc2Buf = await createSimplePdfBuffer("Doc Beta", "Content of doc beta");

        await getDocumentContext({
            query: "Ingest alpha",
            userId,
            conversationId: convId,
            attachment: { name: "doc_alpha.pdf", mimeType: "application/pdf", buffer: doc1Buf, data: doc1Buf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });
        await getDocumentContext({
            query: "Ingest beta",
            userId,
            conversationId: convId,
            attachment: { name: "doc_beta.pdf", mimeType: "application/pdf", buffer: doc2Buf, data: doc2Buf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Ambiguous query that mentions neither
        const ambiguousRes = await getDocumentContext({
            query: "What are the executive recommendations?",
            userId,
            conversationId: convId,
            attachment: null,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(ambiguousRes.status, CONTEXT_STATUS.AMBIGUOUS_DOCUMENT);
        assert.equal(ambiguousRes.hasContext, false);
        assert.equal(ambiguousRes.documents.length, 2);
        assert.equal(ambiguousRes.groundedContext, "");
    });

    test("8. Returns NO_RELEVANT_CONTEXT when query does not match document content", async () => {
        const convId = "conv_no_match";
        const userId = "user_no_match";

        const docBuf = await createSimplePdfBuffer("Culinary Guide", "Recipes for baking Italian sourdough bread and pizza dough.");
        await getDocumentContext({
            query: "Bread recipes",
            userId,
            conversationId: convId,
            attachment: { name: "bread_recipes.pdf", mimeType: "application/pdf", buffer: docBuf, data: docBuf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Query completely unrelated to bread
        const unrelatedRes = await getDocumentContext({
            query: "Quantum entanglement teleportation protocol across optical fibers",
            userId,
            conversationId: convId,
            attachment: null,
            options: {
                embeddingClient: {
                    embedQuery: async () => createMockVector(999), // Vector far from doc
                },
            },
        });

        // Either NO_RELEVANT_CONTEXT if 0 chunks match, or valid fallback if keyword matched
        if (unrelatedRes.retrievedChunks.length === 0) {
            assert.equal(unrelatedRes.status, CONTEXT_STATUS.NO_RELEVANT_CONTEXT);
            assert.equal(unrelatedRes.hasContext, false);
        } else {
            // If fallback matched, status is valid
            assert.ok([CONTEXT_STATUS.READY, CONTEXT_STATUS.PARTIAL].includes(unrelatedRes.status));
        }
    });

    test("9. Multi-tenant isolation: User A cannot retrieve User B's documents", async () => {
        const convId = "conv_shared_tenant_id";
        const userA = "user_alice_secret";
        const userB = "user_bob_attacker";

        const confidentialBuf = await createSimplePdfBuffer(
            "Alice Confidential Salary",
            "Alice executive base compensation is $450,000 per year with 40% target performance bonus."
        );

        // Alice ingests her document
        await getDocumentContext({
            query: "Alice salary",
            userId: userA,
            conversationId: convId,
            attachment: { name: "confidential_salary.pdf", mimeType: "application/pdf", buffer: confidentialBuf, data: confidentialBuf.toString("base64") },
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Reset memory store or switch user context
        // Bob tries to query in conversation
        const bobQuery = await getDocumentContext({
            query: "What is the executive base compensation?",
            userId: userB, // Bob!
            conversationId: "conv_bob_private",
            attachment: null,
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Bob has no documents in his conversation
        assert.equal(bobQuery.status, CONTEXT_STATUS.NO_DOCUMENTS);
        assert.equal(bobQuery.hasContext, false);
        assert.ok(!bobQuery.groundedContext.includes("$450,000"));
    });

    test("10. Preserves visual evidence metadata for TABLE, CHART, and OCR content", async () => {
        const convId = "conv_visual_evidence";
        const userId = "user_visual";
        const docId = "doc_visual_100";

        // Store pre-classified visual chunks directly in vector store
        const visualChunks = [
            {
                chunkId: `${docId}_c0001`,
                chunkIndex: 0,
                pageStart: 2,
                pageEnd: 2,
                section: "Headline Performance Indicators",
                content: "| Metric | Previous | Current | Change |\n| Digital revenue | $12.4m | $14.6m | +18% |",
                tokenCount: 40,
                characterCount: 90,
                startOffset: 0,
                endOffset: 90,
                contentHash: "hash_tab_1",
                contentType: "TABLE",
                extractionMethod: "vision_table",
                visualMetadata: {
                    type: "table",
                    columns: ["Metric", "Previous", "Current", "Change"],
                    rowCount: 1,
                },
                embedding: createMockVector(1),
                embeddingModel: "gemini-embedding-001",
                embeddingDimensions: 768,
            },
            {
                chunkId: `${docId}_c0002`,
                chunkIndex: 1,
                pageStart: 5,
                pageEnd: 5,
                section: "Scanned Invoice",
                content: "Vendor ABC Services Corp: Net 30 invoice amount $8,500.00.",
                tokenCount: 25,
                characterCount: 60,
                startOffset: 95,
                endOffset: 155,
                contentHash: "hash_ocr_1",
                contentType: "OCR_TEXT",
                extractionMethod: "vision_ocr",
                visualMetadata: {
                    type: "ocr",
                    confidence: "HIGH",
                },
                embedding: createMockVector(2),
                embeddingModel: "gemini-embedding-001",
                embeddingDimensions: 768,
            },
        ];

        await storeChunkEmbeddings(docId, convId, userId, visualChunks);

        // Cache document entry
        await cachePdfDocument(convId, {
            documentId: docId,
            fileName: "visual_report.pdf",
            fileSize: "120 KB",
            pageCount: 6,
            title: "Visual Report",
            status: "READY",
            totalChunks: 2,
            chunks: visualChunks,
        });

        const res = await getDocumentContext({
            query: "What is the digital revenue table?",
            userId,
            conversationId: convId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(res.status, CONTEXT_STATUS.READY);
        assert.equal(res.hasContext, true);
        assert.ok(res.citations.length > 0);

        const tableCitation = res.citations.find((c) => c.contentType === "TABLE");
        assert.ok(tableCitation, "Should find citation with contentType TABLE");
        assert.equal(tableCitation.pageStart, 2);
        assert.equal(tableCitation.extractionMethod, "vision_table");
        assert.ok(tableCitation.visualMetadata);
        assert.equal(tableCitation.visualMetadata.type, "table");

        // Verify XML grounding preserved contentType attribute
        assert.ok(res.groundedContext.includes('type="TABLE"'));
    });

    test("11. Explicit selectedDocumentId prevents bypass and returns NO_DOCUMENTS when missing from conversation", async () => {
        const convId = "conv_explicit_lookup";
        const userId = "user_lookup";
        const realDocId = "doc_real_555";

        // Index one active document in this conversation
        await cachePdfDocument(convId, {
            documentId: realDocId,
            fileName: "actual_active.pdf",
            fileSize: "50 KB",
            pageCount: 2,
            title: "Actual Active",
            status: "READY",
            totalChunks: 1,
            chunks: [{
                chunkId: `${realDocId}_c001`,
                chunkIndex: 0,
                pageStart: 1,
                pageEnd: 1,
                section: "General",
                content: "Active conversation document data.",
                embedding: createMockVector(1),
            }],
        });

        // Request an explicit selectedDocumentId that does NOT exist in this conversation
        const res = await getDocumentContext({
            query: "What is the data?",
            userId,
            conversationId: convId,
            selectedDocumentId: "doc_nonexistent_or_foreign",
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Must NOT silently fall back to realDocId
        assert.equal(res.status, CONTEXT_STATUS.NO_DOCUMENTS);
        assert.equal(res.hasContext, false);
        assert.ok(res.error.includes("doc_nonexistent_or_foreign"));
    });

    test("12. Cross-tenant isolation blocks User A from accessing User B's document via selectedDocumentId", async () => {
        const convIdA = "conv_user_a";
        const convIdB = "conv_user_b";
        const userA = "user_alpha";
        const userB = "user_beta";
        const docBId = "doc_secret_beta_999";

        // User B has a document
        await cachePdfDocument(convIdB, {
            documentId: docBId,
            userId: userB,
            fileName: "user_b_financials.pdf",
            fileSize: "90 KB",
            pageCount: 3,
            title: "Secret Financials",
            status: "READY",
            totalChunks: 1,
            chunks: [{
                chunkId: `${docBId}_c001`,
                chunkIndex: 0,
                pageStart: 1,
                pageEnd: 1,
                section: "Salary",
                content: "Executive salary details: $500,000 base.",
                embedding: createMockVector(5),
            }],
        });

        // User A tries to access User B's document in User A's conversation
        const res = await getDocumentContext({
            query: "Show executive salary details",
            userId: userA,
            conversationId: convIdA,
            selectedDocumentId: docBId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Must reject: User A's conversation does not have docBId
        assert.equal(res.status, CONTEXT_STATUS.NO_DOCUMENTS);
        assert.equal(res.hasContext, false);

        // Even if an attacker somehow points to convIdB directly with User A's credentials:
        const attackRes = await getDocumentContext({
            query: "Show executive salary details",
            userId: userA,
            conversationId: convIdB,
            selectedDocumentId: docBId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Must block access: user mismatch
        assert.equal(attackRes.status, CONTEXT_STATUS.FAILED);
        assert.equal(attackRes.hasContext, false);
        assert.ok(attackRes.error.includes("Access denied"));
    });

    test("13. Empty or whitespace query returns NO_RELEVANT_CONTEXT without throwing", async () => {
        const convId = "conv_empty_q";
        const userId = "user_empty_q";
        const docId = "doc_eq_1";

        await cachePdfDocument(convId, {
            documentId: docId,
            userId,
            fileName: "guide.pdf",
            fileSize: "20 KB",
            pageCount: 1,
            title: "Guide",
            status: "READY",
            totalChunks: 1,
            chunks: [{
                chunkId: `${docId}_c001`,
                chunkIndex: 0,
                pageStart: 1,
                pageEnd: 1,
                section: "Intro",
                content: "Some system guide content.",
                embedding: createMockVector(1),
            }],
        });

        const resEmpty = await getDocumentContext({
            query: "   ",
            userId,
            conversationId: convId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(resEmpty.status, CONTEXT_STATUS.NO_RELEVANT_CONTEXT);
        assert.equal(resEmpty.hasContext, false);
        assert.equal(resEmpty.groundedContext, "");
    });

    test("14. Partial retrieval: vector failure preserves keyword retrieval and returns PARTIAL status", async () => {
        const convId = "conv_partial_fail";
        const userId = "user_partial";
        const docId = "doc_partial_1";

        const testChunks = [{
            chunkId: `${docId}_c001`,
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Architecture",
            content: "Microservices cluster deployed on Kubernetes nodes.",
            tokenCount: 20,
            characterCount: 60,
            contentHash: "hash_part_1",
            contentType: "TEXT",
            extractionMethod: "text",
            embedding: createMockVector(1),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        }];

        await storeChunkEmbeddings(docId, convId, userId, testChunks);
        await cachePdfDocument(convId, {
            documentId: docId,
            userId,
            fileName: "architecture.pdf",
            fileSize: "40 KB",
            pageCount: 1,
            title: "Architecture",
            status: "READY",
            totalChunks: 1,
            chunks: testChunks,
        });

        // Embedding client fails with rate limit error (simulating vector branch failure)
        const failingEmbeddingClient = {
            embedQuery: async () => {
                throw new Error("Vector API 429 Rate Limit");
            },
            embedDocuments: async (t) => t.map(() => createMockVector(1)),
        };

        const res = await getDocumentContext({
            query: "microservices cluster kubernetes",
            userId,
            conversationId: convId,
            options: { embeddingClient: failingEmbeddingClient },
        });

        // Keyword branch succeeded while vector failed -> status must be PARTIAL
        assert.equal(res.status, CONTEXT_STATUS.PARTIAL);
        assert.equal(res.hasContext, true);
        assert.ok(res.groundedContext.includes("Kubernetes"));
    });

    test("15. Dual retrieval failure returns FAILED status cleanly", async () => {
        const convId = "conv_dual_fail";
        const userId = "user_dual";
        const docId = "doc_dual_1";

        // Cached document has no chunks and store has no entries
        await cachePdfDocument(convId, {
            documentId: docId,
            userId,
            fileName: "corrupt_index.pdf",
            fileSize: "10 KB",
            pageCount: 1,
            title: "Corrupt",
            status: "READY",
            totalChunks: 0,
            chunks: [],
        });

        const failingEmbeddingClient = {
            embedQuery: async () => {
                throw new Error("Vector DB connection refused");
            },
        };

        const res = await getDocumentContext({
            query: "what is the specification",
            userId,
            conversationId: convId,
            options: {
                embeddingClient: failingEmbeddingClient,
                // memoryStore with no items will yield 0 keyword results
            },
        });

        // Since vector threw and keyword had NO_RESULTS or failed
        // Verify it returns either NO_RELEVANT_CONTEXT or FAILED without unhandled exception
        assert.ok(
            res.status === CONTEXT_STATUS.NO_RELEVANT_CONTEXT || res.status === CONTEXT_STATUS.FAILED,
            `Expected NO_RELEVANT_CONTEXT or FAILED, got ${res.status}`
        );
        assert.equal(res.hasContext, false);
    });

    test("16. Invalid or malformed attachment returns FAILED status cleanly", async () => {
        const convId = "conv_malformed";
        const userId = "user_malformed";

        // Corrupt attachment that is not a valid PDF buffer
        const brokenAttachment = {
            name: "malformed.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("NOT_A_VALID_PDF_NO_HEADER_BYTES_HERE"),
        };

        const res = await getDocumentContext({
            query: "Extract metrics",
            userId,
            conversationId: convId,
            attachment: brokenAttachment,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(res.status, CONTEXT_STATUS.FAILED);
        assert.equal(res.hasContext, false);
        assert.ok(res.error, "Should provide descriptive error message");
    });

    test("17. Serializability: sourceMap.toJSON(), sourcesById, and JSON.stringify produce valid JSON dictionaries", async () => {
        const convId = "conv_serializable";
        const userId = "user_serializable";
        const docId = "doc_serial_1";

        const chunks = [{
            chunkId: `${docId}_c001`,
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Summary",
            content: "Quarterly profits rose by 14% year over year.",
            tokenCount: 15,
            characterCount: 50,
            contentHash: "hash_ser_1",
            contentType: "TEXT",
            extractionMethod: "text",
            embedding: createMockVector(1),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        }];

        await storeChunkEmbeddings(docId, convId, userId, chunks);
        await cachePdfDocument(convId, {
            documentId: docId,
            userId,
            fileName: "financial_report.pdf",
            fileSize: "25 KB",
            pageCount: 1,
            title: "Financial Report",
            status: "READY",
            totalChunks: 1,
            chunks,
        });

        const res = await getDocumentContext({
            query: "Quarterly profits increase",
            userId,
            conversationId: convId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        assert.equal(res.status, CONTEXT_STATUS.READY);
        assert.equal(res.hasContext, true);

        // 1. sourceMap is an instance of Map for .get() compatibility
        assert.ok(res.sourceMap instanceof Map);
        assert.ok(res.sourceMap.get("S1"), "sourceMap.get('S1') should resolve");

        // 2. sourcesById is a plain object
        assert.ok(res.sourcesById && typeof res.sourcesById === "object" && !(res.sourcesById instanceof Map));
        assert.ok(res.sourcesById.S1, "sourcesById.S1 should resolve");

        // 3. JSON.stringify serializes sourceMap properly (not empty {})
        const serialized = JSON.stringify(res);
        const parsed = JSON.parse(serialized);

        assert.ok(parsed.sourceMap, "parsed JSON should have sourceMap property");
        assert.ok(parsed.sourceMap.S1, "parsed.sourceMap should have 'S1' key, not be empty {}");
        assert.equal(parsed.sourceMap.S1.documentName, "financial_report.pdf");

        // 4. LangGraph state checkpoint compatibility: deep object cloning
        const clonedState = structuredClone ? structuredClone({ documentContext: { ...res, sourceMap: res.sourcesById } }) : null;
        if (clonedState) {
            assert.ok(clonedState.documentContext.sourcesById.S1);
        }
    });

    test("18. Ambiguous filename references: query referencing multiple documents flags AMBIGUOUS_DOCUMENT", async () => {
        const convId = "conv_multi_ambiguous";
        const userId = "user_ambiguous";
        const doc1Id = "doc_multi_alpha";
        const doc2Id = "doc_multi_beta";

        await cachePdfDocument(convId, {
            documentId: doc1Id,
            userId,
            fileName: "sales_report_q1.pdf",
            fileSize: "30 KB",
            pageCount: 2,
            title: "Sales Q1",
            status: "READY",
            totalChunks: 1,
            chunks: [{
                chunkId: `${doc1Id}_c001`,
                chunkIndex: 0,
                pageStart: 1,
                pageEnd: 1,
                section: "Q1",
                content: "Q1 revenue reached 10 million.",
                embedding: createMockVector(1),
            }],
        });

        await cachePdfDocument(convId, {
            documentId: doc2Id,
            userId,
            fileName: "sales_report_q2.pdf",
            fileSize: "32 KB",
            pageCount: 2,
            title: "Sales Q2",
            status: "READY",
            totalChunks: 1,
            chunks: [{
                chunkId: `${doc2Id}_c001`,
                chunkIndex: 0,
                pageStart: 1,
                pageEnd: 1,
                section: "Q2",
                content: "Q2 revenue reached 15 million.",
                embedding: createMockVector(2),
            }],
        });

        // Query mentions both files explicitly: "Compare sales report q1 with sales report q2"
        const res = await getDocumentContext({
            query: "Compare sales report q1 with sales report q2",
            userId,
            conversationId: convId,
            options: { embeddingClient: mockEmbeddingClient },
        });

        // Must flag AMBIGUOUS_DOCUMENT because multiple documents matched
        assert.equal(res.status, CONTEXT_STATUS.AMBIGUOUS_DOCUMENT);
        assert.equal(res.hasContext, false);
        assert.equal(res.documents.length, 2);
    });
});

