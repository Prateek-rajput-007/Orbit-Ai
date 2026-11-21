process.env.NODE_ENV = "test";
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import redis from "../../../shared/redis/redis.js";
import { agent } from "../controllers/agent.controller.js";

function createMockRes({ isSse = false, startHeadersSent = false } = {}) {
    let headersSent = startHeadersSent;
    let statusCode = 200;
    const headers = {};
    const writtenChunks = [];
    let writableEnded = false;
    let destroyed = false;

    const res = {
        get headersSent() {
            return headersSent;
        },
        get writableEnded() {
            return writableEnded;
        },
        get destroyed() {
            return destroyed;
        },
        get statusCode() {
            return statusCode;
        },
        setHeader(name, value) {
            if (headersSent) {
                const err = new Error("Cannot set headers after they are sent to the client");
                err.code = "ERR_HTTP_HEADERS_SENT";
                throw err;
            }
            headers[name.toLowerCase()] = String(value);
        },
        getHeader(name) {
            return headers[name.toLowerCase()];
        },
        flushHeaders() {
            headersSent = true;
        },
        status(code) {
            if (headersSent) {
                const err = new Error("Cannot set headers after they are sent to the client");
                err.code = "ERR_HTTP_HEADERS_SENT";
                throw err;
            }
            statusCode = code;
            return res;
        },
        json(data) {
            if (headersSent) {
                const err = new Error("Cannot set headers after they are sent to the client");
                err.code = "ERR_HTTP_HEADERS_SENT";
                throw err;
            }
            headersSent = true;
            writableEnded = true;
            writtenChunks.push(JSON.stringify(data));
            return res;
        },
        write(chunk) {
            headersSent = true;
            writtenChunks.push(chunk);
            return true;
        },
        end(data) {
            if (data) writtenChunks.push(data);
            writableEnded = true;
            headersSent = true;
        },
        _getHeaders: () => headers,
        _getOutput: () => writtenChunks.join(""),
    };

    return res;
}

describe("SSE Concurrency Lease & Error Lifecycle", () => {
    const testRedisStore = new Map();

    const origGet = redis.get;
    const origSet = redis.set;
    const origDel = redis.del;
    const origPttl = redis.pttl;
    const origEval = redis.eval;
    const origDecr = redis.decr;

    before(() => {
        try {
            redis.disconnect();
        } catch {}

        redis.set = async (key, val, ...args) => {
            if (args.includes("NX") && testRedisStore.has(key)) {
                return null;
            }
            testRedisStore.set(key, String(val));
            return "OK";
        };
        redis.get = async (key) => testRedisStore.get(key) || null;
        redis.del = async (key) => {
            testRedisStore.delete(key);
            return 1;
        };
        redis.pttl = async () => 45000;
        redis.decr = async (key) => {
            const val = Number(testRedisStore.get(key) || 1) - 1;
            testRedisStore.set(key, String(val));
            return val;
        };
        redis.eval = async (script, numkeys, key, ...args) => {
            if (key && key.startsWith("quota:daily:")) {
                const current = Number(testRedisStore.get(key) || 0);
                const maxLimit = Number(args[0] || 100);
                if (current >= maxLimit) {
                    return [0, current, 0];
                }
                const next = current + 1;
                testRedisStore.set(key, String(next));
                return [1, next, maxLimit - next];
            }
            if (key && key.startsWith("lease:agent:")) {
                const requestId = args[0];
                if (testRedisStore.get(key) === requestId) {
                    testRedisStore.delete(key);
                    return 1;
                }
                return 0;
            }
            return [1, 1, 99];
        };
    });

    after(() => {
        redis.get = origGet;
        redis.set = origSet;
        redis.del = origDel;
        redis.pttl = origPttl;
        redis.eval = origEval;
        redis.decr = origDecr;
    });

    beforeEach(() => {
        testRedisStore.clear();
    });

    // ------------------------------------------------------------------------
    // Test 1: Pre-stream concurrency rejection (Non-SSE / headers not sent)
    // ------------------------------------------------------------------------
    test("1. Concurrency rejected pre-stream returns HTTP 429 with Retry-After header", async () => {
        const userId = "user-concurr-pre";
        testRedisStore.set(`lease:agent:${userId}`, "existing-active-lease");

        const req = {
            headers: {
                "user-id": userId,
                "x-request-id": "req-pre-stream-1",
            },
            body: {
                prompt: "Tell me about quantum physics",
                conversationId: "conv-test-1",
                agentMode: "chat",
            },
        };

        const res = createMockRes({ isSse: false });
        await agent(req, res);

        assert.equal(res.statusCode, 429, "Must return HTTP 429 status code");
        assert.ok(res.getHeader("retry-after"), "Must set Retry-After header");
        assert.ok(res.writableEnded, "Response must end");

        const payload = JSON.parse(res._getOutput());
        assert.equal(payload.error, "Concurrency Limit Exceeded");
        assert.equal(payload.status, 429);
        assert.ok(payload.retryAfter);
    });

    // ------------------------------------------------------------------------
    // Test 2: Post-stream concurrency rejection (SSE headers already sent)
    // ------------------------------------------------------------------------
    test("2. Concurrency rejected post-stream emits SSE error event and never throws ERR_HTTP_HEADERS_SENT", async () => {
        const userId = "user-concurr-post";
        testRedisStore.set(`lease:agent:${userId}`, "existing-active-lease");

        const req = {
            headers: {
                "user-id": userId,
                "x-request-id": "req-post-stream-2",
                accept: "text/event-stream",
            },
            body: {
                prompt: "Tell me about quantum physics",
                conversationId: "conv-test-2",
                agentMode: "chat",
            },
        };

        const res = createMockRes({ isSse: true });
        // agent() will call res.setHeader for event-stream and flushHeaders
        await agent(req, res);

        assert.ok(res.headersSent, "Headers must be sent for SSE");
        assert.ok(res.writableEnded, "Stream must be cleanly closed with res.end()");

        const output = res._getOutput();
        assert.ok(!output.includes("Cannot set headers after they are sent to the client"), "Must NOT throw ERR_HTTP_HEADERS_SENT");
        assert.ok(output.includes("event: error"), "Must emit SSE error event");
        assert.ok(output.includes("Concurrency Limit Exceeded"), "Must contain concurrency error detail");
        assert.ok(output.includes("429"), "Must communicate 429 status inside SSE error payload");
    });

    // ------------------------------------------------------------------------
    // Test 3: Pre-stream daily quota rejection
    // ------------------------------------------------------------------------
    test("3. Daily quota rejected pre-stream returns HTTP 429 with Retry-After", async () => {
        const userId = "user-quota-pre";
        const todayUtc = new Date().toISOString().slice(0, 10);
        testRedisStore.set(`quota:daily:${userId}:${todayUtc}`, "100");

        const req = {
            headers: {
                "user-id": userId,
                "x-request-id": "req-quota-pre-3",
            },
            body: {
                prompt: "Help me calculate taxes",
                conversationId: "conv-test-3",
                agentMode: "chat",
            },
        };

        const res = createMockRes({ isSse: false });
        await agent(req, res);

        assert.equal(res.statusCode, 429, "Must return HTTP 429");
        assert.ok(res.getHeader("retry-after"));
        const payload = JSON.parse(res._getOutput());
        assert.equal(payload.error, "Daily Quota Exceeded");
    });

    // ------------------------------------------------------------------------
    // Test 4: Post-stream daily quota rejection
    // ------------------------------------------------------------------------
    test("4. Daily quota rejected post-stream emits SSE error without ERR_HTTP_HEADERS_SENT", async () => {
        const userId = "user-quota-post";
        const todayUtc = new Date().toISOString().slice(0, 10);
        testRedisStore.set(`quota:daily:${userId}:${todayUtc}`, "100");

        const req = {
            headers: {
                "user-id": userId,
                "x-request-id": "req-quota-post-4",
                accept: "text/event-stream",
            },
            body: {
                prompt: "Help me calculate taxes",
                conversationId: "conv-test-4",
                agentMode: "chat",
            },
        };

        const res = createMockRes({ isSse: true });
        await agent(req, res);

        assert.ok(res.headersSent);
        assert.ok(res.writableEnded);
        const output = res._getOutput();
        assert.ok(!output.includes("Cannot set headers after they are sent to the client"));
        assert.ok(output.includes("event: error"));
        assert.ok(output.includes("Daily Quota Exceeded"));
    });

    // ------------------------------------------------------------------------
    // Test 5: Client disconnect mid-stream releases leases cleanly in finally
    // ------------------------------------------------------------------------
    test("5. Client disconnect during generation triggers cleanup and releases lease in finally", async () => {
        const userId = "user-disconnect-5";

        let clientDisconnectListener = null;
        const req = {
            headers: {
                "user-id": userId,
                "x-request-id": "req-disc-5",
                accept: "text/event-stream",
            },
            body: {
                prompt: "Very long streaming request",
                conversationId: "conv-test-5",
                agentMode: "chat",
            },
            on: (event, handler) => {
                if (event === "close") {
                    clientDisconnectListener = handler;
                }
            },
        };

        const res = createMockRes({ isSse: true });
        // Execute request; during execution, simulate client disconnect
        const runPromise = agent(req, res);

        // Simulate client socket disconnect after headers sent
        if (clientDisconnectListener) {
            clientDisconnectListener();
        }

        await runPromise;

        assert.ok(res.writableEnded || res.headersSent);
        // Concurrency lease must be cleanly released (not left hanging)
        assert.equal(testRedisStore.get(`lease:agent:${userId}`), undefined, "Lease must be released in finally block");
    });
});
