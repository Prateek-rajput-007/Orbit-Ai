import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const services = [
  { name: "AUTH", file: path.join(__dirname, "services/auth/index.js"), port: 8001 },
  { name: "CHAT", file: path.join(__dirname, "services/chat/index.js"), port: 8002 },
  { name: "AGENT", file: path.join(__dirname, "services/agent/index.js"), port: 8003 },
  { name: "GATEWAY", file: path.join(__dirname, "gateway/index.js"), port: process.env.PORT || 8000 },
];

console.log("==========================================");
console.log("🚀 Launching Orbit Unified Multi-Service System");
console.log("==========================================");

const children = [];

for (const svc of services) {
  const env = {
    ...process.env,
    PORT: svc.port,
    port: svc.port,
    AUTH_SERVICE_URL: process.env.AUTH_SERVICE_URL || "http://127.0.0.1:8001",
    CHAT_SERVICE_URL: process.env.CHAT_SERVICE_URL || "http://127.0.0.1:8002",
    AGENT_SERVICE_URL: process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8003",
  };

  const child = fork(svc.file, [], {
    env,
    cwd: path.dirname(svc.file),
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    console.error(`[${svc.name}] Exited with code ${code} / signal ${signal}`);
  });

  children.push(child);
}

process.on("SIGINT", () => {
  console.log("\nShutting down all Orbit microservices...");
  for (const child of children) {
    child.kill("SIGINT");
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\nTerminating all Orbit microservices...");
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(0);
});

