import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });
import express from "express";
import morgan from "morgan";
import connectDB from "./config/db.js";
import agentRouter from "./routes/agent.route.js";

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled Promise Rejection in Agent Service:", reason?.message || reason);
});

process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception in Agent Service:", error?.message || error);
});

const port = process.env.PORT || process.env.port || 5003;
const app = express();

app.use(morgan((tokens, req, res) =>
    `${tokens.method(req, res)} ${req.path} ${tokens.status(req, res)} ${tokens["response-time"](req, res)} ms`
));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use("/", agentRouter);

app.get("/", (req, res) => {
    res.json({ message: "Agent service is running" });
});

connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Agent server is running on port ${port}`);
    });
}).catch((err) => {
    console.error("Failed to start Agent server:", err.message);
});
