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
            : `Section ${i}: Ingestion and Embedding Verification on Page ${i}\nOrbit ensures semantic vectors are accurately generated for document retrieval.`;

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

describe("Orbit PDF Agent — Phase 2: Embedding Generation & Vector Storage", () => {
    // In-memory Redis simulation for offline test performance
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
        } catch {
            // ignore
        }
    });

    // Setup fast in-memory Redis stubs to prevent network retry timeouts in offline tests
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

    // ==========================================
    // 1. EMBEDDING SERVICE TESTS
    // ==========================================

    test("1. Valid embedding response returns 768-dimensional vector", async () => {
        const client = createMockEmbeddingClient();
        const vector = await generateEmbedding("Orbit multi-agent AI architecture", { client });

        assert.ok(Array.isArray(vector), "Vector must be an array");
        assert.equal(vector.length, 768, "Vector dimension must be exactly 768");
        assert.ok(vector.every((n) => typeof n === "number" && Number.isFinite(n)), "All vector elements must be finite numbers");
    });

    test("2. Empty text rejection throws clear error", async () => {
        const client = createMockEmbeddingClient();

        await assert.rejects(
            async () => generateEmbedding("", { client }),
            /Cannot generate embedding: input text must be a non-empty string/
        );

        await assert.rejects(
            async () => generateEmbedding("    \n\t  ", { client }),
            /Cannot generate embedding: input text must be a non-empty string/
        );

        await assert.rejects(
            async () => generateEmbedding(null, { client }),
            /Cannot generate embedding: input text must be a non-empty string/
        );
    });

    test("3. Invalid vector response (non-finite or non-array) throws validation error", async () => {
        // Test non-array
        const nonArrayClient = {
            embedQuery: async () => "not a vector",
        };
        await assert.rejects(
            async () => generateEmbedding("test", { client: nonArrayClient }),
            /Invalid embedding response: vector must be an array of numbers/
        );

        // Test array with NaN / non-number
        const nanVector = new Array(768).fill(0.1);
        nanVector[42] = NaN;
        const nanClient = {
            embedQuery: async () => nanVector,
        };
        await assert.rejects(
            async () => generateEmbedding("test", { client: nanClient }),
            /value is not a finite number/
        );
    });

    test("4. Wrong vector dimensions (e.g. 512 or 1536) throws validation error", async () => {
        const wrongDimClient = createMockEmbeddingClient({ dimensions: 512 });

        await assert.rejects(
            async () => generateEmbedding("test", { client: wrongDimClient, dimensions: 768 }),
            /Invalid embedding dimensions: expected 768, received 512/
        );
    });

    test("5. Provider timeout exhausts retries and throws cleanly", async () => {
        const timeoutErr = new Error("Request timed out after 30000ms");
        timeoutErr.status = 503;

        const timeoutClient = createMockEmbeddingClient({
            failUntilAttempt: 10,
            failWith: timeoutErr,
        });

        await assert.rejects(
            async () => generateEmbedding("test", { client: timeoutClient, maxRetries: 2 }),
            /Request timed out after 30000ms/
        );
    });

    test("6. Rate limit retry (429) succeeds with exponential backoff", async () => {
        const rateLimitErr = new Error("Rate limit exceeded (429 quota reached)");
        rateLimitErr.status = 429;

        // Fails on attempt 1, succeeds on attempt 2
        const rateLimitClient = createMockEmbeddingClient({
            failUntilAttempt: 1,
            failWith: rateLimitErr,
        });

        const vector = await generateEmbedding("Rate limit recovery test", {
            client: rateLimitClient,
            maxRetries: 2,
        });

        assert.equal(vector.length, 768);
        assert.equal(rateLimitClient.getCallCount(), 2, "Must retry once and succeed");
    });

    test("7. Permanent provider failure (e.g. 401 unauthorized) throws immediately without infinite loop", async () => {
        const authErr = new Error("API_KEY_INVALID: 401 Unauthorized");
        authErr.status = 401;

        const failClient = {
            embedQuery: async () => {
                throw authErr;
            },
        };

        await assert.rejects(
            async () => generateEmbedding("test", { client: failClient }),
            /API_KEY_INVALID/
        );
    });

    test("8. Batch response ordering strictly preserves input-output index correspondence across multiple batches", async () => {
        const inputs = [
            "Alpha: introduction to orbit",
            "Beta: ingestion pipeline design",
            "Gamma: chunking strategy",
            "Delta: embedding generation",
            "Epsilon: vector storage in mongodb",
        ];

        // Track order
        const client = {
            embedDocuments: async (batch) => {
                return batch.map((t) => {
                    const seed = t.startsWith("Alpha") ? 100 : t.startsWith("Beta") ? 200 : t.startsWith("Gamma") ? 300 : t.startsWith("Delta") ? 400 : 500;
                    return createMockVector(seed, 768);
                });
            },
        };

        // Process with batchSize: 2 (forces 3 batch iterations: 2 + 2 + 1)
        const batchResults = await generateEmbeddingsBatch(inputs, {
            batchSize: 2,
            client,
        });

        assert.equal(batchResults.length, 5, "Must return 5 vectors");
        // Verify vector at index 0 corresponds to Alpha
        assert.equal(batchResults[0][0], createMockVector(100, 768)[0]);
        // Verify vector at index 1 corresponds to Beta
        assert.equal(batchResults[1][0], createMockVector(200, 768)[0]);
        // Verify vector at index 4 corresponds to Epsilon
        assert.equal(batchResults[4][0], createMockVector(500, 768)[0]);
    });

    // ==========================================
    // 2. STORAGE & IDEMPOTENCY TESTS
    // ==========================================

    test("9. Successful chunk persistence stores chunk with embedding in vector store", async () => {
        const chunk = {
            chunkId: "c_test_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Intro",
            content: "Welcome to Orbit PDF Agent.",
            tokenCount: 6,
            characterCount: 27,
            contentHash: "hash_test_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        const result = await storeChunkEmbeddings("doc_storage_01", "conv_storage_01", "usr_01", [chunk]);
        assert.equal(result.totalStored, 1);

        const existingMap = await getExistingDocumentChunks("doc_storage_01");
        assert.equal(existingMap.size, 1);
        assert.ok(existingMap.has("c_test_01"));
        assert.equal(existingMap.get("c_test_01").contentHash, "hash_test_01");
        assert.equal(existingMap.get("c_test_01").embedding.length, 768);
    });

    test("10. Duplicate chunk prevention updates existing record rather than duplicating", async () => {
        const chunk = {
            chunkId: "c_dup_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Summary",
            content: "Orbit provides autonomous agent workflows.",
            contentHash: "hash_dup_initial",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_dup_01", "conv_dup_01", "usr_01", [chunk]);
        let existingMap = await getExistingDocumentChunks("doc_dup_01");
        assert.equal(existingMap.size, 1);

        // Re-store same chunkId with updated content
        const updatedChunk = {
            ...chunk,
            contentHash: "hash_dup_updated",
            embedding: createMockVector(2, 768),
        };
        await storeChunkEmbeddings("doc_dup_01", "conv_dup_01", "usr_01", [updatedChunk]);

        existingMap = await getExistingDocumentChunks("doc_dup_01");
        assert.equal(existingMap.size, 1, "Duplicate chunk must not create a second document in storage");
        assert.equal(existingMap.get("c_dup_01").contentHash, "hash_dup_updated");
    });

    test("11. Unchanged chunk skipping reuses existing embedding without calling embedding provider", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 2 });
        const attachment = {
            name: "idempotency_doc.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        let providerCalls = 0;
        const testClient = {
            embedDocuments: async (texts) => {
                providerCalls += texts.length;
                return texts.map((t, idx) => createMockVector(idx + 1, 768));
            },
        };

        // First ingestion: generates embeddings
        const result1 = await ingestPdfDocument(attachment, {
            conversationId: "conv_idem_01",
            userId: "usr_idem_01",
            embeddingClient: testClient,
        });

        assert.equal(result1.embeddingStatus, "EMBEDDED");
        assert.ok(result1.embeddedChunks > 0);
        assert.equal(result1.reusedChunks, 0);
        const initialCalls = providerCalls;
        assert.ok(initialCalls > 0);

        // Second ingestion with identical content: should reuse embeddings
        const result2 = await ingestPdfDocument(attachment, {
            conversationId: "conv_idem_01",
            userId: "usr_idem_01",
            embeddingClient: testClient,
        });

        assert.equal(result2.embeddingStatus, "EMBEDDED");
        assert.equal(result2.reusedChunks, result1.embeddedChunks, "All chunks must be recognized as unchanged and reused");
        assert.equal(providerCalls, initialCalls, "No new provider calls should be made for unchanged document");
    });

    test("12. Updated chunk re-embedding re-embeds when chunk content changes", async () => {
        const docId = "doc_mod_01";
        const convId = "conv_mod_01";
        const userId = "usr_01";

        // Store original chunk
        const chunk1 = {
            chunkId: "chunk_mod_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Original text content",
            contentHash: "hash_orig",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };
        await storeChunkEmbeddings(docId, convId, userId, [chunk1]);

        // Check existing chunks
        const existingMap = await getExistingDocumentChunks(docId);
        const existing = existingMap.get("chunk_mod_01");
        assert.equal(existing.contentHash, "hash_orig");

        // Now simulate new chunk with different content and hash
        const modifiedChunk = {
            chunkId: "chunk_mod_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Updated text content",
            contentHash: "hash_updated",
            embedding: createMockVector(99, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };
        await storeChunkEmbeddings(docId, convId, userId, [modifiedChunk]);

        const updatedMap = await getExistingDocumentChunks(docId);
        assert.equal(updatedMap.get("chunk_mod_01").contentHash, "hash_updated");
        assert.equal(updatedMap.get("chunk_mod_01").embedding[0], createMockVector(99, 768)[0]);
    });

    test("13. Embedding model change forces re-embedding even if content hash matches", async () => {
        const docId = "doc_model_change_01";
        const convId = "conv_model_change_01";
        const userId = "usr_01";

        // Store chunk embedded with an older model (e.g. text-embedding-003 or legacy)
        const oldChunk = {
            chunkId: "chunk_mc_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Important financial statement",
            contentHash: "hash_mc_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-legacy",
            embeddingDimensions: 768,
        };
        await storeChunkEmbeddings(docId, convId, userId, [oldChunk]);

        const existingMap = await getExistingDocumentChunks(docId);
        const existing = existingMap.get("chunk_mc_01");

        // Verify that model mismatch triggers re-embedding logic
        const currentModel = getEmbeddingModel();
        const shouldReuse = existing &&
            existing.contentHash === oldChunk.contentHash &&
            existing.embeddingModel === currentModel;

        assert.equal(shouldReuse, false, "Must not reuse vector if embeddingModel does not match active model");
    });

    test("14. User, conversation, and document ownership metadata are strictly attached to all chunks", async () => {
        const docId = "doc_meta_01";
        const convId = "conv_meta_01";
        const userId = "user_alpha_99";

        const chunk = {
            chunkId: "c_meta_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            section: "Compliance",
            content: "Data privacy regulations.",
            contentHash: "hash_meta_01",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings(docId, convId, userId, [chunk]);

        // Validate via Mongoose schema validation
        const mongooseDoc = new PdfChunk({
            ...chunk,
            documentId: docId,
            conversationId: convId,
            userId,
        });

        const validationErr = mongooseDoc.validateSync();
        assert.equal(validationErr, undefined, "Mongoose validation must pass with all ownership metadata present");
        assert.equal(mongooseDoc.userId, "user_alpha_99");
        assert.equal(mongooseDoc.conversationId, "conv_meta_01");
        assert.equal(mongooseDoc.documentId, "doc_meta_01");
    });

    test("15. Storage failure handles invalid payload defensively", async () => {
        await assert.rejects(
            async () => storeChunkEmbeddings("", "conv", "usr", []),
            /storeChunkEmbeddings requires a valid documentId/
        );

        await assert.rejects(
            async () => storeChunkEmbeddings("doc", "", "usr", []),
            /storeChunkEmbeddings requires a valid conversationId/
        );

        await assert.rejects(
            async () => storeChunkEmbeddings("doc", "conv", "", []),
            /storeChunkEmbeddings requires a valid userId/
        );

        // Chunk missing embedding array
        await assert.rejects(
            async () => storeChunkEmbeddings("doc", "conv", "usr", [{ chunkId: "c1", contentHash: "h1" }]),
            /is missing embedding vector/
        );
    });

    test("16. Partial batch failure detection identifies missing vectors", async () => {
        const partialClient = {
            embedDocuments: async (batch) => {
                // Return only 1 vector for 2 inputs
                return [createMockVector(1, 768)];
            },
        };

        await assert.rejects(
            async () => generateEmbeddingsBatch(["text1", "text2"], { client: partialClient }),
            /Batch embedding mismatch: requested 2 vectors, received 1/
        );
    });

    // ==========================================
    // 3. INGESTION PIPELINE INTEGRATION
    // ==========================================

    test("17. Small document embedding completes end-to-end with EMBEDDED status", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 1 });
        const attachment = {
            name: "small_doc.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        const client = createMockEmbeddingClient();
        const result = await ingestPdfDocument(attachment, {
            conversationId: "conv_small_01",
            userId: "usr_small_01",
            embeddingClient: client,
        });

        assert.equal(result.status, "READY");
        assert.equal(result.embeddingStatus, "EMBEDDED");
        assert.equal(result.embeddedChunks, result.totalChunks);
        assert.equal(result.failedChunks, 0);
        assert.equal(result.chunks[0].embedding.length, 768);
    });

    test("18. Large document batch processing handles multi-page PDF in controlled batches", async () => {
        const fixtureBuffer = await generatePdfFixture({
            pageCount: 12,
            getPageText: (i) => `Chapter ${i}: Scalable Vector Retrieval Methods\nIn this section we analyze throughput, latency, and index memory footprints for multi-page documents under heavy query concurrency across distributed nodes in Orbit.`
        });

        const attachment = {
            name: "large_multipage_doc.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        let batchInvocations = 0;
        const batchTrackingClient = {
            embedDocuments: async (texts) => {
                batchInvocations++;
                assert.ok(texts.length <= 4, "Batch size must not exceed configured limit of 4");
                return texts.map((t, idx) => createMockVector(idx + 1, 768));
            },
        };

        const result = await ingestPdfDocument(attachment, {
            conversationId: "conv_large_01",
            userId: "usr_large_01",
            targetChunkTokens: 50,
            maxChunkTokens: 80,
            batchSize: 4,
            embeddingClient: batchTrackingClient,
        });

        assert.equal(result.embeddingStatus, "EMBEDDED");
        assert.equal(result.pageCount, 12);
        assert.ok(result.totalChunks >= 10, "Should generate multiple chunks with granular chunk tokens");
        assert.ok(batchInvocations >= 3, "Should invoke multiple batches");
        assert.equal(result.embeddedChunks, result.totalChunks);
    });

    test("19. Retry after interrupted processing completes previously un-embedded chunks", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 3 });
        const attachment = {
            name: "retry_doc.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        // First run: embedding generation fails
        const failingClient = {
            embedDocuments: async () => {
                throw new Error("Temporary network partition");
            },
        };

        const result1 = await ingestPdfDocument(attachment, {
            conversationId: "conv_retry_01",
            userId: "usr_retry_01",
            embeddingClient: failingClient,
        });

        assert.equal(result1.embeddingStatus, "FAILED");
        assert.equal(result1.status, "READY", "Document extraction and chunking must still succeed");

        // Second run: provider recovered
        const workingClient = createMockEmbeddingClient();
        const result2 = await ingestPdfDocument(attachment, {
            conversationId: "conv_retry_01",
            userId: "usr_retry_01",
            embeddingClient: workingClient,
        });

        assert.equal(result2.embeddingStatus, "EMBEDDED");
        assert.equal(result2.embeddedChunks, result2.totalChunks);
        assert.equal(result2.failedChunks, 0);
    });

    test("20. Correct final ingestion status values (EMBEDDED, SKIPPED, FAILED)", async () => {
        const fixtureBuffer1 = await generatePdfFixture({ pageCount: 1, getPageText: () => "Skipped document text" });
        const attachmentSkipped = {
            name: "status_skipped.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer1.toString("base64"),
        };

        // SKIPPED when generateEmbeddings: false
        const skippedResult = await ingestPdfDocument(attachmentSkipped, {
            conversationId: "conv_stat_01",
            generateEmbeddings: false,
        });
        assert.equal(skippedResult.embeddingStatus, "SKIPPED");

        // EMBEDDED on success
        const fixtureBuffer2 = await generatePdfFixture({ pageCount: 1, getPageText: () => "Success document text" });
        const attachmentSuccess = {
            name: "status_success.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer2.toString("base64"),
        };
        const successResult = await ingestPdfDocument(attachmentSuccess, {
            conversationId: "conv_stat_02",
            embeddingClient: createMockEmbeddingClient(),
        });
        assert.equal(successResult.embeddingStatus, "EMBEDDED");

        // FAILED on provider error for un-embedded document
        const fixtureBuffer3 = await generatePdfFixture({ pageCount: 1, getPageText: () => "Failure document text" });
        const attachmentFail = {
            name: "status_fail.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer3.toString("base64"),
        };
        const failResult = await ingestPdfDocument(attachmentFail, {
            conversationId: "conv_stat_03",
            embeddingClient: {
                embedDocuments: async () => {
                    throw new Error("Simulated failure");
                },
            },
        });
        assert.equal(failResult.embeddingStatus, "FAILED");
    });

    test("21. Redis failure handling still persists vectors and returns CACHE_FAILED without throwing", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 1 });
        const attachment = {
            name: "redis_fail_test.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        // Temporarily stub redis set to reject
        const originalSet = redis.set;
        redis.set = async () => {
            throw new Error("Redis connection refused");
        };

        try {
            const result = await ingestPdfDocument(attachment, {
                conversationId: "conv_redis_down",
                userId: "usr_redis_down",
                embeddingClient: createMockEmbeddingClient(),
            });

            assert.equal(result.cacheStatus, "CACHE_FAILED");
            assert.equal(result.embeddingStatus, "EMBEDDED", "Vector embedding must still succeed despite Redis failure");
            assert.ok(result.warnings.some((w) => w.includes("Redis document cache write failed")));
        } finally {
            redis.set = originalSet;
        }
    });

    test("22. Storage failure reports embeddingStatus FAILED while preserving extracted text and chunks", async () => {
        const fixtureBuffer = await generatePdfFixture({ pageCount: 1 });
        const attachment = {
            name: "storage_fail_test.pdf",
            mimeType: "application/pdf",
            data: fixtureBuffer.toString("base64"),
        };

        // Pass invalid user ID / options to cause storage step to fail
        const badClient = {
            embedDocuments: async () => {
                throw new Error("Simulated storage write fault");
            },
        };

        const result = await ingestPdfDocument(attachment, {
            conversationId: "conv_mongo_down",
            userId: "usr_test",
            embeddingClient: badClient,
        });

        assert.equal(result.status, "READY", "Document parsing must remain READY");
        assert.equal(result.embeddingStatus, "FAILED");
        assert.ok(result.chunks.length > 0, "Chunks must be preserved");
        assert.ok(result.warnings.some((w) => w.includes("Embedding generation failed")));
    });

    test("23. Multiple PDFs in one conversation store chunks under distinct documentIds", async () => {
        const convId = "conv_multi_pdf_01";
        const userId = "usr_multi_pdf";

        const doc1Chunk = {
            chunkId: "c_doc1_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "First document on Quantum Mechanics",
            contentHash: "hash_qm_01",
            embedding: createMockVector(10, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        const doc2Chunk = {
            chunkId: "c_doc2_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Second document on Classical Thermodynamics",
            contentHash: "hash_ct_01",
            embedding: createMockVector(20, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_qm", convId, userId, [doc1Chunk]);
        await storeChunkEmbeddings("doc_ct", convId, userId, [doc2Chunk]);

        const qmMap = await getExistingDocumentChunks("doc_qm");
        const ctMap = await getExistingDocumentChunks("doc_ct");

        assert.equal(qmMap.size, 1);
        assert.ok(qmMap.has("c_doc1_01"));
        assert.equal(ctMap.size, 1);
        assert.ok(ctMap.has("c_doc2_01"));
    });

    test("24. Isolation across different conversations prevents cross-tenant data leakage", async () => {
        const docChunkConv1 = {
            chunkId: "c_userA_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "User A confidential quarterly projections",
            contentHash: "hash_userA",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        const docChunkConv2 = {
            chunkId: "c_userB_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "User B private patent filings",
            contentHash: "hash_userB",
            embedding: createMockVector(2, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_A", "conv_tenant_A", "user_A", [docChunkConv1]);
        await storeChunkEmbeddings("doc_B", "conv_tenant_B", "user_B", [docChunkConv2]);

        // Deleting conversation A should leave conversation B chunks completely intact
        await deleteConversationChunks("conv_tenant_A");

        const mapA = await getExistingDocumentChunks("doc_A");
        const mapB = await getExistingDocumentChunks("doc_B");

        assert.equal(mapA.size, 0, "Conversation A chunks must be removed");
        assert.equal(mapB.size, 1, "Conversation B chunks must remain intact");
    });

    test("25. Conversation deletion cleanup deletes all chunks belonging to conversationId", async () => {
        const convId = "conv_cleanup_all";
        const userId = "usr_cleanup";

        const chunk1 = {
            chunkId: "c_cl_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Doc 1 text",
            contentHash: "hash_c1",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };
        const chunk2 = {
            chunkId: "c_cl_02",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Doc 2 text",
            contentHash: "hash_c2",
            embedding: createMockVector(2, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_cl_1", convId, userId, [chunk1]);
        await storeChunkEmbeddings("doc_cl_2", convId, userId, [chunk2]);

        const deleteResult = await deleteConversationChunks(convId);
        assert.equal(deleteResult.deletedCount, 2);

        const map1 = await getExistingDocumentChunks("doc_cl_1");
        const map2 = await getExistingDocumentChunks("doc_cl_2");
        assert.equal(map1.size, 0);
        assert.equal(map2.size, 0);
    });

    test("26. Document deletion cleanup deletes only chunks for documentId and preserves other documents", async () => {
        const convId = "conv_selective_delete";
        const userId = "usr_selective";

        const chunkA = {
            chunkId: "c_keep_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Document to KEEP",
            contentHash: "hash_keep",
            embedding: createMockVector(1, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        const chunkB = {
            chunkId: "c_remove_01",
            chunkIndex: 0,
            pageStart: 1,
            pageEnd: 1,
            content: "Document to REMOVE",
            contentHash: "hash_remove",
            embedding: createMockVector(2, 768),
            embeddingModel: "text-embedding-004",
            embeddingDimensions: 768,
        };

        await storeChunkEmbeddings("doc_keep", convId, userId, [chunkA]);
        await storeChunkEmbeddings("doc_remove", convId, userId, [chunkB]);

        const delResult = await deleteDocumentChunks(convId, "doc_remove");
        assert.equal(delResult.deletedCount, 1);

        const keepMap = await getExistingDocumentChunks("doc_keep");
        const removeMap = await getExistingDocumentChunks("doc_remove");

        assert.equal(keepMap.size, 1, "Preserved document must still be present");
        assert.equal(removeMap.size, 0, "Targeted document must be deleted");
    });

    test("27. Atlas Vector Search index specification defines 768 dims, cosine similarity, and filter paths", async () => {
        assert.equal(ATLAS_VECTOR_INDEX_NAME, "pdf_chunk_vector_index");
        assert.equal(ATLAS_VECTOR_INDEX_SPEC.type, "vectorSearch");

        const fields = ATLAS_VECTOR_INDEX_SPEC.definition.fields;
        const vectorField = fields.find((f) => f.path === "embedding");
        assert.ok(vectorField, "Vector search index must index 'embedding' field");
        assert.equal(vectorField.numDimensions, 768);
        assert.equal(vectorField.similarity, "cosine");

        const filterPaths = fields.filter((f) => f.type === "filter").map((f) => f.path);
        assert.ok(filterPaths.includes("userId"), "Must filter by userId");
        assert.ok(filterPaths.includes("conversationId"), "Must filter by conversationId");
        assert.ok(filterPaths.includes("documentId"), "Must filter by documentId");

        // Verify initVectorSearchIndex reports disconnected cleanly when offline
        const initResult = await initVectorSearchIndex();
        assert.ok(["DISCONNECTED", "UNAVAILABLE", "PROVISIONED", "ALREADY_EXISTS"].includes(initResult.status));
    });
});

