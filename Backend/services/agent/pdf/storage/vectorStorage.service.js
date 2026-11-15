import mongoose from "mongoose";
import PdfChunk, {
    ATLAS_VECTOR_INDEX_NAME,
    ATLAS_VECTOR_INDEX_SPEC,
    ATLAS_KEYWORD_INDEX_NAME,
    ATLAS_KEYWORD_INDEX_SPEC,
} from "../../models/pdfChunk.model.js";

// In-memory test store fallback for offline testing and development
export const memoryVectorStore = new Map();
export const getMemoryVectorStore = () => memoryVectorStore;

/**
 * Checks whether MongoDB is actively connected.
 *
 * @returns {boolean} True if MongoDB connection is ready
 */
export const isMongoConnected = () => {
    return mongoose.connection?.readyState === 1;
};

/**
 * Determines whether falling back to in-memory vector storage is permissible.
 * In production or live staging environments, memory fallback is rejected to prevent
 * false persistence positives. Permitted only in tests or explicit dev configurations.
 *
 * @returns {boolean}
 */
export const isMemoryFallbackAllowed = () => {
    if (process.env.ALLOW_MEMORY_VECTOR_STORE === "false") return false;
    return (
        process.env.NODE_ENV === "test" ||
        process.env.ALLOW_MEMORY_VECTOR_STORE === "true" ||
        process.env.NODE_TEST_CONTEXT !== undefined
    );
};

/**
 * Clears the in-memory vector store (used in test teardown).
 */
export const resetMemoryVectorStore = () => {
    memoryVectorStore.clear();
};

/**
 * Persists an array of embedded chunks into MongoDB using bulkWrite upserts for idempotency.
 * Falls back to in-memory store in offline or test environments.
 *
 * @param {string} documentId - Orbit document ID
 * @param {string} conversationId - Orbit conversation ID
 * @param {string} userId - User ID for multi-tenant ownership
 * @param {Array<object>} embeddedChunks - Chunks with embeddings attached
 * @returns {Promise<{ totalStored: number, upsertedCount: number, modifiedCount: number }>}
 */
export const storeChunkEmbeddings = async (
    documentId,
    conversationId,
    userId,
    embeddedChunks = []
) => {
    if (!documentId) throw new Error("storeChunkEmbeddings requires a valid documentId");
    if (!conversationId) throw new Error("storeChunkEmbeddings requires a valid conversationId");
    if (!userId) throw new Error("storeChunkEmbeddings requires a valid userId");
    if (!Array.isArray(embeddedChunks) || embeddedChunks.length === 0) {
        return { totalStored: 0, upsertedCount: 0, modifiedCount: 0 };
    }

    const convIdStr = String(conversationId);
    const userIdStr = String(userId);

    // Verify all chunks have valid embeddings
    for (const chunk of embeddedChunks) {
        if (!chunk.chunkId || !chunk.contentHash) {
            throw new Error("Invalid chunk payload: chunkId and contentHash are required");
        }
        if (!Array.isArray(chunk.embedding) || chunk.embedding.length === 0) {
            throw new Error(`Chunk ${chunk.chunkId} is missing embedding vector`);
        }
    }

    if (isMongoConnected()) {
        const operations = embeddedChunks.map((chunk) => ({
            updateOne: {
                filter: { documentId, chunkId: chunk.chunkId },
                update: {
                    $set: {
                        documentId,
                        conversationId: convIdStr,
                        userId: userIdStr,
                        chunkId: chunk.chunkId,
                        chunkIndex: chunk.chunkIndex,
                        pageStart: chunk.pageStart,
                        pageEnd: chunk.pageEnd,
                        section: chunk.section || "General",
                        content: chunk.content,
                        tokenCount: chunk.tokenCount || 0,
                        characterCount: chunk.characterCount || 0,
                        startOffset: chunk.startOffset || 0,
                        endOffset: chunk.endOffset || 0,
                        contentHash: chunk.contentHash,
                        contentType: chunk.contentType || "TEXT",
                        extractionMethod: chunk.extractionMethod || "text",
                        visualMetadata: chunk.visualMetadata || null,
                        embedding: chunk.embedding,
                        embeddingModel: chunk.embeddingModel || "gemini-embedding-001",
                        embeddingDimensions: chunk.embeddingDimensions || chunk.embedding.length,
                    },
                },
                upsert: true,
            },
        }));

        const result = await PdfChunk.bulkWrite(operations, { ordered: false });
        return {
            totalStored: embeddedChunks.length,
            upsertedCount: result.upsertedCount || 0,
            modifiedCount: result.modifiedCount || 0,
        };
    }

    if (!isMemoryFallbackAllowed()) {
        throw new Error(
            "MongoDB connection is unavailable. Cannot persist chunk embeddings in non-test environment."
        );
    }

    // Memory store fallback
    for (const chunk of embeddedChunks) {
        const key = `${documentId}:${chunk.chunkId}`;
        memoryVectorStore.set(key, {
            documentId,
            conversationId: convIdStr,
            userId: userIdStr,
            chunkId: chunk.chunkId,
            chunkIndex: chunk.chunkIndex,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            section: chunk.section || "General",
            content: chunk.content,
            tokenCount: chunk.tokenCount || 0,
            characterCount: chunk.characterCount || 0,
            startOffset: chunk.startOffset || 0,
            endOffset: chunk.endOffset || 0,
            contentHash: chunk.contentHash,
            contentType: chunk.contentType || "TEXT",
            extractionMethod: chunk.extractionMethod || "text",
            visualMetadata: chunk.visualMetadata || null,
            embedding: chunk.embedding,
            embeddingModel: chunk.embeddingModel || "gemini-embedding-001",
            embeddingDimensions: chunk.embeddingDimensions || chunk.embedding.length,
            updatedAt: new Date(),
        });
    }

    return {
        totalStored: embeddedChunks.length,
        upsertedCount: embeddedChunks.length,
        modifiedCount: 0,
    };
};

/**
 * Retrieves existing stored chunks for a document to check for valid embeddings and content hashes.
 *
 * @param {string} documentId - Document ID
 * @returns {Promise<Map<string, { contentHash: string, embeddingModel: string, embeddingDimensions: number, embedding: number[] }>>}
 */
export const getExistingDocumentChunks = async (documentId) => {
    if (!documentId) return new Map();

    const chunkMap = new Map();

    if (isMongoConnected()) {
        const docs = await PdfChunk.find(
            { documentId },
            "chunkId contentHash embeddingModel embeddingDimensions embedding"
        ).lean();

        for (const doc of docs) {
            chunkMap.set(doc.chunkId, {
                contentHash: doc.contentHash,
                embeddingModel: doc.embeddingModel,
                embeddingDimensions: doc.embeddingDimensions,
                embedding: doc.embedding,
            });
        }
        return chunkMap;
    }

    if (!isMemoryFallbackAllowed()) {
        throw new Error(
            "MongoDB connection is unavailable. Cannot retrieve existing chunk embeddings in non-test environment."
        );
    }

    // Memory store fallback
    for (const [key, val] of memoryVectorStore.entries()) {
        if (val.documentId === documentId) {
            chunkMap.set(val.chunkId, {
                contentHash: val.contentHash,
                embeddingModel: val.embeddingModel,
                embeddingDimensions: val.embeddingDimensions,
                embedding: val.embedding,
            });
        }
    }

    return chunkMap;
};

/**
 * Deletes all stored chunks and vectors belonging to a specific document.
 *
 * @param {string} conversationId - Conversation ID
 * @param {string} documentId - Document ID
 * @returns {Promise<{ deletedCount: number }>}
 */
export const deleteDocumentChunks = async (conversationIdOrDocId, documentId = null) => {
    let convId = conversationIdOrDocId;
    let docId = documentId;
    if (!docId && convId) {
        docId = convId;
        convId = null;
    }
    if (!docId) return { deletedCount: 0 };

    if (isMongoConnected()) {
        const filter = { documentId: docId };
        if (convId) filter.conversationId = String(convId);
        const result = await PdfChunk.deleteMany(filter);
        return { deletedCount: result.deletedCount || 0 };
    }

    if (!isMemoryFallbackAllowed()) {
        throw new Error(
            "MongoDB connection is unavailable. Cannot delete document chunks in non-test environment."
        );
    }

    // Memory store fallback
    let deletedCount = 0;
    for (const [key, val] of memoryVectorStore.entries()) {
        if (val.documentId === docId && (!convId || val.conversationId === String(convId))) {
            memoryVectorStore.delete(key);
            deletedCount++;
        }
    }
    return { deletedCount };
};

/**
 * Deletes all stored chunks and vectors belonging to an entire conversation.
 *
 * @param {string} conversationId - Conversation ID
 * @returns {Promise<{ deletedCount: number }>}
 */
export const deleteConversationChunks = async (conversationId) => {
    if (!conversationId) return { deletedCount: 0 };
    const convIdStr = String(conversationId);

    if (isMongoConnected()) {
        const result = await PdfChunk.deleteMany({ conversationId: convIdStr });
        return { deletedCount: result.deletedCount || 0 };
    }

    if (!isMemoryFallbackAllowed()) {
        throw new Error(
            "MongoDB connection is unavailable. Cannot delete conversation chunks in non-test environment."
        );
    }

    // Memory store fallback
    let deletedCount = 0;
    for (const [key, val] of memoryVectorStore.entries()) {
        if (val.conversationId === convIdStr) {
            memoryVectorStore.delete(key);
            deletedCount++;
        }
    }
    return { deletedCount };
};

/**
 * Attempts to provision or verify the Atlas Vector Search index on the collection.
 * Reports status cleanly without failing if Atlas Search is unsupported on local deployments.
 *
 * @returns {Promise<{ indexName: string, status: string, error?: string }>}
 */
export const initVectorSearchIndex = async () => {
    if (!isMongoConnected()) {
        return {
            indexName: ATLAS_VECTOR_INDEX_NAME,
            status: "DISCONNECTED",
            error: "MongoDB is not connected",
        };
    }

    try {
        if (typeof PdfChunk.createSearchIndex === "function") {
            const indexResult = await PdfChunk.createSearchIndex(ATLAS_VECTOR_INDEX_SPEC);
            return {
                indexName: ATLAS_VECTOR_INDEX_NAME,
                status: "PROVISIONED",
                result: indexResult,
            };
        }
        return {
            indexName: ATLAS_VECTOR_INDEX_NAME,
            status: "UNSUPPORTED_DRIVER",
            error: "Mongoose model createSearchIndex is not available",
        };
    } catch (err) {
        // If index already exists or Atlas search is not enabled on this tier (e.g. local replica or community)
        const isDuplicate = /already\s*exists/i.test(err.message);
        return {
            indexName: ATLAS_VECTOR_INDEX_NAME,
            status: isDuplicate ? "ALREADY_EXISTS" : "UNAVAILABLE",
            error: err.message,
        };
    }
};

/**
 * Attempts to provision or verify the Atlas full-text Search index on the collection.
 *
 * @returns {Promise<{ indexName: string, status: string, error?: string }>}
 */
export const initKeywordSearchIndex = async () => {
    if (!isMongoConnected()) {
        return {
            indexName: ATLAS_KEYWORD_INDEX_NAME,
            status: "DISCONNECTED",
            error: "MongoDB is not connected",
        };
    }

    try {
        if (typeof PdfChunk.createSearchIndex === "function") {
            const indexResult = await PdfChunk.createSearchIndex(ATLAS_KEYWORD_INDEX_SPEC);
            return {
                indexName: ATLAS_KEYWORD_INDEX_NAME,
                status: "PROVISIONED",
                result: indexResult,
            };
        }
        return {
            indexName: ATLAS_KEYWORD_INDEX_NAME,
            status: "UNSUPPORTED_DRIVER",
            error: "Mongoose model createSearchIndex is not available",
        };
    } catch (err) {
        const isDuplicate = /already\s*exists/i.test(err.message);
        return {
            indexName: ATLAS_KEYWORD_INDEX_NAME,
            status: isDuplicate ? "ALREADY_EXISTS" : "UNAVAILABLE",
            error: err.message,
        };
    }
};

export {
    ATLAS_VECTOR_INDEX_NAME,
    ATLAS_VECTOR_INDEX_SPEC,
    ATLAS_KEYWORD_INDEX_NAME,
    ATLAS_KEYWORD_INDEX_SPEC,
};

