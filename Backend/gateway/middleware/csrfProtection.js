/**
 * State-Changing Request Origin & CSRF Protection Middleware.
 *
 * Architecture Context:
 * - Frontend is hosted on Vercel (e.g., https://orbit-ai.vercel.app or preview branches).
 * - Backend Gateway is hosted on Render (e.g., https://orbit-backend.onrender.com).
 * - Because these are different sites, modern browsers legitimately send:
 *   `Sec-Fetch-Site: cross-site` with state-changing requests (POST, PUT, DELETE, PATCH).
 *
 * Security Requirements:
 * 1. Preflight OPTIONS and read-only GET/HEAD requests are not state-changing and proceed unhindered.
 * 2. If an Origin or Referer header is present:
 *    - Must match an explicitly trusted frontend origin (allowedOrigins, local dev, or scoped preview regex),
 *      OR match the server's own Host header (same-origin).
 *    - If trusted, the request is ALLOWED (even if `Sec-Fetch-Site: cross-site`).
 *    - If untrusted, or if Origin is literal "null" (sandboxed iframe / data: URI), reject with HTTP 403 Forbidden.
 * 3. If neither Origin nor Referer is present:
 *    - If browser indicates `Sec-Fetch-Site: cross-site`, reject with HTTP 403 Forbidden (prevent stripped-origin CSRF).
 *    - Otherwise, permit direct server-to-server or non-browser API client requests (e.g., curl, automated scripts).
 */
export const createCsrfProtection = ({ allowedOrigins = [], previewDomainRegex }) => {
  const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

  return (req, res, next) => {
    // 1. Only inspect state-changing HTTP methods
    if (!STATE_CHANGING_METHODS.has(req.method)) {
      return next();
    }

    const rawOrigin = req.headers["origin"] || req.headers["referer"];

    // 2. Reject "null" origins explicitly (sandboxed iframes, data: URLs, opaque origins)
    if (rawOrigin === "null") {
      console.warn(`[CSRF Guard] Blocked state-changing ${req.method} from opaque/null origin.`);
      return res.status(403).json({
        error: "Forbidden",
        message: "Cross-Origin state-changing requests from 'null' origin are blocked by security policy.",
        status: 403,
      });
    }

    // 3. Inspect browser-provided Origin or Referer
    if (rawOrigin) {
      try {
        const parsed = new URL(rawOrigin);
        const originUrl = `${parsed.protocol}//${parsed.host}`;

        // (a) Check same-origin: Host header matches request origin
        const hostHeader = req.headers["host"];
        if (hostHeader && (parsed.host === hostHeader || parsed.hostname === hostHeader.split(":")[0])) {
          return next();
        }

        // (b) Check explicitly configured production frontend URLs
        if (allowedOrigins.includes(originUrl)) {
          return next();
        }

        // (c) In non-production, permit standard local development origins
        if (process.env.NODE_ENV !== "production") {
          const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(originUrl);
          if (isLocalhost) {
            return next();
          }
        }

        // (d) Check strictly scoped Vercel deployment domain pattern (orbit-ai namespace)
        if (previewDomainRegex && previewDomainRegex.test(originUrl)) {
          return next();
        }

        // Untrusted origin attempting state-changing operation: BLOCK!
        console.warn(`[CSRF Guard] Blocked cross-origin ${req.method} from untrusted origin: ${originUrl}`);
        return res.status(403).json({
          error: "Forbidden",
          message: "Cross-Origin state-changing request blocked by security policy.",
          status: 403,
        });
      } catch (err) {
        console.warn(`[CSRF Guard] Malformed origin header: ${rawOrigin}`, err.message);
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid Origin or Referer header.",
          status: 400,
        });
      }
    }

    // 4. Request has no Origin or Referer:
    // If modern browser marked Sec-Fetch-Site as cross-site without origin, reject
    const secFetchSite = req.headers["sec-fetch-site"];
    if (secFetchSite === "cross-site") {
      console.warn(`[CSRF Guard] Blocked cross-site ${req.method} flagged by Sec-Fetch-Site without valid origin`);
      return res.status(403).json({
        error: "Forbidden",
        message: "Cross-Site request blocked by security policy.",
        status: 403,
      });
    }

    // 5. Direct API / server-to-server request without browser origin indicators (curl, test runner)
    next();
  };
};

export default createCsrfProtection;
