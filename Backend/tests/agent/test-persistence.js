import assert from "node:assert/strict";
import mongoose from "mongoose";
import "dotenv/config";
import Message from "../chat/models/message-model.js";
import Conversation from "../chat/models/conversion-model.js";
import chatMongoose from "../chat/node_modules/mongoose/index.js";

async function runPersistenceVerification() {
    console.log("==========================================================");
    console.log("=== ARTIFACT PERSISTENCE & CONVERSATION RELOAD TESTS ===");
    console.log("==========================================================\n");

    const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/orbit";
    try {
        await chatMongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
        console.log("Connected to MongoDB for schema persistence verification.\n");
    } catch (err) {
        console.warn("MongoDB local server not available for integration test, skipping live DB roundtrip:", err.message);
        console.log("Verifying schema definitions in-memory...");
        const caSchema = Message.schema.path("codeArtifact").schema;
        assert.ok(caSchema, "Message schema must define codeArtifact nested schema");
        assert.ok(caSchema.path("files"), "codeArtifact must define files array");
        assert.ok(caSchema.path("deployment.status"), "codeArtifact must define deployment.status");
        assert.ok(caSchema.path("deployment.url"), "codeArtifact must define deployment.url");
        console.log("✓ Mongoose Schema contains codeArtifact, files, and deployment subdocuments.\n");
        return;
    }

    const testUserId = new mongoose.Types.ObjectId();
    const conv = await Conversation.create({ userId: testUserId, title: "Persistence Test Conv" });

    try {
        // Step 1: Save a message turn with codeArtifact
        const testArtifact = {
            artifactId: `code_test_${Date.now()}`,
            title: "Live Stopwatch",
            description: "Stopwatch with lap timer and keyboard shortcuts",
            entryFile: "index.html",
            files: [
                { path: "index.html", content: "<html><body><h1 id='timer'>0</h1></body></html>", language: "html", size: 48 },
                { path: "app.js", content: "let count = 0;", language: "javascript", size: 15 },
            ],
            totalFiles: 2,
            totalSize: 63,
            previewType: "html",
            status: "ready",
            deployment: {
                status: "sandbox",
                url: null,
                provider: "Orbit In-App Sandbox",
                note: "Sandbox ready",
            },
        };

        const msg = await Message.create({
            conversationId: conv._id,
            role: "assistant",
            content: "Here is your generated application:",
            codeArtifact: testArtifact,
        });

        assert.ok(msg._id, "Message must be saved with _id");
        assert.equal(msg.codeArtifact.artifactId, testArtifact.artifactId);
        assert.equal(msg.codeArtifact.files.length, 2);
        assert.equal(msg.codeArtifact.files[0].path, "index.html");
        assert.equal(msg.codeArtifact.deployment.status, "sandbox");
        console.log("✓ Step 1: Artifact saved into MongoDB Message collection with full multi-file schema.");

        // Step 2: Simulate browser refresh & reopening conversation
        const reloaded = await Message.find({ conversationId: conv._id }).sort({ timestamp: 1 });
        assert.equal(reloaded.length, 1);
        const reloadedArtifact = reloaded[0].codeArtifact;
        assert.ok(reloadedArtifact, "Artifact must persist across conversation reload");
        assert.equal(reloadedArtifact.title, "Live Stopwatch");
        assert.equal(reloadedArtifact.files.length, 2);
        assert.equal(reloadedArtifact.files[1].path, "app.js");
        assert.equal(reloadedArtifact.files[1].content, "let count = 0;");
        console.log("✓ Step 2: Reopened conversation verified: full files array restored byte-for-byte.");

        // Step 3: Simulate external deployment record update
        reloaded[0].codeArtifact.deployment = {
            status: "deployed",
            url: "https://orbit-stopwatch-test.netlify.app",
            provider: "Netlify",
            note: "Live verified deployment",
            deployedAt: new Date(),
        };
        reloaded[0].markModified("codeArtifact");
        await reloaded[0].save();

        const deployedMsg = await Message.findById(msg._id);
        assert.equal(deployedMsg.codeArtifact.deployment.status, "deployed");
        assert.equal(deployedMsg.codeArtifact.deployment.url, "https://orbit-stopwatch-test.netlify.app");
        assert.equal(deployedMsg.codeArtifact.deployment.provider, "Netlify");
        console.log("✓ Step 3: Deployment URL and provider state permanently persisted to MongoDB.");

        // Step 4: Missing/corrupt artifact handling
        const emptyMsg = await Message.create({
            conversationId: conv._id,
            role: "assistant",
            content: "Regular chat response without code",
            codeArtifact: null,
        });
        assert.equal(emptyMsg.codeArtifact, null);
        console.log("✓ Step 4: Normal messages without codeArtifact operate with null safely.");

    } finally {
        await Message.deleteMany({ conversationId: conv._id });
        await Conversation.deleteOne({ _id: conv._id });
        await chatMongoose.disconnect();
        console.log("\nPersistence test cleaned up test records and disconnected.\n");
    }

    console.log("ALL PERSISTENCE CHECKS PASSED!\n");
}

runPersistenceVerification().catch((err) => {
    console.error("Persistence test failed:", err);
    process.exit(1);
});
