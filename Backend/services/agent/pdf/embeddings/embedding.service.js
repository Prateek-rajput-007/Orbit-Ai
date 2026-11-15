import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });
dotenv.config();

import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

export const DEFAULT_EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "gemini-embedding-001";
export const DEFAULT_EMBEDDING_DIMENSIONS = parseInt(process.env.EMBEDDING_DIMENSIONS, 10) || 768;
export const DEFAULT_BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE, 10) || 20;
export const MAX_RETRIES = 3;
export const INITIAL_BACKOFF_MS = 800;

/**
 * Returns the currently active embedding model identifier.
 *
 * @returns {string} Model name
 */
export const getEmbeddingModel = () => {
    return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
};

/**
 * Returns the expected vector dimension count.
 *
 * @returns {number} Vector dimensions (768 for text-embedding-004)
 */
export const getEmbeddingDimensions = () => {
    return parseInt(process.env.EMBEDDING_DIMENSIONS, 10) || DEFAULT_EMBEDDING_DIMENSIONS;
};

/**
 * Validates that an embedding vector is an array of finite numbers matching expected dimensions.
 *
 * @param {any} vector - Embedding vector candidate
 * @param {number} [expectedDim] - Required dimension count
 * @throws {Error} If vector is invalid
 * @returns {boolean} True if valid
 */
export const validateVector = (vector, expectedDim = getEmbeddingDimensions()) => {
    if (!Array.isArray(vector)) {
        throw new Error("Invalid embedding response: vector must be an array of numbers");
    }
    if (vector.length !== expectedDim) {
        throw new Error(`Invalid embedding dimensions: expected ${expectedDim}, received ${vector.length}`);
    }
    for (let i = 0; i < vector.length; i++) {
        const val = vector[i];
        if (typeof val !== "number" || !Number.isFinite(val)) {
            throw new Error(`Invalid embedding vector element at index ${i}: value is not a finite number (${val})`);
        }
    }
    return true;
};

/**
 * Factory for the underlying LangChain Google embedding client.
 *
 * @param {object} [customConfig] - Optional client configuration overrides
 * @returns {GoogleGenerativeAIEmbeddings} Configured client
 */
export const createEmbeddingClient = (customConfig = {}) => {
    const apiKey = customConfig.apiKey || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    const model = customConfig.model || getEmbeddingModel();
    const dimensions = customConfig.dimensions || getEmbeddingDimensions();

    return new GoogleGenerativeAIEmbeddings({
        apiKey,
        model,
        outputDimensionality: dimensions,
        ...customConfig,
    });
};

/**
 * Executes a function with bounded exponential backoff for transient rate limits and network errors.
 *
 * @param {Function} fn - Async operation to execute
 * @param {number} [retries=MAX_RETRIES] - Maximum retry attempts
 * @param {number} [backoff=INITIAL_BACKOFF_MS] - Initial backoff in milliseconds
 * @returns {Promise<any>}
 */
const executeWithBackoff = async (fn, retries = MAX_RETRIES, backoff = INITIAL_BACKOFF_MS) => {
    let attempt = 0;
    while (attempt <= retries) {
        try {
            return await fn();
        } catch (err) {
            attempt++;
            const isRateLimit = err?.status === 429 || /rate\s*limit|quota|429/i.test(err?.message || "");
            const isTransientServer = err?.status === 503 || /503|unavailable|econnreset|timeout/i.test(err?.message || "");
            const isRetryable = isRateLimit || isTransientServer;

            if (attempt > retries || !isRetryable) {
                throw err;
            }

            const jitter = Math.random() * 200;
            const delay = backoff * Math.pow(2, attempt - 1) + jitter;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
};

/**
 * Generates an embedding vector for a single string of text.
 *
 * @param {string} text - Input content
 * @param {object} [options] - Options or client overrides
 * @returns {Promise<number[]>} 768-dimensional embedding vector
 */
export const generateEmbedding = async (text, options = {}) => {
    if (!text || typeof text !== "string" || !text.trim()) {
        throw new Error("Cannot generate embedding: input text must be a non-empty string");
    }

    const client = options.client || createEmbeddingClient(options);
    const expectedDim = options.dimensions || getEmbeddingDimensions();

    const vector = await executeWithBackoff(async () => {
        return await client.embedQuery(text.trim());
    }, options.maxRetries || MAX_RETRIES);

    validateVector(vector, expectedDim);
    return vector;
};

/**
 * Generates embeddings for an array of texts in controlled batches.
 *
 * Guarantees:
 * 1. Chunks texts into batches of size `batchSize` (default: 20).
 * 2. Preserves the exact index ordering of the input texts.
 * 3. Applies exponential backoff on rate limits.
 * 4. Verifies dimensions and validity of all generated vectors.
 *
 * @param {string[]} texts - Array of input texts
 * @param {object} [options] - Batch and client options
 * @param {number} [options.batchSize] - Batch size (default: 20)
 * @returns {Promise<number[][]>} Array of embedding vectors matching input texts length
 */
export const generateEmbeddingsBatch = async (texts = [], options = {}) => {
    if (!Array.isArray(texts)) {
        throw new Error("Cannot generate embeddings: texts must be an array");
    }
    if (texts.length === 0) {
        return [];
    }

    for (let i = 0; i < texts.length; i++) {
        if (!texts[i] || typeof texts[i] !== "string" || !texts[i].trim()) {
            throw new Error(`Cannot generate embedding batch: item at index ${i} is empty or not a string`);
        }
    }

    const batchSize = Math.max(1, options.batchSize || DEFAULT_BATCH_SIZE);
    const client = options.client || createEmbeddingClient(options);
    const expectedDim = options.dimensions || getEmbeddingDimensions();

    const allVectors = [];

    for (let i = 0; i < texts.length; i += batchSize) {
        const batchSlice = texts.slice(i, i + batchSize).map((t) => t.trim());

        const batchVectors = await executeWithBackoff(async () => {
            return await client.embedDocuments(batchSlice);
        }, options.maxRetries || MAX_RETRIES);

        if (!Array.isArray(batchVectors) || batchVectors.length !== batchSlice.length) {
            throw new Error(
                `Batch embedding mismatch: requested ${batchSlice.length} vectors, received ${batchVectors?.length || 0}`
            );
        }

        for (let j = 0; j < batchVectors.length; j++) {
            validateVector(batchVectors[j], expectedDim);
        }

        allVectors.push(...batchVectors);
    }

    return allVectors;
};

