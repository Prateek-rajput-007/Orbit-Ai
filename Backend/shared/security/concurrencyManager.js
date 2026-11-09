import redis from "../redis/redis.js";

const RELEASE_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

const RENEW_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

/**
 * Distributed Concurrency Lease Manager
 *
 * Prevents multiple simultaneous heavy AI generations from the same user across
 * all backend processes.
 *
 * Concurrency Scoping Strategy:
 * - By default, concurrency is serialized per-user across all heavy AI agents (Coding, Chat, Vision, PDF, PPT)
 *   via `lease:agent:${userId}`. This protects against multi-tab spamming, runaway parallel loops,
 *   and simultaneous credit exhaustion.
 * - An optional `agentMode` can be passed to partition leases per agent type if independent pools are desired.
 *
 * Key guarantees:
 * - Scoped specifically to AI generations (does not block standard chat CRUD).
 * - Atomic acquisition using Redis SET NX with expiration.
 * - Compare-and-delete safe release: a slow/expired request can NEVER release a newer request's lease.
 * - Lease renewal heartbeat support for long-running generations (e.g. Coding Agent).
 * - Automatic cleanup on client disconnect, completion, or error.
 */
export const acquireConcurrencyLease = async (userId, requestId, ttlMs = 120_000, agentMode = null) => {
  if (!userId) return { acquired: true, key: null, requestId };

  const key = agentMode ? `lease:agent:${userId}:${agentMode}` : `lease:agent:${userId}`;
  try {
    const result = await redis.set(key, requestId, "PX", ttlMs, "NX");
    if (result === "OK") {
      return {
        acquired: true,
        key,
        requestId,
        ttlMs,
      };
    }

    // Busy: fetch remaining TTL to inform client
    const pttl = await redis.pttl(key);
    const remainingSec = Math.max(1, Math.ceil(pttl / 1000));

    return {
      acquired: false,
      key,
      requestId,
      remainingSec,
    };
  } catch (err) {
    console.error("[ConcurrencyManager] Redis error acquiring lease:", err.message);
    // Fail-closed for expensive AI requests to protect upstream LLM resources
    return {
      acquired: false,
      key,
      requestId,
      remainingSec: 10,
      error: err.message,
    };
  }
};

/**
 * Extends the lease TTL while an operation is actively executing.
 */
export const renewConcurrencyLease = async (userId, requestId, extendMs = 60_000, agentMode = null) => {
  if (!userId || !requestId) return false;

  const key = agentMode ? `lease:agent:${userId}:${agentMode}` : `lease:agent:${userId}`;
  try {
    const result = await redis.eval(RENEW_LUA_SCRIPT, 1, key, requestId, extendMs);
    return result === 1;
  } catch (err) {
    console.error("[ConcurrencyManager] Error renewing lease:", err.message);
    return false;
  }
};

/**
 * Safely releases the concurrency lease only if the current value matches requestId.
 */
export const releaseConcurrencyLease = async (userId, requestId, agentMode = null) => {
  if (!userId || !requestId) return false;

  const key = agentMode ? `lease:agent:${userId}:${agentMode}` : `lease:agent:${userId}`;
  try {
    const result = await redis.eval(RELEASE_LUA_SCRIPT, 1, key, requestId);
    return result === 1;
  } catch (err) {
    console.error("[ConcurrencyManager] Error releasing lease:", err.message);
    return false;
  }
};
