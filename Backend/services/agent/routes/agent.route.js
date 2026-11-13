import express from "express";
import multer from "multer";
import { agent, deployArtifact } from "../controllers/agent.controller.js";
import {
    getConversationProjects,
    getProjectDetails,
    getProjectVersions,
    getVersionDetails,
    restoreVersion,
    compareVersions,
} from "../controllers/project.controller.js";

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

// Project Version History Endpoints
router.get("/projects/conversation/:conversationId", getConversationProjects);
router.get("/projects/:projectId/versions", getProjectVersions);
router.get("/projects/:projectId/versions/:versionNumber", getVersionDetails);
router.post("/projects/:projectId/versions/:versionNumber/restore", restoreVersion);
router.get("/projects/:projectId/compare", compareVersions);
router.get("/projects/:projectId", getProjectDetails);

export default router;
