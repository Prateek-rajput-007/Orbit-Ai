import test, { after } from "node:test";
import assert from "node:assert/strict";
import redis from "../../shared/redis/redis.js";
import { createRateLimiter } from "../../gateway/middleware/rateLimiter.js";

after(async () => {
  await redis.quit();
});

// Mock Express req, res, next builder
const createMockContext = ({
  ip = "127.0.0.1",
  user = null,
  headers = {},
} = {}) => {
  const req = {
    ip,
    user,
    headers: { ...headers },
  };

  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, val) {
      this.headers[key.toLowerCase()] = String(val);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return { req, res };
};

test("Phase 1: Requests below threshold are allowed with proper rate limit headers", async () => {
  const limiter = createRateLimiter({
    prefix: "test:rl:allow",
    windowMs: 10_000,
    max: 5,
    keyGenerator: (req) => req.user?.userId || req.ip,
  });

  const userId = `user-allow-${Date.now()}`;
  const { req, res } = createMockContext({ user: { userId } });

  let nextCalled = false;
  await limiter(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true, "First request must proceed");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["x-ratelimit-limit"], "5");
  assert.equal(res.headers["x-ratelimit-remaining"], "4");
  assert.ok(res.headers["x-ratelimit-reset"], "Reset header must be present");

  // Clean up
  await redis.del(`test:rl:allow:${userId}`);
});

test("Phase 1: Requests exceeding threshold receive HTTP 429 with Retry-After header", async () => {
  const limiter = createRateLimiter({
    prefix: "test:rl:block",
    windowMs: 10_000,
    max: 2,
    keyGenerator: (req) => req.user?.userId,
    errorMessage: "AI rate limit reached. Please wait.",
  });

  const userId = `user-block-${Date.now()}`;

  // Request 1: Allowed
  const ctx1 = createMockContext({ user: { userId } });
  let next1 = false;
  await limiter(ctx1.req, ctx1.res, () => { next1 = true; });
  assert.equal(next1, true);

  // Request 2: Allowed (reaches max limit)
  const ctx2 = createMockContext({ user: { userId } });
  let next2 = false;
  await limiter(ctx2.req, ctx2.res, () => { next2 = true; });
  assert.equal(next2, true);

  // Request 3: Blocked with HTTP 429
  const ctx3 = createMockContext({ user: { userId } });
  let next3 = false;
  await limiter(ctx3.req, ctx3.res, () => { next3 = true; });

  assert.equal(next3, false, "Request 3 must be blocked");
  assert.equal(ctx3.res.statusCode, 429);
  assert.equal(ctx3.res.body.error, "Too Many Requests");
  assert.equal(ctx3.res.body.message, "AI rate limit reached. Please wait.");
  assert.ok(Number(ctx3.res.headers["retry-after"]) >= 1, "Retry-After must be positive integer");
  assert.equal(ctx3.res.headers["x-ratelimit-remaining"], "0");

  // Clean up
  await redis.del(`test:rl:block:${userId}`);
});

test("Phase 1: Independent quotas for different authenticated users", async () => {
  const limiter = createRateLimiter({
    prefix: "test:rl:users",
    windowMs: 10_000,
    max: 1,
    keyGenerator: (req) => req.user?.userId,
  });

  const userAlpha = `user-alpha-${Date.now()}`;
  const userBeta = `user-beta-${Date.now()}`;

  // Exhaust User Alpha
  const ctxA1 = createMockContext({ user: { userId: userAlpha } });
  await limiter(ctxA1.req, ctxA1.res, () => {});
  const ctxA2 = createMockContext({ user: { userId: userAlpha } });
  await limiter(ctxA2.req, ctxA2.res, () => {});
  assert.equal(ctxA2.res.statusCode, 429, "User Alpha must be rate limited");

  // User Beta must still have full independent quota
  const ctxB1 = createMockContext({ user: { userId: userBeta } });
  let betaPassed = false;
  await limiter(ctxB1.req, ctxB1.res, () => { betaPassed = true; });
  assert.equal(betaPassed, true, "User Beta must be allowed");
  assert.equal(ctxB1.res.statusCode, 200);

  // Clean up
  await redis.del(`test:rl:users:${userAlpha}`);
  await redis.del(`test:rl:users:${userBeta}`);
});

test("Phase 1: Atomic Lua script prevents race conditions under high concurrency", async () => {
  const limiter = createRateLimiter({
    prefix: "test:rl:atomic",
    windowMs: 10_000,
    max: 5,
    keyGenerator: (req) => req.user?.userId,
  });

  const userConcurrent = `user-concurrent-${Date.now()}`;

  // Fire 20 simultaneous requests at the exact same millisecond
  const batch = Array.from({ length: 20 }).map(async () => {
    const { req, res } = createMockContext({ user: { userId: userConcurrent } });
    let passed = false;
    await limiter(req, res, () => { passed = true; });
    return { passed, status: res.statusCode };
  });

  const results = await Promise.all(batch);
  const allowed = results.filter((r) => r.passed).length;
  const blocked = results.filter((r) => r.status === 429).length;

  assert.equal(allowed, 5, "Strictly 5 requests must pass");
  assert.equal(blocked, 15, "Strictly 15 requests must be rejected with 429");

  // Clean up
  await redis.del(`test:rl:atomic:${userConcurrent}`);
});

test("Phase 1: Sliding window expires and quota recovers", async () => {
  const shortLimiter = createRateLimiter({
    prefix: "test:rl:window-recovery",
    windowMs: 600, // 600ms window
    max: 1,
    keyGenerator: (req) => req.user?.userId,
  });

  const userRecover = `user-recover-${Date.now()}`;

  // Hit 1: Allowed
  const ctx1 = createMockContext({ user: { userId: userRecover } });
  let p1 = false;
  await shortLimiter(ctx1.req, ctx1.res, () => { p1 = true; });
  assert.equal(p1, true);

  // Immediate Hit 2: Blocked
  const ctx2 = createMockContext({ user: { userId: userRecover } });
  let p2 = false;
  await shortLimiter(ctx2.req, ctx2.res, () => { p2 = true; });
  assert.equal(p2, false);
  assert.equal(ctx2.res.statusCode, 429);

  // Wait for window to expire
  await new Promise((r) => setTimeout(r, 700));

  // Hit 3: Recovers and is allowed
  const ctx3 = createMockContext({ user: { userId: userRecover } });
  let p3 = false;
  await shortLimiter(ctx3.req, ctx3.res, () => { p3 = true; });
  assert.equal(p3, true, "Quota must recover after sliding window expires");

  // Clean up
  await redis.del(`test:rl:window-recovery:${userRecover}`);
});

test("Phase 1: IP-based limits for public unauthenticated endpoints", async () => {
  const publicLimiter = createRateLimiter({
    prefix: "test:rl:public-ip",
    windowMs: 10_000,
    max: 2,
    keyGenerator: (req) => req.ip,
    errorMessage: "Too many login attempts from this IP",
  });

  const ipA = "198.51.100.10";
  const ipB = "198.51.100.20";

  // Exhaust IP A
  for (let i = 0; i < 2; i++) {
    const ctx = createMockContext({ ip: ipA });
    await publicLimiter(ctx.req, ctx.res, () => {});
  }
  const ctxA3 = createMockContext({ ip: ipA });
  await publicLimiter(ctxA3.req, ctxA3.res, () => {});
  assert.equal(ctxA3.res.statusCode, 429);

  // IP B has independent allowance
  const ctxB1 = createMockContext({ ip: ipB });
  let bAllowed = false;
  await publicLimiter(ctxB1.req, ctxB1.res, () => { bAllowed = true; });
  assert.equal(bAllowed, true);

  // Clean up
  await redis.del(`test:rl:public-ip:${ipA}`);
  await redis.del(`test:rl:public-ip:${ipB}`);
});

test("Phase 1: Fail-closed security policy on Redis outage returns HTTP 503", async () => {
  const protectedLimiter = createRateLimiter({
    prefix: "test:rl:failclosed",
    windowMs: 10_000,
    max: 5,
    keyGenerator: (req) => req.user?.userId,
    failClosed: true,
  });

  const ctx = createMockContext({ user: { userId: "test-failclosed" } });

  // Simulate Redis outage by mocking redis.eval failure
  const originalEval = redis.eval;
  redis.eval = () => Promise.reject(new Error("Redis cluster connection timeout"));

  let nextCalled = false;
  await protectedLimiter(ctx.req, ctx.res, () => { nextCalled = true; });

  // Restore redis.eval
  redis.eval = originalEval;

  assert.equal(nextCalled, false, "Must block request when security state cannot be verified");
  assert.equal(ctx.res.statusCode, 503, "Must return HTTP 503");
  assert.equal(ctx.res.body.error, "Service Temporarily Unavailable");
  assert.ok(ctx.res.headers["retry-after"], "Retry-After must be supplied on 503");
});

test("Phase 1: CORS validation permits valid origins and rejects unauthorized origins", () => {
  const allowedOrigins = ["http://localhost:5173", "https://orbit-ai.vercel.app"];

  const corsCheck = (origin) => {
    if (!origin) return true; // Server-to-server or curl
    const clean = origin.replace(/\/$/, "");
    if (allowedOrigins.includes(clean) || clean.endsWith(".vercel.app")) {
      return true;
    }
    return false;
  };

  assert.equal(corsCheck("http://localhost:5173"), true, "Localhost origin allowed");
  assert.equal(corsCheck("https://orbit-ai.vercel.app"), true, "Production Vercel URL allowed");
  assert.equal(corsCheck("https://orbit-ai-git-feature.vercel.app"), true, "Vercel preview subdomain allowed");
  assert.equal(corsCheck("https://malicious-attacker.com"), false, "Third-party origin blocked");
  assert.equal(corsCheck("https://vercel.app.attacker.com"), false, "Spoofed domain suffix blocked");
  assert.equal(corsCheck(null), true, "Direct non-browser origin permitted");
});
