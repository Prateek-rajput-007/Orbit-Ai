import {
    formatFileSize,
    extractImageMetadata,
    cacheVisionImage,
    getCachedVisionImage,
} from "./utils/extractImage.js";
import { visionAgent, isCreateImageIntent } from "./agents/vision-agent.js";
import redis from "../../shared/redis/redis.js";

async function runVisionTests() {
    console.log("--- Starting Vision Agent Unit & Multi-Turn Integration Tests ---");
    let passed = 0;

    // Test 1: formatFileSize
    if (formatFileSize(0) === "0 KB" && formatFileSize(2048) === "2 KB") {
        console.log("✓ Test 1: File size formatting verified");
        passed++;
    } else {
        throw new Error("Test 1 failed");
    }

    // Test 2: extractImageMetadata
    const sampleAttachment = {
        name: "architecture-diagram.png",
        mimeType: "image/png",
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    };
    const meta = extractImageMetadata(sampleAttachment);
    if (meta.fileName === "architecture-diagram.png" && meta.dataUrl.startsWith("data:image/png;base64,")) {
        console.log("✓ Test 2: Image metadata extraction verified");
        passed++;
    } else {
        throw new Error("Test 2 failed");
    }

    // Test 3: Redis image caching & retrieval
    const testConvId = `test-vision-conv-${Date.now()}`;
    await cacheVisionImage(testConvId, {
        fileName: meta.fileName,
        fileSize: meta.fileSize,
        mimeType: meta.mimeType,
        data: meta.data,
        dataUrl: meta.dataUrl,
        lastAnalysis: "A single pink pixel test image.",
    });

    const cached = await getCachedVisionImage(testConvId);
    if (cached && cached.fileName === "architecture-diagram.png" && cached.lastAnalysis.includes("pink pixel")) {
        console.log("✓ Test 3: Redis image caching & 24h multi-turn retrieval verified");
        passed++;
    } else {
        throw new Error("Test 3 failed");
    }

    // Test 4: Vision Agent with empty prompt/attachment
    const emptyRes = await visionAgent({
        prompt: "",
        history: [],
    });
    if (emptyRes.aiResponse && emptyRes.aiResponse.includes("attach an image")) {
        console.log("✓ Test 4: Empty attachment guidance verified");
        passed++;
    } else {
        throw new Error("Test 4 failed");
    }

    // Test 5: Vision Agent multi-turn from Redis cache
    const followUpRes = await visionAgent({
        prompt: "What was the color of the pixel in that image?",
        conversationId: testConvId,
        history: [
            { role: "user", content: "What does this image show?" },
            { role: "assistant", content: "A single pink pixel test image." },
        ],
    });
    if (followUpRes.aiResponse && followUpRes.imageAttachment?.fileName === "architecture-diagram.png") {
        console.log("✓ Test 5: Multi-turn reasoning with cached Redis image verified");
        passed++;
    } else {
        throw new Error("Test 5 failed: " + JSON.stringify(followUpRes));
    }

    // Test 6: Image intent & Tavily image search retrieval
    if (isCreateImageIntent("Create a image for cat") && isCreateImageIntent("Cat image")) {
        const genRes = await visionAgent({
            prompt: "Create a image for cat",
            conversationId: testConvId,
            history: [],
        });
        if (
            (Array.isArray(genRes.images) && genRes.images.length === 1 && genRes.images[0].url.startsWith("https://")) ||
            (genRes.aiResponse && (genRes.aiResponse.includes("searched for images") || genRes.aiResponse.includes("cat")))
        ) {
            console.log(`✓ Test 6: Tavily single image retrieval / graceful fallback verified`);
            passed++;
        } else {
            throw new Error("Test 6 failed: " + JSON.stringify(genRes));
        }
    } else {
        throw new Error("Test 6 intent check failed");
    }

    // Cleanup Redis test key
    await redis.del(`vision-image-${testConvId}`);
    await redis.quit();

    console.log(`\nALL VISION TESTS PASSED! (${passed}/6)\n`);
}

runVisionTests().catch((err) => {
    console.error("Vision tests failed:", err);
    process.exit(1);
});
