import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });
dotenv.config();

import express from "express";
import proxy from "express-http-proxy";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import protect from "./middleware/auth.middleware.js";
import { getCurrentUser } from "./controllers/user.controllers.js";
import { createRateLimiter } from "./middleware/rateLimiter.js";
import { createCsrfProtection } from "./middleware/csrfProtection.js";

const port = process.env.PORT || process.env.port || 5000;
const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:5001";
const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:5002";
const agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://localhost:5003";

// Helper to safely parse TRUST_PROXY setting
function parseTrustProxy(val) {
    if (val === undefined || val === null || val === "") return 1;
    if (val === "true" || val === true) return true;
    if (val === "false" || val === false) return false;
    const num = parseInt(val, 10);
    return Number.isNaN(num) ? 1 : num;
}

// Configurable Allowed Origins
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = frontendUrl.split(",").map((u) => u.trim().replace(/\/$/, ""));

// Specific preview domain pattern for Orbit (avoids wildcards that trust any arbitrary .vercel.app)
const previewDomainRegex = process.env.VERCEL_PREVIEW_PATTERN
    ? new RegExp(process.env.VERCEL_PREVIEW_PATTERN)
    : /^https:\/\/orbit-ai(?:-[a-zA-Z0-9_-]+)?\.vercel\.app$/;

export const app = express();

// Trust reverse proxies (Cloudflare / Render load balancers)
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

app.use(morgan((tokens, req, res) =>
    `${tokens.method(req, res)} ${req.path} ${tokens.status(req, res)} ${tokens["response-time"](req, res)} ms`
));

app.use(cors({
    origin: (origin, callback) => {
        // Non-browser or server-to-server requests (e.g. curl, internal health checks) have no Origin header
        if (!origin) return callback(null, true);

        const cleanOrigin = origin.replace(/\/$/, "");

        // 1. Check explicitly configured production frontend URLs
        if (allowedOrigins.includes(cleanOrigin)) {
            return callback(null, true);
        }

        // 2. In non-production, permit standard local development origins
        if (process.env.NODE_ENV !== "production") {
            const isLocalhost = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(cleanOrigin);
            if (isLocalhost) {
                return callback(null, true);
            }
        }

        // 3. Check strictly scoped Vercel deployment domain pattern (not arbitrary .vercel.app)
        if (previewDomainRegex.test(cleanOrigin)) {
            return callback(null, true);
        }

        // Disallowed origin: return false so CORS header is omitted (browser blocks cross-origin access cleanly)
        return callback(null, false);
    },
    credentials: true,
}));

app.use(cookieParser());

// CSRF Defense: Block untrusted cross-origin state-changing requests before they reach routes
app.use(createCsrfProtection({ allowedOrigins, previewDomainRegex }));

// Rate Limiting Tier 1: Public Auth Limiter (IP-based on unauthenticated auth routes)
const authLimiter = createRateLimiter({
    prefix: "rl:public:auth",
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_AUTH_MAX || "15", 10),
    keyGenerator: (req) => req.ip,
    errorMessage: "Too many authentication requests from this IP. Please wait 1 minute before trying again.",
    failClosed: false,
});

// Rate Limiting Tier 2: Authenticated Chat API Limiter (userId-based)
const chatLimiter = createRateLimiter({
    prefix: "rl:user:chat",
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_CHAT_MAX || "60", 10),
    keyGenerator: (req) => req.user?.userId || req.ip,
    errorMessage: "Too many chat requests. Please slow down and try again.",
    failClosed: false,
});

// Rate Limiting Tier 3: Authenticated AI Agent Generation Limiter (userId-based, strict fail-closed)
const agentLimiter = createRateLimiter({
    prefix: "rl:user:agent",
    windowMs: 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_AGENT_MAX || "10", 10),
    keyGenerator: (req) => req.user?.userId || req.ip,
    errorMessage: "AI request limit reached. You can send up to 10 prompts per minute. Please wait a moment.",
    failClosed: true,
});

// 1. Unauthenticated / Public Auth routes with IP-based rate protection (strictly capped at 1mb payload)
app.use("/api/auth", authLimiter, proxy(authServiceUrl, { limit: "1mb" }));

// 2. Protected Chat routes: Authenticated first via session cookie, then user-rate-limited, then proxied
app.use("/api/chat", protect, chatLimiter, proxy(chatServiceUrl, {
    limit: "10mb",
    proxyReqPathResolver: (req) => `/chat${req.url}`,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers["user-id"] = srcReq.user.userId;
        return proxyReqOpts;
    },
}));

// 3. Protected AI Agent routes: Authenticated first, then AI-quota rate-limited, then proxied
app.use("/api/agent", protect, agentLimiter, proxy(agentServiceUrl, {
    limit: "25mb",
    timeout: 180000,
    parseReqBody: false,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers["user-id"] = srcReq.user.userId;
        proxyReqOpts.agent = false;
        return proxyReqOpts;
    },
}));

// 4. Current user session route
app.use("/api/me", protect, getCurrentUser);

// 5. Unrestricted Health check (critical: never rate-limited to avoid Render deploy/health check failures)
app.get("/", (req, res) => {
    res.json({ message: "Gateway service is running" });
});

// Start Gateway if executed directly
if (process.env.NODE_ENV !== "test") {
    app.listen(port, () => {
        console.log(`Gateway server is running on port ${port}`);
    });
}

export default app;
