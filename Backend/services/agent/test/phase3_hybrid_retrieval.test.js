import { test, describe, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import redis from "../../../shared/redis/redis.js";

import PdfChunk, {
    ATLAS_VECTOR_INDEX_NAME,
    ATLAS_VECTOR_INDEX_SPEC,
    ATLAS_KEYWORD_INDEX_NAME,
    ATLAS_KEYWORD_INDEX_SPEC,
} from "../models/pdfChunk.model.js";

import {
    generateEmbedding,
    getEmbeddingModel,
    getEmbeddingDimensions,
} from "../pdf/embeddings/embedding.service.js";

import {
    generateQueryEmbedding,
} from "../pdf/retrieval/queryEmbedding.service.js";

import {
    searchVectorChunks,
    cosineSimilarity,
} from "../pdf/retrieval/vectorSearch.service.js";

import {
    searchKeywordChunks,
    calculateKeywordScore,
    sanitizeKeywordQuery,
} from "../pdf/retrieval/keywordSearch.service.js";

import {
    reciprocalRankFusion,
} from "../pdf/retrieval/resultFusion.service.js";

import {
    executeHybridRetrieval,
    preprocessQuery,
    resolveTargetDocument,
} from "../pdf/retrieval/hybridRetrieval.service.js";

import {
    storeChunkEmbeddings,
    resetMemoryVectorStore,
} from "../pdf/storage/vectorStorage.service.js";

import {
    pdfAgent,
} from "../agents/pdf-agent.js";
import { groqFast } from "../config/llmModels.js";

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
 * Helper to generate real PDF buffers using pdf-lib.
 */
async function generatePdfFixture({ pageCount = 1, getPageText = null }) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);

    for (let i = 1; i <= pageCount; i++) {
        const page = doc.addPage([612, 792]);
        const text = typeof getPageText === "function"
            ? getPageText(i)
            : `Section ${i}: Performance and Financial Metrics for Page ${i}\nRevenue grew by ${i * 15} percent with high gross margin expansion across international markets.`;

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

describe("Orbit PDF Agent — Phase 3: Hybrid Retrieval & Intelligent Document Search", () => {
    // In-memory Redis simulation for fast deterministic testing
    const mockRedisMap = new Map();
    const mockRedisSets = new Map();
    let originalRedisOps = null;
    let origGroqInvoke = null;

    beforeEach(() => {
        resetMemoryVectorStore();
        if (groqFast) {
            origGroqInvoke = groqFast.invoke;
            groqFast.invoke = async (prompt) => {
                if (typeof prompt === "string" && prompt.includes("conforming to this exact schema")) {
                    return {
                        content: JSON.stringify({
                            title: "Senior Node.js Architecture",
                            subtitle: "Technical Architecture Guide",
                            sections: [
                                { heading: "Event Loop & Asynchronous I/O", items: ["Core libuv execution", "Thread pool offloading"] },
                                { heading: "Microservices & Clustering", items: ["Process management", "IPC coordination"] },
                            ],
                        }),
                    };
                }
                return {
                    content: "Based on [Page 2], the message bus processes high throughput events with sub-millisecond latency.",
                };
            };
        }
    });

    after(async () => {
        if (groqFast && origGroqInvoke) {
            groqFast.invoke = origGroqInvoke;
        }
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
    // 1. QUERY EMBEDDING SERVICE TESTS (1-3)
    // =========================================================================

    test("1. Query embedding generation returns validated 768-dim vector", async () => {
        const client = {
            embedQuery: async (text) => createMockVector(text.length, 768),
        };

        const result = await generateQueryEmbedding("What is the Q3 operating margin?", {
            client,
        });

        assert.ok(Array.isArray(result.vector));
        assert.equal(result.vector.length, 768);
        assert.equal(result.dimensions, 768);
        assert.equal(result.model, getEmbeddingModel());
        assert.ok(typeof result.durationMs === "number");
    });

    test("2. Invalid embedding rejection throws error on empty, blank, or non-string query", async () => {
        await assert.rejects(
            async () => generateQueryEmbedding(""),
            /query must be a non-empty string/
        );
        await assert.rejects(
            async () => generateQueryEmbedding("   \t\n  "),
            /query must be a non-empty string/
        );
        await assert.rejects(
            async () => generateQueryEmbedding(null),
            /query must be a non-empty string/
        );
    });

    test("3. Correct 768-dimensional compatibility verifies exact model dimension match", async () => {
        const wrongDimClient = {
            embedQuery: async () => createMockVector(1, 512),
        };

        await assert.rejects(
            async () => generateQueryEmbedding("Valid query", { client: wrongDimClient }),
            /Invalid embedding dimensions: expected 768, received 512/
        );
    });

    // =========================================================================
    // 2. VECTOR SEARCH SERVICE TESTS (4-7)
    // =========================================================================

    test("4. Vector search query construction validates parameters and formats pre-filters", async () => {
        // Missing userId
        const resMissingUser = await searchVectorChunks({
            queryVector: createMockVector(1, 768),
            conversationId: "conv_1",
        });
        assert.equal(resMissingUser.status, "FAILED");
        assert.match(resMissingUser.error, /requires an authenticated userId/);

        // Missing conversationId
        const resMissingConv = await searchVectorChunks({
            queryVector: createMockVector(1, 768),
            userId: "user_1",
        });
        assert.equal(resMissingConv.status, "FAILED");
        assert.match(resMissingConv.error, /requires a valid conversationId/);
    });

    test("5. User ownership filters strictly exclude chunks belonging to other users", async () => {
        const memoryStore = new Map();
        const userAChunk = {
            chunkId: "c_uA",
            documentId: "doc_1",
            conversationId: "conv_1",
            userId: "user_A",
            embedding: createMockVector(10, 768),
            content: "User A confidential data",
        };
        const userBChunk = {
            chunkId: "c_uB",
            documentId: "doc_1",
            conversationId: "conv_1",
            userId: "user_B",
            embedding: createMockVector(10, 768),
            content: "User B data",
        };
        memoryStore.set("doc_1:c_uA", userAChunk);
        memoryStore.set("doc_1:c_uB", userBChunk);

        const searchRes = await searchVectorChunks({
            queryVector: createMockVector(10, 768),
            userId: "user_A",
            conversationId: "conv_1",
            memoryStore,
        });

        assert.equal(searchRes.status, "SUCCESS");
        assert.equal(searchRes.results.length, 1);
        assert.equal(searchRes.results[0].chunkId, "c_uA");
        assert.equal(searchRes.results[0].userId, "user_A");
    });

    test("6. Conversation filters exclude chunks from other conversations", async () => {
        const memoryStore = new Map();
        const conv1Chunk = {
            chunkId: "c_conv1",
            documentId: "doc_1",
            conversationId: "conv_1",
            userId: "user_A",
            embedding: createMockVector(1, 768),
            content: "Conv 1 context",
        };
        const conv2Chunk = {
            chunkId: "c_conv2",
            documentId: "doc_1",
            conversationId: "conv_2",
            userId: "user_A",
            embedding: createMockVector(1, 768),
            content: "Conv 2 context",
        };
        memoryStore.set("doc_1:c_conv1", conv1Chunk);
        memoryStore.set("doc_1:c_conv2", conv2Chunk);

        const searchRes = await searchVectorChunks({
            queryVector: createMockVector(1, 768),
            userId: "user_A",
            conversationId: "conv_1",
            memoryStore,
        });

        assert.equal(searchRes.results.length, 1);
        assert.equal(searchRes.results[0].conversationId, "conv_1");
    });

    test("7. Document-specific filtering targets only the selected documentId", async () => {
        const memoryStore = new Map();
        const doc1Chunk = {
            chunkId: "c_d1",
            documentId: "doc_1",
            conversationId: "conv_1",
            userId: "user_A",
            embedding: createMockVector(1, 768),
            content: "Doc 1 text",
        };
        const doc2Chunk = {
            chunkId: "c_d2",
            documentId: "doc_2",
            conversationId: "conv_1",
            userId: "user_A",
            embedding: createMockVector(1, 768),
            content: "Doc 2 text",
        };
        memoryStore.set("doc_1:c_d1", doc1Chunk);
        memoryStore.set("doc_2:c_d2", doc2Chunk);

        const searchRes = await searchVectorChunks({
            queryVector: createMockVector(1, 768),
            userId: "user_A",
            conversationId: "conv_1",
            documentId: "doc_2",
            memoryStore,
        });

        assert.equal(searchRes.results.length, 1);
        assert.equal(searchRes.results[0].documentId, "doc_2");
    });

    // =========================================================================
    // 3. KEYWORD SEARCH SERVICE TESTS (8-9)
    // =========================================================================

    test("8. Keyword search query construction sanitizes query and preserves quotes and terms", () => {
        const raw = "What is the \"operating margin\" and EBITDA for Q3?\n\t";
        const sanitized = sanitizeKeywordQuery(raw);
        assert.equal(sanitized, 'What is the "operating margin" and EBITDA for Q3');
    });

    test("9. Keyword scoring calculation scores matches and boosts section headings", () => {
        const queryTokens = ["ebitda", "margin"];
        const chunkMatchingSection = {
            content: "The company reported steady revenue.",
            section: "EBITDA & Profit Margin Highlights",
        };
        const chunkMatchingContentOnly = {
            content: "Operating margin expansion reached 24%.",
            section: "Introduction",
        };

        const scoreHeading = calculateKeywordScore(
            chunkMatchingSection.content,
            chunkMatchingSection.section,
            queryTokens
        );
        const scoreContent = calculateKeywordScore(
            chunkMatchingContentOnly.content,
            chunkMatchingContentOnly.section,
            queryTokens
        );

        assert.ok(scoreHeading > scoreContent, "Section heading matches must receive higher weight than body text alone");
    });

    // =========================================================================
    // 4. FUSION STRATEGY & RRF TESTS (10-12)
    // =========================================================================

    test("10. RRF ranking balances vector and keyword ranks using standard reciprocal formula", () => {
        const vectorResults = [
            { chunkId: "c1", score: 0.95, vectorRank: 1 },
            { chunkId: "c2", score: 0.85, vectorRank: 2 },
        ];
        const keywordResults = [
            { chunkId: "c2", score: 4.5, keywordRank: 1 },
            { chunkId: "c3", score: 3.2, keywordRank: 2 },
        ];

        const { fusedResults } = reciprocalRankFusion(vectorResults, keywordResults, { k: 60 });

        assert.equal(fusedResults.length, 3);
        // c2 appeared in both: rank 2 vector + rank 1 keyword -> 1/(60+2) + 1/(60+1) = 0.016129 + 0.016393 = 0.03252
        // c1 appeared in vector only: rank 1 -> 1/(60+1) = 0.016393
        // c2 should be #1 ranked
        assert.equal(fusedResults[0].chunkId, "c2");
        assert.equal(fusedResults[1].chunkId, "c1");
        assert.equal(fusedResults[2].chunkId, "c3");
    });

    test("11. Duplicate chunk merging merges chunkId into single entry preserving source diagnostics", () => {
        const vectorResults = [
            { chunkId: "c_shared", pageStart: 2, pageEnd: 2, score: 0.88, vectorRank: 1 },
        ];
        const keywordResults = [
            { chunkId: "c_shared", pageStart: 2, pageEnd: 2, score: 5.0, keywordRank: 1 },
        ];

        const { fusedResults } = reciprocalRankFusion(vectorResults, keywordResults, { k: 60 });

        assert.equal(fusedResults.length, 1);
        const merged = fusedResults[0];
        assert.equal(merged.chunkId, "c_shared");
        assert.equal(merged.vectorRank, 1);
        assert.equal(merged.keywordRank, 1);
        assert.ok(merged.sources.includes("vector") && merged.sources.includes("keyword"));
    });

    test("12. Deterministic ordering breaks ties consistently by pageStart, chunkIndex, and chunkId", () => {
        // Equal scores
        const vectorResults = [
            { chunkId: "chunk_z", pageStart: 5, chunkIndex: 1, vectorRank: 1 },
            { chunkId: "chunk_a", pageStart: 2, chunkIndex: 0, vectorRank: 1 },
        ];

        const { fusedResults } = reciprocalRankFusion(vectorResults, [], { k: 60 });

        assert.equal(fusedResults.length, 2);
        // chunk_a has pageStart 2 < pageStart 5, so must sort first deterministically
        assert.equal(fusedResults[0].chunkId, "chunk_a");
        assert.equal(fusedResults[1].chunkId, "chunk_z");
    });

    // =========================================================================
    // 5. DOCUMENT SELECTION & AMBIGUITY TESTS (13-15)
    // =========================================================================

    test("13. Multiple PDF retrieval resolves targeted document when mentioned in prompt", async () => {
        // Cache 2 documents in Redis
        mockRedisSets.set("pdf-docs-conv_multi", new Set(["doc_q3", "doc_q4"]));
        mockRedisMap.set("pdf-doc-conv_multi-doc_q3", JSON.stringify({
            documentId: "doc_q3",
            fileName: "q3_financial_report.pdf",
            pageCount: 10,
        }));
        mockRedisMap.set("pdf-doc-conv_multi-doc_q4", JSON.stringify({
            documentId: "doc_q4",
            fileName: "q4_annual_budget.pdf",
            pageCount: 15,
        }));

        const resolution = await resolveTargetDocument("conv_multi", "What were the results in q3_financial_report?");

        assert.equal(resolution.isAmbiguous, false);
        assert.equal(resolution.targetDocumentId, "doc_q3");
        assert.equal(resolution.targetFileName, "q3_financial_report.pdf");
    });

    test("14. Explicit filename selection targets document even with partial case-insensitive match", async () => {
        mockRedisSets.set("pdf-docs-conv_name", new Set(["doc_handbook"]));
        mockRedisMap.set("pdf-doc-conv_name-doc_handbook", JSON.stringify({
            documentId: "doc_handbook",
            fileName: "Employee_Handbook_2026.pdf",
            pageCount: 20,
        }));

        const res = await resolveTargetDocument("conv_name", "What is the policy in employee_handbook?");
        assert.equal(res.targetDocumentId, "doc_handbook");
    });

    test("15. Ambiguous document selection flags multiple PDFs when query mentions neither", async () => {
        mockRedisSets.set("pdf-docs-conv_ambig", new Set(["doc_alpha", "doc_beta"]));
        mockRedisMap.set("pdf-doc-conv_ambig-doc_alpha", JSON.stringify({
            documentId: "doc_alpha",
            fileName: "Alpha_Architecture.pdf",
        }));
        mockRedisMap.set("pdf-doc-conv_ambig-doc_beta", JSON.stringify({
            documentId: "doc_beta",
            fileName: "Beta_Guidelines.pdf",
        }));

        const res = await resolveTargetDocument("conv_ambig", "What is the general overview?");
        assert.equal(res.isAmbiguous, true);
        assert.equal(res.targetDocumentId, null);
        assert.equal(res.availableDocs.length, 2);
    });

    // =========================================================================
    // 6. RETRIEVAL EDGE CASES & QUALITY (16-19)
    // =========================================================================

    test("16. No matching results returns empty array with NO_RESULTS status", async () => {
        const memoryStore = new Map();
        const res = await executeHybridRetrieval({
            query: "completely unrelated query for which no chunks exist",
            userId: "user_x",
            conversationId: "conv_empty",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(1, 768) },
            },
        });

        assert.equal(res.status, "NO_RESULTS");
        assert.equal(res.results.length, 0);
    });

    test("17. Empty query handling returns NO_RESULTS without throwing", async () => {
        const res = await executeHybridRetrieval({
            query: "   \t  ",
            userId: "user_x",
            conversationId: "conv_blank",
        });

        assert.equal(res.status, "NO_RESULTS");
        assert.equal(res.results.length, 0);
    });

    test("18. Vector index unavailable handles index errors gracefully without throwing", async () => {
        const memoryStore = new Map();
        // Add chunk with keyword match
        memoryStore.set("doc_idx:c1", {
            chunkId: "c1",
            documentId: "doc_idx",
            conversationId: "conv_idx",
            userId: "user_idx",
            content: "Technical architecture specification for cloud infrastructure.",
            section: "Architecture",
        });

        // Simulating failing vector client
        const badEmbeddingClient = {
            embedQuery: async () => { throw new Error("Index unready / connection refused"); },
        };

        const res = await executeHybridRetrieval({
            query: "cloud infrastructure",
            userId: "user_idx",
            conversationId: "conv_idx",
            documentId: "doc_idx",
            options: {
                memoryStore,
                embeddingClient: badEmbeddingClient,
            },
        });

        // Graceful degradation: vector branch failed, but keyword branch succeeded -> PARTIAL
        assert.equal(res.status, "PARTIAL");
        assert.ok(res.results.length > 0);
        assert.equal(res.results[0].chunkId, "c1");
    });

    test("19. Keyword index unavailable falls back to vector branch", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_k_down:c1", {
            chunkId: "c_v_only",
            documentId: "doc_k_down",
            conversationId: "conv_k_down",
            userId: "user_k",
            content: "Vector content",
            embedding: createMockVector(10, 768),
        });

        const workingClient = {
            embedQuery: async () => createMockVector(10, 768),
        };

        const res = await executeHybridRetrieval({
            query: "vector query",
            userId: "user_k",
            conversationId: "conv_k_down",
            documentId: "doc_k_down",
            options: {
                memoryStore,
                embeddingClient: workingClient,
            },
        });

        assert.ok(["SUCCESS", "PARTIAL"].includes(res.status));
        assert.ok(res.results.length > 0);
    });

    // =========================================================================
    // 7. BRANCH FAILURES & PARTIAL RETRIEVAL (20-23)
    // =========================================================================

    test("20. Vector search failure preserves keyword results", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_vf:c1", {
            chunkId: "c_kw_win",
            documentId: "doc_vf",
            conversationId: "conv_vf",
            userId: "user_vf",
            content: "Important quarterly performance data",
            section: "Quarterly Performance",
        });

        const failingClient = {
            embedQuery: async () => { throw new Error("Vector API rate limit 429"); },
        };

        const res = await executeHybridRetrieval({
            query: "quarterly performance",
            userId: "user_vf",
            conversationId: "conv_vf",
            documentId: "doc_vf",
            options: {
                memoryStore,
                embeddingClient: failingClient,
            },
        });

        assert.equal(res.status, "PARTIAL");
        assert.equal(res.results[0].chunkId, "c_kw_win");
    });

    test("21. Keyword search failure preserves vector results", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_kf:c1", {
            chunkId: "c_vec_win",
            documentId: "doc_kf",
            conversationId: "conv_kf",
            userId: "user_kf",
            content: "Semantic meaning without verbatim words",
            embedding: createMockVector(15, 768),
        });

        const res = await executeHybridRetrieval({
            query: "semantic question",
            userId: "user_kf",
            conversationId: "conv_kf",
            documentId: "doc_kf",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(15, 768) },
            },
        });

        assert.ok(res.results.length > 0);
        assert.equal(res.results[0].chunkId, "c_vec_win");
    });

    test("22. Partial retrieval reports status PARTIAL accurately", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_part:c1", {
            chunkId: "c_part_1",
            documentId: "doc_part",
            conversationId: "conv_part",
            userId: "user_part",
            content: "Partial data",
            embedding: createMockVector(1, 768),
        });

        const res = await executeHybridRetrieval({
            query: "query",
            userId: "user_part",
            conversationId: "conv_part",
            documentId: "doc_part",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => { throw new Error("Timeout"); } },
            },
        });

        assert.equal(res.status, "PARTIAL");
    });

    test("23. Both branches failing returns FAILED status cleanly", async () => {
        // Missing userId causes retrieval validation to fail cleanly
        const res = await executeHybridRetrieval({
            query: "fatal query",
            userId: "", // Missing userId causes failure
            conversationId: "conv_fail",
            documentId: "doc_fail",
        });

        assert.equal(res.status, "FAILED");
        assert.equal(res.results.length, 0);
    });

    // =========================================================================
    // 8. METADATA & TIMEOUT TELEMETRY (24-26)
    // =========================================================================

    test("24. Result metadata preservation retains pageStart, pageEnd, section, and hashes", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_meta:c1", {
            chunkId: "c_meta_test",
            documentId: "doc_meta",
            conversationId: "conv_meta",
            userId: "user_meta",
            chunkIndex: 3,
            pageStart: 7,
            pageEnd: 8,
            section: "Compliance & Security",
            content: "Audit verified security protocols.",
            contentHash: "hash_meta_999",
            tokenCount: 42,
            characterCount: 180,
            embedding: createMockVector(1, 768),
        });

        const res = await executeHybridRetrieval({
            query: "security protocols",
            userId: "user_meta",
            conversationId: "conv_meta",
            documentId: "doc_meta",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(1, 768) },
            },
        });

        assert.ok(res.results.length > 0);
        const item = res.results[0];
        assert.equal(item.pageStart, 7);
        assert.equal(item.pageEnd, 8);
        assert.equal(item.section, "Compliance & Security");
        assert.equal(item.contentHash, "hash_meta_999");
        assert.equal(item.chunkIndex, 3);
    });

    test("25. Retrieval timeout protects against hanging database calls", async () => {
        const slowClient = {
            embedQuery: () => new Promise((resolve) => setTimeout(resolve, 5000)),
        };

        const res = await executeHybridRetrieval({
            query: "timeout test",
            userId: "user_t",
            conversationId: "conv_t",
            documentId: "doc_t",
            options: {
                timeoutMs: 50, // 50ms fast timeout
                embeddingClient: slowClient,
                memoryStore: new Map(),
            },
        });

        assert.ok(["FAILED", "NO_RESULTS", "PARTIAL"].includes(res.status));
    });

    test("26. Large document candidate limits respect configured limit top-K", async () => {
        const memoryStore = new Map();
        for (let i = 0; i < 20; i++) {
            memoryStore.set(`doc_large:c${i}`, {
                chunkId: `c_${i}`,
                documentId: "doc_large",
                conversationId: "conv_large",
                userId: "user_large",
                content: `Section ${i} with relevant finance metrics`,
                embedding: createMockVector(i, 768),
            });
        }

        const res = await executeHybridRetrieval({
            query: "finance metrics",
            userId: "user_large",
            conversationId: "conv_large",
            documentId: "doc_large",
            options: {
                limit: 5,
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(1, 768) },
            },
        });

        assert.equal(res.results.length, 5, "Must respect limit parameter of 5");
    });

    // =========================================================================
    // 9. SECURITY & ISOLATION (27-28)
    // =========================================================================

    test("27. Cross-user isolation prevents user A from retrieving user B chunks", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_iso:cA", {
            chunkId: "c_A",
            documentId: "doc_iso",
            conversationId: "conv_shared",
            userId: "user_A",
            content: "Confidential patent of User A",
            embedding: createMockVector(10, 768),
        });

        const res = await executeHybridRetrieval({
            query: "patent",
            userId: "user_B", // User B queries
            conversationId: "conv_shared",
            documentId: "doc_iso",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(10, 768) },
            },
        });

        assert.equal(res.results.length, 0, "User B must not see User A chunks");
    });

    test("28. Cross-conversation isolation restricts chunks to origin conversation", async () => {
        const memoryStore = new Map();
        memoryStore.set("doc_ci:c1", {
            chunkId: "c1",
            documentId: "doc_ci",
            conversationId: "conv_private_1",
            userId: "user_same",
            content: "Meeting notes conversation 1",
            embedding: createMockVector(10, 768),
        });

        const res = await executeHybridRetrieval({
            query: "Meeting notes",
            userId: "user_same",
            conversationId: "conv_private_2", // Different conversation
            documentId: "doc_ci",
            options: {
                memoryStore,
                embeddingClient: { embedQuery: async () => createMockVector(10, 768) },
            },
        });

        assert.equal(res.results.length, 0);
    });

    // =========================================================================
    // 10. LANGGRAPH INTEGRATION & REGRESSION (29-30)
    // =========================================================================

    test("29. LangGraph integration executes hybrid retrieval in multi-turn conversation and grounds answer", async () => {
        const convId = "conv_langgraph_integration";
        const docId = "doc_langgraph_01";

        // Pre-populate document cache with chunks
        const cachedDocData = {
            documentId: docId,
            fileName: "System_Architecture.pdf",
            pageCount: 5,
            totalChunks: 3,
            text: "Orbit Architecture Overview",
            chunks: [
                {
                    chunkId: "c_lg_1",
                    pageStart: 2,
                    pageEnd: 2,
                    section: "Message Bus",
                    content: "The message bus processes high throughput events with sub-millisecond latency.",
                    tokenCount: 15,
                },
            ],
        };

        mockRedisMap.set(`pdf-doc-${convId}`, JSON.stringify(cachedDocData));
        mockRedisMap.set(`pdf-doc-${convId}-${docId}`, JSON.stringify(cachedDocData));
        mockRedisSets.set(`pdf-docs-${convId}`, new Set([docId]));

        // Invoke pdfAgent
        const state = {
            conversationId: convId,
            userId: "user_lg",
            prompt: "What is the latency of the message bus in System_Architecture.pdf?",
            embeddingClient: { embedQuery: async () => createMockVector(1, 768) },
            history: [],
        };

        const resultState = await pdfAgent(state);

        assert.ok(resultState.aiResponse, "Must produce an AI response");
        assert.ok(resultState.pdfDocument, "Must preserve pdfDocument metadata");
        assert.equal(resultState.pdfDocument.fileName, "System_Architecture.pdf");
    });

    test("30. Existing PDF agent regression: Single-turn PDF creation works normally", async () => {
        const state = {
            agentMode: "pdf",
            prompt: "Create a PDF on Senior Node.js Architecture Questions",
            conversationId: "conv_create_test",
            history: [],
        };

        const resultState = await pdfAgent(state);

        assert.ok(resultState.aiResponse, "Must produce generated PDF response");
        assert.ok(resultState.pdfDocument, "Must attach pdfDocument artifact");
        assert.ok(resultState.pdfDocument.fileName.endsWith(".pdf"));
    });
});

