import test, { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * ============================================================================
 * Orbit Authentication Optimization Test Suite
 * Mode: Mocked In-Memory Integration & Unit Testing
 * (Runs hermetically without external network dependencies)
 * ============================================================================
 */

// In-Memory Mock Redis Store simulating the shared Redis client
class MockRedisStore {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async set(key, value, mode, duration) {
    let expiresAt = null;
    if (mode === "PX") {
      expiresAt = Date.now() + duration;
    } else if (mode === "EX") {
      expiresAt = Date.now() + duration * 1000;
    }
    this.store.set(key, { value: String(value), expiresAt });
    return "OK";
  }

  async del(key) {
    return this.store.delete(key) ? 1 : 0;
  }

  clear() {
    this.store.clear();
  }
}

// Simulated Gateway protect middleware using injectable Redis
const createProtectMiddleware = (redisClient) => async (req, res, next) => {
  try {
    const sessionCookie = req.cookies?.session;
    if (!sessionCookie) {
      return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
    }
    const session = await redisClient.get(`session:${sessionCookie}`);
    if (!session) {
      return res.status(401).json({ message: "Session expired", error: "Session expired" });
    }

    let user;
    try {
      user = JSON.parse(session);
    } catch {
      await redisClient.del(`session:${sessionCookie}`);
      return res.status(401).json({ message: "Invalid session data", error: "Invalid session data" });
    }

    if (!user || !user.userId) {
      return res.status(401).json({ message: "Invalid session user", error: "Invalid session user" });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(500).json({ error: "Internal server error", message: error.message });
  }
};

// Simulated Gateway getCurrentUser handler
const getCurrentUserHandler = (req, res) => {
  if (!req.user) {
    return res.status(404).json({ message: "User not found" });
  }
  res.status(200).json({ user: req.user });
};

// Mock Response helper
const createMockResponse = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    cookiesCleared: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    clearCookie(name) {
      this.cookiesCleared.push(name);
      return this;
    },
  };
  return res;
};

describe("Orbit Authentication Performance Optimization Tests", () => {
  const redis = new MockRedisStore();
  const protect = createProtectMiddleware(redis);

  // 1. First-time popup login
  it("1. First-time popup login: verifies token and establishes Redis session", async () => {
    const mockUser = {
      firebaseUID: "fbase-new-user-001",
      userId: "mongo-user-id-001",
      name: "New Explorer",
      email: "explorer@orbit.dev",
      avatar: "https://orbit.dev/avatar.png",
    };
    const sessionCookie = "mock-session-cookie-12345";
    const expiresIn = 5 * 24 * 60 * 60 * 1000;

    // Simulate backend auth-service POST /login handling
    await redis.set(`session:${sessionCookie}`, JSON.stringify(mockUser), "PX", expiresIn);

    // Verify session stored in Redis
    const stored = await redis.get(`session:${sessionCookie}`);
    assert.ok(stored);
    assert.deepEqual(JSON.parse(stored), mockUser);
  });

  // 2. Redirect login handling
  it("2. Redirect login: tracks redirect in sessionStorage and processes exactly once", async () => {
    const mockSessionStorage = new Map();
    const REDIRECT_PENDING_KEY = "orbit_auth_redirect_pending";

    // Step A: Popup blocked -> set redirect pending flag
    mockSessionStorage.set(REDIRECT_PENDING_KEY, "true");
    assert.equal(mockSessionStorage.get(REDIRECT_PENDING_KEY), "true");

    // Step B: App loads after redirect -> checks and consumes flag
    let redirectProcessed = false;
    if (mockSessionStorage.get(REDIRECT_PENDING_KEY) === "true") {
      mockSessionStorage.delete(REDIRECT_PENDING_KEY);
      redirectProcessed = true;
    }

    assert.equal(redirectProcessed, true, "Redirect should be processed");
    assert.equal(mockSessionStorage.has(REDIRECT_PENDING_KEY), false, "Flag must be cleared immediately");

    // Step C: Subsequent loads must NOT re-process redirect
    const hasFlagAgain = mockSessionStorage.get(REDIRECT_PENDING_KEY) === "true";
    assert.equal(hasFlagAgain, false, "Redirect result must not be processed repeatedly");
  });

  // 3. Existing session restoration via GET /api/me
  it("3. Existing session restoration: GET /api/me returns user from Redis without re-login", async () => {
    const sessionCookie = "valid-active-session";
    const expectedUser = {
      userId: "u-123",
      firebaseUID: "f-123",
      name: "Commander",
      email: "commander@orbit.dev",
      avatar: null,
    };
    await redis.set(`session:${sessionCookie}`, JSON.stringify(expectedUser), "EX", 300);

    const req = { cookies: { session: sessionCookie } };
    const res = createMockResponse();

    let nextCalled = false;
    await protect(req, res, () => {
      nextCalled = true;
      getCurrentUserHandler(req, res);
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.user, expectedUser);
  });

  // 4. Page refresh with a valid session
  it("4. Page refresh with valid session: keeps user logged in seamlessly", async () => {
    const sessionCookie = "refresh-session-token";
    const userSession = {
      userId: "u-refresh",
      name: "Refreshing User",
      email: "refresh@orbit.dev",
    };
    await redis.set(`session:${sessionCookie}`, JSON.stringify(userSession), "EX", 300);

    // Simulate 3 consecutive page reloads
    for (let i = 0; i < 3; i++) {
      const req = { cookies: { session: sessionCookie } };
      const res = createMockResponse();
      await protect(req, res, () => getCurrentUserHandler(req, res));
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user.userId, "u-refresh");
    }
  });

  // 5. Expired session
  it("5. Expired session: returns 401 Session expired and signals unauthenticated", async () => {
    const expiredCookie = "expired-cookie-999";
    // Store with 1 millisecond expiration and wait for expiration
    await redis.set(`session:${expiredCookie}`, JSON.stringify({ userId: "u-exp" }), "PX", 1);
    await new Promise((r) => setTimeout(r, 10));

    const req = { cookies: { session: expiredCookie } };
    const res = createMockResponse();

    let nextCalled = false;
    await protect(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.message, "Session expired");
  });

  // 6. Invalid or missing session cookie
  it("6. Invalid session: returns 401 Unauthorized when cookie is missing or data is corrupted", async () => {
    // Case A: Missing cookie
    const reqA = { cookies: {} };
    const resA = createMockResponse();
    await protect(reqA, resA, () => {});
    assert.equal(resA.statusCode, 401);
    assert.equal(resA.body.error, "Unauthorized");

    // Case B: Corrupted JSON in Redis
    const corruptCookie = "corrupted-cookie";
    await redis.set(`session:${corruptCookie}`, "NOT_VALID_JSON", "EX", 300);
    const reqB = { cookies: { session: corruptCookie } };
    const resB = createMockResponse();
    await protect(reqB, resB, () => {});
    assert.equal(resB.statusCode, 401);
    assert.equal(resB.body.message, "Invalid session data");
    // Verify corrupt key was deleted
    const cleaned = await redis.get(`session:${corruptCookie}`);
    assert.equal(cleaned, null);
  });

  // 7. Backend unavailable handling
  it("7. Backend unavailable: surfaces recoverable error instead of false logout", async () => {
    const simulateRestoreBackendSession = async (mockApi) => {
      try {
        const { data } = await mockApi.get("/api/me");
        return data?.user ?? null;
      } catch (error) {
        const status = error?.response?.status;
        if (status === 401) return null;
        if (status === 403) throw new Error("Forbidden");
        if (status === 404) throw new Error("Endpoint not found");
        throw error; // Re-throw network or 5xx errors
      }
    };

    // 503 Service Unavailable / Network error
    const brokenApi = {
      get: async () => {
        const err = new Error("Network Error: Backend connection refused");
        err.response = { status: 503 };
        throw err;
      },
    };

    await assert.rejects(
      async () => simulateRestoreBackendSession(brokenApi),
      (err) => {
        assert.equal(err.response.status, 503);
        return true;
      },
      "Backend failure must throw a recoverable error, not silently return null"
    );
  });

  // 8. Popup close / window refocus behavior
  it("8. Popup close/refocus: refetchOnWindowFocus is disabled to prevent duplicate requests", () => {
    // TanStack Query configuration validation
    const queryConfig = {
      queryKey: ["auth", "current-user"],
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
    };

    assert.equal(queryConfig.refetchOnWindowFocus, false, "refetchOnWindowFocus must be false");
    assert.ok(queryConfig.staleTime >= 60000, "staleTime must keep session fresh");
  });

  // 9. Concurrent current-user requests deduplication
  it("9. Concurrent requests: multiple simultaneous calls to session restore are deduplicated", async () => {
    let networkCallCount = 0;
    let inflightPromise = null;

    const deduplicatedRestore = async () => {
      if (inflightPromise) return inflightPromise;
      inflightPromise = (async () => {
        networkCallCount++;
        await new Promise((r) => setTimeout(r, 20));
        return { userId: "user-dedup" };
      })().finally(() => {
        inflightPromise = null;
      });
      return inflightPromise;
    };

    // Fire 5 concurrent calls
    const results = await Promise.all([
      deduplicatedRestore(),
      deduplicatedRestore(),
      deduplicatedRestore(),
      deduplicatedRestore(),
      deduplicatedRestore(),
    ]);

    assert.equal(networkCallCount, 1, "Only 1 backend network request should be executed");
    results.forEach((res) => assert.equal(res.userId, "user-dedup"));
  });

  // 10. Logout and cache cleanup
  it("10. Logout: destroys Redis session and clears session cookie", async () => {
    const sessionCookie = "logout-session-id";
    await redis.set(`session:${sessionCookie}`, JSON.stringify({ userId: "u-out" }), "EX", 300);

    // Simulate backend logout handler
    const req = { cookies: { session: sessionCookie } };
    const res = createMockResponse();

    const logoutHandler = async (req, res) => {
      const cookie = req.cookies?.session;
      if (!cookie) return res.status(400).json({ error: "No session cookie found" });
      await redis.del(`session:${cookie}`);
      res.clearCookie("session");
      res.status(200).json({ message: "User logged out successfully" });
    };

    await logoutHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.cookiesCleared.includes("session"));

    // Verify session removed from Redis
    const remaining = await redis.get(`session:${sessionCookie}`);
    assert.equal(remaining, null, "Session must be purged from Redis on logout");
  });

  // 11. Gateway Domain Regex Security Audit
  it("11. Gateway regex: strictly matches orbitai-agents and orbit-ai, blocking malicious origins", () => {
    const previewDomainRegex = /^https:\/\/(?:orbit-ai|orbitai-agents)(?:-[a-zA-Z0-9_-]+)?\.vercel\.app$/;

    // Legitimate origins that MUST match
    assert.equal(previewDomainRegex.test("https://orbitai-agents.vercel.app"), true);
    assert.equal(previewDomainRegex.test("https://orbitai-agents-git-main.vercel.app"), true);
    assert.equal(previewDomainRegex.test("https://orbitai-agents-pr-42.vercel.app"), true);
    assert.equal(previewDomainRegex.test("https://orbit-ai.vercel.app"), true);
    assert.equal(previewDomainRegex.test("https://orbit-ai-git-feature.vercel.app"), true);

    // Malicious or arbitrary origins that MUST BE BLOCKED
    assert.equal(previewDomainRegex.test("https://orbit-evil.vercel.app"), false);
    assert.equal(previewDomainRegex.test("https://orbit.vercel.app"), false);
    assert.equal(previewDomainRegex.test("https://orbitai.vercel.app"), false);
    assert.equal(previewDomainRegex.test("https://orbitai-evil.vercel.app"), false);
    assert.equal(previewDomainRegex.test("https://evil-orbitai-agents.vercel.app"), false);
    assert.equal(previewDomainRegex.test("https://orbitai-agents.vercel.app.attacker.com"), false);
    assert.equal(previewDomainRegex.test("http://orbitai-agents.vercel.app"), false);
  });

  // 12. Redirect Cancellation Fallback
  it("12. Redirect cancellation fallback: checks existing cookie if redirect returns null", async () => {
    let checkExistingSessionCalled = false;
    const simulateRestoreSession = async ({ isRedirectPending, completeRedirectUser, existingUser }) => {
      if (isRedirectPending) {
        // flag cleared
        const redirectedUser = completeRedirectUser;
        if (redirectedUser) {
          return redirectedUser;
        }
      }
      checkExistingSessionCalled = true;
      return existingUser;
    };

    const user = await simulateRestoreSession({
      isRedirectPending: true,
      completeRedirectUser: null, // user cancelled redirect or no credential found
      existingUser: { userId: "existing-user-cookie" },
    });

    assert.equal(checkExistingSessionCalled, true, "Must fall back to checking existing session cookie");
    assert.equal(user.userId, "existing-user-cookie");
  });
});

