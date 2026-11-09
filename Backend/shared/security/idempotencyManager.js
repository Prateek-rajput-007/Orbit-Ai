import crypto from "node:crypto";
import redis from "../redis/redis.js";

/**
 * Computes a SHA-256 fingerprint for a request payload to verify payload consistency.
 * Covers prompt, agentMode, conversationId, model selection, and attachment metadata/content.
 */
export const computePayloadFingerprint = (payload = {}) => {
  let attachmentMeta = null;
  if (payload.attachment) {
    attachmentMeta = {
      name: payload.attachment.originalname || payload.attachment.name || "",
      size: payload.attachment.size || 0,
      mimetype: payload.attachment.mimetype || payload.attachment.type || "",
      hash: payload.attachment.buffer
        ? crypto.createHash("sha256").update(payload.attachment.buffer).digest("hex").slice(0, 32)
        : (payload.attachment.hash || ""),
    };
  }

  const normalized = JSON.stringify({
    prompt: typeof payload.prompt === "string" ? payload.prompt.trim() : "",
    agentMode: payload.agentMode || "auto",
    conversationId: payload.conversationId || "",
    model: payload.model || "",
    attachment: attachmentMeta,
  });
  return crypto.createHash("sha256").update(normalized).digest("hex");
};

/**
 * Checks and reserves an Idempotency Key for an authenticated user.
 *
 * @param {string} userId - Authenticated user ID
 * @param {string} keyId - Client-supplied Idempotency-Key or x-request-id
 * @param {object} payload - Request payload ({ prompt, agentMode, conversationId, model, attachment })
 * @param {number} ttlMs - TTL for in-progress reservation (default: 120s)
 */
export const checkAndReserveIdempotency = async (userId, keyId, payload = {}, ttlMs = 120_000) => {
  if (!userId || !keyId) {
    return { shouldProceed: true, isDuplicate: false, status: "bypassed" };
  }

  const key = `idemp:${userId}:${keyId}`;
  const currentFingerprint = computePayloadFingerprint(payload);

  try {
    const existing = await redis.get(key);
    if (existing) {
      let parsed = {};
      try {
        parsed = JSON.parse(existing);
      } catch {
        parsed = { status: "running" };
      }

      // Check for key reuse with a different payload (RFC 7231 / Idempotency specification)
      if (parsed.fingerprint && parsed.fingerprint !== currentFingerprint) {
        return {
          shouldProceed: false,
          isDuplicate: true,
          status: "payload_mismatch",
          error: "Idempotency key was previously used with a different request payload.",
        };
      }

      // Key matches: in-progress or completed
      return {
        shouldProceed: false,
        isDuplicate: true,
        status: parsed.status || "running",
        cachedResult: parsed.result || null,
      };
    }

    // Atomically reserve the key with in-progress status and payload fingerprint
    const reservation = JSON.stringify({
      status: "running",
      fingerprint: currentFingerprint,
      startedAt: Date.now(),
    });

    await redis.set(key, reservation, "PX", ttlMs);

    return {
      shouldProceed: true,
      isDuplicate: false,
      status: "reserved",
    };
  } catch (err) {
    console.error("[IdempotencyManager] Error checking idempotency:", err.message);
    // On transient Redis error, fail-open to allow user request to proceed
    return { shouldProceed: true, isDuplicate: false, status: "error" };
  }
};

/**
 * Marks the idempotency key as completed with a summary of the generated response.
 * Caches userMessageId, assistantMessageId, full aiResponse, and artifacts for deterministic replay.
 */
export const markIdempotencyCompleted = async (
  userId,
  keyId,
  payload = {},
  resultSummary = {},
  cacheTtlMs = 300_000
) => {
  if (!userId || !keyId) return;

  const key = `idemp:${userId}:${keyId}`;
  const fingerprint = computePayloadFingerprint(payload);

  try {
    const data = JSON.stringify({
      status: "completed",
      fingerprint,
      completedAt: Date.now(),
      result: resultSummary,
    });
    await redis.set(key, data, "PX", cacheTtlMs);
  } catch (err) {
    console.error("[IdempotencyManager] Error marking completed:", err.message);
  }
};

/**
 * Clears the idempotency reservation if the generation failed or client disconnected.
 */
export const clearIdempotencyReservation = async (userId, keyId) => {
  if (!userId || !keyId) return;

  const key = `idemp:${userId}:${keyId}`;
  try {
    await redis.del(key);
  } catch (err) {
    console.error("[IdempotencyManager] Error clearing reservation:", err.message);
  }
};
