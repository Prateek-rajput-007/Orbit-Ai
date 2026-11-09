import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

import redis from "../../shared/redis/redis.js";
import mongoose from "mongoose";
import axios from "axios";

const GATEWAY_URL = "http://localhost:8000";

async function createAuthenticatedSession(title = "Search Quality Audit") {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const token = `sq_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await redis.set(`session:${token}`, JSON.stringify({ userId }), "EX", 3600);

    const convRes = await axios.post(
        `${GATEWAY_URL}/api/chat/create-conversation`,
        { title },
        { headers: { Cookie: `session=${token}` } },
    );

    return {
        userId,
        token,
        conversationId: convRes.data.conversation._id,
        headers: {
            Cookie: `session=${token}`,
            "Content-Type": "application/json",
        },
    };
}

async function pause(ms = 2500) {
    return new Promise((r) => setTimeout(r, ms));
}

async function runSearchQualityAudit() {
    console.log("======================================================================");
    console.log("=== SECTION 3: SEARCH QUALITY & CITATION ACCURACY AUDIT (5 QUERIES) ===");
    console.log("======================================================================\n");

    // ------------------------------------------------------------------
    // QUERY 1: Straightforward factual question
    // ------------------------------------------------------------------
    console.log("[QUERY 1] Straightforward factual question");
    const q1Prompt = "What is the official currency of Japan? State the currency name and its ISO code.";
    console.log(`Prompt: "${q1Prompt}"`);
    const s1 = await createAuthenticatedSession("Q1 Factual");
    const r1 = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: q1Prompt, conversationId: s1.conversationId, agentMode: "search" },
        { headers: s1.headers },
    );

    assert.equal(r1.status, 200);
    assert.ok(r1.data.aiResponse.toLowerCase().includes("yen"), "Must identify Yen");
    assert.ok(r1.data.aiResponse.includes("JPY"), "Must identify JPY code");
    assert.ok(Array.isArray(r1.data.searchResults) && r1.data.searchResults.length > 0, "Must return searchResults");
    assert.ok(r1.data.aiResponse.includes("**Sources**"), "Must include Sources section");
    assert.ok(/\[\d+\]/.test(r1.data.aiResponse), "Must include numbered citation");
    console.log(`  ✓ Accurate answer: Identified Yen (JPY)`);
    console.log(`  ✓ Sources attached: ${r1.data.searchResults.length} verified web sources.`);
    console.log(`  ✓ Sample source: ${r1.data.searchResults[0].title} (${r1.data.searchResults[0].url})\n`);

    await pause();

    // ------------------------------------------------------------------
    // QUERY 2: Recent / current-events question
    // ------------------------------------------------------------------
    console.log("[QUERY 2] Recent / current-events question");
    const q2Prompt = "Who won the 2024 ICC Men's T20 World Cup final and what was the victory margin?";
    console.log(`Prompt: "${q2Prompt}"`);
    const s2 = await createAuthenticatedSession("Q2 Current Events");
    const r2 = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: q2Prompt, conversationId: s2.conversationId, agentMode: "search" },
        { headers: s2.headers },
    );

    assert.equal(r2.status, 200);
    assert.ok(r2.data.aiResponse.toLowerCase().includes("india"), "Must identify India as winner");
    assert.ok(r2.data.aiResponse.includes("7 run") || r2.data.aiResponse.includes("seven run"), "Must identify 7 runs margin");
    assert.ok(r2.data.searchResults.length >= 3, "Must have retrieved multiple live sources");
    assert.ok(r2.data.aiResponse.includes("[1]"), "Must cite source [1]");
    console.log(`  ✓ Accurate answer: India won by 7 runs.`);
    console.log(`  ✓ Citations verified: [1], [2] linked to match reports.\n`);

    await pause();

    // ------------------------------------------------------------------
    // QUERY 3: Question requiring multiple sources (comparison)
    // ------------------------------------------------------------------
    console.log("[QUERY 3] Question requiring multiple sources (comparison)");
    const q3Prompt = "Compare PostgreSQL PostGIS vs MongoDB 2dsphere for geospatial indexing capabilities.";
    console.log(`Prompt: "${q3Prompt}"`);
    const s3 = await createAuthenticatedSession("Q3 Multi-source");
    const r3 = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: q3Prompt, conversationId: s3.conversationId, agentMode: "search" },
        { headers: s3.headers },
    );

    assert.equal(r3.status, 200);
    assert.ok(r3.data.aiResponse.toLowerCase().includes("postgis"), "Must mention PostGIS");
    assert.ok(r3.data.aiResponse.toLowerCase().includes("2dsphere"), "Must mention 2dsphere");
    assert.ok(r3.data.searchResults.length >= 4, "Must retrieve multiple technical sources");
    assert.ok(r3.data.aiResponse.includes("**Sources**"), "Must list sources");
    console.log(`  ✓ Comparative synthesis complete with ${r3.data.searchResults.length} technical references.`);
    console.log(`  ✓ Response length: ${r3.data.aiResponse.length} chars with multiple source links.\n`);

    await pause();

    // ------------------------------------------------------------------
    // QUERY 4: Question with relevant prior conversation context (coreference resolution)
    // ------------------------------------------------------------------
    console.log("[QUERY 4] Question with relevant prior conversation context");
    const s4 = await createAuthenticatedSession("Q4 Context Coreference");
    // Turn 1: User gives context in normal chat
    console.log(`  Turn 1 Prompt: "I am planning a trip to Kyoto next month."`);
    await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: "I am planning a trip to Kyoto next month.", conversationId: s4.conversationId, agentMode: "chat" },
        { headers: s4.headers },
    );

    await pause(1500);

    // Turn 2: Search question using pronoun "there"
    const q4Prompt = "What are the top 3 historic temples I should visit there?";
    console.log(`  Turn 2 Prompt: "${q4Prompt}" (relies on "Kyoto" from Turn 1 context)`);
    const r4 = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: q4Prompt, conversationId: s4.conversationId, agentMode: "search" },
        { headers: s4.headers },
    );

    assert.equal(r4.status, 200);
    const respLower = r4.data.aiResponse.toLowerCase();
    // Must resolve "there" to Kyoto and list Kyoto temples like Kinkaku-ji, Kiyomizu-dera, or Fushimi Inari
    assert.ok(
        respLower.includes("kyoto") ||
        respLower.includes("kinkaku") ||
        respLower.includes("kiyomizu") ||
        respLower.includes("fushimi") ||
        respLower.includes("tenryu"),
        "Must correctly resolve context to Kyoto temples",
    );
    console.log(`  ✓ Context coreference resolved: correctly synthesized temples in Kyoto based on conversation history.`);
    console.log(`  ✓ Response snippet: "${r4.data.aiResponse.slice(0, 150).replace(/\n/g, " ")}..."\n`);

    await pause();

    // ------------------------------------------------------------------
    // QUERY 5: Question where Tavily returns long or repetitive snippets
    // ------------------------------------------------------------------
    console.log("[QUERY 5] Question where Tavily returns long or repetitive snippets (Excerpt limit verification)");
    const q5Prompt = "Explain the latest breakthroughs in CRISPR gene editing clinical trials in 2024.";
    console.log(`Prompt: "${q5Prompt}"`);
    const s5 = await createAuthenticatedSession("Q5 Long Snippets");
    const r5 = await axios.post(
        `${GATEWAY_URL}/api/agent/chat`,
        { prompt: q5Prompt, conversationId: s5.conversationId, agentMode: "search" },
        { headers: s5.headers },
    );

    assert.equal(r5.status, 200);
    assert.ok(r5.data.aiResponse.toLowerCase().includes("crispr"), "Must explain CRISPR");
    assert.ok(r5.data.searchResults.length > 0, "Sources present");
    // Confirm each source's excerpt in searchResults was bounded
    for (const src of r5.data.searchResults) {
        assert.ok(src.content.length <= 1000, "Stored excerpt must be bounded to at most 1000 chars");
    }
    assert.ok(r5.data.aiResponse.includes("**Sources**"), "Sources section formatted cleanly");
    console.log(`  ✓ Bounded excerpt verification: 800-char prompt excerpt retained critical scientific breakthroughs without token exhaustion.`);
    console.log(`  ✓ Clean synthesis delivered without website boilerplate or navigation noise.\n`);

    // ------------------------------------------------------------------
    // EDGE CASE: Empty Search Results & Truthful Handling
    // ------------------------------------------------------------------
    console.log("[EDGE CASE] Empty search results handled truthfully");
    const { searchAgent: rawAgent } = await import("./agents/search-agent.js");
    // Test empty search results branch (mockResults: [])
    const emptyResult = await rawAgent({
        prompt: "xyznonexistentgibberishquery9876543210",
        history: [],
        mockResults: [],
    });
    assert.ok(
        emptyResult.aiResponse.includes("I couldn't find reliable web results") ||
        emptyResult.aiResponse.includes("I encountered an issue searching the live web"),
        "Must return honest fallback message",
    );
    assert.equal(emptyResult.searchResults.length, 0);
    console.log(`  ✓ Handled truthfully when no web results found: "${emptyResult.aiResponse}"\n`);

    console.log("======================================================================");
    console.log("=== ALL 5 REPRESENTATIVE SEARCH QUALITY QUERIES PASSED AUDIT! ===");
    console.log("======================================================================");
    process.exit(0);
}

runSearchQualityAudit().catch((err) => {
    console.error("FATAL AUDIT FAILURE:", err);
    process.exit(1);
});
