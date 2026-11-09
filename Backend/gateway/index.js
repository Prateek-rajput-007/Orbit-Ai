import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });
import express from "express";
import proxy from "express-http-proxy";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import protect from "./middleware/auth.middleware.js";
import { getCurrentUser } from "./controllers/user.controllers.js";

const port = process.env.PORT || process.env.port || 5000;
const authServiceUrl = process.env.AUTH_SERVICE_URL || "http://localhost:5001";
const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:5002";
const agentServiceUrl = process.env.AGENT_SERVICE_URL || "http://localhost:5003";
const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const allowedOrigins = frontendUrl.split(",").map((u) => u.trim().replace(/\/$/, ""));

const app = express();

app.use(morgan((tokens, req, res) =>
    `${tokens.method(req, res)} ${req.path} ${tokens.status(req, res)} ${tokens["response-time"](req, res)} ms`
));

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const cleanOrigin = origin.replace(/\/$/, "");
        if (
            process.env.NODE_ENV !== "production" ||
            allowedOrigins.includes(cleanOrigin) ||
            cleanOrigin.endsWith(".vercel.app")
        ) {
            return callback(null, true);
        }
        return callback(null, true);
    },
    credentials: true
}));

app.use(cookieParser());

app.use("/api/auth", proxy(authServiceUrl, { limit: "25mb" }));
app.use("/api/chat", protect, proxy(chatServiceUrl, {
    limit: "25mb",
    proxyReqPathResolver: (req) => `/chat${req.url}`,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers["user-id"] = srcReq.user.userId;
        return proxyReqOpts;
    }
}));
app.use("/api/agent", protect, proxy(agentServiceUrl, {
    limit: "25mb",
    timeout: 180000,
    parseReqBody: false,
    proxyReqOptDecorator: (proxyReqOpts, srcReq) => {
        proxyReqOpts.headers["user-id"] = srcReq.user.userId;
        proxyReqOpts.agent = false;
        return proxyReqOpts;
    }
}));
app.use("/api/me", protect, getCurrentUser);
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));

app.get("/", (req, res) => {
    res.json({ message: "Gateway service is running" });
});

app.listen(port, () => {
    console.log(`Gateway server is running on port ${port}`);
});
