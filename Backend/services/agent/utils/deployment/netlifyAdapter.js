import axios from "axios";
import JSZip from "jszip";
import { sanitizePath } from "../codeArtifact.js";

/**
 * Prepares and normalizes project files before ZIP packaging and deployment:
 * 1. Strips any common nested directory prefix (e.g. "focusflow/index.html" -> "index.html")
 * 2. Ensures index.html exists at the root of the site
 * 3. Inspects and reconciles HTML references for CSS (<link>) and JS (<script>)
 * 4. Injects missing stylesheet and script tags into index.html if unreferenced
 *
 * @param {Array<{ path: string, content: string }>} files
 * @returns {Array<{ path: string, content: string }>}
 */
export function prepareProjectFilesForDeployment(files = []) {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error("No files provided for deployment.");
    }

    const cleanFiles = files
        .filter((f) => f && f.path && typeof f.content === "string")
        .map((f) => ({
            path: sanitizePath(f.path),
            content: f.content,
        }));

    if (cleanFiles.length === 0) {
        throw new Error("No valid files found for deployment.");
    }

    // Detect if all files share a common directory prefix (e.g. "focusflow/index.html", "focusflow/css/styles.css")
    const pathParts = cleanFiles.map((f) => f.path.split("/"));
    let commonPrefix = "";
    if (pathParts.length > 0 && pathParts[0].length > 1) {
        const firstSegment = pathParts[0][0];
        const allShare = pathParts.every((parts) => parts.length > 1 && parts[0] === firstSegment);
        if (allShare) {
            commonPrefix = firstSegment + "/";
        }
    }

    // Strip common prefix so files sit directly at the root
    let strippedFiles = cleanFiles.map((f) => ({
        path: commonPrefix && f.path.startsWith(commonPrefix) ? f.path.slice(commonPrefix.length) : f.path,
        content: f.content,
    }));

    // Find root index.html
    let indexFile = strippedFiles.find((f) => f.path.toLowerCase() === "index.html");
    if (!indexFile) {
        // If index.html is in a subfolder, unwrap that subfolder
        const nestedIndex = strippedFiles.find((f) => f.path.toLowerCase().endsWith("/index.html"));
        if (nestedIndex) {
            const dir = nestedIndex.path.slice(0, nestedIndex.path.lastIndexOf("/") + 1);
            strippedFiles = strippedFiles.map((f) => ({
                path: f.path.startsWith(dir) ? f.path.slice(dir.length) : f.path,
                content: f.content,
            }));
            indexFile = strippedFiles.find((f) => f.path.toLowerCase() === "index.html");
        }
    }

    // Fallback: If still no index.html, find any .html file and rename it to index.html
    if (!indexFile) {
        const anyHtml = strippedFiles.find((f) => f.path.toLowerCase().endsWith(".html"));
        if (anyHtml) {
            anyHtml.path = "index.html";
            indexFile = anyHtml;
        } else {
            throw new Error("Project must contain an index.html entry point for static deployment.");
        }
    }

    // Reconcile HTML references for CSS and JavaScript
    let htmlContent = indexFile.content;

    // Check CSS files
    const cssFiles = strippedFiles.filter((f) => f.path.endsWith(".css"));
    for (const css of cssFiles) {
        const cssPath = css.path; // e.g. "css/styles.css"
        const cssFileName = cssPath.split("/").pop(); // e.g. "styles.css"

        const hasExactRef =
            htmlContent.includes(`href="${cssPath}"`) ||
            htmlContent.includes(`href="./${cssPath}"`) ||
            htmlContent.includes(`href="/${cssPath}"`);

        if (!hasExactRef) {
            // Check if index.html references the filename with a mismatched relative path (e.g. href="styles.css")
            const looseRegex = new RegExp(`href=["']\\.?/?(?:[a-zA-Z0-9_-]+/)*${cssFileName}["']`, "gi");
            if (looseRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(looseRegex, `href="${cssPath}"`);
            } else {
                // Not referenced at all: inject into <head>
                if (htmlContent.includes("</head>")) {
                    htmlContent = htmlContent.replace("</head>", `  <link rel="stylesheet" href="${cssPath}">\n</head>`);
                } else if (htmlContent.includes("<html>")) {
                    htmlContent = htmlContent.replace("<html>", `<html><head><link rel="stylesheet" href="${cssPath}"></head>`);
                } else {
                    htmlContent = `<link rel="stylesheet" href="${cssPath}">\n${htmlContent}`;
                }
            }
        }
    }

    // Check JS files
    const jsFiles = strippedFiles.filter(
        (f) => (f.path.endsWith(".js") || f.path.endsWith(".jsx")) && !f.path.endsWith(".test.js")
    );
    for (const js of jsFiles) {
        const jsPath = js.path; // e.g. "js/script.js"
        const jsFileName = jsPath.split("/").pop(); // e.g. "script.js"

        const hasExactRef =
            htmlContent.includes(`src="${jsPath}"`) ||
            htmlContent.includes(`src="./${jsPath}"`) ||
            htmlContent.includes(`src="/${jsPath}"`);

        if (!hasExactRef) {
            const looseRegex = new RegExp(`src=["']\\.?/?(?:[a-zA-Z0-9_-]+/)*${jsFileName}["']`, "gi");
            if (looseRegex.test(htmlContent)) {
                htmlContent = htmlContent.replace(looseRegex, `src="${jsPath}"`);
            } else {
                // Not referenced at all: inject before </body>
                if (htmlContent.includes("</body>")) {
                    htmlContent = htmlContent.replace("</body>", `  <script src="${jsPath}"></script>\n</body>`);
                } else {
                    htmlContent += `\n<script src="${jsPath}"></script>`;
                }
            }
        }
    }

    indexFile.content = htmlContent;

    return strippedFiles;
}

/**
 * Packs project files into a binary ZIP buffer with files strictly placed at the root.
 *
 * @param {Array<{ path: string, content: string }>} files
 * @param {string} title
 * @returns {Promise<{ zipBuffer: Buffer, preparedFiles: Array<{ path: string, content: string }> }>}
 */
export async function packProjectZip(files = [], title = "orbit-app") {
    const preparedFiles = prepareProjectFilesForDeployment(files);
    const zip = new JSZip();

    for (const file of preparedFiles) {
        zip.file(file.path, file.content);
    }

    const zipBuffer = await zip.generateAsync({
        type: "nodebuffer",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
    });

    return { zipBuffer, preparedFiles };
}

/**
 * Polls Netlify Deploy endpoint until deploy reaches "ready" state or fails.
 *
 * @param {string} deployId
 * @param {string} token
 * @param {number} maxTimeoutMs
 * @returns {Promise<object>} The ready deploy object
 */
export async function pollNetlifyDeployReady(deployId, token, maxTimeoutMs = 45000) {
    const startTime = Date.now();
    const pollIntervalMs = 1500;

    while (Date.now() - startTime < maxTimeoutMs) {
        try {
            const res = await axios.get(`https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployId)}`, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 8000,
            });

            const deploy = res.data;
            const state = deploy?.state;

            if (state === "ready") {
                return deploy;
            }

            if (state === "error") {
                const errorMsg = deploy?.error_message || "Deploy entered error state on Netlify.";
                throw new Error(`Netlify deploy processing failed: ${errorMsg}`);
            }

            // Still processing ("new", "uploading", "prepared", "building", "processing")
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        } catch (err) {
            // Re-throw fatal deploy errors immediately
            if (err.message.includes("Netlify deploy processing failed")) {
                throw err;
            }
            // Transient network retry
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
    }

    throw new Error(`Netlify deployment timed out after ${Math.round(maxTimeoutMs / 1000)}s waiting for 'ready' state.`);
}

/**
 * Inspects Netlify's deployed file manifest to verify all expected files exist on the server.
 *
 * @param {string} deployId
 * @param {string} token
 * @param {Array<{ path: string }>} expectedFiles
 * @returns {Promise<Array<string>>} List of verified deployed file paths
 */
export async function inspectDeployManifest(deployId, token, expectedFiles = []) {
    try {
        const res = await axios.get(
            `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployId)}/files`,
            {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 10000,
            }
        );

        const deployedFileList = Array.isArray(res.data) ? res.data : [];
        const deployedPaths = new Set();
        for (const f of deployedFileList) {
            const raw = (f.path || "").trim().toLowerCase();
            if (raw === "/" || raw === "/index.html" || raw === "index.html" || raw === "") {
                deployedPaths.add("index.html");
                deployedPaths.add("/");
            } else {
                deployedPaths.add(raw.startsWith("/") ? raw.slice(1) : raw);
            }
        }

        // Verify index.html exists in manifest (Netlify reports root entry point as "/" or "/index.html")
        if (!deployedPaths.has("index.html") && !deployedPaths.has("/")) {
            throw new Error("Deploy manifest verification failed: index.html was not found in Netlify deployed files.");
        }

        // Verify expected CSS and JS files exist
        const missingFiles = [];
        for (const file of expectedFiles) {
            const cleanPath = file.path.toLowerCase();
            if (cleanPath === "index.html" || cleanPath === "/index.html") continue;
            if (!deployedPaths.has(cleanPath)) {
                missingFiles.push(file.path);
            }
        }

        if (missingFiles.length > 0) {
            throw new Error(`Deploy manifest verification failed: missing expected file(s) on Netlify: ${missingFiles.join(", ")}`);
        }

        return Array.from(deployedPaths);
    } catch (err) {
        if (err.message.includes("Deploy manifest verification failed")) {
            throw err;
        }
        console.warn("Deploy file manifest probe encountered a non-fatal warning:", err.message);
        return expectedFiles.map((f) => f.path);
    }
}

/**
 * Verifies that the published site and its required assets return HTTP 200 via server-side requests.
 *
 * @param {string} baseUrl
 * @param {Array<{ path: string }>} requiredFiles
 * @returns {Promise<{ verified: boolean, verifiedAssets: Array<string> }>}
 */
export async function verifyPublishedSiteAndAssets(baseUrl, requiredFiles = []) {
    if (!baseUrl) {
        throw new Error("No deployment URL available to verify.");
    }

    const cleanBaseUrl = baseUrl.replace(/\/+$/, "");

    // 1. Verify main HTML page
    const pageRes = await axios.get(cleanBaseUrl, {
        timeout: 10000,
        headers: { "User-Agent": "Orbit-Deploy-Verifier/1.0" },
    });

    if (pageRes.status !== 200 || !pageRes.data) {
        throw new Error(`Published website home page returned HTTP ${pageRes.status}. Expected HTTP 200.`);
    }

    const verifiedAssets = ["/"];

    // 2. Verify critical assets (css/styles.css, js/script.js)
    const assetFiles = requiredFiles.filter(
        (f) => f.path.endsWith(".css") || (f.path.endsWith(".js") && !f.path.endsWith(".test.js"))
    );

    for (const asset of assetFiles) {
        const assetUrl = `${cleanBaseUrl}/${asset.path}`;
        const assetRes = await axios.get(assetUrl, {
            timeout: 10000,
            headers: { "User-Agent": "Orbit-Deploy-Verifier/1.0" },
        });

        if (assetRes.status !== 200) {
            throw new Error(`Published asset verification failed: ${asset.path} returned HTTP ${assetRes.status}.`);
        }

        verifiedAssets.push(asset.path);
    }

    return { verified: true, verifiedAssets };
}

/**
 * Netlify Deployment Adapter.
 * Deploys pre-bundled static applications to Netlify, polls for 'ready' state,
 * inspects the deployed file manifest, and verifies live HTTP 200 access on all assets.
 */
export async function deployToNetlify({ files = [], title = "orbit-project", siteId = null }) {
    const token = process.env.NETLIFY_AUTH_TOKEN;
    if (!token) {
        return {
            success: false,
            status: "unconfigured",
            provider: "Netlify",
            error: "NETLIFY_AUTH_TOKEN is not configured in agent service environment.",
            instructions: "Set NETLIFY_AUTH_TOKEN in Backend/services/agent/.env to enable live Netlify deployments.",
        };
    }

    try {
        // Step 1: Prepare files & package ZIP with files strictly at root
        const { zipBuffer, preparedFiles } = await packProjectZip(files, title);
        const targetSiteId = siteId || process.env.NETLIFY_SITE_ID;

        let initialResponse;
        let resolvedSiteId = targetSiteId;

        // Step 2: Upload to Netlify
        if (targetSiteId) {
            // Deploy ZIP to existing site
            initialResponse = await axios.post(
                `https://api.netlify.com/api/v1/sites/${encodeURIComponent(targetSiteId)}/deploys`,
                zipBuffer,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/zip",
                    },
                    maxBodyLength: 25 * 1024 * 1024,
                    timeout: 35000,
                }
            );
        } else {
            // Create a new site and deploy ZIP
            const safeName = `orbit-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}-${Date.now().toString(36)}`;
            initialResponse = await axios.post(
                "https://api.netlify.com/api/v1/sites",
                zipBuffer,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/zip",
                    },
                    params: {
                        name: safeName,
                    },
                    maxBodyLength: 25 * 1024 * 1024,
                    timeout: 35000,
                }
            );
        }

        const initialData = initialResponse.data;
        const deployId = initialData.deploy_id || initialData.deploy?.id || initialData.id;
        resolvedSiteId = initialData.site_id || (initialData.deploy_id ? initialData.id : null) || targetSiteId;

        if (!deployId) {
            throw new Error("Netlify did not return a valid deployment ID.");
        }

        // Step 3: Poll Netlify Deploy endpoint until deploy reaches "ready" state
        const readyDeploy = await pollNetlifyDeployReady(deployId, token, 45000);

        // Step 4: Inspect Deployed File Manifest to ensure index.html, CSS, and JS exist
        const verifiedManifestFiles = await inspectDeployManifest(deployId, token, preparedFiles);

        // Step 5: Determine canonical public URL (prefer ssl_url or url on public Netlify domain)
        const canonicalUrl = readyDeploy.ssl_url || readyDeploy.url || initialData.ssl_url || initialData.url;
        if (!canonicalUrl) {
            throw new Error("Netlify did not return a public canonical URL for the site.");
        }

        // Step 6: Verify published page and its required assets via server-side HTTP GET requests
        const { verified, verifiedAssets } = await verifyPublishedSiteAndAssets(canonicalUrl, preparedFiles);

        return {
            success: true,
            status: "published",
            provider: "Netlify",
            deploymentUrl: canonicalUrl,
            permalinkUrl: readyDeploy.deploy_ssl_url || readyDeploy.deploy_url || canonicalUrl,
            deployId,
            siteId: resolvedSiteId,
            verified,
            verifiedFiles: verifiedAssets,
            deployedAt: readyDeploy.published_at || new Date().toISOString(),
        };
    } catch (error) {
        // Sanitize error message to ensure tokens are never leaked
        const status = error.response?.status;
        let errMsg = error.response?.data?.message || error.message || "Netlify deployment failed.";

        if (status === 401) {
            errMsg = "Netlify authentication failed: Invalid or expired personal access token.";
        } else if (status === 429) {
            errMsg = "Netlify API rate limit exceeded. Please wait a few moments and try again.";
        } else if (status === 422) {
            errMsg = `Netlify rejected deployment payload: ${error.response?.data?.message || "Invalid archive format"}`;
        }

        console.error("Netlify deployment error:", errMsg);

        return {
            success: false,
            status: "failed",
            provider: "Netlify",
            statusCode: status || 500,
            error: errMsg,
        };
    }
}
