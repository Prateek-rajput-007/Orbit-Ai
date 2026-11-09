import express from "express";
import multer from "multer";
import { agent, deployArtifact } from "../controllers/agent.controller.js";

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

router.post("/chat", (req, res, next) => {
    if (!req.is("multipart/form-data")) {
        return next();
    }
    upload.single("attachment")(req, res, (error) => {
        if (error) {
            const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
            return res.status(status).json({ message: error.message });
        }
        next();
    });
}, agent);

router.post("/deploy", deployArtifact);

export default router;
