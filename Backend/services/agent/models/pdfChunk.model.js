import mongoose from "mongoose";

export const ATLAS_VECTOR_INDEX_NAME = "pdf_chunk_vector_index";
export const ATLAS_KEYWORD_INDEX_NAME = "pdf_chunk_keyword_index";

/**
 * MongoDB Atlas Vector Search index specification for PDF chunks.
 * Uses 768 dimensions (Gemini embedding standard) with Cosine similarity,
 * with indexed pre-filters on userId, conversationId, and documentId for strict multi-tenant isolation.
 */
export const ATLAS_VECTOR_INDEX_SPEC = {
    name: ATLAS_VECTOR_INDEX_NAME,
    type: "vectorSearch",
    definition: {
        fields: [
            {
                type: "vector",
                path: "embedding",
                numDimensions: 768,
                similarity: "cosine",
            },
            {
                type: "filter",
                path: "userId",
            },
            {
                type: "filter",
                path: "conversationId",
            },
            {
                type: "filter",
                path: "documentId",
            },
        ],
    },
};

/**
 * MongoDB Atlas Search Lucene index specification for full-text keyword BM25 retrieval (optional Atlas Search index; active implementation uses collection-level $text index).
 */
export const ATLAS_KEYWORD_INDEX_SPEC = {
    name: ATLAS_KEYWORD_INDEX_NAME,
    type: "search",
    definition: {
        mappings: {
            dynamic: false,
            fields: {
                content: {
                    type: "string",
                    analyzer: "lucene.standard",
                },
                section: {
                    type: "string",
                    analyzer: "lucene.standard",
                },
                userId: {
                    type: "string",
                    index: false,
                },
                conversationId: {
                    type: "string",
                    index: false,
                },
                documentId: {
                    type: "string",
                    index: false,
                },
            },
        },
    },
};

const pdfChunkSchema = new mongoose.Schema(
    {
        chunkId: {
            type: String,
            required: true,
            index: true,
        },
        documentId: {
            type: String,
            required: true,
            index: true,
        },
        conversationId: {
            type: String,
            required: true,
            index: true,
        },
        userId: {
            type: String,
            required: true,
            index: true,
        },
        chunkIndex: {
            type: Number,
            required: true,
        },
        pageStart: {
            type: Number,
            required: true,
        },
        pageEnd: {
            type: Number,
            required: true,
        },
        section: {
            type: String,
            default: "General",
            trim: true,
        },
        content: {
            type: String,
            required: true,
        },
        tokenCount: {
            type: Number,
            default: 0,
        },
        characterCount: {
            type: Number,
            default: 0,
        },
        startOffset: {
            type: Number,
            default: 0,
        },
        endOffset: {
            type: Number,
            default: 0,
        },
        contentHash: {
            type: String,
            required: true,
        },
        contentType: {
            type: String,
            enum: ["TEXT", "OCR_TEXT", "TABLE", "CHART"],
            default: "TEXT",
            index: true,
        },
        extractionMethod: {
            type: String,
            default: "text",
        },
        visualMetadata: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        embedding: {
            type: [Number],
            required: true,
            validate: {
                validator: (v) => Array.isArray(v) && v.length > 0 && v.every((n) => Number.isFinite(n)),
                message: "Embedding must be a non-empty array of finite numbers",
            },
        },
        embeddingModel: {
            type: String,
            required: true,
            default: "gemini-embedding-001",
        },
        embeddingDimensions: {
            type: Number,
            required: true,
            default: 768,
        },
    },
    {
        timestamps: true,
    }
);

// Idempotent uniqueness: one unique chunk per document
pdfChunkSchema.index({ documentId: 1, chunkId: 1 }, { unique: true });

// Ownership & multi-tenant isolation filtering
pdfChunkSchema.index({ userId: 1, conversationId: 1, documentId: 1 });
pdfChunkSchema.index({ conversationId: 1, createdAt: 1 });

// Full-text search index for TF-weighted keyword matching across database deployments ($text / textScore)
pdfChunkSchema.index(
    { content: "text", section: "text" },
    { weights: { section: 3, content: 1 }, name: "pdf_chunk_text_search_index" }
);

const PdfChunk = mongoose.models.PdfChunk || mongoose.model("PdfChunk", pdfChunkSchema);

export default PdfChunk;

