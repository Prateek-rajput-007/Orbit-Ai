import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Redis from "ioredis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getRedisUrl() {
  if (!process.env.REDIS_URL) {
    const candidatePaths = [
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "Backend/gateway/.env"),
      path.resolve(process.cwd(), "gateway/.env"),
      path.resolve(__dirname, "../../gateway/.env"),
      path.resolve(__dirname, "../../services/auth/.env"),
    ];
    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p) && typeof process.loadEnvFile === "function") {
          process.loadEnvFile(p);
          if (process.env.REDIS_URL) break;
        }
      } catch {}
    }
  }

  let url = process.env.REDIS_URL || "redis://localhost:6379";
  if (typeof url === "string" && url.includes("upstash.io") && url.startsWith("redis://")) {
    url = url.replace("redis://", "rediss://");
  }
  return url;
}

const redisUrl = getRedisUrl();
const isTls = typeof redisUrl === "string" && (redisUrl.startsWith("rediss://") || redisUrl.includes("upstash.io"));

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  tls: isTls ? { rejectUnauthorized: false } : undefined,
  retryStrategy(times) {
    return Math.min(times * 50, 2000);
  },
});

redis.on("connect", () => {
  console.log("Connected to Redis");
});

redis.on("error", (err) => {
  console.error("Redis connection error:", err.message);
});

export default redis;
