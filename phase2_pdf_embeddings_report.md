# Orbit PDF Agent — Phase 2: Embedding Generation & Vector Storage Report

**Role:** Senior GenAI Engineer, Senior Node.js Backend Architect, RAG Systems Engineer  
**Date:** November 14, 2026  
**Status:** Complete  
**Final Verdict:** **PASS WITH LIMITATIONS** (Production-ready local & cloud pipeline; Atlas Vector Search index definition ready and provisionable, requiring an Atlas cluster with Vector Search tier enabled for live index building)

---

## 1. Executive Summary

Phase 2 builds upon the Phase 1 page-aware extraction and structure-aware chunking pipeline by introducing a production-minded, decoupled embedding generation and vector storage architecture for Orbit's PDF Agent.

Every ingested PDF document is now:
1. Parsed with 1-based page boundary preservation and table indicators (`extractPdf.js`).
2. Chunked using structural heuristics, overlap guarantees, token accounting, and content hashing (`chunking.service.js`).
3. Evaluated for existing embeddings using a deterministic chunk-level content hash and model identity check (`vectorStorage.service.js`).
4. Embedded using Google Gemini (`text-embedding-004`, 768 dimensions) in configurable, bounded batches with exponential backoff and jitter (`embedding.service.js`).
5. Persisted durably into MongoDB (`PdfChunk` collection) with compound unique indexes (`documentId`, `chunkId`), multi-tenant ownership filters (`userId`, `conversationId`, `documentId`), and vector dimensions validation.
6. Tracked through explicit ingestion lifecycle statuses (`READY` / `EXTRACTED`, `CHUNKED`, `EMBEDDING`, `EMBEDDED`, `PARTIAL`, `FAILED`, `SKIPPED`).
7. Cleaned up automatically upon document removal or conversation deletion.

All 27 Phase 2 test scenarios, 27 Phase 1 ingestion tests, 11 Phase 1.1 integration tests, 6 existing PDF agent tests, 11 coding agent regression tests, 20 frontend integration tests, frontend lint, and production build **passed with 100% success**.

---

## 2. Existing Architecture Inspected

Prior to editing, the Orbit PDF Agent and storage systems were audited:
- **Agent Service (`Backend/services/agent/`):**
  - `agents/pdf-agent.js`: Orchestrates LangGraph state transitions (`processUserMessage`, `routeIntent`, `generatePdfContent`, `extractPdfDocJson`, `compileFinalPdf`).
  - `utils/extractPdf.js`: Upgraded in Phase 1 to output normalized `{ documentId, pageCount, pages, text, totalCharacters, estimatedTokens, isScanned, warnings, status }`.
  - `shared/redis/redis.js`: Upstash Redis instance utilized for fast session caching with immutable document keys (`pdf-doc-${conversationId}-${docId}`) and conversation index sets (`pdf-docs-${conversationId}`).
- **Data Persistence:**
  - MongoDB Atlas instance connected via Mongoose in backend services.
  - Chat Service (`Backend/services/chat/`): Manages `conversations` and `messages`, invoking deletion routines in `chat.controller.js`.

---

## 3. Embedding Model & API Compatibility

### Provider Selection
- **Library:** `@langchain/google-genai` (v2.3.2) utilizing `GoogleGenerativeAIEmbeddings`.
- **Model Selected:** `text-embedding-004`.
- **Vector Dimensions:** `768` (standard for Gemini text-embedding-004).
- **Environment Configuration:**
  - `EMBEDDING_MODEL`: Defaults to `text-embedding-004`.
  - `EMBEDDING_DIMENSIONS`: Defaults to `768`.
  - `EMBEDDING_BATCH_SIZE`: Defaults to `20` (bounded to avoid request payload limits).
  - `GOOGLE_API_KEY` / `GEMINI_API_KEY`: Server-side only; never exposed to frontend clients.

### Interface & Boundary Abstraction
Implemented in `Backend/services/agent/pdf/embeddings/embedding.service.js`:
- `generateEmbedding(text, options)`: Returns validated 768-dim float array.
- `generateEmbeddingsBatch(texts, options)`: Guarantees strict 1-to-1 input-to-output ordering across slices.
- `getEmbeddingModel()`: Returns active model ID.
- `getEmbeddingDimensions()`: Returns active dimension count.
- `validateVector(vector, expectedDim)`: Validates that vectors are non-empty arrays of finite floating-point numbers matching expected dimension.
- `executeWithBackoff(fn, retries, backoff)`: Catches HTTP 429 (rate limits) and 503 (transient server errors) with exponential backoff and randomized jitter (bounded to 3 retries).

---

## 4. Vector Storage Architecture & MongoDB Design

### Mongoose Model: `PdfChunk` (`Backend/services/agent/models/pdfChunk.model.js`)
Persisted in the `pdfchunks` collection with the following schema:

```javascript
{
  chunkId: { type: String, required: true, index: true },
  documentId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  chunkIndex: { type: Number, required: true },
  pageStart: { type: Number, required: true },
  pageEnd: { type: Number, required: true },
  section: { type: String, default: "General" },
  content: { type: String, required: true },
  tokenCount: { type: Number, default: 0 },
  characterCount: { type: Number, default: 0 },
  startOffset: { type: Number, default: 0 },
  endOffset: { type: Number, default: 0 },
  contentHash: { type: String, required: true },
  embedding: {
    type: [Number],
    required: true,
    validate: (v) => Array.isArray(v) && v.length === 768 && v.every(Number.isFinite)
  },
  embeddingModel: { type: String, required: true, default: "text-embedding-004" },
  embeddingDimensions: { type: Number, required: true, default: 768 },
  timestamps: true
}
```

### Uniqueness & Indexing Strategy
1. **Idempotent Unique Index:** `{ documentId: 1, chunkId: 1 }` (unique constraint prevents duplicate chunk records).
2. **Multi-tenant Compound Filter Index:** `{ userId: 1, conversationId: 1, documentId: 1 }` (guarantees strict tenant and conversation isolation during retrieval).
3. **Temporal Ordering Index:** `{ conversationId: 1, createdAt: 1 }`.

### Atlas Vector Search Index Specification
Exported as `ATLAS_VECTOR_INDEX_SPEC` and initialized via `initVectorSearchIndex()`:
```javascript
export const ATLAS_VECTOR_INDEX_SPEC = {
  name: "pdf_chunk_vector_index",
  type: "vectorSearch",
  definition: {
    fields: [
      {
        type: "vector",
        path: "embedding",
        numDimensions: 768,
        similarity: "cosine",
      },
      { type: "filter", path: "userId" },
      { type: "filter", path: "conversationId" },
      { type: "filter", path: "documentId" },
    ],
  },
};
```
- **Deployment Status:** In offline/test and standard local MongoDB instances, `initVectorSearchIndex` detects capability gracefully without throwing (`DISCONNECTED` or `UNAVAILABLE`). On MongoDB Atlas clusters with Search enabled, Mongoose 9.11.1 calls `createSearchIndex` to provision `pdf_chunk_vector_index`.

---

## 5. Batch Processing & Idempotency Behavior

### Batching Design
- Chunks are sliced into configurable batches (default `20` chunks per API request).
- Promises resolve sequentially per batch slice, preventing API concurrency choke.
- Strict index mapping ensures vector outputs map identically to chunk order.

### Incremental Ingestion & Idempotency
- Before embedding, `ingestPdfDocument` invokes `getExistingDocumentChunks(documentId)`.
- For each chunk:
  - If `existing.contentHash === chunk.contentHash` AND `existing.embeddingModel === activeModel` AND dimensions match (768), the existing embedding is reused immediately without making an LLM API call (`reusedChunks++`).
  - If content changed, hash differs, or model changed, only the modified chunk is added to `chunksToEmbed`.
- Bulk persistence uses `bulkWrite(operations, { ordered: false })` with `updateOne` and `{ upsert: true }`, ensuring re-ingesting the same PDF produces zero duplicate records.

---

## 6. Status Tracking & Error Handling

Ingestion results now expose fine-grained status indicators:
- `status`: Document parsing state (`READY`, `PARTIAL`, `FAILED`).
- `embeddingStatus`:
  - `EMBEDDED`: All generated chunks have valid 768-dim embeddings in storage.
  - `PARTIAL`: A subset of chunks succeeded while others failed.
  - `FAILED`: Embedding generation or storage failed completely.
  - `SKIPPED`: Embeddings skipped due to `generateEmbeddings: false` or `isScanned: true`.
- `embeddedChunks`: Total count of chunks with valid embeddings.
- `failedChunks`: Count of failed chunks.
- `reusedChunks`: Count of chunks reused via content-hash idempotency without API calls.

### Fault Tolerance
- **Embedding Provider Outage:** Embedding failure does not corrupt extraction or chunking. Document remains `status: "READY"` with `embeddingStatus: "FAILED"` and descriptive `warnings`.
- **Redis Outage:** If Redis write fails, vector persistence to MongoDB still proceeds and returns `cacheStatus: "CACHE_FAILED"`, `embeddingStatus: "EMBEDDED"`.

---

## 7. Security, Tenant Isolation & Lifecycle Cleanup

### Document Isolation
- Every chunk document explicitly records `userId`, `conversationId`, and `documentId`.
- No cross-conversation access is possible: queries and vector search pre-filters enforce exact match on `(userId, conversationId)`.

### Lifecycle Management
- **Targeted Document Deletion:** `deleteDocumentChunks(conversationId, documentId)` removes only records matching that document.
- **Conversation Deletion:** When a conversation is deleted via Chat service (`chat.controller.js:deleteConversation`), it invokes `deleteConversationChunks(conversationId)` and removes all associated records across both MongoDB and Redis caches.

---

## 8. Test Execution Verification

All suites were executed via Node test runner, ESLint, and Vite.

### Summary Table

| Test Suite | Command | Tests Run | Passed | Failed | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Phase 2 Embeddings & Vector Storage** | `node --test Backend/services/agent/test/phase2_pdf_embeddings.test.js` | 27 | 27 | 0 | **PASS** |
| **Phase 1 PDF Ingestion** | `node --test Backend/services/agent/test/phase1_pdf_ingestion.test.js` | 27 | 27 | 0 | **PASS** |
| **Phase 1.1 Ingestion Reliability Audit** | `node --test Backend/services/agent/test/phase1_1_integration_audit.test.js` | 11 | 11 | 0 | **PASS** |
| **Existing PDF Agent Tests** | `node Backend/tests/agent/test-pdf.js` | 6 | 6 | 0 | **PASS** |
| **Agent Regression Audit** | `node --test Backend/services/agent/test/phase5_3_preview_reliability_acceptance.test.js` | 11 | 11 | 0 | **PASS** |
| **Frontend Tests** | `node --test Frontend/test/*.test.js` | 20 | 20 | 0 | **PASS** |
| **Frontend Lint** | `npm --prefix Frontend run lint` | ESLint | All files | 0 errors | **PASS** |
| **Frontend Production Build** | `npm --prefix Frontend run build` | Vite 8.3 | Clean build (2.76s) | 0 errors | **PASS** |

### Phase 2 Detailed Test Coverage (27 Scenarios)
1. Valid embedding response returns 768-dimensional vector: **PASS**
2. Empty text rejection throws clear error: **PASS**
3. Invalid vector response (non-finite or non-array) throws validation error: **PASS**
4. Wrong vector dimensions (512 or 1536) throws validation error: **PASS**
5. Provider timeout exhausts retries and throws cleanly: **PASS**
6. Rate limit retry (429) succeeds with exponential backoff: **PASS**
7. Permanent provider failure (401 unauthorized) throws immediately: **PASS**
8. Batch response ordering strictly preserves 1:1 input-output index correspondence: **PASS**
9. Successful chunk persistence stores chunk with embedding in vector store: **PASS**
10. Duplicate chunk prevention updates existing record rather than duplicating: **PASS**
11. Unchanged chunk skipping reuses existing embedding without provider calls: **PASS**
12. Updated chunk re-embedding re-embeds when chunk content changes: **PASS**
13. Embedding model change forces re-embedding even if content hash matches: **PASS**
14. User, conversation, and document ownership metadata are strictly attached: **PASS**
15. Storage failure handles invalid payload defensively: **PASS**
16. Partial batch failure detection identifies missing vectors: **PASS**
17. Small document embedding completes end-to-end with EMBEDDED status: **PASS**
18. Large document batch processing handles multi-page PDF in controlled batches: **PASS**
19. Retry after interrupted processing completes previously un-embedded chunks: **PASS**
20. Correct final ingestion status values (`EMBEDDED`, `SKIPPED`, `FAILED`): **PASS**
21. Redis failure handling still persists vectors and returns `CACHE_FAILED`: **PASS**
22. Storage failure reports `embeddingStatus: FAILED` while preserving text/chunks: **PASS**
23. Multiple PDFs in one conversation store chunks under distinct documentIds: **PASS**
24. Isolation across different conversations prevents cross-tenant data leakage: **PASS**
25. Conversation deletion cleanup deletes all chunks belonging to conversationId: **PASS**
26. Document deletion cleanup deletes only chunks for targeted documentId: **PASS**
27. Atlas Vector Search index specification defines 768 dims, cosine, and filter paths: **PASS**

---

## 9. Performance & Cost Observations

- **Batch Chunking:** 20 chunks per request reduces network round-trips by 95% compared to individual vector calls.
- **Content Hashing:** MD5/SHA-256 chunk content hash checks prevent re-embedding identical pages during repeat queries or multi-turn chats, reducing API costs to zero for unmodified documents.
- **Memory Footprint:** 768 float32 numbers per vector requires ~3 KB per chunk. A 50-page document generating ~80 chunks requires ~240 KB of vector storage in MongoDB.
- **Security:** Vector arrays and raw API keys are excluded from default logs to protect privacy.

---

## 10. Known Limitations

1. **Atlas Vector Search Cloud Dependency:** MongoDB Atlas Vector Search requires an Atlas cluster running M10+ or an Atlas Search enabled tier to build vector indexes dynamically via `createSearchIndex()`. In offline development, standalone Community editions, or sandboxed test runners without Atlas Search daemons, vector persistence operates via MongoDB documents with in-memory vector storage fallback.
2. **Phase Scope Boundary (Phase 3 Deferred):** As strictly instructed in Section 13, semantic vector retrieval (`$vectorSearch` aggregation pipeline), hybrid BM25 search, query rewriting, reranking, and citation generation were excluded from Phase 2 and remain the focus of Phase 3.

---

## 11. Files Created & Modified

### Created Files:
1. `Backend/services/agent/models/pdfChunk.model.js` — Mongoose schema for chunk embeddings and Atlas Search index specification.
2. `Backend/services/agent/pdf/embeddings/embedding.service.js` — LangChain Gemini embedding service with batching and backoff.
3. `Backend/services/agent/pdf/storage/vectorStorage.service.js` — MongoDB vector storage service with bulkWrite upserts and in-memory test fallback.
4. `Backend/services/agent/test/phase2_pdf_embeddings.test.js` — Complete 27-scenario automated test suite.
5. `phase2_pdf_embeddings_report.md` — This architectural and audit report.

### Modified Files:
1. `Backend/services/agent/pdf/ingestion/pdfIngestion.service.js` — Extended `ingestPdfDocument` with Step 4 embedding generation, idempotency hash checks, and status tracking.
2. `Backend/services/agent/graph/state.js` — Added `userId` to LangGraph state schema.
3. `Backend/services/agent/controllers/agent.controller.js` — Passes `userId` into workflow invocation.
4. `Backend/services/agent/agents/pdf-agent.js` — Passes `userId` and `generateEmbeddings: true` into `ingestPdfDocument`.
5. `Backend/services/chat/controllers/chat.controller.js` — Added cleanup routine `pdfchunks.deleteMany({ conversationId })` during conversation deletion.

---

## 12. Git Branch & Working Tree Status

- **Branch:** `main` (synchronized with `origin/main` at `68e2ec4`).
- **Policy Enforcement:** No git commits, pushes, stashes, resets, or discarded files were made. All modifications remain intact in the working directory ready for inspection.

