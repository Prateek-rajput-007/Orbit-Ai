# Orbit PDF Agent — Phase 4: Grounded Answer Generation & Verifiable Citations Implementation Report

**System**: Orbit Multi-Agent AI Platform  
**Subsystem**: PDF Agent & RAG Pipeline  
**Phase**: Phase 4 — Grounded Answer Generation, Citation Validation, and Source References  
**Status**: COMPLETED & VERIFIED  
**Date**: November 2026  

---

## 1. Architecture Before and After

### 1.1 Architecture Before Phase 4 (Phases 1–3.1)
Prior to Phase 4, Orbit possessed a full hybrid retrieval engine capable of querying uploaded documents:
- **Phase 1 & 1.1**: Page-aware PDF text extraction (`pdf-parse`), structure-aware chunking, Redis caching (`pdf-doc:${conversationId}:${docId}`), and conversation cleanup.
- **Phase 2 & 2.1**: Persistent MongoDB storage (`pdfchunks`), vector generation using Google Gemini (`gemini-embedding-001`, 768 dimensions), and multi-tenant scoping (`userId`, `conversationId`, `documentId`).
- **Phase 3 & 3.1**: Hybrid retrieval combining MongoDB Atlas Vector Search (`pdf_chunk_vector_index`) and MongoDB native text search (`$text` with TF-weighted `textScore`), merged via Reciprocal Rank Fusion (RRF, $k=60$).

**Limitations Before Phase 4**:
- **Raw Context Injection**: Follow-up questions in `pdf-agent.js` (Case 3) injected unstructured retrieved chunk text directly into the LLM system prompt without source identifiers or XML bounding tags.
- **Hallucinated Citations & Untrusted Pages**: The LLM frequently cited page numbers that did not match the document, made up source numbers, or asserted claims with no retrieved basis.
- **No Citation Validation**: No pipeline component verified whether citations in LLM responses matched genuine retrieved chunks or belonged to the requesting user/conversation.
- **Lack of UI Grounding**: Frontend chat messages rendered static text without interactive citation badges or deep links to specific PDF pages in the PDF viewer.

### 1.2 Architecture After Phase 4
```
User Query (Chat Turn)
       │
       ▼
LangGraph Agent Router / State
       │
       ▼
PDF Agent (`pdf-agent.js`)
       │
       ├── Case 3: Follow-Up / RAG Question
       │     │
       │     ▼
       │   Hybrid Retrieval Service (`hybridRetrieval.service.js`)
       │   [Vector (Gemini) + Keyword (TF TextScore) -> RRF Fusion]
       │     │
       │     ▼ (Retrieved Chunks Array)
       │   Grounded Context Construction Service (`groundedContext.service.js`)
       │   - Deduplication & Multi-tenant boundary checks
       │   - XML Tagging (`<source id="S1" doc="..." page="..."><chunk_content>...</chunk_content></source>`)
       │   - Token budget management (4,000 token limit with head/tail packing)
       │   - Strict anti-hallucination & grounding system prompt
       │     │
       │     ▼
       │   LLM Generation (`groqFast.invoke`)
       │   - Enforced to use `[S1]`, `[S2]` citation tags
       │   - Refusal instruction when context is insufficient
       │     │
       │     ▼
       │   Citation Validation Service (`citationValidation.service.js`)
       │   - Extracts source references (`[S1]`, `[S2]`)
       │   - Rejects hallucinated source IDs & invalid tags
       │   - Maps cited sources to authoritative chunk metadata (authoritative pages)
       │   - Evaluates semantic evidence status (`SUPPORTED`, `PARTIALLY_SUPPORTED`, `INSUFFICIENT_EVIDENCE`)
       │   - Calculates confidence (`HIGH`, `MEDIUM`, `LOW`)
       │   - Normalizes tags from `[S1]` to user-facing badges `[1]`
       │   - Appends verifiable "Sources & References" block to text
       │     │
       │     ▼
       │   State Update (`agentState`)
       │   { citations, evidenceStatus, confidence, retrievedChunks, retrievalTelemetry }
       │
       ▼
Agent Controller (`agent.controller.js`)
       │
       ├── Emits SSE payload (`event: ready`) with structured citation metadata
       └── Passes structured citations to `chatController.saveTurn`
             │
             ▼
Chat Service & MongoDB (`chat.controller.js` & `message-model.js`)
       │
       └── Persists `citations`, `evidenceStatus`, `confidence` in Message document
             │
             ▼
Frontend UI (`Message.jsx` & `PdfArtifactPanel.jsx`)
       │
       ├── `Message.jsx`: Renders `[1] Page X (Section)` clickable pills + Evidence badge
       └── `PdfArtifactPanel.jsx`: Jumps to target page (`#page=X`) with interactive page controls
```

---

## 2. Grounded Context Construction

The Grounded Context Construction Service (`Backend/services/agent/pdf/answer/groundedContext.service.js`) formats retrieved chunks into a bounded, prompt-safe payload for the LLM.

### 2.1 Context Formatting & Delimiters
- Chunks are enclosed in explicit XML tags:
  ```xml
  <sources>
    <source id="S1" docId="60d5ec49..." docName="AnnualReport.pdf" page="3">
      <chunk_content>
        Net revenue increased by 14% year-over-year...
      </chunk_content>
    </source>
  </sources>
  ```
- **Text Sanitization**: Raw chunk content is sanitized to strip prompt-injection patterns, XML delimiter mimics (e.g. `</source>`, `<source>`), and extraneous whitespace.
- **Deterministic ID Assignment**: Chunks are numbered deterministically as `S1`, `S2`, ..., `Sn` based on their retrieval rank.
- **Source Map**: Builds an immutable lookup map `sourceMap[sourceId]` retaining:
  - `sourceId`: e.g. `"S1"`
  - `chunkId`: MongoDB ObjectId of the chunk
  - `documentId`: Authoritative document ID
  - `documentName`: Human-readable document name
  - `pageStart`: Authoritative starting page number from extraction
  - `pageEnd`: Authoritative ending page number
  - `score`: RRF fusion score
  - `content`: Original snippet text

### 2.2 Token Budget & Packing
- **Default Budget**: 4,000 tokens (approx. 16,000 characters).
- **Packing Strategy**: Chunks are sorted by RRF retrieval rank. Chunks are greedily packed until the token budget is reached. If a single high-priority chunk exceeds remaining space, it is safely truncated with an ellipsis rather than dropping the document entirely.
- **Diagnostic Logging**: Emits telemetry with `totalChunksReceived`, `chunksIncluded`, `chunksDiscarded`, and `estimatedTokensUsed`.

---

## 3. Answer-Generation Strategy

### 3.1 Strict Grounding Prompt
The prompt enforces factual precision:
1. **Direct Grounding Only**: Answers must rely strictly on information provided within the `<sources>` XML blocks.
2. **Mandatory Tagging**: Every substantive factual statement must cite its source using `[S1]`, `[S2]`, etc.
3. **No External Knowledge**: If retrieved context lacks the answer, the LLM is explicitly instructed to output:  
   *"Based on the provided document(s), there is insufficient information to answer this question."*
4. **No Speculation**: The model is forbidden from guessing page numbers or introducing unsourced facts.

### 3.2 Handling Edge Cases
- **No Chunks Retrieved**: Bypasses the LLM entirely or issues a safe fallback response stating that no relevant sections were found in the document.
- **Partial Evidence**: If only part of a complex query is answerable, the model is instructed to answer the supported portion with citations and explicitly note what the document does not mention.
- **Contradictory Sources**: When retrieved chunks report conflicting information across sections or documents, the LLM highlights both perspectives and cites their respective source IDs.

---

## 4. Structured Output Schema

The system tracks and emits structured citation metadata alongside the generated answer.

### 4.1 Citation Schema
```typescript
interface Citation {
  sourceId: string;        // e.g. "S1"
  index: number;           // 1-based user facing index (e.g. 1)
  documentId: string;      // Authoritative MongoDB documentId
  documentName: string;    // e.g. "Quarterly_Results.pdf"
  pageStart: number;       // Verified starting page
  pageEnd: number;         // Verified ending page
  snippet: string;         // Truncated excerpt (<= 200 chars)
  score: number;           // RRF relevance score
}
```

### 4.2 Evidence & Confidence Schema
- **`evidenceStatus`**:
  - `SUPPORTED`: Valid citations exist and text exhibits strong semantic alignment.
  - `PARTIALLY_SUPPORTED`: Answer is partially grounded or some claims lack direct snippet backing.
  - `INSUFFICIENT_EVIDENCE`: LLM indicated lack of info, no citations provided, or query unmatched.
  - `CONFLICTING_EVIDENCE`: Retrieved sources report contradictory claims.
- **`confidence`**:
  - `HIGH`: Multiple verified citations, high RRF score ($> 0.015$), and clear lexical overlap.
  - `MEDIUM`: At least one verified citation with moderate score.
  - `LOW`: Insufficient evidence, fallback answer, or no valid citations.

---

## 5. Citation Validation

The Citation Validation Service (`Backend/services/agent/pdf/answer/citationValidation.service.js`) acts as a zero-trust verification barrier:

### 5.1 Rejection of Hallucinations
1. **Invented Source IDs**: If the LLM generates `[S99]` but only `[S1]...[S3]` were in context, `[S99]` is rejected and stripped from the final user response.
2. **Invented Page Numbers**: The LLM's raw text may attempt to say *"on page 42"*. The validation engine ignores LLM-asserted page numbers and only displays `pageStart` and `pageEnd` retrieved from authoritative MongoDB chunk records.
3. **Tenant & Identity Verification**: Every cited chunk is checked against the active `userId` and `conversationId`. Any chunk failing ownership validation is purged immediately.

### 5.2 User-Facing Transformation
- Converts internal `[S1]`, `[S2]` markers into clean numbered badges: `[1]`, `[2]`.
- Strips malformed or orphaned source brackets without corrupting legitimate markdown formatting.
- Automatically appends a structured markdown **"Sources & References"** section at the bottom of the answer if verified citations exist:
  ```markdown
  ---
  **Sources & References:**
  - **[1]** *Quarterly_Results.pdf* (Page 3) — "Net revenue increased by 14% year-over-year..."
  ```

---

## 6. Multi-Document Behavior

When multiple documents are active in a conversation:
1. **Document-Aware Tagging**: Each `<source>` block includes both `docId` and `docName`.
2. **Cross-Document RRF**: Chunks from different PDFs compete fairly in the RRF fusion pool based on semantic and keyword similarity.
3. **Multi-Doc References**: Citations clearly distinguish which document each claim originates from (e.g. `[1] Report_A.pdf (Page 2)`, `[2] Report_B.pdf (Page 10)`).
4. **Resolution Routing**: Single-document questions automatically filter to the relevant document ID, while multi-document or comparative questions query across all documents registered to the conversation.

---

## 7. PDF Viewer Integration

The frontend PDF Viewer was upgraded to provide verifiable navigation directly to cited pages:

### 7.1 Deep-Linking Page Navigation (`PdfArtifactPanel.jsx`)
- Supports `#page=X&toolbar=0&navpanes=0` parameters on PDF `<object>` and `<iframe>` elements.
- **Dynamic Page Syncing**: Derives `currentPage` from `pdfDoc.initialPage` or user page navigation.
- **Interactive Controls**: Added Prev/Next page navigation bar, current page indicator, and jump-to-page input directly in the artifact panel header.
- **Cross-Browser Support**: Gracefully degrades to native browser PDF viewer navigation when embedded viewer controls are present.

### 7.2 Interactive Citation Badges (`Message.jsx`)
- When an assistant message has `citations`, interactive badges are rendered below the message or inline:
  ```jsx
  <span className="cursor-pointer bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded px-1.5 py-0.5 text-xs font-mono">
    [1] Page 3
  </span>
  ```
- **Click Behavior**: Clicking a badge triggers `onOpenArtifact(pdfDocWithInitialPage)`, opening the PDF Artifact Panel navigated directly to `citation.pageStart`.
- **Status Indicator**: Renders an evidence status pill (`SUPPORTED`, `PARTIALLY_SUPPORTED`, `INSUFFICIENT_EVIDENCE`) showing response grounding quality.

---

## 8. Persistence and Backward Compatibility

### 8.1 Database Schema (`message-model.js`)
The `Message` schema in `Backend/services/chat/models/message-model.js` was safely extended:
```javascript
citations: {
  type: [{
    sourceId: { type: String },
    index: { type: Number },
    documentId: { type: String },
    documentName: { type: String },
    pageStart: { type: Number },
    pageEnd: { type: Number },
    snippet: { type: String },
    score: { type: Number }
  }],
  default: []
},
evidenceStatus: {
  type: String,
  enum: ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE', null],
  default: null
},
confidence: {
  type: String,
  enum: ['HIGH', 'MEDIUM', 'LOW', null],
  default: null
}
```

### 8.2 Backward Compatibility
- Existing messages and non-PDF conversations have `citations: []`, `evidenceStatus: null`, and `confidence: null`.
- `chatController.saveTurn` accepts optional `citations`, `evidenceStatus`, and `confidence`, preserving existing call signatures.
- Legacy unchunked or single-page documents continue to function using existing fallback paths without errors.

---

## 9. Security and Ownership Checks

1. **Multi-Tenant Filter Enforcement**: Both `hybridRetrieval.service.js` and `citationValidation.service.js` enforce that all chunks belong to `userId` and `conversationId`.
2. **No Cross-User Leaks**: Chunks belonging to User A cannot be retrieved or cited in User B's conversation.
3. **Prompt Injection Mitigation**: XML tags in chunk contents (`</source>`, `<source>`) are neutralized prior to prompt interpolation to prevent jailbreaking the grounding boundary.
4. **Secret Protection**: No API keys, credentials, or internal tokens are exposed in error logs, SSE events, or database payloads.

---

## 10. Test Results: Mocked vs Live Tests

### 10.1 Automated Phase 4 Test Suite (`phase4_grounded_answers.test.js`)
All **30 / 30** automated tests pass with 0 failures:

| # | Test Name | Scope | Result |
|---|---|---|---|
| 1 | Single valid source extraction | Grounded Context | PASS |
| 2 | Multiple valid sources ordering | Grounded Context | PASS |
| 3 | Hallucinated source ID rejection (`[S99]`) | Citation Validation | PASS |
| 4 | Fabricated citation formatting removal | Citation Validation | PASS |
| 5 | Contradictory sources handling | Citation Validation | PASS |
| 6 | Insufficient evidence refusal detection | Citation Validation | PASS |
| 7 | Supported evidence classification | Citation Validation | PASS |
| 8 | Partially supported evidence classification | Citation Validation | PASS |
| 9 | High confidence calculation | Citation Validation | PASS |
| 10 | Medium confidence calculation | Citation Validation | PASS |
| 11 | Low confidence calculation | Citation Validation | PASS |
| 12 | Citation replacement (`[S1]` -> `[1]`) | Citation Validation | PASS |
| 13 | Authoritative page metadata mapping | Citation Validation | PASS |
| 14 | Cross-document citation distinction | Multi-Document | PASS |
| 15 | Multi-page range handling | Citation Validation | PASS |
| 16 | Token budget truncation handling | Token Packing | PASS |
| 17 | Deduplication of duplicate chunk citations | Grounded Context | PASS |
| 18 | Prompt injection neutralization in chunk text | Security / Sanitization | PASS |
| 19 | Missing chunk text graceful fallback | Error Handling | PASS |
| 20 | Missing source metadata handling | Error Handling | PASS |
| 21 | Empty retrieval results safe handling | Fallback | PASS |
| 22 | Partial retrieval failure handling | Fallback / Degradation | PASS |
| 23 | Cross-user chunk leakage prevention | Multi-Tenant Security | PASS |
| 24 | Cross-conversation chunk leakage prevention | Multi-Tenant Security | PASS |
| 25 | SSE event citation serialization | Controller / API | PASS |
| 26 | Message model citation persistence | Persistence | PASS |
| 27 | Backward compatibility with ungrounded messages | Compatibility | PASS |
| 28 | Deleted source document handling | Fallback | PASS |
| 29 | Follow-up question RAG execution | LangGraph PDF Agent | PASS |
| 30 | Existing PDF creation regression check | Regression | PASS |

### 10.2 Regression Test Suites Across All Phases
- `node --test Backend/services/agent/test/phase4_grounded_answers.test.js`: **30 / 30 PASSED**
- `node --test Backend/services/agent/test/phase3_hybrid_retrieval.test.js`: **30 / 30 PASSED**
- `node --test Backend/services/agent/test/phase2_1_production_readiness.test.js`: **19 / 19 PASSED**
- `node --test Backend/services/agent/test/phase2_pdf_embeddings.test.js`: **27 / 27 PASSED**
- `node --test Backend/services/agent/test/phase1_1_integration_audit.test.js`: **11 / 11 PASSED**
- `node --test Backend/services/agent/test/phase1_pdf_ingestion.test.js`: **27 / 27 PASSED**
- `node Backend/tests/agent/test-pdf.js`: **6 / 6 PASSED**

### 10.3 Frontend Lint & Production Build
- `npm --prefix Frontend run lint`: **0 errors, 0 warnings**
- `npm --prefix Frontend run build`: **Vite production build successful (2.49s)**

---

## 11. Browser Verification Status

- **Component Verification**: `Message.jsx` and `PdfArtifactPanel.jsx` were verified via static analysis, React ESLint verification, and headless Vite bundle compilation.
- **Deep-Linking**: Tested URL fragment generation (`#page=${targetPage}`).
- **Interactive Badge Click**: Verified that clicking a citation badge calls `onOpenArtifact` with the target document and `initialPage` matching `citation.pageStart`.

---

## 12. Performance and Token-Budget Considerations

1. **Prompt Overhead**: XML tags and metadata add ~100 tokens per chunk. With top-$k=5$, context overhead is ~500 tokens, well within the 4,000-token allocation.
2. **Context Compression**: High-similarity chunks are packed first; lower-ranked chunks that exceed budget are safely discarded with telemetry.
3. **Execution Latency**:
   - `buildGroundedContext`: $< 2\text{ms}$ execution time (in-memory parsing and XML building).
   - `validateAnswerCitations`: $< 5\text{ms}$ execution time (regex parsing, hash map lookups, and score calculations).
   - No additional LLM calls are introduced for verification; validation is performed deterministically.

---

## 13. Files Created and Modified

### Created Files:
1. `Backend/services/agent/pdf/answer/groundedContext.service.js` — Grounded XML context construction, prompt sanitization, token budgeting.
2. `Backend/services/agent/pdf/answer/citationValidation.service.js` — Citation tag extraction, hallucination removal, evidence/confidence classification, tag normalization (`[S1]` -> `[1]`).
3. `Backend/services/agent/test/phase4_grounded_answers.test.js` — 30-scenario comprehensive test suite.
4. `phase4_grounded_answers_report.md` — This comprehensive Phase 4 verification report.

### Modified Files:
1. `Backend/services/agent/agents/pdf-agent.js` — Integrated grounded context construction and citation validation into Case 3 follow-ups and Case 1 fallback.
2. `Backend/services/agent/graph/state.js` — Added `citations`, `evidenceStatus`, `confidence`, `retrievalTelemetry`, and `retrievedChunks` annotations.
3. `Backend/services/agent/controllers/agent.controller.js` — Emitted `citations`, `evidenceStatus`, `confidence` in SSE payloads and routed to `chatController.saveTurn`.
4. `Backend/services/chat/models/message-model.js` — Added `citations`, `evidenceStatus`, and `confidence` fields to Mongoose schema.
5. `Backend/services/chat/controllers/chat.controller.js` — Saved structured citations, evidence status, and confidence in database.
6. `Frontend/src/components/chat/Message.jsx` — Rendered interactive citation badges and evidence status indicators.
7. `Frontend/src/components/chat/PdfArtifactPanel.jsx` — Implemented page navigation controls and deep-link page loading.

---

## 14. Remaining Limitations

1. **Scanned / Image-Only PDFs**: Text extraction relies on `pdf-parse`. Scanned PDFs without an OCR layer yield no extracted text and cannot be chunked or retrieved.
2. **Complex Multi-Column Tables**: While structure-aware chunking preserves line breaks, tables spanning multiple pages may be split across chunks.
3. **Browser Native PDF Viewer Support**: Some mobile browsers do not support iframe `#page=X` URL fragments for embedded PDFs.

---

## 15. Git Status and Uncommitted Changes

All changes for Phases 1 through 4 remain strictly preserved in the working tree without any commits, pushes, resets, or stashes:

```
 M Backend/services/agent/agents/pdf-agent.js
 M Backend/services/agent/controllers/agent.controller.js
 M Backend/services/agent/graph/state.js
 M Backend/services/agent/utils/extractPdf.js
 M Backend/services/chat/controllers/chat.controller.js
 M Backend/services/chat/models/message-model.js
 M Backend/tests/agent/test-pdf.js
 M Frontend/src/components/chat/Message.jsx
 M Frontend/src/components/chat/PdfArtifactPanel.jsx
?? Backend/services/agent/models/pdfChunk.model.js
?? Backend/services/agent/pdf/
?? Backend/services/agent/test/phase1_1_integration_audit.test.js
?? Backend/services/agent/test/phase1_pdf_ingestion.test.js
?? Backend/services/agent/test/phase2_1_production_readiness.test.js
?? Backend/services/agent/test/phase2_pdf_embeddings.test.js
?? Backend/services/agent/test/phase3_hybrid_retrieval.test.js
?? Backend/services/agent/test/phase4_grounded_answers.test.js
?? phase1_1_pdf_integration_audit.md
?? phase1_pdf_ingestion_report.md
?? phase2_1_production_readiness_report.md
?? phase2_pdf_embeddings_report.md
?? phase3_1_retrieval_audit_report.md
?? phase3_hybrid_retrieval_report.md
?? phase4_grounded_answers_report.md
```

---

## 16. Recommendation for Phase 5

Phase 4 has established a robust, verifiable citation and grounded generation pipeline.

**Recommended Focus for Phase 5 (Advanced Document Understanding & Visual Grounding)**:
1. **Multimodal OCR**: Introduce Tesseract.js or Gemini Vision OCR for scanned pages and image-based PDFs.
2. **Visual Bounding Boxes**: Extract coordinate bounding boxes $(x, y, w, h)$ for chunks to highlight exact text snippets visually in the PDF viewer.
3. **Cross-Encoder Reranking**: Deploy a lightweight cross-encoder (e.g. BGE-Reranker or Cohere Rerank) to further sharpen precision prior to context packing.
4. **Table & Chart Understanding**: Implement specialized Markdown/HTML table extraction for complex financial or scientific documents.

