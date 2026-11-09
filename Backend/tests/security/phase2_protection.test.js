import test, { after } from "node:test";
import assert from "node:assert/strict";
import redis from "../../shared/redis/redis.js";
import {
  acquireConcurrencyLease,
  renewConcurrencyLease,
  releaseConcurrencyLease,
} from "../../shared/security/concurrencyManager.js";
import {
  checkAndReserveIdempotency,
  markIdempotencyCompleted,
  clearIdempotencyReservation,
  computePayloadFingerprint,
} from "../../shared/security/idempotencyManager.js";
import {
  checkAndConsumeDailyQuota,
  rollbackDailyQuota,
  getSecondsUntilUtcMidnight,
} from "../../shared/security/usageManager.js";
import {
  validateAgentRequest,
} from "../../shared/security/requestValidator.js";

after(async () => {
  await redis.quit();
});

// =========================================================================
// 1. CONCURRENCY CONTROL TESTS
// =========================================================================

test("Concurrency: User cannot exceed concurrent limit of 1 active generation", async () => {
  const userId = `user-conc-${Date.now()}`;
  const req1 = "req-1";
  const req2 = "req-2";

  // Request 1 acquires lease
  const lease1 = await acquireConcurrencyLease(userId, req1, 10_000);
  assert.equal(lease1.acquired, true, "First request must acquire lease");

  // Request 2 from same user blocked
  const lease2 = await acquireConcurrencyLease(userId, req2, 10_000);
  assert.equal(lease2.acquired, false, "Concurrent request from same user must be blocked");
  assert.ok(lease2.remainingSec >= 1, "Must report positive remaining seconds");

  // Clean up
  await releaseConcurrencyLease(userId, req1);
});

test("Concurrency: Different users do not block each other", async () => {
  const userA = `user-conc-A-${Date.now()}`;
  const userB = `user-conc-B-${Date.now()}`;

  const leaseA = await acquireConcurrencyLease(userA, "req-A", 10_000);
  const leaseB = await acquireConcurrencyLease(userB, "req-B", 10_000);

  assert.equal(leaseA.acquired, true);
  assert.equal(leaseB.acquired, true, "User B must not be blocked by User A");

  // Clean up
  await releaseConcurrencyLease(userA, "req-A");
  await releaseConcurrencyLease(userB, "req-B");
});

test("Concurrency: Expired lease recovers correctly and allows new request", async () => {
  const userId = `user-expire-${Date.now()}`;

  // Acquire with 300ms short TTL
  await acquireConcurrencyLease(userId, "req-short", 300);

  // Wait 400ms for expiration
  await new Promise((r) => setTimeout(r, 400));

  // New request acquires cleanly
  const leaseNew = await acquireConcurrencyLease(userId, "req-after-expire", 10_000);
  assert.equal(leaseNew.acquired, true, "New request must acquire slot after expiration");

  // Clean up
  await releaseConcurrencyLease(userId, "req-after-expire");
});

test("Concurrency: Stale request cannot release a newer request's lease (Compare-and-Delete)", async () => {
  const userId = `user-stale-${Date.now()}`;

  // Request 1 acquires with 300ms TTL
  await acquireConcurrencyLease(userId, "req-1", 300);

  // Wait for TTL to expire
  await new Promise((r) => setTimeout(r, 400));

  // Request 2 acquires the vacant lease
  await acquireConcurrencyLease(userId, "req-2", 10_000);

  // Stale Request 1 finishes late and tries to release its lock
  const released = await releaseConcurrencyLease(userId, "req-1");
  assert.equal(released, false, "Stale request must NOT be allowed to release new lease");

  // Verify Request 2's lease is still intact
  const activeHolder = await redis.get(`lease:agent:${userId}`);
  assert.equal(activeHolder, "req-2", "New lease holder must remain owner");

  // Clean up
  await releaseConcurrencyLease(userId, "req-2");
});

test("Concurrency: Long-running generations can extend lease via heartbeat renewal", async () => {
  const userId = `user-renew-${Date.now()}`;
  const reqId = "req-long";

  await acquireConcurrencyLease(userId, reqId, 1000);

  // Renew lease for 20,000ms
  const renewed = await renewConcurrencyLease(userId, reqId, 20_000);
  assert.equal(renewed, true, "Lease holder must be able to renew lease");

  const pttl = await redis.pttl(`lease:agent:${userId}`);
  assert.ok(pttl > 10_000, "PTTL must reflect renewed duration");

  // Clean up
  await releaseConcurrencyLease(userId, reqId);
});

test("Concurrency: Partitioned agent leases support independent execution per agent mode", async () => {
  const userId = `user-agent-pool-${Date.now()}`;

  // Acquire lease for 'chat' agent
  const leaseChat = await acquireConcurrencyLease(userId, "req-chat", 10_000, "chat");
  assert.equal(leaseChat.acquired, true);

  // Acquire lease for 'coding' agent in parallel
  const leaseCoding = await acquireConcurrencyLease(userId, "req-coding", 10_000, "coding");
  assert.equal(leaseCoding.acquired, true, "Different agent modes can acquire separate leases when partitioned");

  // Clean up
  await releaseConcurrencyLease(userId, "req-chat", "chat");
  await releaseConcurrencyLease(userId, "req-coding", "coding");
});

// =========================================================================
// 2. IDEMPOTENCY TESTS & FINGERPRINT COMPLETENESS
// =========================================================================

test("Idempotency: Same key and same payload is recognized as duplicate", async () => {
  const userId = `user-idemp-${Date.now()}`;
  const keyId = "key-alpha-1";
  const payload = { prompt: "Build a calculator", agentMode: "coding", conversationId: "c1" };

  // First request: reserves
  const res1 = await checkAndReserveIdempotency(userId, keyId, payload, 5000);
  assert.equal(res1.shouldProceed, true);
  assert.equal(res1.isDuplicate, false);

  // Duplicate submission (double click)
  const res2 = await checkAndReserveIdempotency(userId, keyId, payload, 5000);
  assert.equal(res2.shouldProceed, false);
  assert.equal(res2.isDuplicate, true);
  assert.equal(res2.status, "running");

  // Clean up
  await clearIdempotencyReservation(userId, keyId);
});

test("Idempotency: Same key with DIFFERENT payload is rejected with payload_mismatch", async () => {
  const userId = `user-idemp-${Date.now()}`;
  const keyId = "key-beta-2";
  const payload1 = { prompt: "Prompt One", agentMode: "chat", conversationId: "c1" };
  const payload2 = { prompt: "Prompt Two (Tampered)", agentMode: "chat", conversationId: "c1" };

  await checkAndReserveIdempotency(userId, keyId, payload1, 5000);

  // Client reuses same keyId for different prompt
  const resTampered = await checkAndReserveIdempotency(userId, keyId, payload2, 5000);
  assert.equal(resTampered.shouldProceed, false);
  assert.equal(resTampered.status, "payload_mismatch");

  // Clean up
  await clearIdempotencyReservation(userId, keyId);
});

test("Idempotency: Attachment presence produces distinct fingerprint & detects tampering", async () => {
  const userId = `user-attach-${Date.now()}`;
  const keyId = "key-attach-verify";

  const payloadWithoutAttachment = {
    prompt: "Analyze this file",
    agentMode: "pdf",
    conversationId: "c1",
  };

  const payloadWithAttachment = {
    prompt: "Analyze this file",
    agentMode: "pdf",
    conversationId: "c1",
    attachment: {
      originalname: "annual-report.pdf",
      size: 1024,
      mimetype: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 report content"),
    },
  };

  const fp1 = computePayloadFingerprint(payloadWithoutAttachment);
  const fp2 = computePayloadFingerprint(payloadWithAttachment);
  assert.notEqual(fp1, fp2, "Payload fingerprint must differ when an attachment is added");

  // Reserve key with payload without attachment
  await checkAndReserveIdempotency(userId, keyId, payloadWithoutAttachment, 5000);

  // Subsequent call with same key but different attachment payload triggers mismatch
  const resTampered = await checkAndReserveIdempotency(userId, keyId, payloadWithAttachment, 5000);
  assert.equal(resTampered.shouldProceed, false);
  assert.equal(resTampered.status, "payload_mismatch", "Reusing key with different attachment must trigger payload_mismatch");

  // Clean up
  await clearIdempotencyReservation(userId, keyId);
});

test("Idempotency: Model selection variation produces distinct fingerprint", () => {
  const payloadModelA = { prompt: "Summarize", conversationId: "c1", model: "gemini-2.5-flash" };
  const payloadModelB = { prompt: "Summarize", conversationId: "c1", model: "groq-llama-3.3-70b" };

  const fpA = computePayloadFingerprint(payloadModelA);
  const fpB = computePayloadFingerprint(payloadModelB);
  assert.notEqual(fpA, fpB, "Fingerprint must cover model selection");
});

test("Idempotency: Completed request returns full cached completion result replay", async () => {
  const userId = `user-comp-${Date.now()}`;
  const keyId = "key-completed-1";
  const payload = { prompt: "Explain quantum computing", agentMode: "chat", conversationId: "c9" };

  await checkAndReserveIdempotency(userId, keyId, payload, 5000);

  // Mark completed with response content
  await markIdempotencyCompleted(userId, keyId, payload, {
    userMessageId: "msg-user-1",
    assistantMessageId: "msg-asst-2",
    aiResponse: "Quantum computing utilizes qubits...",
    artifacts: [{ title: "qubit.js", language: "javascript" }],
  }, 10_000);

  // Subsequent check detects completed state and retrieves replay data
  const resCheck = await checkAndReserveIdempotency(userId, keyId, payload, 5000);
  assert.equal(resCheck.shouldProceed, false);
  assert.equal(resCheck.status, "completed");
  assert.equal(resCheck.cachedResult.userMessageId, "msg-user-1");
  assert.equal(resCheck.cachedResult.assistantMessageId, "msg-asst-2");
  assert.equal(resCheck.cachedResult.aiResponse, "Quantum computing utilizes qubits...");
  assert.equal(resCheck.cachedResult.artifacts.length, 1);

  // Clean up
  await redis.del(`idemp:${userId}:${keyId}`);
});

test("Idempotency: Failed or cancelled generation clears reservation so user can retry", async () => {
  const userId = `user-retry-${Date.now()}`;
  const keyId = "key-fail-retry";
  const payload = { prompt: "Generate report", agentMode: "chat", conversationId: "c10" };

  await checkAndReserveIdempotency(userId, keyId, payload, 5000);

  // Operation fails / client aborts
  await clearIdempotencyReservation(userId, keyId);

  // User retries: should be allowed to proceed
  const retryRes = await checkAndReserveIdempotency(userId, keyId, payload, 5000);
  assert.equal(retryRes.shouldProceed, true, "User must be allowed to retry after error/abort");

  // Clean up
  await clearIdempotencyReservation(userId, keyId);
});

// =========================================================================
// 3. DAILY AI USAGE QUOTA TESTS
// =========================================================================

test("Usage Quota: Requests within quota succeed; requests over quota are rejected with Retry-After", async () => {
  const userId = `user-quota-${Date.now()}`;
  const maxQuota = 3;

  for (let i = 1; i <= 3; i++) {
    const res = await checkAndConsumeDailyQuota(userId, maxQuota);
    assert.equal(res.allowed, true, `Turn ${i} must be allowed`);
    assert.equal(res.current, i);
  }

  // Turn 4 exceeds daily quota
  const resOver = await checkAndConsumeDailyQuota(userId, maxQuota);
  assert.equal(resOver.allowed, false, "Turn 4 must be rejected");
  assert.equal(resOver.remaining, 0);
  assert.ok(resOver.retryAfterSec > 0, "Retry-After seconds must be provided");

  // Verify rejected request DID NOT increment counter
  const checkAgain = await checkAndConsumeDailyQuota(userId, maxQuota);
  assert.equal(checkAgain.current, 3, "Rejected hit must not increment quota counter");

  // Clean up
  const todayUtc = new Date().toISOString().slice(0, 10);
  await redis.del(`quota:daily:${userId}:${todayUtc}`);
});

test("Usage Quota: Atomic Lua script prevents race conditions under simultaneous quota requests", async () => {
  const userId = `user-quota-race-${Date.now()}`;
  const maxQuota = 5;

  // 15 simultaneous requests hitting quota
  const promises = Array.from({ length: 15 }).map(() =>
    checkAndConsumeDailyQuota(userId, maxQuota)
  );

  const results = await Promise.all(promises);
  const allowedCount = results.filter((r) => r.allowed).length;
  const rejectedCount = results.filter((r) => !r.allowed).length;

  assert.equal(allowedCount, 5, "Strictly 5 turns must be consumed under high concurrency");
  assert.equal(rejectedCount, 10, "Strictly 10 requests must be rejected");

  // Clean up
  const todayUtc = new Date().toISOString().slice(0, 10);
  await redis.del(`quota:daily:${userId}:${todayUtc}`);
});

test("Usage Quota: Rollback deletes key when count drops to zero (no persistent zero-keys)", async () => {
  const userId = `user-rollback-${Date.now()}`;

  await checkAndConsumeDailyQuota(userId, 10);

  // Rollback turn on failure
  await rollbackDailyQuota(userId);

  const todayUtc = new Date().toISOString().slice(0, 10);
  const keyExists = await redis.exists(`quota:daily:${userId}:${todayUtc}`);
  assert.equal(keyExists, 0, "Key must be completely removed when counter drops to 0");
});

// =========================================================================
// 4. BACKEND REQUEST VALIDATION TESTS
// =========================================================================

test("Validation: Rejects oversized prompts exceeding configured character limit", () => {
  const oversizedPrompt = "A".repeat(16_001);
  const res = validateAgentRequest(
    { prompt: oversizedPrompt, conversationId: "c1", agentMode: "auto" },
    null,
    16_000
  );
  assert.equal(res.isValid, false);
  assert.equal(res.status, 413);
  assert.ok(res.message.includes("exceeds the maximum allowed limit"));
});

test("Validation: Rejects missing or whitespace-only prompt and missing conversationId", () => {
  const resNoPrompt = validateAgentRequest({ prompt: "   ", conversationId: "c1" });
  assert.equal(resNoPrompt.isValid, false);
  assert.equal(resNoPrompt.status, 400);

  const resNoConv = validateAgentRequest({ prompt: "Hello", conversationId: "" });
  assert.equal(resNoConv.isValid, false);
  assert.equal(resNoConv.status, 400);
});

test("Validation: Rejects unsupported agent selection", () => {
  const res = validateAgentRequest({
    prompt: "Hello",
    conversationId: "c1",
    agentMode: "unsupported-malicious-agent",
  });
  assert.equal(res.isValid, false);
  assert.equal(res.status, 400);
  assert.ok(res.message.includes("Unsupported agent selection"));
});

test("Validation: Rejects file with invalid PDF magic bytes", () => {
  const fakePdfAttachment = {
    originalname: "malicious.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("NOT_A_REAL_PDF_HEADER"),
  };

  const res = validateAgentRequest(
    { prompt: "Summarize this", conversationId: "c1", agentMode: "auto" },
    fakePdfAttachment
  );
  assert.equal(res.isValid, false);
  assert.equal(res.status, 400);
  assert.ok(res.message.includes("valid PDF binary signature"));
});

test("Validation: Accepts valid prompt, conversationId, and legitimate PDF with magic bytes", () => {
  const validPdfAttachment = {
    originalname: "quarterly-report.pdf",
    mimetype: "application/pdf",
    buffer: Buffer.from("%PDF-1.7 legitimate pdf content"),
  };

  const res = validateAgentRequest(
    { prompt: "Summarize this quarterly report", conversationId: "c1", agentMode: "pdf" },
    validPdfAttachment
  );
  assert.equal(res.isValid, true);
  assert.equal(res.prompt, "Summarize this quarterly report");
});
