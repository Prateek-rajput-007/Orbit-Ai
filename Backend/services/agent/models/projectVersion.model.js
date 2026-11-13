import mongoose from "mongoose";

const projectVersionSchema = new mongoose.Schema(
    {
        versionId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        projectId: {
            type: String,
            required: true,
            index: true,
        },
        versionNumber: {
            type: Number,
            required: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
            index: true,
        },
        messageId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Message",
            default: null,
        },
        changeType: {
            type: String,
            enum: ["INITIAL_GENERATION", "INCREMENTAL_UPDATE", "RESTORE", "MANUAL_SAVE"],
            default: "INITIAL_GENERATION",
        },
        changeSummary: {
            type: String,
            default: "",
        },
        runtimeType: {
            type: String,
            enum: ["react", "legacy"],
            default: "react",
        },
        entryFile: {
            type: String,
            default: "index.html",
        },
        dependencies: {
            type: Map,
            of: String,
            default: {},
        },
        parentVersionId: {
            type: String,
            default: null,
        },
        baseVersionId: {
            type: String,
            default: null,
        },
        validationStatus: {
            type: String,
            enum: ["valid", "repaired", "failed"],
            default: "valid",
        },
        snapshot: {
            artifactId: { type: String, default: "" },
            title: { type: String, default: "" },
            description: { type: String, default: "" },
            entryFile: { type: String, default: "index.html" },
            files: [
                {
                    path: { type: String, required: true },
                    content: { type: String, default: "" },
                    language: { type: String, default: "text" },
                    size: { type: Number, default: 0 },
                },
            ],
            totalFiles: { type: Number, default: 0 },
            totalSize: { type: Number, default: 0 },
            previewType: { type: String, default: "html" },
            bundledHtml: { type: String, default: "" },
            runtimeType: { type: String, default: "react" },
            status: { type: String, default: "ready" },
            deployment: { type: Object, default: null },
        },
    },
    { timestamps: true }
);

// Compound unique index ensuring no duplicate version numbers per project
projectVersionSchema.index({ projectId: 1, versionNumber: 1 }, { unique: true });
projectVersionSchema.index({ conversationId: 1, createdAt: -1 });

const ProjectVersion = mongoose.models.ProjectVersion || mongoose.model("ProjectVersion", projectVersionSchema);
export default ProjectVersion;

