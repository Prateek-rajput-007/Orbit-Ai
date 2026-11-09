import assert from "node:assert/strict";
import { parseDeckJson, createFallbackDeck, normalizeDeck } from "./utils/parseDeck.js";
import { generatePptxFile } from "./utils/generatePptx.js";

async function runTests() {
    console.log("--- Starting PPT Agent Unit & Integration Tests ---");

    // Test 1: Direct JSON parse
    const rawJson = JSON.stringify({
        deckTitle: "Scaling Distributed Systems",
        summary: "Architectural blueprint for high throughput services.",
        slides: [
            {
                slideNumber: 1,
                title: "Scaling Distributed Systems",
                subtitle: "Executive Architecture Review",
                bullets: ["Microservices", "Event-Driven Messaging", "Caching Strategies"],
                speakerNotes: "Welcome everyone to the architecture review.",
            },
            {
                slideNumber: 2,
                title: "Redis & Read Replication",
                subtitle: "Data Layer",
                bullets: ["Cache-aside pattern", "Sub-millisecond latency", "Cluster replication"],
                speakerNotes: "Notice how Redis eliminates database load.",
            },
        ],
    });

    const parsed1 = parseDeckJson(rawJson);
    assert.equal(parsed1.deckTitle, "Scaling Distributed Systems");
    assert.equal(parsed1.slides.length, 2);
    assert.equal(parsed1.slides[0].title, "Scaling Distributed Systems");
    console.log("✓ Test 1: Direct JSON parsing verified");

    // Test 2: Fenced markdown code block
    const fencedJson = `Here is your slide deck:\n\`\`\`json\n${rawJson}\n\`\`\`\nHope this helps!`;
    const parsed2 = parseDeckJson(fencedJson);
    assert.equal(parsed2.deckTitle, "Scaling Distributed Systems");
    assert.equal(parsed2.slides.length, 2);
    console.log("✓ Test 2: Fenced markdown block extraction verified");

    // Test 3: Malformed text fallback
    const malformed = "Just some casual bullet points without any json formatting whatsoever.";
    const parsed3 = parseDeckJson(malformed, "My Prompt Title");
    assert.ok(parsed3.slides.length >= 3);
    assert.equal(parsed3.deckTitle, "My Prompt Title");
    console.log("✓ Test 3: Defensive fallback deck generation verified");

    // Test 4: generatePptxFile generates valid base64 dataUrl
    const pptxResult = await generatePptxFile(parsed1);
    assert.ok(pptxResult.fileName.endsWith(".pptx"));
    assert.ok(pptxResult.dataUrl.startsWith("data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,"));
    assert.ok(pptxResult.dataUrl.length > 1000);
    console.log(`✓ Test 4: PPTX compilation verified (${pptxResult.fileName}, size: ${pptxResult.dataUrl.length} chars)`);

    console.log("\nALL PPT TESTS PASSED! (4/4)\n");
}

runTests().catch((err) => {
    console.error("PPT Test Failed:", err);
    process.exit(1);
});
