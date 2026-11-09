import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import connectDB from "./config/db.js";
import authRouter from "./routes/auth.route.js";

const port = process.env.PORT || process.env.port || 5001;
const app = express();

app.use(morgan((tokens, req, res) =>
    `${tokens.method(req, res)} ${req.path} ${tokens.status(req, res)} ${tokens["response-time"](req, res)} ms`
));
app.use(cookieParser());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));
app.use(authRouter);

app.get("/", (req, res) => {
    res.json({ message: "Auth service is running" });
});

connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Auth server is running on port ${port}`);
    });
}).catch((err) => {
    console.error("Failed to start Auth server:", err.message);
});
