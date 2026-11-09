import Redis from "ioredis";

function getRedisUrl() {
  if (!process.env.REDIS_URL) {
    try {
      if (typeof process.loadEnvFile === "function") {
        process.loadEnvFile();
      }
    } catch {}
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
