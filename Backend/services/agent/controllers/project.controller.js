import {
    listConversationProjects,
    listProjectVersions,
    getProjectVersionDetails,
    restoreProjectVersion,
    compareProjectVersions,
    getActiveProjectForConversation,
} from "../utils/projectVersionService.js";

export const getConversationProjects = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { conversationId } = req.params;
        if (!conversationId) {
            return res.status(400).json({ message: "conversationId is required", error: "Missing conversationId" });
        }

        const projects = await listConversationProjects(conversationId, userId);
        return res.status(200).json({ success: true, projects });
    } catch (err) {
        console.error("getConversationProjects error:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};

export const getProjectDetails = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({ message: "projectId is required", error: "Missing projectId" });
        }

        const active = await getProjectVersionDetails({ projectId, versionNumber: req.query.version || null, userId });
        return res.status(200).json({ success: true, version: active });
    } catch (err) {
        const isNotFound = err.message.includes("not found") || err.message.includes("unauthorized");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const getProjectVersions = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { projectId } = req.params;
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);
        const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);

        const data = await listProjectVersions({ projectId, userId, limit, skip });
        return res.status(200).json({ success: true, ...data });
    } catch (err) {
        const isNotFound = err.message.includes("not found") || err.message.includes("unauthorized");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const getVersionDetails = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { projectId, versionNumber } = req.params;
        const versionNum = parseInt(versionNumber, 10);
        if (Number.isNaN(versionNum)) {
            return res.status(400).json({ message: "Invalid versionNumber", error: "Invalid versionNumber" });
        }

        const version = await getProjectVersionDetails({ projectId, versionNumber: versionNum, userId });
        return res.status(200).json({ success: true, version });
    } catch (err) {
        const isNotFound = err.message.includes("not found") || err.message.includes("unauthorized");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const restoreVersion = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { projectId, versionNumber } = req.params;
        const versionNum = parseInt(versionNumber, 10);
        if (Number.isNaN(versionNum)) {
            return res.status(400).json({ message: "Invalid versionNumber", error: "Invalid versionNumber" });
        }

        const result = await restoreProjectVersion({
            projectId,
            versionNumber: versionNum,
            userId,
            conversationId: req.body?.conversationId || null,
        });

        return res.status(201).json(result);
    } catch (err) {
        const isClientErr = err.message.includes("not found") || err.message.includes("integrity");
        const status = isClientErr ? 400 : 500;
        return res.status(status).json({ success: false, error: err.message });
    }
};

export const compareVersions = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { projectId } = req.params;
        const baseVersion = parseInt(req.query.base, 10);
        const targetVersion = parseInt(req.query.target, 10);

        if (Number.isNaN(baseVersion) || Number.isNaN(targetVersion)) {
            return res.status(400).json({
                message: "Valid base and target query parameters are required (e.g. ?base=1&target=2)",
                error: "Missing version numbers",
            });
        }

        const diff = await compareProjectVersions({
            projectId,
            baseVersion,
            targetVersion,
            userId,
        });

        return res.status(200).json({ success: true, ...diff });
    } catch (err) {
        const isNotFound = err.message.includes("not found") || err.message.includes("unauthorized");
        const status = isNotFound ? 404 : 500;
        return res.status(status).json({ success: false, error: err.message });
    }
};

