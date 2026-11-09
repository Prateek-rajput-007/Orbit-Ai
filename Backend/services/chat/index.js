import express from "express";
import dotenv from "dotenv";
import morgan from "morgan";
import connectDB from "./config/db.js";
import chatRoutes from "./routes/chat.routes.js";
dotenv.config();

const port = process.env.PORT || process.env.port || 5002;
const app = express();

app.use(morgan((tokens, req, res) =>
    `${tokens.method(req, res)} ${req.path} ${tokens.status(req, res)} ${tokens["response-time"](req, res)} ms`
));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use("/chat", chatRoutes);

app.get("/", (req, res) => {
    res.json({ message: "Chat service is running" });
});

connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Chat server is running on port ${port}`);
    });
}).catch((err) => {
    console.error("Failed to start Chat server:", err.message);
});
