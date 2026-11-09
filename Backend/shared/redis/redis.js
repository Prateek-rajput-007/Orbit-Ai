import Redis from "ioredis";

let redisUrl = process.env.REDIS_URL;

// Automatically convert to rediss:// if connecting to Upstash cloud
if (redisUrl.includes("upstash.io") && redisUrl.startsWith("redis://")) {
  redisUrl = redisUrl.replace("redis://", "rediss://");
}

const isTls = redisUrl.startsWith("rediss://") || redisUrl.includes("upstash.io");

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  tls: isTls ? { rejectUnauthorized: false } : undefined,
  retryStrategy(times) {
    // Reconnect with backoff capped at 2 seconds
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
