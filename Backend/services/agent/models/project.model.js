import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
    {
        projectId: {
            type: String,
            required: true,
            unique: true,
            index: true,
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
        title: {
            type: String,
            default: "Orbit Project",
        },
        currentVersionNumber: {
            type: Number,
            default: 1,
        },
        currentVersionId: {
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
            default: "src/main.jsx",
        },
    },
    { timestamps: true }
);

projectSchema.index({ conversationId: 1, updatedAt: -1 });
projectSchema.index({ userId: 1, projectId: 1 });

const Project = mongoose.models.Project || mongoose.model("Project", projectSchema);
export default Project;

