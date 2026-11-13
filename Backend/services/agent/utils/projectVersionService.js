import mongoose from "mongoose";
import { randomUUID } from "crypto";
import Project from "../models/project.model.js";
import ProjectVersion from "../models/projectVersion.model.js";
import { isReactProject, validateArtifactIntegrity } from "./codeArtifact.js";

// In-memory fallback stores for test and offline environments
const memoryProjects = new Map(); // projectId -> project
const memoryVersions = new Map(); // projectId -> [versions]
let explicitMemoryStoreEnabled = false;

export function resetMemoryStore() {
    memoryProjects.clear();
    memoryVersions.clear();
}

export function enableTestMemoryStore() {
    explicitMemoryStoreEnabled = true;
}

export function disableTestMemoryStore() {
    explicitMemoryStoreEnabled = false;
}

export function isMemoryStoreAllowed() {
    return (
        explicitMemoryStoreEnabled ||
        process.env.NODE_ENV === "test" ||
        process.env.ENABLE_TEST_MEMORY_STORE === "true"
    );
}

const isDbConnected = () => mongoose.connection?.readyState === 1;

export function assertStorageAvailable() {
    if (isDbConnected()) return "db";
    if (isMemoryStoreAllowed()) return "memory";
    const dbErr = new Error(
        "Database persistence unavailable: MongoDB is not connected. Durable project versioning requires an active database connection."
    );
    dbErr.status = 503;
    dbErr.code = "SERVICE_UNAVAILABLE";
    throw dbErr;
}

/**
 * Extracts dependencies from package.json if present in the files array.
 */
function extractDependencies(files = []) {
    const pkgFile = files.find((f) => (f.path || "").toLowerCase() === "package.json");
    if (!pkgFile || typeof pkgFile.content !== "string") return {};
    try {
        const parsed = JSON.parse(pkgFile.content);
        return { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
    } catch {
        return {};
    }
}

/**
 * Creates the initial Version 1 snapshot for a newly generated project.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {object} params.artifact Complete generated CodeArtifact
 * @param {string} [params.messageId]
 * @returns {Promise<{ project: object, version: object, artifact: object }>}
 */
export async function createInitialProjectVersion({ userId, conversationId, artifact, messageId = null }) {
    if (!artifact || !Array.isArray(artifact.files) || artifact.files.length === 0) {
        throw new Error("Cannot create project version: valid artifact with files is required.");
    }

    const projectId = artifact.projectId || `proj_${randomUUID().replace(/-/g, "")}`;
    const versionId = `ver_${randomUUID().replace(/-/g, "")}`;
    const runtimeType = isReactProject(artifact) ? "react" : "legacy";
    const title = artifact.title || "Orbit Project";
    const entryFile = artifact.entryFile || (runtimeType === "react" ? "src/main.jsx" : "index.html");
    const dependencies = extractDependencies(artifact.files);

    // Deep clone snapshot to prevent external mutation
    const snapshot = JSON.parse(JSON.stringify(artifact));
    snapshot.projectId = projectId;
    snapshot.version = 1;

    const projectData = {
        projectId,
        userId,
        conversationId,
        title,
        currentVersionNumber: 1,
        currentVersionId: versionId,
        runtimeType,
        entryFile,
    };

    const versionData = {
        versionId,
        projectId,
        versionNumber: 1,
        userId,
        conversationId,
        messageId,
        changeType: "INITIAL_GENERATION",
        changeSummary: `Initial generation: ${title}`,
        runtimeType,
        entryFile,
        dependencies,
        parentVersionId: null,
        baseVersionId: null,
        validationStatus: "valid",
        snapshot,
    };

    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const project = await Project.create(projectData);
        const version = await ProjectVersion.create(versionData);
        return { project: project.toObject(), version: version.toObject(), artifact: snapshot };
    }

    // In-memory test store
    memoryProjects.set(projectId, { ...projectData, createdAt: new Date(), updatedAt: new Date() });
    memoryVersions.set(projectId, [{ ...versionData, createdAt: new Date() }]);

    return {
        project: memoryProjects.get(projectId),
        version: memoryVersions.get(projectId)[0],
        artifact: snapshot,
    };
}

/**
 * Creates an incremental project version following an iterative edit.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {string} params.conversationId
 * @param {object} params.artifact Updated CodeArtifact
 * @param {string} [params.promptText]
 * @param {string} [params.messageId]
 * @param {number|null} [params.expectedBaseVersion]
 * @returns {Promise<{ project: object, version: object, artifact: object }>}
 */
export async function createIncrementalProjectVersion({
    projectId,
    userId,
    conversationId,
    artifact,
    promptText = "",
    messageId = null,
    expectedBaseVersion = null,
}) {
    if (!projectId) {
        throw new Error("projectId is required to create an incremental project version.");
    }
    if (!artifact || !Array.isArray(artifact.files) || artifact.files.length === 0) {
        throw new Error("Cannot create project version: valid artifact with files is required.");
    }

    const storageMode = assertStorageAvailable();
    const runtimeType = isReactProject(artifact) ? "react" : "legacy";
    const entryFile = artifact.entryFile || (runtimeType === "react" ? "src/main.jsx" : "index.html");
    const dependencies = extractDependencies(artifact.files);
    const versionId = `ver_${randomUUID().replace(/-/g, "")}`;
    const cleanSummary = promptText ? promptText.slice(0, 120).trim() : `Incremental update: ${artifact.title || "Project"}`;

    if (storageMode === "db") {
        const project = await Project.findOne({ projectId, userId });
        if (!project) {
            throw new Error(`Project "${projectId}" not found or unauthorized.`);
        }

        // Stale base version conflict protection
        if (expectedBaseVersion != null) {
            const expNum = parseInt(expectedBaseVersion, 10);
            if (!Number.isNaN(expNum) && project.currentVersionNumber !== expNum) {
                const staleErr = new Error(
                    `Stale base version conflict: Project "${projectId}" is at version ${project.currentVersionNumber}, but this update was based on version ${expNum}. Please refresh your workspace to edit the latest version.`
                );
                staleErr.status = 409;
                staleErr.code = "STALE_BASE_VERSION";
                throw staleErr;
            }
        }

        const nextVersionNumber = project.currentVersionNumber + 1;
        const parentVersionId = project.currentVersionId;

        const snapshot = JSON.parse(JSON.stringify(artifact));
        snapshot.projectId = projectId;
        snapshot.version = nextVersionNumber;

        let version;
        try {
            version = await ProjectVersion.create({
                versionId,
                projectId,
                versionNumber: nextVersionNumber,
                userId,
                conversationId,
                messageId,
                changeType: "INCREMENTAL_UPDATE",
                changeSummary: cleanSummary,
                runtimeType,
                entryFile,
                dependencies,
                parentVersionId,
                baseVersionId: null,
                validationStatus: "valid",
                snapshot,
            });
        } catch (createErr) {
            if (createErr.code === 11000 || createErr.name === "MongoServerError") {
                const conflictErr = new Error(
                    `Concurrent version conflict: Version ${nextVersionNumber} already exists for project "${projectId}". Another turn may have completed simultaneously.`
                );
                conflictErr.status = 409;
                conflictErr.code = "VERSION_CONFLICT";
                throw conflictErr;
            }
            throw createErr;
        }

        project.currentVersionNumber = nextVersionNumber;
        project.currentVersionId = versionId;
        project.updatedAt = new Date();
        await project.save();

        return { project: project.toObject(), version: version.toObject(), artifact: snapshot };
    }

    // In-memory test store
    const project = memoryProjects.get(projectId);
    if (!project || String(project.userId) !== String(userId)) {
        throw new Error(`Project "${projectId}" not found or unauthorized.`);
    }

    // Stale base version conflict protection in memory
    if (expectedBaseVersion != null) {
        const expNum = parseInt(expectedBaseVersion, 10);
        if (!Number.isNaN(expNum) && project.currentVersionNumber !== expNum) {
            const staleErr = new Error(
                `Stale base version conflict: Project "${projectId}" is at version ${project.currentVersionNumber}, but this update was based on version ${expNum}. Please refresh your workspace to edit the latest version.`
            );
            staleErr.status = 409;
            staleErr.code = "STALE_BASE_VERSION";
            throw staleErr;
        }
    }

    const nextVersionNumber = project.currentVersionNumber + 1;
    const parentVersionId = project.currentVersionId;

    const versions = memoryVersions.get(projectId) || [];
    if (versions.some((v) => v.versionNumber === nextVersionNumber)) {
        const conflictErr = new Error(
            `Concurrent version conflict: Version ${nextVersionNumber} already exists for project "${projectId}". Another turn may have completed simultaneously.`
        );
        conflictErr.status = 409;
        conflictErr.code = "VERSION_CONFLICT";
        throw conflictErr;
    }

    const snapshot = JSON.parse(JSON.stringify(artifact));
    snapshot.projectId = projectId;
    snapshot.version = nextVersionNumber;

    const newVersion = {
        versionId,
        projectId,
        versionNumber: nextVersionNumber,
        userId,
        conversationId,
        messageId,
        changeType: "INCREMENTAL_UPDATE",
        changeSummary: cleanSummary,
        runtimeType,
        entryFile,
        dependencies,
        parentVersionId,
        baseVersionId: null,
        validationStatus: "valid",
        snapshot,
        createdAt: new Date(),
    };

    project.currentVersionNumber = nextVersionNumber;
    project.currentVersionId = versionId;
    project.updatedAt = new Date();

    versions.push(newVersion);
    memoryVersions.set(projectId, versions);

    return { project, version: newVersion, artifact: snapshot };
}

/**
 * Restores an older project version by creating a new forward version with the target snapshot.
 * Preserves all historical versions without destructive modification.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {number} params.versionNumber
 * @param {string} params.userId
 * @param {string} [params.conversationId]
 * @returns {Promise<{ success: boolean, project: object, version: object, restoredArtifact: object }>}
 */
export async function restoreProjectVersion({ projectId, versionNumber, userId, conversationId = null }) {
    if (!projectId || !versionNumber) {
        throw new Error("projectId and versionNumber are required for restoration.");
    }

    const targetVersionNum = parseInt(versionNumber, 10);
    if (Number.isNaN(targetVersionNum) || targetVersionNum < 1) {
        throw new Error("Invalid versionNumber requested for restoration.");
    }

    const versionId = `ver_${randomUUID().replace(/-/g, "")}`;

    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const project = await Project.findOne({ projectId, userId });
        if (!project) {
            throw new Error(`Project "${projectId}" not found or unauthorized.`);
        }

        const targetVersion = await ProjectVersion.findOne({ projectId, versionNumber: targetVersionNum });
        if (!targetVersion || !targetVersion.snapshot) {
            throw new Error(`Version ${targetVersionNum} not found for project "${projectId}".`);
        }

        // Validate integrity of restored snapshot
        const integrity = validateArtifactIntegrity(targetVersion.snapshot);
        if (!integrity.valid) {
            const errList = integrity.errors?.map((e) => e.message || String(e)).join(", ");
            throw new Error(`Target snapshot failed integrity validation: ${errList}`);
        }

        const restoreVersionNumber = project.currentVersionNumber + 1;
        const parentVersionId = project.currentVersionId;

        const restoredSnapshot = JSON.parse(JSON.stringify(targetVersion.snapshot));
        restoredSnapshot.projectId = projectId;
        restoredSnapshot.version = restoreVersionNumber;

        const newVersion = await ProjectVersion.create({
            versionId,
            projectId,
            versionNumber: restoreVersionNumber,
            userId,
            conversationId: conversationId || project.conversationId,
            changeType: "RESTORE",
            changeSummary: `Restored from Version ${targetVersionNum}`,
            runtimeType: targetVersion.runtimeType || "react",
            entryFile: targetVersion.entryFile || "src/main.jsx",
            dependencies: targetVersion.dependencies || {},
            parentVersionId,
            baseVersionId: targetVersion.versionId,
            validationStatus: "valid",
            snapshot: restoredSnapshot,
        });

        project.currentVersionNumber = restoreVersionNumber;
        project.currentVersionId = versionId;
        project.updatedAt = new Date();
        await project.save();

        return {
            success: true,
            project: project.toObject(),
            version: newVersion.toObject(),
            restoredArtifact: restoredSnapshot,
        };
    }

    // In-memory test store
    const project = memoryProjects.get(projectId);
    if (!project || String(project.userId) !== String(userId)) {
        throw new Error(`Project "${projectId}" not found or unauthorized.`);
    }

    const versions = memoryVersions.get(projectId) || [];
    const targetVersion = versions.find((v) => v.versionNumber === targetVersionNum);
    if (!targetVersion || !targetVersion.snapshot) {
        throw new Error(`Version ${targetVersionNum} not found for project "${projectId}".`);
    }

    const integrity = validateArtifactIntegrity(targetVersion.snapshot);
    if (!integrity.valid) {
        const errList = integrity.errors?.map((e) => e.message || String(e)).join(", ");
        throw new Error(`Target snapshot failed integrity validation: ${errList}`);
    }

    const restoreVersionNumber = project.currentVersionNumber + 1;
    const parentVersionId = project.currentVersionId;

    const restoredSnapshot = JSON.parse(JSON.stringify(targetVersion.snapshot));
    restoredSnapshot.projectId = projectId;
    restoredSnapshot.version = restoreVersionNumber;

    const newVersion = {
        versionId,
        projectId,
        versionNumber: restoreVersionNumber,
        userId,
        conversationId: conversationId || project.conversationId,
        changeType: "RESTORE",
        changeSummary: `Restored from Version ${targetVersionNum}`,
        runtimeType: targetVersion.runtimeType || "react",
        entryFile: targetVersion.entryFile || "src/main.jsx",
        dependencies: targetVersion.dependencies || {},
        parentVersionId,
        baseVersionId: targetVersion.versionId,
        validationStatus: "valid",
        snapshot: restoredSnapshot,
        createdAt: new Date(),
    };

    project.currentVersionNumber = restoreVersionNumber;
    project.currentVersionId = versionId;
    project.updatedAt = new Date();
    versions.push(newVersion);

    return {
        success: true,
        project,
        version: newVersion,
        restoredArtifact: restoredSnapshot,
    };
}

/**
 * Retrieves the version history metadata list for a project (excludes heavy file bodies).
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {string} params.userId
 * @param {number} [params.limit=50]
 * @param {number} [params.skip=0]
 * @returns {Promise<{ versions: Array<object>, total: number, currentVersionNumber: number }>}
 */
export async function listProjectVersions({ projectId, userId, limit = 50, skip = 0 }) {
    if (!projectId || !userId) {
        throw new Error("projectId and userId are required.");
    }

    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const project = await Project.findOne({ projectId, userId });
        if (!project) {
            throw new Error(`Project "${projectId}" not found or unauthorized.`);
        }

        const total = await ProjectVersion.countDocuments({ projectId });
        const versions = await ProjectVersion.find({ projectId })
            .select("-snapshot.files -snapshot.bundledHtml")
            .sort({ versionNumber: -1 })
            .skip(skip)
            .limit(limit);

        const mapped = versions.map((v) => ({
            versionId: v.versionId,
            projectId: v.projectId,
            versionNumber: v.versionNumber,
            changeType: v.changeType,
            changeSummary: v.changeSummary,
            runtimeType: v.runtimeType,
            entryFile: v.entryFile,
            validationStatus: v.validationStatus,
            parentVersionId: v.parentVersionId,
            baseVersionId: v.baseVersionId,
            createdAt: v.createdAt,
            totalFiles: v.snapshot?.totalFiles || 0,
            totalSize: v.snapshot?.totalSize || 0,
            isCurrent: v.versionNumber === project.currentVersionNumber,
        }));

        return { versions: mapped, total, currentVersionNumber: project.currentVersionNumber };
    }

    // In-memory test store
    const project = memoryProjects.get(projectId);
    if (!project || String(project.userId) !== String(userId)) {
        throw new Error(`Project "${projectId}" not found or unauthorized.`);
    }

    const all = memoryVersions.get(projectId) || [];
    const sorted = [...all].sort((a, b) => b.versionNumber - a.versionNumber);
    const paginated = sorted.slice(skip, skip + limit);

    const mapped = paginated.map((v) => ({
        versionId: v.versionId,
        projectId: v.projectId,
        versionNumber: v.versionNumber,
        changeType: v.changeType,
        changeSummary: v.changeSummary,
        runtimeType: v.runtimeType,
        entryFile: v.entryFile,
        validationStatus: v.validationStatus,
        parentVersionId: v.parentVersionId,
        baseVersionId: v.baseVersionId,
        createdAt: v.createdAt,
        totalFiles: v.snapshot?.files?.length || 0,
        totalSize: v.snapshot?.totalSize || 0,
        isCurrent: v.versionNumber === project.currentVersionNumber,
    }));

    return { versions: mapped, total: all.length, currentVersionNumber: project.currentVersionNumber };
}

/**
 * Retrieves the full snapshot details for a specific version.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {number|null} [params.versionNumber]
 * @param {string} params.userId
 * @returns {Promise<object>} Complete ProjectVersion document
 */
export async function getProjectVersionDetails({ projectId, versionNumber = null, userId }) {
    if (!projectId || !userId) {
        throw new Error("projectId and userId are required.");
    }

    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const project = await Project.findOne({ projectId, userId });
        if (!project) {
            throw new Error(`Project "${projectId}" not found or unauthorized.`);
        }

        const versionNum = versionNumber != null ? parseInt(versionNumber, 10) : project.currentVersionNumber;

        const version = await ProjectVersion.findOne({ projectId, versionNumber: versionNum });
        if (!version) {
            throw new Error(`Version ${versionNum} not found for project "${projectId}".`);
        }

        const obj = version.toObject();
        obj.isCurrent = version.versionNumber === project.currentVersionNumber;
        return obj;
    }

    // In-memory test store
    const project = memoryProjects.get(projectId);
    if (!project || String(project.userId) !== String(userId)) {
        throw new Error(`Project "${projectId}" not found or unauthorized.`);
    }

    const versionNum = versionNumber != null ? parseInt(versionNumber, 10) : project.currentVersionNumber;

    const versions = memoryVersions.get(projectId) || [];
    const version = versions.find((v) => v.versionNumber === versionNum);
    if (!version) {
        throw new Error(`Version ${versionNum} not found for project "${projectId}".`);
    }

    return { ...version, isCurrent: version.versionNumber === project.currentVersionNumber };
}

/**
 * Compares two versions of a project reporting added, modified, deleted, and unchanged files.
 *
 * @param {object} params
 * @param {string} params.projectId
 * @param {number} params.baseVersion
 * @param {number} params.targetVersion
 * @param {string} params.userId
 * @returns {Promise<object>} File-level comparison results
 */
export async function compareProjectVersions({ projectId, baseVersion, targetVersion, userId }) {
    if (!projectId || !baseVersion || !targetVersion || !userId) {
        throw new Error("projectId, baseVersion, targetVersion, and userId are required for comparison.");
    }

    const baseVerDoc = await getProjectVersionDetails({ projectId, versionNumber: baseVersion, userId });
    const targetVerDoc = await getProjectVersionDetails({ projectId, versionNumber: targetVersion, userId });

    const baseFilesMap = new Map((baseVerDoc.snapshot?.files || []).map((f) => [f.path, f.content]));
    const targetFilesMap = new Map((targetVerDoc.snapshot?.files || []).map((f) => [f.path, f.content]));

    const added = [];
    const modified = [];
    const deleted = [];
    const unchanged = [];

    for (const [filePath, targetContent] of targetFilesMap.entries()) {
        const targetSize = Buffer.byteLength(targetContent || "", "utf8");
        if (!baseFilesMap.has(filePath)) {
            added.push({ path: filePath, size: targetSize });
        } else {
            const baseContent = baseFilesMap.get(filePath);
            if (baseContent !== targetContent) {
                const oldSize = Buffer.byteLength(baseContent || "", "utf8");
                modified.push({
                    path: filePath,
                    oldSize,
                    newSize: targetSize,
                    deltaBytes: targetSize - oldSize,
                });
            } else {
                unchanged.push({ path: filePath, size: targetSize });
            }
        }
    }

    for (const [filePath, baseContent] of baseFilesMap.entries()) {
        if (!targetFilesMap.has(filePath)) {
            deleted.push({
                path: filePath,
                size: Buffer.byteLength(baseContent || "", "utf8"),
            });
        }
    }

    return {
        projectId,
        baseVersion: parseInt(baseVersion, 10),
        targetVersion: parseInt(targetVersion, 10),
        summary: {
            addedCount: added.length,
            modifiedCount: modified.length,
            deletedCount: deleted.length,
            unchangedCount: unchanged.length,
            totalBaseFiles: baseFilesMap.size,
            totalTargetFiles: targetFilesMap.size,
        },
        changes: {
            added,
            modified,
            deleted,
            unchanged,
        },
    };
}

/**
 * Gets the current active project and its latest version snapshot for a conversation.
 * If explicitProjectId is provided, targets that exact project.
 *
 * @param {string} conversationId
 * @param {string} userId
 * @param {string|null} [explicitProjectId=null]
 * @returns {Promise<{ project: object, currentVersion: object, currentArtifact: object }|null>}
 */
export async function getActiveProjectForConversation(conversationId, userId, explicitProjectId = null) {
    if (!conversationId || !userId) return null;
    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const query = { conversationId, userId };
        if (explicitProjectId) {
            query.projectId = explicitProjectId;
        }
        const project = await Project.findOne(query).sort({ updatedAt: -1 });
        if (!project) return null;

        const currentVersion = await ProjectVersion.findOne({
            projectId: project.projectId,
            versionNumber: project.currentVersionNumber,
        });

        if (!currentVersion || !currentVersion.snapshot) return null;

        return {
            project: project.toObject(),
            currentVersion: currentVersion.toObject(),
            currentArtifact: currentVersion.snapshot,
        };
    }

    // In-memory test store
    for (const project of memoryProjects.values()) {
        const matchConv = String(project.conversationId) === String(conversationId) && String(project.userId) === String(userId);
        const matchProj = explicitProjectId ? project.projectId === explicitProjectId : true;
        if (matchConv && matchProj) {
            const versions = memoryVersions.get(project.projectId) || [];
            const currentVersion = versions.find((v) => v.versionNumber === project.currentVersionNumber);
            if (currentVersion && currentVersion.snapshot) {
                return {
                    project,
                    currentVersion,
                    currentArtifact: currentVersion.snapshot,
                };
            }
        }
    }

    return null;
}

/**
 * Lists all projects in a conversation.
 *
 * @param {string} conversationId
 * @param {string} userId
 * @returns {Promise<Array<object>>}
 */
export async function listConversationProjects(conversationId, userId) {
    if (!conversationId || !userId) return [];
    const storageMode = assertStorageAvailable();

    if (storageMode === "db") {
        const projects = await Project.find({ conversationId, userId }).sort({ updatedAt: -1 });
        return projects.map((p) => p.toObject());
    }

    // In-memory test store
    const list = [];
    for (const project of memoryProjects.values()) {
        if (String(project.conversationId) === String(conversationId) && String(project.userId) === String(userId)) {
            list.push(project);
        }
    }
    return list;
}
