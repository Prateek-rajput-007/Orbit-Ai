import {
    generateEmbedding,
    validateVector,
    getEmbeddingModel,
    getEmbeddingDimensions,
} from "../embeddings/embedding.service.js";

/**
 * Generates and validates an embedding vector for user search queries.
 * Reuses the existing Google Gemini embedding client and dimensions (768).
 *
 * @param {string} query - Raw search prompt or question
 * @param {object} [options] - Configuration overrides (e.g., custom client, retries)
 * @returns {Promise<{ vector: number[], model: string, dimensions: number, durationMs: number }>}
 */
export const generateQueryEmbedding = async (query = "", options = {}) => {
    if (!query || typeof query !== "string" || !query.trim()) {
        throw new Error("Cannot generate query embedding: query must be a non-empty string");
    }

    const cleanQuery = query.trim();
    const startTime = Date.now();
    const model = options.model || getEmbeddingModel();
    const dimensions = options.dimensions || getEmbeddingDimensions();

    const vector = await generateEmbedding(cleanQuery, {
        ...options,
        model,
        dimensions,
    });

    validateVector(vector, dimensions);

    return {
        vector,
        model,
        dimensions,
        durationMs: Date.now() - startTime,
    };
};

