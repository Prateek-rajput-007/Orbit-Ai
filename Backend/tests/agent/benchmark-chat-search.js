import path from "node:path";
import dotenv from "dotenv";
import axios from "axios";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

const chatServiceUrl = process.env.CHAT_SERVICE_URL || "http://localhost:8002";
const agentServiceUrl = "http://localhost:8003";

async function createConv() {
    const userId = new mongoose.Types.ObjectId().toHexString();
    const res = await axios.post(
        `${chatServiceUrl}/chat/create-conversation`,
        {},
        { headers: { "user-id": userId } },
    );
    return { userId, conversationId: res.data.conversation._id };
}

async function benchmarkPrompt(label, prompt, agentMode) {
    console.log(`\n======================================================`);
    console.log(`BENCHMARK: ${label}`);
    console.log(`Prompt: "${prompt}"`);
    console.log(`Agent Mode: ${agentMode}`);
    console.log(`======================================================`);

    // 1. Non-Streaming Test
    const nonStreamConv = await createConv();
    const nsStart = Date.now();
    const nsRes = await axios.post(
        `${agentServiceUrl}/chat`,
        {
            prompt,
            conversationId: nonStreamConv.conversationId,
            agentMode,
        },
        {
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "user-id": nonStreamConv.userId,
            },
        },
    );
    const nsTotal = Date.now() - nsStart;
    const nsAnswerLen = nsRes.data.aiResponse?.length || 0;

    // In non-streaming, perceived TTFT = total latency (user sees 0 words until request finishes)
    console.log(`[Non-Streaming] Perceived TTFT: ${nsTotal}ms | Total Duration: ${nsTotal}ms | Length: ${nsAnswerLen} chars`);

    // 2. Streaming Test (SSE)
    const streamConv = await createConv();
    const sStart = Date.now();
    let sTtft = null;
    let sChunks = 0;
    let sTotalChars = 0;

    const sRes = await axios.post(
        `${agentServiceUrl}/chat`,
        {
            prompt,
            conversationId: streamConv.conversationId,
            agentMode,
        },
        {
            headers: {
                "Accept": "text/event-stream",
                "Content-Type": "application/json",
                "user-id": streamConv.userId,
            },
            responseType: "stream",
        },
    );

    await new Promise((resolve, reject) => {
        let buffer = "";
        sRes.data.on("data", (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();

            let currentEvent = "";
            for (const line of lines) {
                if (line.startsWith("event: ")) currentEvent = line.slice(7).trim();
                if (line.startsWith("data: ")) {
                    if (currentEvent === "token") {
                        if (sTtft === null) {
                            sTtft = Date.now() - sStart;
                        }
                        try {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.token) {
                                sChunks++;
                                sTotalChars += parsed.token.length;
                            }
                        } catch {}
                    }
                }
            }
        });

        sRes.data.on("end", () => resolve());
        sRes.data.on("error", (err) => reject(err));
    });

    const sTotal = Date.now() - sStart;
    console.log(`[Streaming]     Actual TTFT:    ${sTtft}ms | Total Duration: ${sTotal}ms | Chunks: ${sChunks} | Chars: ${sTotalChars}`);
    const ttftImprovement = (((nsTotal - sTtft) / nsTotal) * 100).toFixed(1);
    console.log(`-> Perceived TTFT Improvement: ${ttftImprovement}% faster time-to-first-token`);
}

async function run() {
    await benchmarkPrompt(
        "Chat Agent - Technical Architecture Explanation",
        "Explain the difference between optimistic concurrency control and pessimistic locking in database design. Provide three practical examples.",
        "chat",
    );

    await benchmarkPrompt(
        "Search Agent - Current Live Fact Lookup",
        "What was the outcome of the 2024 ICC Men's T20 World Cup final and who won?",
        "search",
    );
}

run().catch(console.error);
