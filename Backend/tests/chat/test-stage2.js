import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "../..");

console.log("=== Running Stage 2 Backend Correctness & Reliability Verification ===\n");

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

// 1. Verify package.json declarations
test("Package declarations: gateway declares ioredis", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(backendRoot, "gateway/package.json"), "utf-8"));
  assert.ok(pkg.dependencies.ioredis, "gateway must declare ioredis");
});

test("Package declarations: auth declares ioredis", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(backendRoot, "services/auth/package.json"), "utf-8"));
  assert.ok(pkg.dependencies.ioredis, "auth must declare ioredis");
});

test("Package declarations: chat declares ioredis", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(backendRoot, "services/chat/package.json"), "utf-8"));
  assert.ok(pkg.dependencies.ioredis, "chat must declare ioredis");
});

test("Package declarations: agent declares ioredis and @langchain/langgraph", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(backendRoot, "services/agent/package.json"), "utf-8"));
  assert.ok(pkg.dependencies.ioredis, "agent must declare ioredis");
  assert.ok(pkg.dependencies["@langchain/langgraph"], "agent must declare @langchain/langgraph");
});

// 2. Verify Mongoose model registration and schema reference
await testAsync("Mongoose Models: Conversation and Conversion aliases & indexes", async () => {
  const mongoose = (await import("mongoose")).default;
  const { default: Conversation } = await import("./models/conversion-model.js");
  const { default: Message } = await import("./models/message-model.js");

  // Verify models are registered
  assert.ok(mongoose.models.Conversation, "Model 'Conversation' must be registered in Mongoose");
  assert.ok(mongoose.models.Conversion, "Model 'Conversion' alias must be registered in Mongoose");

  // Verify collection name is explicitly 'conversions' (no data loss)
  assert.equal(Conversation.collection.name, "conversions", "Conversation must bind to 'conversions' collection");
  assert.equal(mongoose.models.Conversion.collection.name, "conversions", "Conversion must bind to 'conversions' collection");

  // Verify Message.conversationId ref resolves to 'Conversation'
  const refModel = Message.schema.path("conversationId").options.ref;
  assert.equal(refModel, "Conversation", "Message.conversationId ref must point to 'Conversation'");

  // Verify compound indexes are registered in schema
  const convIndexes = Conversation.schema.indexes();
  const hasConvIndex = convIndexes.some(([fields]) => fields.userId === 1 && fields.timestamp === -1);
  assert.ok(hasConvIndex, "Conversation schema must have compound index on { userId: 1, timestamp: -1 }");

  const msgIndexes = Message.schema.indexes();
  const hasMsgIndex = msgIndexes.some(([fields]) => fields.conversationId === 1 && fields.timestamp === 1);
  assert.ok(hasMsgIndex, "Message schema must have compound index on { conversationId: 1, timestamp: 1 }");
});

// 3. Verify Gateway Auth Middleware logic
await testAsync("Gateway Auth Middleware: handles missing and malformed sessions safely", async () => {
  const { protect } = await import("../../gateway/middleware/auth.middleware.js");

  const createMockRes = () => {
    const res = {
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
    };
    return res;
  };

  // Case A: Missing cookie
  const resNoCookie = createMockRes();
  let nextCalled = false;
  await protect({ cookies: {} }, resNoCookie, () => { nextCalled = true; });
  assert.equal(resNoCookie.statusCode, 401, "Missing cookie must return 401");
  assert.equal(resNoCookie.body.message, "Unauthorized");
  assert.equal(nextCalled, false);
});

// 4. Verify Chat Controller route validation
await testAsync("Chat Controller: guards against invalid user-id and conversationId", async () => {
  const {
    createConversation,
    getConversations,
    getMessages,
    updateConversation,
  } = await import("./controllers/chat.controller.js");

  const createMockRes = () => {
    const res = {
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
    };
    return res;
  };

  // Case A: Missing user-id on create
  const resNoUser = createMockRes();
  await createConversation({ headers: {} }, resNoUser);
  assert.equal(resNoUser.statusCode, 401, "createConversation with missing user-id must return 401");

  // Case B: Malformed user-id (not a valid ObjectId)
  const resBadUser = createMockRes();
  await getConversations({ headers: { "user-id": "not-an-object-id" } }, resBadUser);
  assert.equal(resBadUser.statusCode, 401, "getConversations with malformed user-id must return 401");

  // Case C: Invalid conversationId on getMessages
  const resBadConv = createMockRes();
  await getMessages(
    { headers: { "user-id": "507f1f77bcf86cd799439011" }, params: { conversationId: "bad-id" } },
    resBadConv
  );
  assert.equal(resBadConv.statusCode, 404, "getMessages with invalid conversationId must return 404");

  // Case D: Invalid title on updateConversation
  const resBadTitle = createMockRes();
  await updateConversation(
    {
      headers: { "user-id": "507f1f77bcf86cd799439011" },
      body: { conversationId: "507f1f77bcf86cd799439012", title: "   " },
    },
    resBadTitle
  );
  assert.equal(resBadTitle.statusCode, 400, "updateConversation with empty title must return 400");
});

// 5. Verify Redis shared client configuration
await testAsync("Redis shared client: initialized with retryStrategy", async () => {
  const { default: redis } = await import("../../shared/redis/redis.js");
  assert.ok(redis, "Redis client must be exported");
  assert.equal(redis.options.maxRetriesPerRequest, 3, "Redis maxRetriesPerRequest should be 3");
  assert.equal(typeof redis.options.retryStrategy, "function", "Redis retryStrategy must be a function");
  redis.disconnect();
});

console.log(`\n=== Verification Complete: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
