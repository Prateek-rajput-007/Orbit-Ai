import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(import.meta.dirname, ".env") });

import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

const badGroq = new ChatGroq({ apiKey: "gsk_invalid_key_for_testing", model: "openai/gpt-oss-120b", maxRetries: 0 });
const gemini = new ChatGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
  maxRetries: 1,
});

const modelWithFallback = badGroq.withFallbacks([gemini]);

async function run() {
  console.log("Testing withFallbacks streaming when primary fails...");
  try {
    const stream = await modelWithFallback.stream("Reply with 'Fallback worked!'");
    let text = "";
    for await (const chunk of stream) {
      const c = typeof chunk.content === "string" ? chunk.content : (chunk.content?.[0]?.text || "");
      text += c;
    }
    console.log("Result:", text);
    console.log("Fallback succeeded seamlessly!");
  } catch (err) {
    console.error("Stream fallback failed with:", err);
  }

  console.log("Testing withFallbacks invoke when primary fails...");
  try {
    const res = await modelWithFallback.invoke("Reply with 'Invoke fallback worked!'");
    console.log("Invoke fallback result:", res.content);
  } catch (err) {
    console.error("Invoke fallback failed:", err);
  }
}

run();
