import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config();
import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const groqApiKey = process.env.GROQ_API_KEY || "gsk_placeholder_for_unit_testing";
const googleApiKey = process.env.GOOGLE_API_KEY || "AIzaSy_placeholder_for_unit_testing";

// 1. High-speed Groq Model (LPU inference)
const groq = new ChatGroq({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,
    apiKey: groqApiKey,
});

// 2. Primary Gemini Model
const geminiPrimary = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,
    apiKey: googleApiKey,
});

// 3. Secondary Gemini Fallback Model (when primary experiences 503 capacity spikes)
const geminiFallback1 = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_FALLBACK_MODEL || "gemini-3.6-flash",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,
    apiKey: googleApiKey,
});

// 4. Tertiary Gemini Fallback Model
const geminiFallback2 = new ChatGoogleGenerativeAI({
    model: "gemini-3.5-flash-lite",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,
    apiKey: googleApiKey,
});

// 5. Quaternary Gemini Fallback Model
const geminiFallback3 = new ChatGoogleGenerativeAI({
    model: "gemini-3.8-flash",
    temperature: 0,
    maxTokens: undefined,
    maxRetries: 2,
    apiKey: googleApiKey,
});

// Resilient Multimodal Model (for PDF, Vision, Image)
// Failover chain: gemini-3.5-flash -> gemini-3.6-flash -> gemini-3.8-flash -> gemini-3.5-flash-lite
const geminiMultimodal = geminiPrimary.withFallbacks([
    geminiFallback1,
    geminiFallback3,
    geminiFallback2,
]);
geminiMultimodal.model = geminiPrimary.model;

// High-speed Coding Model (Cross-Provider Failover)
// Configurable provider: default to Groq LPU (openai/gpt-oss-120b) for sub-10s multi-file generation.
// Override via CODING_MODEL_PROVIDER="gemini"|"groq" in environment.
const codingProvider = (process.env.CODING_MODEL_PROVIDER || "groq").toLowerCase();
const groqCodingModelName = process.env.GROQ_CODING_MODEL || process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const groqCoding = new ChatGroq({
    model: groqCodingModelName,
    temperature: 0,
    maxTokens: 8192,
    maxRetries: 0, // Fail fast on rate limits (429) so Gemini fallback triggers immediately
    apiKey: groqApiKey,
});

// Additional Groq fallback models with separate daily token quotas on the same Groq account.
// qwen3.8-27b and gpt-oss-20b have independent 200K token/day pools, so when gpt-oss-120b is
// exhausted these kick in before falling all the way back to the Gemini free tier.
const groqQwen = new ChatGroq({
    model: "qwen/qwen3.8-27b",
    temperature: 0,
    maxTokens: 8192,
    maxRetries: 0,
    apiKey: groqApiKey,
});

const groqGpt20b = new ChatGroq({
    model: "openai/gpt-oss-20b",
    temperature: 0,
    maxTokens: 8192,
    maxRetries: 0,
    apiKey: groqApiKey,
});

const codingModel = (codingProvider === "gemini")
    ? geminiPrimary.withFallbacks([geminiFallback1, geminiFallback2, groqCoding])
    : groqCoding.withFallbacks([groqQwen, groqGpt20b, geminiPrimary, geminiFallback1, geminiFallback2]);

codingModel.model = (codingProvider === "gemini") ? geminiPrimary.model : groqCodingModelName;
codingModel.provider = codingProvider;

// High-speed, Low-latency Groq Model for Chat & Search (bounded maxTokens & fail-fast retries)
const groqFast = new ChatGroq({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    temperature: 0,
    maxTokens: 1024,
    maxRetries: 0, // Fail fast on rate limits (429) or timeouts so fallback triggers without 11s stall
    apiKey: groqApiKey,
});
groqFast.provider = "groq";

const geminiFastFallback = new ChatGoogleGenerativeAI({
    model: process.env.GEMINI_MODEL || "gemini-3.5-flash",
    temperature: 0,
    maxTokens: 1024,
    maxRetries: 1,
    apiKey: googleApiKey,
});
geminiFastFallback.provider = "google";

// Resilient Chat and Search Models (Cross-Provider Failover from Groq to Gemini)
const chatModel = groqFast.withFallbacks([geminiFastFallback, geminiFallback1]);
chatModel.model = groqFast.model;
chatModel.provider = "groq";

const searchModel = groqFast.withFallbacks([geminiFastFallback, geminiFallback1]);
searchModel.model = groqFast.model;
searchModel.provider = "groq";

export const getModel = (agent) => {
    switch (agent) {
        case "router":
            return groqFast;
        case "chat":
            return groqFast;
        case "chat_fallback":
            return geminiFastFallback;
        case "chat_chain":
            return chatModel;
        case "search":
            return groqFast;
        case "search_fallback":
            return geminiFastFallback;
        case "search_chain":
            return searchModel;
        case "coding":
            return codingModel;
        case "pdf":
            return geminiMultimodal;
        case "ppt":
            return groq;
        case "vision":
            return geminiMultimodal;
        case "image":
            return geminiMultimodal;
        default:
            return groqFast;
    }
};

export { groq, groqFast, geminiFastFallback, geminiPrimary as gemini, geminiMultimodal, codingModel, chatModel, searchModel, groqQwen, groqGpt20b };
