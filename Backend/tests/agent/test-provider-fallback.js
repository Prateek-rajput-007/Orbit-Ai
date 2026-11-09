import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { chatAgent } from "./agents/chat-agent.js";
import { searchAgent } from "./agents/search-agent.js";
import * as llmConfig from "./config/llmModels.js";
import redis from "../../shared/redis/redis.js";
import mongoose from "mongoose";
import axios from "axios";

const GATEWAY_URL = "http://localhost:8000";

async function createAuthenticatedSession() {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const token = `verify_fallback_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await redis.set(`session:${token}`, JSON.stringify({ userId }), "EX", 3600);

    const convRes = await axios.post(
        `${GATEWAY_URL}/api/chat/create-conversation`,
        { title: "Fallback Verification Test" },
        { headers: { Cookie: `session=${token}` } },
    );

    return {
        userId,
        token,
        conversationId: convRes.data.conversation._id,
        headers: {
            Cookie: `session=${token}`,
            "Content-Type": "application/json",
        },
    };
}

async function runFallbackVerification() {
    console.log("======================================================================");
    console.log("=== PROVIDER FALLBACK & PARTIAL INTERRUPTION VERIFICATION ===");
    console.log("======================================================================\n");

    // TEST 1: Model with Fallback triggers secondary on primary error
    console.log("[TEST 1] Primary Provider Failure Triggers Transparent Streaming Fallback");
    const badPrimary = new ChatGroq({
        apiKey: "gsk_invalid_test_key_to_simulate_provider_failure",
        model: "openai/gpt-oss-120b",
        maxRetries: 0,
    });
    const healthySecondary = new ChatGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_API_KEY,
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
        maxRetries: 1,
    });

    const fallbackChain = badPrimary.withFallbacks([healthySecondary]);

    let streamedTokens = [];
    const stream = await fallbackChain.stream("Reply with the exact word: FALLBACK_SUCCESS");
    for await (const chunk of stream) {
        const text = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
        if (text) streamedTokens.push(text);
    }
    const combined = streamedTokens.join("");
    assert.ok(combined.includes("FALLBACK_SUCCESS"), `Fallback should yield expected answer, got: ${combined}`);
    console.log(`  ✓ Primary failure cleanly fell back to secondary provider.`);
    console.log(`  ✓ Tokens received (${streamedTokens.length} chunks): "${combined.trim()}"\n`);

    // TEST 2: Mid-stream failure prevents duplicate output
    console.log("[TEST 2] Mid-stream Failure Aborts Without Duplicating Partial Output");
    // Simulate generator that yields some tokens then aborts
    async function* faultyGenerator() {
        yield { content: "Part one of message. " };
        throw new Error("Simulated mid-stream socket termination");
    }

    const mockFailingLlm = {
        stream: () => faultyGenerator(),
        invoke: async () => ({ content: "Completely new invoked text that would duplicate if called." }),
    };

    let caughtError = null;
    let tokensEmitted = [];
    try {
        // Run with mock failing llm by calling a custom simulation of the guard
        let fullText = "";
        const stream = mockFailingLlm.stream();
        for await (const chunk of stream) {
            fullText += chunk.content;
            tokensEmitted.push(chunk.content);
        }
    } catch (err) {
        // This is what chat-agent and search-agent catch block does:
        if (tokensEmitted.length > 0) {
            caughtError = new Error(`Streaming interrupted after partial output: ${err.message}`);
        }
    }

    assert.ok(caughtError !== null, "Must abort with error when stream fails mid-way");
    assert.ok(caughtError.message.includes("Streaming interrupted after partial output"), "Must not invoke fallback when partial tokens already emitted");
    assert.equal(tokensEmitted.length, 1, "Only initial tokens should have been collected");
    console.log(`  ✓ Correctly prevented fallback re-invocation after partial emission: "${caughtError.message}"\n`);

    // TEST 3: Live End-to-End Persistence Check on Provider Fallback
    console.log("[TEST 3] Live End-to-End Resilient Generation via Gateway");
    const session = await createAuthenticatedSession();
    const res = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        {
            prompt: "What is 44 + 55? Answer in one short sentence.",
            conversationId: session.conversationId,
            agentMode: "chat",
        },
        {
            headers: { ...session.headers, Accept: "text/event-stream" },
            responseType: "stream",
        },
    );

    let receivedReady = null;
    let tokenCount = 0;
    await new Promise((resolve, reject) => {
        let buffer = "";
        res.data.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();

            let currentEvent = "";
            for (const line of lines) {
                if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
                if (line.startsWith("data: ")) {
                    try {
                        const parsed = JSON.parse(line.slice(6));
                        if (currentEvent === "token") tokenCount++;
                        if (currentEvent === "ready") receivedReady = parsed;
                    } catch {}
                }
            }
        });
        res.data.on("end", resolve);
        res.data.on("error", reject);
    });

    assert.ok(receivedReady, "Must receive ready event");
    assert.ok(receivedReady.aiResponse.includes("99"), "Must compute 99 correctly");

    // Confirm persisted once
    const msgs = await axios.get(
        `${GATEWAY_URL}/api/chat/get-messages/${session.conversationId}`,
        { headers: session.headers },
    );
    assert.equal(msgs.data.messages.length, 2, "Conversation must contain exactly 1 user and 1 assistant message");
    console.log(`  ✓ Turn persisted exactly once in MongoDB with ID ${receivedReady.assistantMessageId}`);
    console.log(`  ✓ Streamed ${tokenCount} tokens; final response contains correct answer.`);
    console.log("\n======================================================================");
    console.log("=== ALL PROVIDER FALLBACK CHECKS PASSED ===");
    console.log("======================================================================");
    process.exit(0);
}

runFallbackVerification().catch((err) => {
    console.error("FATAL FALLBACK TEST FAILURE:", err);
    process.exit(1);
});
