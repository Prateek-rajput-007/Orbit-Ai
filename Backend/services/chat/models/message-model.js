import mongoose from "mongoose";

const messageSchema = new mongoose.Schema({
    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true,
        index: true
    },
    role: {
        type: String,
        enum: ["user", "assistant"],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    images: {
        type: [{
            url: { type: String, required: true },
            description: { type: String, default: "" }
        }],
        default: []
    },
    searchResults: {
        type: [{
            title: { type: String, default: "" },
            url: { type: String, required: true },
            content: { type: String, default: "" },
            published_date: { type: Date, default: null }
        }],
        default: []
    },
    slides: {
        type: [{
            slideNumber: { type: Number },
            title: { type: String, default: "" },
            subtitle: { type: String, default: "" },
            bullets: { type: [String], default: [] },
            speakerNotes: { type: String, default: "" },
            citations: { type: [Number], default: [] },
            sources: { type: [mongoose.Schema.Types.Mixed], default: [] },
            dataProvenance: { type: mongoose.Schema.Types.Mixed, default: null }
        }],
        default: []
    },
    presentationFile: {
        type: {
            fileName: { type: String, default: "" },
            dataUrl: { type: String, default: "" },
            deckTitle: { type: String, default: "" },
            dataProvenance: { type: mongoose.Schema.Types.Mixed, default: null }
        },
        default: null
    },
    pdfDocument: {
        type: {
            documentId: { type: String, default: "" },
            fileName: { type: String, default: "" },
            fileSize: { type: String, default: "" },
            pageCount: { type: Number, default: 1 },
            title: { type: String, default: "" },
            dataUrl: { type: String, default: "" },
            status: { type: String, default: "READY" },
            totalChunks: { type: Number, default: 0 },
        },
        default: null
    },
    codeArtifact: {
        type: {
            artifactId: { type: String, default: "" },
            title: { type: String, default: "" },
            description: { type: String, default: "" },
            entryFile: { type: String, default: "index.html" },
            files: {
                type: [{
                    path: { type: String, required: true },
                    content: { type: String, default: "" },
                    language: { type: String, default: "text" },
                    size: { type: Number, default: 0 },
                }],
                default: [],
            },
            totalFiles: { type: Number, default: 0 },
            totalSize: { type: Number, default: 0 },
            previewType: { type: String, default: "html" },
            previewDataUrl: { type: String, default: "" },
            bundledHtml: { type: String, default: "" },
            status: { type: String, default: "ready" },
            deployment: {
                status: { type: String, default: "sandbox" },
                url: { type: String, default: null },
                permalinkUrl: { type: String, default: null },
                provider: { type: String, default: "Orbit In-App Sandbox" },
                note: { type: String, default: "" },
                deployId: { type: String, default: null },
                siteId: { type: String, default: null },
                verified: { type: Boolean, default: false },
                verifiedFiles: { type: [String], default: [] },
                deployedAt: { type: Date, default: null },
            },
            dataProvenance: { type: mongoose.Schema.Types.Mixed, default: null },
            projectId: { type: String, default: null },
            version: { type: Number, default: 1 },
            baseVersion: { type: Number, default: null },
            runtimeStrategy: { type: String, default: null },
        },
        default: null,
    },
    imageAttachment: {
        type: {
            fileName: { type: String, default: "" },
            fileSize: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            dataUrl: { type: String, default: "" }
        },
        default: null
    },
    attachment: {
        type: {
            name: { type: String, default: "" },
            mimeType: { type: String, default: "" },
            dataUrl: { type: String, default: "" }
        },
        default: null
    },
    suggestedQuestions: {
        type: [String],
        default: []
    },
    citations: {
        type: [{
            sourceId: { type: String, required: true },
            citationNumber: { type: Number, default: 1 },
            documentId: { type: String, default: "" },
            documentName: { type: String, default: "" },
            chunkId: { type: String, default: "" },
            pageStart: { type: Number, required: true },
            pageEnd: { type: Number, required: true },
            section: { type: String, default: "General" },
            snippet: { type: String, default: "" },
            hasSemanticSupport: { type: Boolean, default: true },
            contentType: { type: String, enum: ["TEXT", "TABLE", "CHART", "OCR_TEXT"], default: "TEXT" },
            extractionMethod: { type: String, default: "text" },
            visualMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
        }],
        default: []
    },
    evidenceStatus: {
        type: String,
        enum: ["SUPPORTED", "PARTIALLY_SUPPORTED", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE", null],
        default: null
    },
    confidence: {
        type: String,
        enum: ["HIGH", "MEDIUM", "LOW", null],
        default: null
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, { timestamps: true });

// Compound index for fetching messages by conversation ordered chronologically
messageSchema.index({ conversationId: 1, timestamp: 1 });

const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);
export default Message;
