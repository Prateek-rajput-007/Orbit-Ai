import { deployToNetlify } from "./netlifyAdapter.js";
import { deployToVercel } from "./vercelAdapter.js";
import { sanitizePath } from "../codeArtifact.js";

/**
 * Validates files and project security before initiating deployment.
 */
export function validateDeploymentPayload(files = []) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error("No files provided for deployment.");
    }

    let totalSize = 0;
    const sanitizedFiles = [];
    const seenPaths = new Set();

    for (const f of files) {
        if (!f || !f.path || typeof f.content !== "string") continue;
        const cleanPath = sanitizePath(f.path);
        if (seenPaths.has(cleanPath.toLowerCase())) continue;
        seenPaths.add(cleanPath.toLowerCase());

        const size = Buffer.byteLength(f.content, "utf8");
        totalSize += size;

        sanitizedFiles.push({
            path: cleanPath,
            content: f.content,
            size,
        });
    }

    if (totalSize > 10 * 1024 * 1024) {
        throw new Error("Total project size exceeds maximum deployment limit of 10 MB.");
    }

    if (!sanitizedFiles.some((f) => f.path.toLowerCase().endsWith(".html"))) {
        const hasWebFiles = sanitizedFiles.some((f) =>
            f.path.toLowerCase().endsWith(".js") ||
            f.path.toLowerCase().endsWith(".jsx") ||
            f.path.toLowerCase().endsWith(".css")
        );

        if (hasWebFiles) {
            // Synthesize an index.html host wrapper for static web hosting
            const defaultIndexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Orbit Web Application</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen p-6 font-sans">
  <div id="root" class="max-w-4xl mx-auto">
    <div id="app"></div>
  </div>
</body>
</html>`;
            sanitizedFiles.unshift({
                path: "index.html",
                content: defaultIndexHtml,
                size: Buffer.byteLength(defaultIndexHtml, "utf8"),
            });
        } else {
            throw new Error("Static deployment requires at least one HTML entry point (e.g. index.html).");
        }
    }

    return sanitizedFiles;
}

/**
 * Deploys a project using the configured cloud hosting provider.
 *
 * @param {object} params
 * @param {Array<{ path: string, content: string }>} params.files
 * @param {string} params.title
 * @param {string} [params.provider] Optional provider override ("netlify" | "vercel")
 * @returns {Promise<object>} Deployment result
 */
export async function deployArtifactProject({ files = [], title = "orbit-project", provider = null }) {
    const validatedFiles = validateDeploymentPayload(files);
    const chosenProvider = (provider || process.env.DEPLOYMENT_PROVIDER || "netlify").toLowerCase();

    if (chosenProvider === "vercel") {
        return await deployToVercel({ files: validatedFiles, title });
    }

    // Default to Netlify
    return await deployToNetlify({ files: validatedFiles, title });
}
