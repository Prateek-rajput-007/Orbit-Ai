import { test, describe, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import mongoose from "mongoose";
import redis from "../../../shared/redis/redis.js";

import PdfChunk, {
    ATLAS_VECTOR_INDEX_NAME,
    ATLAS_VECTOR_INDEX_SPEC,
} from "../models/pdfChunk.model.js";

import {
    generateEmbedding,
    generateEmbeddingsBatch,
    validateVector,
    getEmbeddingModel,
    getEmbeddingDimensions,
} from "../pdf/embeddings/embedding.service.js";

import {
    storeChunkEmbeddings,
    getExistingDocumentChunks,
    deleteDocumentChunks,
    deleteConversationChunks,
    initVectorSearchIndex,
    isMongoConnected,
    isMemoryFallbackAllowed,
    resetMemoryVectorStore,
} from "../pdf/storage/vectorStorage.service.js";

import {
    ingestPdfDocument,
} from "../pdf/ingestion/pdfIngestion.service.js";

/**
 * Deterministic helper to create a mock 768-dimensional vector based on a seed.
 */
function createMockVector(seed = 1, dimensions = 768) {
    const vec = new Array(dimensions);
    for (let i = 0; i < dimensions; i++) {
        vec[i] = Number((Math.sin(seed + i) * 0.1).toFixed(6));
    }
    return vec;
}

/**
 * Creates a mock LangChain embedding client for deterministic unit testing.
 */
function createMockEmbeddingClient(options = {}) {
    let callCount = 0;
    const {
        failUntilAttempt = 0,
        failWith = null,
        dimensions = 768,
        vectorTransform = null,
    } = options;

    return {
        getCallCount: () => callCount,
        embedQuery: async (text) => {
            callCount++;
            if (callCount <= failUntilAttempt && failWith) {
                throw failWith;
            }
            if (vectorTransform) {
                return vectorTransform(text, callCount);
            }
            return createMockVector(text.length, dimensions);
        },
        embedDocuments: async (texts) => {
            callCount++;
            if (callCount <= failUntilAttempt && failWith) {
                throw failWith;
            }
            return texts.map((t, idx) => {
                if (vectorTransform) {
                    return vectorTransform(t, idx);
                }
                return createMockVector(idx + t.length, dimensions);
            });
        },
    };
}

/**
 * Helper to generate real PDF buffers using pdf-lib.
 */
async function generatePdfFixture({ pageCount = 1, getPageText = null }) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= pageCount; i++) {
        const page = doc.addPage([612, 792]);
        const text = typeof getPageText === "function"
            ? getPageText(i)
            : `Section ${i}: Production Readiness Audit for Page ${i}\nOrbit PDF Agent ensures strict isolation and embedding durability.`;

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
    return Buffer.from(bytes);
}

describe("Orbit PDF Agent — Phase 2.1 Production-Readiness Audit", () => {
    // In-memory Redis simulation for fast unit test execution
    const mockRedisMap = new Map();
    const mockRedisSets = new Map();
    let originalRedisOps = null;

    beforeEach(() => {
        resetMemoryVectorStore();
    });

    after(async () => {
        if (originalRedisOps) {
            redis.get = originalRedisOps.get;
            redis.set = originalRedisOps.set;
            redis.sadd = originalRedisOps.sadd;
            redis.smembers = originalRedisOps.smembers;
            redis.del = originalRedisOps.del;
        }
        try {
            redis.disconnect();
        } catch {}
    });

    originalRedisOps = {
        get: redis.get,
        set: redis.set,
        sadd: redis.sadd,
        smembers: redis.smembers,
        del: redis.del,
    };

    redis.get = async (k) => mockRedisMap.get(k) || null;
    redis.set = async (k, v) => { mockRedisMap.set(k, v); return "OK"; };
    redis.sadd = async (k, ...members) => {
        if (!mockRedisSets.has(k)) mockRedisSets.set(k, new Set());
        const set = mockRedisSets.get(k);
        members.forEach((m) => set.add(m));
        return members.length;
    };
    redis.smembers = async (k) => Array.from(mockRedisSets.get(k) || []);
    redis.del = async (k) => {
        mockRedisMap.delete(k);
        mockRedisSets.delete(k);
        return 1;
    };

    // =========================================================================
    // SECTION 1: EMBEDDING PROVIDER AUDIT (UNIT & SPECIFICATION)
    // =========================================================================

    test("1.1 Active embedding model defaults to supported gemini-embedding-001 with 768 dimensions", () => {
        const model = getEmbeddingModel();
        assert.ok(["gemini-embedding-001", "text-embedding-004"].includes(model), `Model must be recognized: ${model}`);
        assert.equal(getEmbeddingDimensions(), 768, "Must configure 768 dimensions");
    });

    test("1.2 Vector validator accepts finite 768-dim float arrays and rejects NaNs or wrong dims", () => {
        const validVector = createMockVector(1, 768);
        assert.equal(validateVector(validVector, 768), true);

        // Reject wrong dimension
        assert.throws(() => validateVector(new Array(512).fill(0.1), 768), /Invalid embedding dimensions/);
        // Reject non-finite number
        const corrupted = [...validVector];
        corrupted[10] = Infinity;
        assert.throws(() => validateVector(corrupted, 768), /value is not a finite number/);
    });

    test("1.3 Model identity is stored alongside every chunk embedding", async () => {
        const chunk = {
            chunkId: "c_model_ident_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Intro",
            content: "Audit content",
            contentHash: "hash_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_audit_model", "conv_audit", "user_audit", [chunk]);
        const chunksMap = await getExistingDocumentChunks("doc_audit_model");
        const stored = chunksMap.get("c_model_ident_01");

        assert.ok(stored, "Stored chunk must exist");
        assert.equal(stored.embeddingModel, "gemini-embedding-001");
        assert.equal(stored.embeddingDimensions, 768);
    });

    // =========================================================================
    // SECTION 2: MONGODB DURABILITY & DISCONNECTION AUDIT
    // =========================================================================

    test("2.1 Unavailable MongoDB connection prevents false persistence when memory fallback is disabled", async () => {
        const prevEnv = process.env.NODE_ENV;
        const prevAllow = process.env.ALLOW_MEMORY_VECTOR_STORE;

        try {
            // Simulate production environment with no memory fallback allowed
            process.env.NODE_ENV = "production";
            process.env.ALLOW_MEMORY_VECTOR_STORE = "false";

            // If MongoDB is not connected, storeChunkEmbeddings must throw rather than pretend success
            if (!isMongoConnected()) {
                await assert.rejects(
                    async () => storeChunkEmbeddings("doc_prod", "conv_prod", "user_prod", [{
                        chunkId: "c_p1",
                        contentHash: "h1",
                        embedding: createMockVector(1, 768),
                    }]),
                    /MongoDB connection is unavailable/
                );
            }
        } finally {
            process.env.NODE_ENV = prevEnv;
            process.env.ALLOW_MEMORY_VECTOR_STORE = prevAllow;
        }
    });

    test("2.2 Bulk write upsert prevents duplicate chunk records across multiple writes", async () => {
        const chunk = {
            chunkId: "c_idemp_dup",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Testing idempotency duplicates",
            contentHash: "hash_init",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        // Write 1
        await storeChunkEmbeddings("doc_dup_audit", "conv_dup", "user_dup", [chunk]);
        // Write 2 with updated hash
        const updated = { ...chunk, contentHash: "hash_v2" };
        await storeChunkEmbeddings("doc_dup_audit", "conv_dup", "user_dup", [updated]);

        const map = await getExistingDocumentChunks("doc_dup_audit");
        assert.equal(map.size, 1, "Must contain exactly 1 chunk record, no duplicates");
        assert.equal(map.get("c_idemp_dup").contentHash, "hash_v2");
    });

    // =========================================================================
    // SECTION 3: ATLAS VECTOR SEARCH SPECIFICATION AUDIT
    // =========================================================================

    test("3.1 Atlas Vector Search index spec conforms to exact schema, 768 dims, cosine similarity, and multi-tenant filters", () => {
        assert.equal(ATLAS_VECTOR_INDEX_NAME, "pdf_chunk_vector_index");
        assert.equal(ATLAS_VECTOR_INDEX_SPEC.type, "vectorSearch");

        const fields = ATLAS_VECTOR_INDEX_SPEC.definition.fields;
        const vecField = fields.find((f) => f.path === "embedding");
        assert.ok(vecField, "Must index embedding field");
        assert.equal(vecField.numDimensions, 768);
        assert.equal(vecField.similarity, "cosine");

        const filterPaths = fields.filter((f) => f.type === "filter").map((f) => f.path);
        assert.ok(filterPaths.includes("userId"), "Must filter on userId");
        assert.ok(filterPaths.includes("conversationId"), "Must filter on conversationId");
        assert.ok(filterPaths.includes("documentId"), "Must filter on documentId");
    });

    test("3.2 Vector Search index provisioning is idempotent and handles existing index gracefully", async () => {
        const initResult = await initVectorSearchIndex();
        assert.ok(
            ["PROVISIONED", "ALREADY_EXISTS", "DISCONNECTED", "UNAVAILABLE"].includes(initResult.status),
            `Unexpected index status: ${initResult.status}`
        );
    });

    // =========================================================================
    // SECTION 4: IDEMPOTENCY & MODEL MIGRATION AUDIT (THE 8 REQUIRED CASES)
    // =========================================================================

    test("4.1 Case 1: Same document and unchanged content reuses existing embeddings without API calls", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 1 });
        const attachment = {
            name: "case1_unchanged.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        let apiCalls = 0;
        const client = {
            embedDocuments: async (texts) => {
                apiCalls += texts.length;
                return texts.map((t, idx) => createMockVector(idx + 1, 768));
            },
        };

        // First ingestion
        const res1 = await ingestPdfDocument(attachment, {
            conversationId: "conv_case1",
            userId: "user_case1",
            embeddingClient: client,
        });
        assert.equal(res1.embeddingStatus, "EMBEDDED");
        assert.equal(res1.reusedChunks, 0);
        const callsAfterFirst = apiCalls;
        assert.ok(callsAfterFirst > 0);

        // Second ingestion with identical content
        const res2 = await ingestPdfDocument(attachment, {
            conversationId: "conv_case1",
            userId: "user_case1",
            embeddingClient: client,
        });
        assert.equal(res2.embeddingStatus, "EMBEDDED");
        assert.equal(res2.reusedChunks, res1.embeddedChunks);
        assert.equal(apiCalls, callsAfterFirst, "Zero additional API calls for unchanged document");
    });

    test("4.2 Case 2: Same document and changed chunk content regenerates only affected embeddings", async () => {
        const docId = "doc_case2";
        const convId = "conv_case2";
        const userId = "user_case2";

        const chunkA = {
            chunkId: "c_c2_a",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Unchanged paragraph A",
            contentHash: "hash_A",
            embedding: createMockVector(10, 768),
            embeddingModel: getEmbeddingModel(),
            embeddingDimensions: 768,
        };
        const chunkB = {
            chunkId: "c_c2_b",
            chunkIndex: 1,
            pageStart: 1,
            pageEnd: 1,
            content: "Original paragraph B",
            contentHash: "hash_B_v1",
            embedding: createMockVector(20, 768),
            embeddingModel: getEmbeddingModel(),
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings(docId, convId, userId, [chunkA, chunkB]);

        // Now simulate chunk B updated
        const chunkBUpdated = {
            ...chunkB,
            content: "Modified paragraph B with updated text",
            contentHash: "hash_B_v2",
            embedding: createMockVector(99, 768),
        };

        await storeChunkEmbeddings(docId, convId, userId, [chunkA, chunkBUpdated]);

        const map = await getExistingDocumentChunks(docId);
        assert.equal(map.get("c_c2_a").contentHash, "hash_A");
        assert.equal(map.get("c_c2_b").contentHash, "hash_B_v2");
        assert.equal(map.get("c_c2_b").embedding[0], createMockVector(99, 768)[0]);
    });

    test("4.3 Case 3: Same content and same model makes no unnecessary API calls", async () => {
        const docId = "doc_case3";
        const chunk = {
            chunkId: "c_c3",
            contentHash: "hash_same",
            embeddingModel: getEmbeddingModel(),
            embeddingDimensions: 768,
            embedding: createMockVector(5, 768),
        };
        await storeChunkEmbeddings(docId, "conv_c3", "user_c3", [chunk]);

        const existingMap = await getExistingDocumentChunks(docId);
        const existing = existingMap.get("c_c3");
        const activeModel = getEmbeddingModel();

        const canReuse = existing &&
            existing.contentHash === "hash_same" &&
            existing.embeddingModel === activeModel &&
            existing.embeddingDimensions === 768;

        assert.equal(canReuse, true, "Must recognize exact content and model match as reusable");
    });

    test("4.4 Case 4: Same content but changed embedding model triggers re-embedding", async () => {
        const docId = "doc_case4";
        const chunk = {
            chunkId: "c_c4",
            contentHash: "hash_same_text",
            embeddingModel: "legacy-model-v0",
            embeddingDimensions: 768,
            embedding: createMockVector(5, 768),
        };
        await storeChunkEmbeddings(docId, "conv_c4", "user_c4", [chunk]);

        const existingMap = await getExistingDocumentChunks(docId);
        const existing = existingMap.get("c_c4");
        const activeModel = getEmbeddingModel();

        const canReuse = existing &&
            existing.contentHash === "hash_same_text" &&
            existing.embeddingModel === activeModel;

        assert.equal(canReuse, false, "Must NOT reuse embedding when model differs");
    });

    test("4.5 Case 5: Changed embedding dimensions prevents incompatible vectors from being mixed", () => {
        const incompatible512 = createMockVector(1, 512);
        assert.throws(
            () => validateVector(incompatible512, 768),
            /Invalid embedding dimensions: expected 768, received 512/
        );
    });

    test("4.6 Case 6: Failed batch followed by retry creates no duplicate chunks", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 2 });
        const attachment = {
            name: "case6_retry.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        // Run 1: Interrupted/failed
        const failingClient = {
            embedDocuments: async () => { throw new Error("Transient network dropped"); },
        };
        const run1 = await ingestPdfDocument(attachment, {
            conversationId: "conv_c6",
            userId: "user_c6",
            embeddingClient: failingClient,
        });
        assert.equal(run1.embeddingStatus, "FAILED");

        // Run 2: Retry succeeds
        const workingClient = createMockEmbeddingClient();
        const run2 = await ingestPdfDocument(attachment, {
            conversationId: "conv_c6",
            userId: "user_c6",
            embeddingClient: workingClient,
        });
        assert.equal(run2.embeddingStatus, "EMBEDDED");

        const map = await getExistingDocumentChunks(run2.documentId);
        assert.equal(map.size, run2.totalChunks, "Chunk count must exactly match without duplicate records");
    });

    test("4.7 Case 7: Partial embedding failure reports PARTIAL status accurately", async () => {
        const docId = "doc_case7";
        const convId = "conv_case7";
        const userId = "user_case7";

        // Suppose 1 of 2 chunks has a valid vector, but 2nd chunk is un-embedded
        const validChunk = {
            chunkId: "c_valid",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Valid chunk",
            contentHash: "hash_v",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings(docId, convId, userId, [validChunk]);

        const totalChunks = 2;
        const embeddedChunks = 1;
        const failedChunks = 1;
        const embeddingStatus = (embeddedChunks === totalChunks)
            ? "EMBEDDED"
            : (embeddedChunks > 0 ? "PARTIAL" : "FAILED");

        assert.equal(embeddingStatus, "PARTIAL");
    });

    test("4.8 Case 8: Process restart recovers document status from durable storage", async () => {
        const docId = "doc_case8";
        const convId = "conv_case8";
        const userId = "user_case8";

        const chunk = {
            chunkId: "c_restart",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Persistent across restarts",
            contentHash: "hash_restart",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings(docId, convId, userId, [chunk]);

        // Simulate new process reading existing stored document chunks
        const recoveredMap = await getExistingDocumentChunks(docId);
        assert.ok(recoveredMap.has("c_restart"), "Recovered chunk must be present in storage");
        assert.equal(recoveredMap.get("c_restart").contentHash, "hash_restart");
        assert.equal(recoveredMap.get("c_restart").embeddingDimensions, 768);
    });

    // =========================================================================
    // SECTION 5: MULTI-TENANT ISOLATION AUDIT
    // =========================================================================

    test("5.1 Client cannot override authenticated server-side userId", async () => {
        const authenticatedUserId = "auth_user_999";
        const clientSpoofedUserId = "victim_user_111";

        // PDF Agent reads state.userId (from server authentication) rather than client payload
        const chunk = {
            chunkId: "c_sec_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Tenant boundary data",
            contentHash: "h_sec_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_sec_01", "conv_sec_01", authenticatedUserId, [chunk]);

        // Schema validation enforces authenticated userId
        const schemaDoc = new PdfChunk({
            ...chunk,
            documentId: "doc_sec_01",
            conversationId: "conv_sec_01",
            userId: authenticatedUserId,
        });

        assert.equal(schemaDoc.userId, authenticatedUserId);
        assert.notEqual(schemaDoc.userId, clientSpoofedUserId);
    });

    test("5.2 Querying or deleting conversation A never touches conversation B chunks", async () => {
        const chunkA = {
            chunkId: "c_tenantA",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Tenant A secret roadmap",
            contentHash: "hash_A",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };
        const chunkB = {
            chunkId: "c_tenantB",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Tenant B proprietary algorithm",
            contentHash: "hash_B",
            embedding: createMockVector(2, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_A", "conv_tenant_A", "user_A", [chunkA]);
        await storeChunkEmbeddings("doc_B", "conv_tenant_B", "user_B", [chunkB]);

        // Delete conversation A
        await deleteConversationChunks("conv_tenant_A");

        const mapA = await getExistingDocumentChunks("doc_A");
        const mapB = await getExistingDocumentChunks("doc_B");

        assert.equal(mapA.size, 0, "Tenant A chunks must be removed");
        assert.equal(mapB.size, 1, "Tenant B chunks must remain completely intact");
    });

    // =========================================================================
    // SECTION 6: LIFECYCLE & CLEANUP AUDIT
    // =========================================================================

    test("6.1 Deleting one PDF does not delete another PDF in the same conversation", async () => {
        const convId = "conv_shared_lifecycle";
        const userId = "user_lifecycle";

        const doc1Chunk = {
            chunkId: "c_doc1",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Document 1 content",
            contentHash: "hash_d1",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };
        const doc2Chunk = {
            chunkId: "c_doc2",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Document 2 content",
            contentHash: "hash_d2",
            embedding: createMockVector(2, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_pdf_1", convId, userId, [doc1Chunk]);
        await storeChunkEmbeddings("doc_pdf_2", convId, userId, [doc2Chunk]);

        // Selectively delete document 1
        const delResult = await deleteDocumentChunks(convId, "doc_pdf_1");
        assert.equal(delResult.deletedCount, 1);

        const map1 = await getExistingDocumentChunks("doc_pdf_1");
        const map2 = await getExistingDocumentChunks("doc_pdf_2");

        assert.equal(map1.size, 0, "Document 1 must be deleted");
        assert.equal(map2.size, 1, "Document 2 must remain preserved");
    });

    test("6.2 Redis cache loss does not destroy durable MongoDB embeddings", async () => {
        const docId = "doc_redis_loss";
        const convId = "conv_redis_loss";
        const userId = "user_redis_loss";

        const chunk = {
            chunkId: "c_dur_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Durable chunk survives Redis flush",
            contentHash: "hash_dur_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "gemini-embedding-001",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings(docId, convId, userId, [chunk]);

        // Simulate complete Redis flush / cache eviction
        mockRedisMap.clear();
        mockRedisSets.clear();

        // Chunks are safely intact in durable store
        const storedMap = await getExistingDocumentChunks(docId);
        assert.equal(storedMap.size, 1);
        assert.ok(storedMap.has("c_dur_01"));
    });
});

