import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import { EventEmitter } from "node:events";
import axios from "axios";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

import { chatAgent } from "./agents/chat-agent.js";
import { searchAgent } from "./agents/search-agent.js";
import { agent as agentController } from "./controllers/agent.controller.js";

async function runTestSuite() {
    console.log("===================================================================");
    console.log("=== ORBIT CHAT & SEARCH AGENT TOKEN STREAMING VERIFICATION SUITE ===");
    console.log("===================================================================\n");

    let totalTests = 0;
    let passedTests = 0;

    // Helper to run a test
    async function test(name, fn) {
        totalTests++;
        process.stdout.write(`[TEST ${totalTests}] ${name} ... `);
        try {
            await fn();
            passedTests++;
            console.log("PASSED");
        } catch (err) {
            console.log("FAILED!");
            console.error(err);
            process.exitCode = 1;
        }
        await new Promise((r) => setTimeout(r, 1200));
    }

    // Helper to create a test user & conversation on the chat service
    const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:8002";
    async function createTestConversation() {
        const userId = new mongoose.Types.ObjectId().toHexString();
        const res = await axios.post(
            `${chatServiceUrl}/chat/create-conversation`,
            {},
            { headers: { "user-id": userId } },
        );
        return { userId, conversationId: res.data.conversation._id };
    }

    // -------------------------------------------------------------------------
    // TEST 1: Chunk ordering and content integrity
    // -------------------------------------------------------------------------
    await test("Chunk ordering and content integrity", async () => {
        const receivedChunks = [];
        const stages = [];
        const t0 = Date.now();
        let ttft = null;

        const state = {
            prompt: "Explain binary search in exactly 2 short sentences.",
            history: [],
            onStage: (stage, message) => stages.push({ stage, message }),
            onToken: (chunk) => {
                if (ttft === null) ttft = Date.now() - t0;
                receivedChunks.push(chunk);
            },
        };

        const result = await chatAgent(state);
        const reconstructed = receivedChunks.join("");

        assert.ok(receivedChunks.length > 1, "Must receive multiple incremental token chunks");
        assert.equal(reconstructed, result.aiResponse, "Reconstructed streamed chunks must strictly match final aiResponse");
        assert.ok(stages.some((s) => s.stage === "generating"), "Must emit 'generating' stage");
        assert.ok(ttft !== null && ttft < 2500, `TTFT should be fast, got ${ttft}ms`);
        console.log(`\n    -> Streamed ${receivedChunks.length} chunks, TTFT: ${ttft}ms, total chars: ${reconstructed.length}`);
    });

    // -------------------------------------------------------------------------
    // TEST 2: Chat Agent with conversation history streaming
    // -------------------------------------------------------------------------
    await test("Chat Agent context preservation during streaming", async () => {
        const history = [
            { role: "user", content: "My favorite color is emerald green." },
            { role: "assistant", content: "Got it! Emerald green is a beautiful shade." },
        ];
        const chunks = [];
        const state = {
            prompt: "What is my favorite color? Answer in 5 words or fewer.",
            history,
            onToken: (c) => chunks.push(c),
        };

        const result = await chatAgent(state);
        const fullAnswer = chunks.join("");
        assert.ok(
            /emerald|green/i.test(fullAnswer),
            `Streaming chat must retain context from history. Output: ${fullAnswer}`,
        );
        assert.equal(result.aiResponse, fullAnswer);
        assert.ok(result.modelUsed, "modelUsed must be populated");
        assert.ok(result.providerUsed, "providerUsed must be populated");
    });

    // -------------------------------------------------------------------------
    // TEST 3: Search Agent truthful stages, synthesis streaming, and citation preservation
    // -------------------------------------------------------------------------
    await test("Search Agent truthful stages, synthesis streaming & citations", async () => {
        const stages = [];
        const chunks = [];
        const t0 = Date.now();
        let firstTokenTime = null;

        const state = {
            prompt: "What was the score of Super Bowl LVIII in 2024?",
            history: [],
            onStage: (stage, message) => stages.push({ stage, message }),
            onToken: (chunk) => {
                if (firstTokenTime === null) firstTokenTime = Date.now() - t0;
                chunks.push(chunk);
            },
        };

        const result = await searchAgent(state);
        const streamedContent = chunks.join("");

        // Verify truthful stage events
        const searchingStage = stages.find((s) => s.stage === "searching");
        const synthesizingStage = stages.find((s) => s.stage === "synthesizing");
        assert.ok(searchingStage, "Must emit 'searching' stage during web lookup");
        assert.ok(synthesizingStage, "Must emit 'synthesizing' stage during answer generation");
        assert.ok(stages.indexOf(searchingStage) < stages.indexOf(synthesizingStage), "Stage ordering must be searching -> synthesizing");

        // Verify streaming tokens and citations
        assert.ok(chunks.length > 0, "Must stream synthesized answer chunks");
        assert.ok(streamedContent.includes("**Sources**"), "Streamed text must include sources section");
        assert.ok(Array.isArray(result.searchResults) && result.searchResults.length > 0, "Must preserve structured searchResults");
        assert.equal(result.aiResponse, streamedContent, "Final aiResponse must equal streamed text + sources");

        console.log(`\n    -> Search sources: ${result.searchResults.length}, TTFT: ${firstTokenTime}ms, stages: ${stages.map(s => s.stage).join(" -> ")}`);
    });

    // -------------------------------------------------------------------------
    // TEST 4: Error handling and empty responses
    // -------------------------------------------------------------------------
    await test("Search Agent handles empty queries gracefully", async () => {
        await assert.rejects(
            async () => {
                await searchAgent({ prompt: "   " });
            },
            { message: "A search query is required" },
        );
    });

    // -------------------------------------------------------------------------
    // TEST 5: SSE Event Contract & Sanitization in agent.controller
    // -------------------------------------------------------------------------
    await test("Controller SSE stream emits valid events and sanitizes sensitive credentials", async () => {
        const { userId, conversationId } = await createTestConversation();
        const eventsReceived = [];
        let writtenData = "";

        const mockReq = new EventEmitter();
        mockReq.headers = {
            "accept": "text/event-stream",
            "user-id": userId,
            "x-request-id": "trace-test-sse-001",
        };
        mockReq.body = {
            prompt: "Say 'Hello Orbit!' in one sentence.",
            conversationId,
            agentMode: "chat",
        };

        const mockRes = {
            headers: {},
            setHeader(key, value) {
                this.headers[key.toLowerCase()] = value;
            },
            flushHeaders() {},
            flush() {},
            write(chunk) {
                writtenData += chunk;
                const lines = chunk.split("\n");
                let curEv = "message";
                for (const line of lines) {
                    if (line.startsWith("event: ")) curEv = line.slice(7).trim();
                    if (line.startsWith("data: ")) {
                        try {
                            eventsReceived.push({ event: curEv, data: JSON.parse(line.slice(6)) });
                        } catch {
                            // ignore
                        }
                    }
                }
            },
            end() {
                this.writableEnded = true;
            },
            writableEnded: false,
        };

        await agentController(mockReq, mockRes);

        // Verify SSE headers
        assert.equal(mockRes.headers["content-type"], "text/event-stream");
        assert.equal(mockRes.headers["cache-control"], "no-cache, no-transform");

        // Verify event types
        const eventNames = eventsReceived.map((e) => e.event);
        assert.ok(eventNames.includes("stage"), "Must emit stage events");
        assert.ok(eventNames.includes("token"), "Must emit token events");
        assert.ok(eventNames.includes("ready"), "Must emit ready event with complete payload");
        assert.ok(eventNames.includes("done"), "Must emit done event");

        // Verify payload contents
        const readyEvent = eventsReceived.find((e) => e.event === "ready");
        assert.ok(readyEvent.data.aiResponse, "ready event must contain aiResponse");
        assert.ok(readyEvent.data.userMessageId, "ready event must contain persisted userMessageId");
        assert.ok(readyEvent.data.assistantMessageId, "ready event must contain persisted assistantMessageId");
        assert.ok(readyEvent.data.telemetry, "ready event must include telemetry");
        assert.equal(readyEvent.data.telemetry.traceId, "trace-test-sse-001");

        // Verify exact-once persistence in MongoDB via chat service
        const msgsRes = await axios.get(`${chatServiceUrl}/chat/get-messages/${conversationId}`, {
            headers: { "user-id": userId },
        });
        assert.equal(msgsRes.data.messages.length, 2, "Exact-once persistence: must have exactly 1 user and 1 assistant message");
        assert.equal(msgsRes.data.messages[1].content, readyEvent.data.aiResponse);

        // Verify sanitization
        assert.ok(!writtenData.includes("gsk_"), "Must not leak Groq credentials in SSE data");
        assert.ok(!writtenData.includes("tvly-"), "Must not leak Tavily credentials in SSE data");
        assert.ok(!writtenData.includes("AIzaSy"), "Must not leak Google credentials in SSE data");
    });

    // -------------------------------------------------------------------------
    // TEST 6: Client cancellation / disconnect halts processing before persistence
    // -------------------------------------------------------------------------
    await test("Client disconnect halts processing cleanly before persistence", async () => {
        const { userId, conversationId } = await createTestConversation();
        const mockReq = new EventEmitter();
        mockReq.headers = {
            "accept": "text/event-stream",
            "user-id": userId,
        };
        mockReq.body = {
            prompt: "A quick test message that should be canceled mid-stream.",
            conversationId,
            agentMode: "chat",
        };

        const mockRes = new EventEmitter();
        mockRes.headers = {};
        mockRes.setHeader = () => {};
        mockRes.flushHeaders = () => {};
        mockRes.flush = () => {};
        mockRes.writableEnded = false;
        mockRes.write = (chunk) => {
            // Simulate client disconnecting as soon as streaming tokens start arriving
            if (chunk.includes("event: token")) {
                mockRes.emit("close");
            }
        };
        mockRes.end = function() {
            this.writableEnded = true;
        };

        await agentController(mockReq, mockRes);

        // Verify no message was persisted because client disconnected
        const msgsRes = await axios.get(`${chatServiceUrl}/chat/get-messages/${conversationId}`, {
            headers: { "user-id": userId },
        });
        assert.equal(msgsRes.data.messages.length, 0, "No messages should be saved when client disconnected mid-stream");
    });

    // -------------------------------------------------------------------------
    // TEST 7: Non-streaming request backward compatibility
    // -------------------------------------------------------------------------
    await test("Non-streaming request returns standard JSON (backward compatibility)", async () => {
        const { userId, conversationId } = await createTestConversation();
        const mockReq = new EventEmitter();
        mockReq.headers = {
            "accept": "application/json",
            "user-id": userId,
        };
        mockReq.body = {
            prompt: "What is 2+2? Reply with only the number.",
            conversationId,
            agentMode: "chat",
        };

        let jsonStatusCode = null;
        let jsonResponsePayload = null;

        const mockRes = {
            headers: {},
            setHeader(k, v) { this.headers[k] = v; },
            status(code) {
                jsonStatusCode = code;
                return this;
            },
            json(payload) {
                jsonResponsePayload = payload;
                return this;
            },
        };

        await agentController(mockReq, mockRes);

        assert.equal(jsonStatusCode, 200, "Non-streaming request must return status 200");
        assert.ok(jsonResponsePayload, "Must return JSON payload");
        assert.ok(jsonResponsePayload.aiResponse.includes("4"), "Payload must contain correct answer");
        assert.ok(jsonResponsePayload.userMessageId, "Must contain persisted userMessageId");
        assert.ok(jsonResponsePayload.assistantMessageId, "Must contain persisted assistantMessageId");
        assert.ok(jsonResponsePayload.telemetry, "Must contain telemetry data");
    });

    // -------------------------------------------------------------------------
    // TEST 8: Error handling without valid authorization or missing prompt
    // -------------------------------------------------------------------------
    await test("Missing authorization or parameters rejected with 400/401", async () => {
        const mockReq = new EventEmitter();
        mockReq.headers = { "accept": "application/json" };
        mockReq.body = { prompt: "", conversationId: "" };

        let code400 = null;
        let payload400 = null;
        const mockRes = {
            status(code) { code400 = code; return this; },
            json(p) { payload400 = p; return this; },
        };

        await agentController(mockReq, mockRes);
        assert.equal(code400, 400, "Must return 400 when prompt or conversationId missing");
        assert.ok(payload400.error, "Must include error message");
    });

    console.log("\n===================================================================");
    console.log(`TEST SUITE RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log("===================================================================");
}

runTestSuite().catch((err) => {
    console.error("FATAL TEST SUITE FAILURE:", err);
    process.exit(1);
});
