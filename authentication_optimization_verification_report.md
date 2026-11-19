# Orbit Authentication Optimization — Independent Verification Audit Report

**Auditor:** Senior MERN Engineer & Security Code Reviewer  
**Date:** November 19, 2026  
**Target:** Orbit Multi-Service Authentication Subsystem (`https://orbitai-agents.vercel.app/`)  
**Verdict:** **PASS WITH LIMITATIONS**  

---

## 1. Final Verdict: PASS WITH LIMITATIONS

The authentication performance optimization correctly eliminates redundant Firebase and MongoDB operations on initial page load and refreshes, prevents duplicate queries on window refocus, introduces non-blocking pre-warming, and enhances user feedback during server cold starts.

Two confirmed defects were identified during this audit and have been fixed:
1. **Security Defect**: `previewDomainRegex` in the Gateway was overly permissive (`/^https:\/\/orbit(?:-ai|ai)?(?:-[a-zA-Z0-9_-]+)?\.vercel\.app$/`), allowing arbitrary `orbit-<anything>.vercel.app` origins to bypass CORS and CSRF guards. This has been tightened to strictly match `(?:orbit-ai|orbitai-agents)`.
2. **Redirect Edge Case**: If redirect sign-in was initiated but returned `null` (e.g. user aborted sign-in on Google), `restoreSession()` returned `null` immediately without checking whether a valid session cookie already existed. This has been corrected to fall back to `restoreBackendSession()`.

The **LIMITATION** designation reflects that real-world cloud container cold-start elimination is host-infrastructure dependent (Render free-tier inactivity sleep) and cannot be eliminated by application code alone without continuous pinging or paid hosting.

---

## 2. Verified Changes

| Component / File | Verification Findings | Status |
|---|---|---|
| `Frontend/src/api/prewarm.js` | Fires a single non-blocking `GET /` to the Gateway root with `credentials: "omit"` and `cache: "no-store"`. Guarded by module-level boolean `prewarmTriggered`. | **VERIFIED CLEAN** |
| `Frontend/src/App.jsx` | Invokes `prewarmBackend()` inside a mount-only `useEffect`. Rendering is non-blocking. | **VERIFIED CLEAN** |
| `Frontend/src/features/auth/auth.js` | Directs returning users to `restoreBackendSession()` (`GET /api/me`) instead of full `POST /api/auth/login`. Restricts `getRedirectResult(auth)` strictly to sessions with `orbit_auth_redirect_pending`. | **VERIFIED CLEAN** (Defect resolved) |
| `Frontend/src/features/auth/useAuthSession.js` | Sets `refetchOnWindowFocus: false`, `staleTime: 5m`, selective retry ignoring 401/403/404, and preserves clean query invalidation. | **VERIFIED CLEAN** |
| `Frontend/src/components/signin/GoogleAuthButton.jsx` | Clean React 19 hook lifecycle with timer cleanup; displays dynamic elapsed-time states (0–3s, 3–7s, 7s+) without cascading render errors. | **VERIFIED CLEAN** |
| `Frontend/src/pages/Home.jsx` | Inlines `WorkspaceLoader` with a 2.5s threshold warning for server wakeup; renders clean error notice without unmounting. | **VERIFIED CLEAN** |
| `Backend/gateway/index.js` | Switched `/api/me` route to explicit `app.get("/api/me", protect, getCurrentUser)`. Tightened `previewDomainRegex`. | **VERIFIED CLEAN** (Defect resolved) |

---

## 3. Defects Found and Fixes Applied

### Defect 1 (Security): Overly Broad Origin Matching in Gateway
- **Location:** `Backend/gateway/index.js` (line 34)
- **Root Cause:** The regex `^https:\/\/orbit(?:-ai|ai)?(?:-[a-zA-Z0-9_-]+)?\.vercel\.app$` made `(?:-ai|ai)` optional. As a result, an origin like `https://orbit-attacker.vercel.app` matched `^https:\/\/orbit` + `-attacker` + `.vercel.app`, granting unauthorized CORS and CSRF bypass access.
- **Fix Applied:** Tightened to strictly require the registered project names:
  ```javascript
  const previewDomainRegex = process.env.VERCEL_PREVIEW_PATTERN
      ? new RegExp(process.env.VERCEL_PREVIEW_PATTERN)
      : /^https:\/\/(?:orbit-ai|orbitai-agents)(?:-[a-zA-Z0-9_-]+)?\.vercel\.app$/;
  ```
- **Verification:** Unit test #11 verified that `orbitai-agents.vercel.app`, preview branches, and `orbit-ai.vercel.app` match, while `orbit-evil.vercel.app`, `orbit.vercel.app`, and `orbitai.vercel.app` are rejected.

### Defect 2 (Functional): Premature Abandonment of Existing Session on Aborted Redirect
- **Location:** `Frontend/src/features/auth/auth.js` (`restoreSession`)
- **Root Cause:** If a user initiated a redirect login but returned without a credential (e.g. cancelled at Google prompt), `completeRedirectSignIn()` returned `null`. The function returned `null` immediately without checking if the user already possessed a valid session cookie.
- **Fix Applied:** Modified `restoreSession` to check if `redirectedUser` is truthy, falling back to `restoreBackendSession()` if `null`:
  ```javascript
  if (isRedirectPending) {
    try {
      window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
      const redirectedUser = await completeRedirectSignIn();
      if (redirectedUser) {
        return redirectedUser;
      }
    } catch (redirectError) {
      console.warn("Failed to complete redirect sign-in, falling back to /api/me check:", redirectError);
    }
  }
  return await restoreBackendSession();
  ```
- **Verification:** Unit test #12 verified fallback behavior when redirect yields null.

---

## 4. Authentication Security Findings

1. **Server-Side Session Enforcement**:
   - `GET /api/me` is strictly protected by `protect` middleware (`auth.middleware.js`).
   - Requests without a `session` cookie are rejected with `401 Unauthorized`.
   - Redis lookup keys are formed as `session:${sessionCookie}` using the server-generated cookie value, never client-submitted payloads.
2. **User Identity Provenance**:
   - The user identity returned by `GET /api/me` is read entirely from the Redis session record originally verified by Firebase Admin during `POST /login`.
3. **Cookie Attributes**:
   - In production: `httpOnly: true`, `secure: true`, `sameSite: "none"`, `maxAge: 5 days`.
   - `api.js` is configured with `withCredentials: true`, ensuring cookies pass cross-origin between Vercel and Render.
4. **Logout Invalidation**:
   - `POST /api/auth/logout` deletes the Redis session key (`redis.del`) and issues `res.clearCookie("session")`.
   - The frontend clears `queryKeys.currentUser` and removes all cached conversation queries.

---

## 5. Test Evidence

### 1. Backend Security & Optimization Test Suite
**Command:** `node --test Backend/tests/security/auth_optimization.test.js`  
**Exit Code:** `0`  
**Duration:** `128 ms`  
**Tests Run:** 12 | **Passed:** 12 | **Failed:** 0  

```
TAP version 13
# Subtest: Orbit Authentication Performance Optimization Tests
    # Subtest: 1. First-time popup login: verifies token and establishes Redis session
    ok 1 - 1. First-time popup login: verifies token and establishes Redis session
    # Subtest: 2. Redirect login: tracks redirect in sessionStorage and processes exactly once
    ok 2 - 2. Redirect login: tracks redirect in sessionStorage and processes exactly once
    # Subtest: 3. Existing session restoration: GET /api/me returns user from Redis without re-login
    ok 3 - 3. Existing session restoration: GET /api/me returns user from Redis without re-login
    # Subtest: 4. Page refresh with valid session: keeps user logged in seamlessly
    ok 4 - 4. Page refresh with valid session: keeps user logged in seamlessly
    # Subtest: 5. Expired session: returns 401 Session expired and signals unauthenticated
    ok 5 - 5. Expired session: returns 401 Session expired and signals unauthenticated
    # Subtest: 6. Invalid session: returns 401 Unauthorized when cookie is missing or data is corrupted
    ok 6 - 6. Invalid session: returns 401 Unauthorized when cookie is missing or data is corrupted
    # Subtest: 7. Backend unavailable: surfaces recoverable error instead of false logout
    ok 7 - 7. Backend unavailable: surfaces recoverable error instead of false logout
    # Subtest: 8. Popup close/refocus: refetchOnWindowFocus is disabled to prevent duplicate requests
    ok 8 - 8. Popup close/refocus: refetchOnWindowFocus is disabled to prevent duplicate requests
    # Subtest: 9. Concurrent requests: multiple simultaneous calls to session restore are deduplicated
    ok 9 - 9. Concurrent requests: multiple simultaneous calls to session restore are deduplicated
    # Subtest: 10. Logout: destroys Redis session and clears session cookie
    ok 10 - 10. Logout: destroys Redis session and clears session cookie
    # Subtest: 11. Gateway regex: strictly matches orbitai-agents and orbit-ai, blocking malicious origins
    ok 11 - 11. Gateway regex: strictly matches orbitai-agents and orbit-ai, blocking malicious origins
    # Subtest: 12. Redirect cancellation fallback: checks existing cookie if redirect returns null
    ok 12 - 12. Redirect cancellation fallback: checks existing cookie if redirect returns null
    1..12
ok 1 - Orbit Authentication Performance Optimization Tests
1..1
# tests 12
# suites 1
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### 2. Frontend Linter
**Command:** `npm --prefix Frontend run lint`  
**Exit Code:** `0` (Zero errors, zero warnings)

### 3. Frontend Production Build
**Command:** `npm --prefix Frontend run build`  
**Exit Code:** `0` (Built successfully in 1.12s via Vite)

---

## 6. Mocked vs. Real Integration Coverage

- **In-Memory Mock Coverage (12 tests)**:
  - All 12 automated tests in `auth_optimization.test.js` run against an in-memory Redis implementation and mock Express context. This allows deterministic, hermetic execution without requiring live Upstash credentials or external internet access inside CI/sandbox environments.
- **Real Service Integration Coverage**:
  - `gateway_integration.test.js` tests live HTTP server bindings against real Upstash Redis when network access is enabled (`BypassSandbox: true`).
  - Production verification requires the deployed environment on Render / Vercel.

---

## 7. Deployed Performance Measurements

Because execution took place within an isolated offline development sandbox without outbound network access:
- **Direct deployed latency against `https://orbitai-agents.vercel.app/` was not independently recorded during this turn.**
- Any previous claims of specific 5–10ms latency reflect expected in-memory Redis lookup speeds rather than live cross-region HTTP roundtrips between Vercel Edge and Render.
- Architectural latency reductions (eliminating 2 Google external API calls and 1 MongoDB find on every page load) are confirmed by static code path verification.

---

## 8. Remaining Limitations

1. **Physical Container Spin-Up (Free Tier)**:
   - On Render Free Web Services, inactivity past 15 minutes spins down the container. The background `prewarmBackend()` ping starts container initialization when a user visits the landing page, but cold-start delays will remain noticeable if the user clicks "Continue with Google" immediately upon loading.
2. **Third-Party Cookie Restrictions**:
   - Browsers with strict cross-site cookie blocking (such as Safari ITP) may restrict cookies set across different domains (`orbitai-agents.vercel.app` $\leftrightarrow$ `onrender.com`). A shared custom domain (e.g. `app.orbit.dev` / `api.orbit.dev`) is the recommended production standard.

---

## 9. Files Modified During This Audit

- [Backend/gateway/index.js](file:///d:/Code/LLM/Advance%20Ai%20MERN/Backend/gateway/index.js): Tightened `previewDomainRegex` to disallow malicious `orbit-*.vercel.app` domains.
- [Frontend/src/features/auth/auth.js](file:///d:/Code/LLM/Advance%20Ai%20MERN/Frontend/src/features/auth/auth.js): Added fallback to `restoreBackendSession()` if redirect sign-in yields null.
- [Backend/tests/security/auth_optimization.test.js](file:///d:/Code/LLM/Advance%20Ai%20MERN/Backend/tests/security/auth_optimization.test.js): Added tests #11 and #12 covering domain regex security and redirect cancellation fallback.

