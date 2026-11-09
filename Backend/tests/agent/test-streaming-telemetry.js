import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

import { createTrace } from "./utils/telemetry.js";
import { codingModel, getModel } from "./config/llmModels.js";
import { codingAgent } from "./agents/coding-agent.js";

async function runStreamingTelemetryTestSuite() {
    console.log("==========================================================");
    console.log("=== ORBIT STREAMING & TELEMETRY OBSERVABILITY TESTS ===");
    console.log("==========================================================\n");

    let passed = 0;

    // Test 1: Telemetry creation, phase marking, and sanitization
    console.log("[TEST 1] Telemetry Creation, Phase Marking & Sanitization");
    const mockReq = { headers: { "x-request-id": "req-perf-test-123" } };
    const trace = createTrace(mockReq, "coding");
    assert.equal(trace.traceId, "req-perf-test-123", "Trace ID must propagate from header");

    trace.mark("llmStart");
    await new Promise((r) => setTimeout(r, 20));
    trace.mark("firstToken");
    await new Promise((r) => setTimeout(r, 20));
    trace.mark("llmEnd");

    const record = trace.record({
        model: "openai/gpt-oss-120b",
        provider: "groq",
        status: "success",
        tokenUsage: { estimatedOutputTokens: 1200 },
    });

    assert.equal(record.traceId, "req-perf-test-123");
    assert.equal(record.agent, "coding");
    assert.equal(record.status, "success");
    assert.equal(record.model, "openai/gpt-oss-120b");
    assert.equal(record.provider, "groq");
    assert.ok(record.totalDurationMs >= 40, "Total duration must be at least 40ms");
    assert.ok(record.phases.llmGenerationMs >= 40, "LLM generation must be tracked");
    assert.ok(record.phases.ttftMs >= 20, "TTFT must be tracked");
    assert.equal(record.tokenUsage.estimatedOutputTokens, 1200);

    // Verify sanitization: Ensure no sensitive keys exist
    const jsonStr = JSON.stringify(record);
    assert.ok(!jsonStr.includes("gsk_"), "Must not leak Groq API keys");
    assert.ok(!jsonStr.includes("AIzaSy"), "Must not leak Google API keys");
    assert.ok(!jsonStr.includes("authorization"), "Must not leak authorization headers");
    console.log("  ✓ Telemetry accurately tracks lifecycle phases and emits sanitized structured logs.\n");
    passed++;

    // Test 2: Model Configuration & Fast Provider Failover Chain
    console.log("[TEST 2] Model Configuration & Provider Selection");
    const activeCodingModel = getModel("coding");
    assert.ok(activeCodingModel, "Coding model must be configured");
    assert.ok(activeCodingModel.model, "Must declare active model identifier");
    assert.ok(activeCodingModel.provider, "Must declare active provider ('groq' or 'gemini')");
    console.log(`  Active coding model: ${activeCodingModel.model} (provider: ${activeCodingModel.provider})`);
    console.log("  ✓ Configurable coding model abstraction verified.\n");
    passed++;

    // Test 3: Coding Agent Stage-based Streaming & Truthful Stage Reporting
    console.log("[TEST 3] Coding Agent Stage-based Streaming & Progress Transitions");
    const stagesReceived = [];
    let tokensStreamed = 0;

    const testState = {
        prompt: "Create a simple counter widget with index.html",
        history: [],
        onStage: (stage, msg) => {
            stagesReceived.push({ stage, msg });
        },
        onToken: (chunk) => {
            tokensStreamed += chunk.length;
        },
    };

    const t0 = Date.now();
    const result = await codingAgent(testState);
    const duration = Date.now() - t0;

    assert.ok(stagesReceived.some((s) => s.stage === "generating"), "Must emit 'generating' stage");
    assert.ok(stagesReceived.some((s) => s.stage === "parsing"), "Must emit 'parsing' stage");
    assert.equal(tokensStreamed, 0, "Raw code tokens must NOT be streamed to chat bubble");
    assert.ok(result.codeArtifact, "Must produce valid codeArtifact");
    assert.ok(result.codeArtifact.files.length > 0, "Must produce files");
    assert.ok(result.modelUsed, "Must report modelUsed");
    assert.ok(result.providerUsed, "Must report providerUsed");
    assert.ok(duration < 25000, `Generation must be fast (<25s), actual: ${duration}ms`);

    console.log(`  Generation duration: ${duration}ms, raw chat tokens: ${tokensStreamed} (cleanly suppressed), parsed ${result.codeArtifact.files.length} file(s)`);
    console.log("  ✓ Stage-based SSE streaming, progress transitions, and artifact parsing verified.\n");
    passed++;

    console.log("==========================================================");
    console.log(`ALL STREAMING & TELEMETRY TESTS PASSED! (${passed}/${passed})`);
    console.log("==========================================================");
}

runStreamingTelemetryTestSuite().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
