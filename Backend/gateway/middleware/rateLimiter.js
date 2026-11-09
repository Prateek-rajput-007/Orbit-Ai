import crypto from "node:crypto";
import redis from "../../shared/redis/redis.js";

/**
 * Atomic Sliding Window Rate Limiting Lua Script.
 *
 * Runs as a single atomic transaction on Redis:
 * 1. ZREMRANGEBYSCORE: Prunes timestamps older than (now - windowMs).
 * 2. ZCARD: Counts current requests in the sliding window.
 * 3. If under limit: Adds current request (ZADD) and sets TTL (PEXPIRE).
 * 4. If over limit: Fetches the oldest timestamp (ZRANGE) to calculate exact Retry-After in seconds.
 *    NOTE: Blocked requests do NOT call ZADD, ensuring rejected hits never consume quota.
 *
 * Returns table: { isAllowed (1 or 0), remainingQuota, retryAfterSeconds }
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxLimit = tonumber(ARGV[3])
local member = ARGV[4]
local clearBefore = now - windowMs

redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)
local currentCount = redis.call('ZCARD', key)

if currentCount < maxLimit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, windowMs)
  local remaining = maxLimit - (currentCount + 1)
  return { 1, remaining, 0 }
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retryAfterMs = windowMs
  if oldest and #oldest >= 2 then
    local oldestTime = tonumber(oldest[2])
    local diff = (oldestTime + windowMs) - now
    if diff > 0 then
      retryAfterMs = diff
    end
  end
  local retryAfterSec = math.ceil(retryAfterMs / 1000)
  if retryAfterSec < 1 then
    retryAfterSec = 1
  end
  return { 0, 0, retryAfterSec }
end
`;

/**
 * Creates an atomic sliding-window rate limiter middleware.
 *
 * @param {object} options
 * @param {string} options.prefix - Redis key prefix (e.g. "rl:auth", "rl:chat", "rl:agent")
 * @param {number} options.windowMs - Rolling window duration in milliseconds (default: 60,000ms = 1m)
 * @param {number} options.max - Maximum requests allowed per window
 * @param {function} options.keyGenerator - (req) => string identifier (must use req.user.userId for authenticated routes)
 * @param {string} options.errorMessage - Descriptive message returned to client on HTTP 429
 * @param {boolean} options.failClosed - If true, rejects with 503 on Redis outage (default: true for protected/AI routes)
 */
export const createRateLimiter = ({
  prefix = "rl",
  windowMs = 60 * 1000,
  max = 10,
  keyGenerator,
  errorMessage = "Too many requests. Please slow down and try again.",
  failClosed = true,
}) => {
  return async (req, res, next) => {
    let identifier;
    try {
      identifier = typeof keyGenerator === "function" ? keyGenerator(req) : null;
    } catch {
      identifier = null;
    }

    if (!identifier) {
      identifier = req.ip || "unknown-client";
    }

    const redisKey = `${prefix}:${identifier}`;
    const now = Date.now();
    // Cryptographically secure UUID ensures requests arriving in the exact same millisecond never overwrite
    const member = `${now}:${crypto.randomUUID()}`;

    try {
      // Execute Lua script atomically on Redis server
      const result = await redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        redisKey,
        now,
        windowMs,
        max,
        member
      );

      const [isAllowed, remaining, retryAfterSeconds] = result;

      if (isAllowed === 1) {
        res.setHeader("X-RateLimit-Limit", max);
        res.setHeader("X-RateLimit-Remaining", remaining);
        res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));
        return next();
      }

      // Exceeded limit: return standardized HTTP 429 response
      const retryAfter = Math.max(1, retryAfterSeconds || Math.ceil(windowMs / 1000));
      res.setHeader("Retry-After", retryAfter);
      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", 0);
      res.setHeader("X-RateLimit-Reset", Math.ceil((now + (retryAfter * 1000)) / 1000));

      return res.status(429).json({
        error: "Too Many Requests",
        message: errorMessage,
        retryAfter,
        status: 429,
      });
    } catch (err) {
      console.error(`[RateLimiter:${prefix}] Redis operation failed:`, err.message);

      if (failClosed) {
        // Controlled 503 rejection for protected/expensive operations
        res.setHeader("Retry-After", 10);
        return res.status(503).json({
          error: "Service Temporarily Unavailable",
          message: "Rate limiting and abuse protection services are temporarily unavailable. Please retry shortly.",
          status: 503,
          retryAfter: 10,
        });
      }

      // Fail-open for non-critical informational endpoints
      next();
    }
  };
};

export default createRateLimiter;
