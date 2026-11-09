import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cert, getApps, initializeApp } from "firebase-admin/app";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const loadServiceAccount = () => {
  // 1. Direct JSON string or base64 encoded string from environment variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      try {
        const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, "base64").toString("utf-8");
        return JSON.parse(decoded);
      } catch (err) {
        throw new Error(`FIREBASE_SERVICE_ACCOUNT environment variable is not valid JSON or base64 JSON: ${err.message}`);
      }
    }
  }

  // 2. Custom path from environment variable
  const customPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (customPath) {
    const resolvedPath = path.resolve(customPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Firebase service account file not found at path specified by environment variable: ${resolvedPath}`);
    }
    return JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
  }

  // 3. Fallback: local uncommitted firebase.json in Backend/services/auth/ for development
  const localPath = path.resolve(__dirname, "../firebase.json");
  if (fs.existsSync(localPath)) {
    return JSON.parse(fs.readFileSync(localPath, "utf-8"));
  }

  throw new Error(
    "Firebase Admin credentials missing. Please set the FIREBASE_SERVICE_ACCOUNT environment variable, or place an uncommitted firebase.json in Backend/services/auth/."
  );
};

export const app = getApps().length > 0
  ? getApps()[0]
  : initializeApp({
      credential: cert(loadServiceAccount()),
    });
