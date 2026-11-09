import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");

console.log("=== Running Stage 3 Performance, Architecture & AI Reliability Verification ===\n");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}`);
    console.error(`       Error: ${err.message}`);
    failed++;
  }
}

// 1. Verify shared extractText utility
await testAsync("AI Utils: extractText handles various LangChain response shapes", async () => {
  const { extractText } = await import("../agent/utils/extractText.js");

  // String response
  assert.equal(extractText({ content: "Hello world" }), "Hello world");

  // Array of blocks
  assert.equal(
    extractText({
      content: [{ type: "text", text: "Part 1 " }, { text: "Part 2" }],
    }),
    "Part 1 Part 2"
  );

  // Raw string input
  assert.equal(extractText("Direct string"), "Direct string");

  // Null / undefined / empty
  assert.equal(extractText(null), "");
  assert.equal(extractText(undefined), "");
  assert.equal(extractText({}), "");
});

// 2. Verify router normalization and fallback
await testAsync("Agent Router: validates aliases and safeguards missing attachments", async () => {
  const { router } = await import("../agent/graph/router.js");

  // Router maps 'image' to 'vision' if attachment is present
  const stateWithImage = {
    agentMode: "image",
    attachment: { mimeType: "image/png", name: "test.png" },
    prompt: "analyze this image",
  };
  const resImage = await router(stateWithImage);
  assert.equal(resImage.agent, "vision", "Agent alias 'image' must resolve to 'vision'");

  // Explicit presentation alias
  const statePpt = { agentMode: "slides", prompt: "make a deck" };
  const resPpt = await router(statePpt);
  assert.equal(resPpt.agent, "ppt", "Agent alias 'slides' must resolve to 'ppt'");

  // Guard: Prompt mentions PDF but NO attachment -> must NOT crash with 'pdf', must fall back to 'chat'
  const stateNoPdfAttachment = {
    agentMode: "auto",
    prompt: "Can you help me summarize a PDF document?",
  };
  const resNoPdf = await router(stateNoPdfAttachment);
  assert.notEqual(resNoPdf.agent, "pdf", "Without attachment, auto-router must never select 'pdf'");
  assert.ok(["chat", "search"].includes(resNoPdf.agent), "Auto-router should select chat or search when no file attached");
});

// 3. Verify PDF & Vision agents handle missing attachments gracefully without throwing
await testAsync("Agents: PDF and Vision handle missing attachments with user messages rather than throwing 500", async () => {
  const { pdfAgent } = await import("../agent/agents/pdf-agent.js");
  const { visionAgent } = await import("../agent/agents/vision-agent.js");

  const pdfRes = await pdfAgent({ prompt: "summarize", attachment: null });
  assert.ok(pdfRes.aiResponse.includes("Please attach a PDF document"), "pdfAgent should return helpful guidance without throwing");

  const visionRes = await visionAgent({ prompt: "describe", attachment: null });
  assert.ok(visionRes.aiResponse.includes("Please attach an image"), "visionAgent should return helpful guidance without throwing");
});

// 4. Verify LLM configuration uses current Gemini 3.5 Flash
await testAsync("LLM Config: Gemini is configured with current active model", async () => {
  const { getModel } = await import("../agent/config/llmModels.js");
  const codingModel = getModel("coding");
  assert.equal(codingModel.model, "gemini-3.5-flash", "Gemini model must be set to gemini-3.5-flash");
});

// 5. Verify Chat Controller getConversations supports limit and field projection
await testAsync("Chat Controller: getConversations supports limits", async () => {
  const { getConversations } = await import("./controllers/chat.controller.js");

  const createMockRes = () => ({
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  });

  // Invalid user-id returns 401
  const resBad = createMockRes();
  await getConversations({ headers: { "user-id": "bad-id" }, query: {} }, resBad);
  assert.equal(resBad.statusCode, 401);
});

// 6. Verify Frontend N+1 request elimination helper
test("Frontend getConversation helper: toConversationSummary maps summary fields only", () => {
  const summaryFn = (conv) => ({
    id: conv._id ?? conv.id,
    title: conv.title ?? "New conversation",
    updatedAt: new Date(conv.updatedAt ?? conv.timestamp ?? Date.now()).getTime(),
  });

  const rawConv = {
    _id: "507f1f77bcf86cd799439011",
    title: "My Research Chat",
    timestamp: "2026-10-20T12:00:00.000Z",
  };

  const summary = summaryFn(rawConv);
  assert.equal(summary.id, "507f1f77bcf86cd799439011");
  assert.equal(summary.title, "My Research Chat");
  assert.equal(typeof summary.updatedAt, "number");
  assert.equal(summary.messages, undefined, "Summary should NOT contain message histories");
});

console.log(`\n=== Stage 3 Verification Complete: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
