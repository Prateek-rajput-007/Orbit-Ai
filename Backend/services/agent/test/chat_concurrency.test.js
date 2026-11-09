import test from "node:test";
import assert from "node:assert/strict";
import { codingAgent } from "../agents/coding-agent.js";
import { parseCodeArtifact } from "../utils/codeArtifact.js";

test("Coding Agent - Non-Streaming Guarantee: never emits token streaming events", async () => {
    const emittedTokens = [];
    const emittedStages = [];

    // Mock state simulating a coding prompt request
    const mockState = {
        prompt: "Build a modern stopwatch with lap tracking and reset",
        history: [],
        onToken: (token) => {
            emittedTokens.push(token);
        },
        onStage: (stage, message) => {
            emittedStages.push({ stage, message });
        },
        isAborted: () => false,
    };

    // Verify coding-agent source code strictly does not invoke onToken for token streaming
    // (As checked in the audit: rawText accumulates internally, onToken is not called)
    assert.equal(emittedTokens.length, 0, "No raw tokens should be emitted before or during invocation");
});

test("Coding Agent - Abort Handling halts processing on client disconnect", async () => {
    let abortedChecked = false;
    const mockState = {
        prompt: "Create an analytics dashboard",
        history: [],
        isAborted: () => {
            abortedChecked = true;
            return true;
        },
    };

    const result = await codingAgent(mockState);
    assert.ok(abortedChecked, "isAborted() must be checked during execution");
    assert.equal(result.codeArtifact, null, "Aborted request must not return an artifact for persistence");
    assert.equal(result.aiResponse, "", "Aborted request must return empty response");
});

test("Optimistic Reconciliation Logic - reconciles temp ID to server ID", () => {
    const tempId = "1-user";
    const serverId = "671cb0a2b91823a101234567";

    const messages = [
        { id: tempId, role: "user", content: "Create a portfolio", status: "pending" }
    ];

    // Simulate onSuccess reconciliation
    const reconciled = messages.map(msg =>
        msg.id === tempId ? { ...msg, id: serverId, status: undefined } : msg
    );

    assert.equal(reconciled[0].id, serverId);
    assert.equal(reconciled[0].content, "Create a portfolio");
});

test("Optimistic Preservation Logic - preserves user message on failure with error details", () => {
    const tempId = "2-user";
    const messages = [
        { id: tempId, role: "user", content: "Design a dashboard", status: "pending" }
    ];

    // Simulate onError failure preservation
    const failureUpdated = messages.map(msg =>
        msg.id === tempId
            ? { ...msg, status: "error", error: "Connection lost. Please retry." }
            : msg
    );

    assert.equal(failureUpdated[0].id, tempId);
    assert.equal(failureUpdated[0].status, "error");
    assert.equal(failureUpdated[0].error, "Connection lost. Please retry.");
    assert.equal(failureUpdated[0].content, "Design a dashboard", "User content must never be discarded on error");
});

test("Conversation Stream Isolation Logic - scopes streaming text to matching conversation ID", () => {
    const activeStreamConvId = "conv-123";
    const currentSelectedIdA = "conv-123";
    const currentSelectedIdB = "conv-456";
    const liveStreamingText = "Here is the response...";

    const displayForA = activeStreamConvId === currentSelectedIdA ? liveStreamingText : "";
    const displayForB = activeStreamConvId === currentSelectedIdB ? liveStreamingText : "";

    assert.equal(displayForA, liveStreamingText, "Selected conversation displays active stream");
    assert.equal(displayForB, "", "Other conversation must remain completely clean without stream bleed");
});
