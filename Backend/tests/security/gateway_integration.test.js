import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import redis from "../../shared/redis/redis.js";
import { app } from "../../gateway/index.js";
import { createRateLimiter } from "../../gateway/middleware/rateLimiter.js";

let server;
let serverBaseUrl;
const MOCK_SESSION_COOKIE = `test-session-${Date.now()}`;
const MOCK_USER_ID = `user-integration-${Date.now()}`;

before(async () => {
  // 1. Insert test session in Upstash Redis
  await redis.set(
    `session:${MOCK_SESSION_COOKIE}`,
    JSON.stringify({
      userId: MOCK_USER_ID,
      firebaseUID: "test-firebase-uid",
      email: "tester@orbit.dev",
      name: "Orbit Tester",
    }),
    "EX",
    300
  );

  // 2. Start Gateway on ephemeral port
  await new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      serverBaseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  // Clean up Redis and close server
  await redis.del(`session:${MOCK_SESSION_COOKIE}`);
  await redis.del(`rl:user:chat:${MOCK_USER_ID}`);
  await redis.del(`rl:user:agent:${MOCK_USER_ID}`);
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await redis.quit();
});

test("Gateway Integration: Health check GET / is unrestricted and returns 200", async () => {
  const res = await fetch(`${serverBaseUrl}/`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.message, "Gateway service is running");
});

test("Gateway Integration: Unauthenticated requests are rejected with 401 before rate limiting", async () => {
  const res = await fetch(`${serverBaseUrl}/api/chat/get-conversations`);
  assert.equal(res.status, 401, "Unauthenticated request must be rejected with 401 by auth middleware");
  const data = await res.json();
  assert.equal(data.error, "Unauthorized");
});

test("Gateway Integration: Authenticated requests extract verified identity from Redis session", async () => {
  const res = await fetch(`${serverBaseUrl}/api/me`, {
    headers: {
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
    },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.user.userId, MOCK_USER_ID, "Identity must come from verified session in Redis");
  assert.equal(data.user.email, "tester@orbit.dev");
});

test("Gateway Integration: Spoofed X-Forwarded-For header cannot manipulate resolved client IP", async () => {
  const spoofedHeader = "198.51.100.1, 203.0.113.195";

  const res = await fetch(`${serverBaseUrl}/`, {
    headers: {
      "X-Forwarded-For": spoofedHeader,
    },
  });
  assert.equal(res.status, 200);
});

test("Gateway Integration: Same-millisecond high-concurrency race condition test", async () => {
  const key = `test:rl:millisecond-race:${Date.now()}`;
  const maxLimit = 5;
  const limiter = createRateLimiter({
    prefix: "test:rl:same-ms",
    windowMs: 5000,
    max: maxLimit,
    keyGenerator: () => key,
  });

  const simultaneousReqs = Array.from({ length: 50 }).map(async () => {
    let allowed = false;
    let statusCode = 200;
    const mockReq = { ip: "127.0.0.1" };
    const mockRes = {
      headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = String(v); },
      status(c) { statusCode = c; return this; },
      json() { return this; },
    };

    await limiter(mockReq, mockRes, () => { allowed = true; });
    return { allowed, statusCode };
  });

  const results = await Promise.all(simultaneousReqs);
  const allowedCount = results.filter((r) => r.allowed).length;
  const blockedCount = results.filter((r) => r.statusCode === 429).length;

  assert.equal(allowedCount, maxLimit, `Strictly ${maxLimit} requests must be allowed under 50 simultaneous hits`);
  assert.equal(blockedCount, 45, "Strictly 45 requests must receive HTTP 429");

  // Clean up
  await redis.del(`test:rl:same-ms:${key}`);
});

test("Gateway Integration: Strict CORS allows valid Vercel preview & production origins, rejects malicious", async () => {
  // Valid Origin 1: Default frontend URL
  const res1 = await fetch(`${serverBaseUrl}/`, {
    headers: { Origin: "http://localhost:5173" },
  });
  assert.equal(res1.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(res1.headers.get("access-control-allow-credentials"), "true");

  // Valid Origin 2: Orbit Vercel production
  const res2 = await fetch(`${serverBaseUrl}/`, {
    headers: { Origin: "https://orbit-ai.vercel.app" },
  });
  assert.equal(res2.headers.get("access-control-allow-origin"), "https://orbit-ai.vercel.app");

  // Valid Origin 3: Orbit scoped preview deployment
  const res3 = await fetch(`${serverBaseUrl}/`, {
    headers: { Origin: "https://orbit-ai-git-feature.vercel.app" },
  });
  assert.equal(res3.headers.get("access-control-allow-origin"), "https://orbit-ai-git-feature.vercel.app");

  // Malicious Origin 4: Arbitrary / malicious Vercel deployment (MUST BE BLOCKED!)
  const res4 = await fetch(`${serverBaseUrl}/`, {
    headers: { Origin: "https://evil-phishing-attacker.vercel.app" },
  });
  assert.equal(
    res4.headers.get("access-control-allow-origin"),
    null,
    "Arbitrary Vercel domains must NOT receive Access-Control-Allow-Origin"
  );

  // Malicious Origin 5: Unknown external website
  const res5 = await fetch(`${serverBaseUrl}/`, {
    headers: { Origin: "https://attacker.com" },
  });
  assert.equal(res5.headers.get("access-control-allow-origin"), null);

  // Non-browser / server-to-server request (no Origin header)
  const res6 = await fetch(`${serverBaseUrl}/`);
  assert.equal(res6.status, 200, "Requests without Origin header must proceed normally");
});

// =========================================================================
// CSRF & SEC-FETCH-SITE VERIFICATION SUITE (ALL 6 CRITICAL CONDITIONS)
// =========================================================================

test("CSRF Guard Condition 1: Trusted frontend Origin + Sec-Fetch-Site cross-site is ALLOWED", async () => {
  // Legitimate browser call from Vercel frontend to Render backend
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "POST",
    headers: {
      Origin: "https://orbit-ai.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  // Must NOT be blocked by CSRF guard (status !== 403)
  assert.notEqual(res.status, 403, "Trusted origin + Sec-Fetch-Site cross-site must be allowed through CSRF guard");
});

test("CSRF Guard Condition 2: Untrusted frontend Origin + Sec-Fetch-Site cross-site is REJECTED (403)", async () => {
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "POST",
    headers: {
      Origin: "https://malicious-attacker.com",
      "Sec-Fetch-Site": "cross-site",
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 403, "Untrusted cross-origin request must be rejected with 403 Forbidden");
  const data = await res.json();
  assert.equal(data.error, "Forbidden");
});

test("CSRF Guard Condition 3: Same-Origin requests (Origin matches Host header) are ALLOWED", async () => {
  const host = new URL(serverBaseUrl).host;
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "POST",
    headers: {
      Origin: `http://${host}`,
      Host: host,
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.notEqual(res.status, 403, "Same-origin state-changing request must be allowed");
});

test("CSRF Guard Condition 4: Requests without Origin header (direct API / curl) are ALLOWED", async () => {
  // Non-browser client without Origin or Sec-Fetch headers
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "POST",
    headers: {
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.notEqual(res.status, 403, "Direct non-browser API requests without Origin must proceed");
});

test("CSRF Guard Condition 5: Requests with Origin: 'null' are REJECTED (403)", async () => {
  // Browsers send Origin: null for data: URIs and sandboxed iframes
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "POST",
    headers: {
      Origin: "null",
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  assert.equal(res.status, 403, "Requests with Origin: null must be blocked with 403 Forbidden");
  const data = await res.json();
  assert.equal(data.error, "Forbidden");
});

test("CSRF Guard Condition 6: Browser-style preflight OPTIONS requests are ALLOWED", async () => {
  const res = await fetch(`${serverBaseUrl}/api/chat/create-conversation`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://orbit-ai.vercel.app",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type",
    },
  });

  assert.notEqual(res.status, 403, "Preflight OPTIONS requests must not be blocked by CSRF guard");
  assert.equal(res.headers.get("access-control-allow-origin"), "https://orbit-ai.vercel.app");
});

// =========================================================================
// LOGOUT ROUTE SECURITY VERIFICATION
// =========================================================================

test("Auth Route: POST /api/auth/logout with trusted origin passes CSRF guard", async () => {
  const res = await fetch(`${serverBaseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      Origin: "https://orbit-ai.vercel.app",
      "Sec-Fetch-Site": "cross-site",
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
    },
  });

  // Passed CSRF guard (status is not 403)
  assert.notEqual(res.status, 403, "POST logout from trusted origin must pass CSRF guard");
});

test("Auth Route: POST /api/auth/logout with untrusted origin is BLOCKED with 403", async () => {
  const res = await fetch(`${serverBaseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      Origin: "https://evil-attacker.com",
      Cookie: `session=${MOCK_SESSION_COOKIE}`,
    },
  });

  assert.equal(res.status, 403, "POST logout from malicious origin must be blocked with 403 Forbidden");
});
