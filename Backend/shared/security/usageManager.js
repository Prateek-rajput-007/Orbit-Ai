import redis from "../redis/redis.js";

const USAGE_INCR_LUA = `
local key = KEYS[1]
local maxLimit = tonumber(ARGV[1])
local ttlSec = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key)) or 0

if current < maxLimit then
  local newCount = redis.call('INCR', key)
  if newCount == 1 then
    redis.call('EXPIRE', key, ttlSec)
  end
  return { 1, newCount, maxLimit - newCount }
else
  return { 0, current, 0 }
end
`;

/**
 * Calculates remaining seconds until the next UTC midnight.
 */
export const getSecondsUntilUtcMidnight = () => {
  const now = new Date();
  const nextMidnightUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0
  ));
  return Math.max(1, Math.ceil((nextMidnightUtc.getTime() - now.getTime()) / 1000));
};

/**
 * Daily AI Usage Quota Manager
 *
 * Scope & Architecture:
 * - Tracks user-level AI interaction turns (requests) aligned strictly with UTC midnight resets.
 * - Purpose: Protects backend worker pools, rate limits, and abuse prevention against automated loops.
 * - Distinction from Financial Metering:
 *   * Turn quotas meter "requests" (e.g. 100 turns/day) to prevent runaway scripts.
 *   * Upstream LLM providers (Groq, Gemini) bill based on input/output tokens. Orbit captures
 *     prompt and completion token metrics via telemetry.js for cost analytics.
 *
 * Guarantees:
 * - Atomic evaluation using Redis Lua script.
 * - Concurrent requests cannot exceed the daily limit.
 * - Rejected requests do NOT increment or consume quota.
 * - Rollback cleanly clears the key if decremented to <= 0 (no lingering zero-keys without TTL).
 */
export const checkAndConsumeDailyQuota = async (userId, maxDailyTurns = 100) => {
  if (!userId) {
    return { allowed: true, current: 0, remaining: maxDailyTurns, retryAfterSec: 0 };
  }

  const todayUtc = new Date().toISOString().slice(0, 10); // YYYY-MM-DD in UTC
  const key = `quota:daily:${userId}:${todayUtc}`;
  const ttlSec = getSecondsUntilUtcMidnight() + 3600; // Extra 1h buffer

  try {
    const result = await redis.eval(USAGE_INCR_LUA, 1, key, maxDailyTurns, ttlSec);
    const [isAllowed, currentCount, remaining] = result;

    return {
      allowed: isAllowed === 1,
      current: currentCount,
      remaining: Math.max(0, remaining),
      retryAfterSec: isAllowed === 1 ? 0 : getSecondsUntilUtcMidnight(),
      dailyLimit: maxDailyTurns,
    };
  } catch (err) {
    console.error("[UsageManager] Error enforcing daily quota:", err.message);
    // Transient Redis error: fail-open for quota accounting so users are not blocked
    return {
      allowed: true,
      current: 0,
      remaining: maxDailyTurns,
      retryAfterSec: 0,
      error: err.message,
    };
  }
};

/**
 * Rolls back 1 turn from daily quota if generation was aborted before touching the LLM.
 * Removes key if counter drops to 0 or below to prevent dangling zero-value keys.
 */
export const rollbackDailyQuota = async (userId) => {
  if (!userId) return;

  const todayUtc = new Date().toISOString().slice(0, 10);
  const key = `quota:daily:${userId}:${todayUtc}`;
  try {
    const count = await redis.decr(key);
    if (count <= 0) {
      await redis.del(key);
    }
  } catch (err) {
    console.error("[UsageManager] Error rolling back quota:", err.message);
  }
};
