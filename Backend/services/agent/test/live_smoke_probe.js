import dotenv from "dotenv";
import path from "node:path";
import mongoose from "mongoose";
import { ChatGroq } from "@langchain/groq";
import { createEmbeddingClient } from "../pdf/embeddings/embedding.service.js";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

function redact(str = "") {
    if (!str || typeof str !== "string") return str;
    return str
        .replace(/mongodb(?:\+srv)?:\/\/[^@]+@/gi, "mongodb+srv://[REDACTED_USER]:[REDACTED_PASS]@")
        .replace(/gsk_[a-zA-Z0-9_-]+/gi, "gsk_[REDACTED]")
        .replace(/AIzaSy[a-zA-Z0-9_-]+/gi, "AIzaSy[REDACTED]")
        .replace(/:[^:@]+@grand-skylark/gi, ":[REDACTED_PASS]@grand-skylark");
}

async function runLiveProbe() {
    console.log("=== LIVE INFRASTRUCTURE PROBE ===");

    // 1. Redis
    console.log("\n1. Testing Redis Connection...");
    const redisUrl = process.env.REDIS_URL;
    let redisResult = { status: "UNKNOWN" };
    try {
        const { default: redis } = await import("../../../shared/redis/redis.js");
        const pingStart = Date.now();
        const pong = await Promise.race([
            redis.ping(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 5000ms")), 5000))
        ]);
        const duration = Date.now() - pingStart;
        redisResult = { status: "AVAILABLE", pong, durationMs: duration };
        console.log("Redis PING:", pong, `(${duration}ms)`);
    } catch (err) {
        redisResult = { status: "UNAVAILABLE", error: redact(err.message) };
        console.log("Redis FAILED:", redact(err.message));
    }

    // 2. MongoDB Atlas
    console.log("\n2. Testing MongoDB Atlas Connection...");
    let mongoResult = { status: "UNKNOWN" };
    try {
        const mongoStart = Date.now();
        await Promise.race([
            mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 6000ms")), 6000))
        ]);
        const duration = Date.now() - mongoStart;
        const state = mongoose.connection.readyState;
        mongoResult = { status: "AVAILABLE", readyState: state, durationMs: duration };
        console.log("MongoDB State:", state, `(${duration}ms)`);

        // Check Atlas Vector Search Index
        console.log("\n3. Testing Atlas Search Indexes on 'pdfchunks'...");
        try {
            const collection = mongoose.connection.db.collection("pdfchunks");
            const indexesCursor = collection.listSearchIndexes();
            const indexes = await indexesCursor.toArray();
            console.log("Search Indexes Found:", indexes.map(idx => ({ name: idx.name, status: idx.status, queryable: idx.queryable })));
        } catch (idxErr) {
            console.log("Search Index Inspection:", redact(idxErr.message));
        }
    } catch (err) {
        mongoResult = { status: "UNAVAILABLE", error: redact(err.message) };
        console.log("MongoDB FAILED:", redact(err.message));
    }

    // 4. Google Generative AI Embeddings
    console.log("\n4. Testing Google Generative AI Embeddings API...");
    let embedResult = { status: "UNKNOWN" };
    try {
        const embedder = createEmbeddingClient();
        const embStart = Date.now();
        const vec = await Promise.race([
            embedder.embedQuery("Apex Global Financial Performance"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 6000ms")), 6000))
        ]);
        const duration = Date.now() - embStart;
        embedResult = { status: "AVAILABLE", model: embedder.model || embedder.modelName || "gemini-embedding-001", dimensions: vec.length, durationMs: duration };
        console.log("Embeddings Generated! Dimensions:", vec.length, `(${duration}ms)`);
    } catch (err) {
        embedResult = { status: "UNAVAILABLE", error: redact(err.message) };
        console.log("Embeddings FAILED:", redact(err.message));
    }

    // 5. Groq LLM API
    console.log("\n5. Testing Groq LLM API...");
    let groqResult = { status: "UNKNOWN" };
    try {
        const groqChat = new ChatGroq({
            model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
            apiKey: process.env.GROQ_API_KEY,
            maxRetries: 0,
        });
        const groqStart = Date.now();
        const res = await Promise.race([
            groqChat.invoke("Reply strictly with the word: READY"),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 6000ms")), 6000))
        ]);
        const duration = Date.now() - groqStart;
        groqResult = { status: "AVAILABLE", response: res.content?.trim(), durationMs: duration };
        console.log("Groq LLM Response:", res.content?.trim(), `(${duration}ms)`);
    } catch (err) {
        groqResult = { status: "UNAVAILABLE", error: redact(err.message) };
        console.log("Groq LLM FAILED:", redact(err.message));
    }

    console.log("\n=== PROBE SUMMARY ===");
    console.log(JSON.stringify({ redis: redisResult, mongo: mongoResult, embeddings: embedResult, groq: groqResult }, null, 2));

    try {
        await mongoose.disconnect();
    } catch {}
    process.exit(0);
}

runLiveProbe().catch(err => {
    console.error("Fatal Probe Error:", redact(err.message));
    process.exit(1);
});
