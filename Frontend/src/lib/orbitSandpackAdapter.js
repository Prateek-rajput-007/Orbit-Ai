/**
 * Orbit <-> Sandpack Runtime Adapter (Production).
 *
 * Provides bidirectional translation between Orbit's portable CodeArtifact format:
 *   {
 *     artifactId: string,
 *     entryFile: string,
 *     files: [{ path: string, content: string, language: string, size?: number }]
 *   }
 * and Sandpack's required file map:
 *   {
 *     "/path/to/file": { code: string, active?: boolean, hidden?: boolean }
 *   }
 *
 * Guarantees that Orbit CodeArtifact remains 100% portable and completely decoupled
 * from CodeSandbox/Sandpack runtime internals.
 */

/**
 * Normalizes file paths for Sandpack (ensuring leading forward slash).
 */
export function normalizeSandpackPath(rawPath = "") {
  if (!rawPath || typeof rawPath !== "string") return "/App.jsx";
  let clean = rawPath.replace(/\\+/g, "/").replace(/^(\.\/)+/, "");
  if (!clean.startsWith("/")) clean = `/${clean}`;
  return clean;
}

/**
 * Extracts and maps standard dependencies required for React execution.
 */
export function extractSandpackDependencies(files = [], customDependencies = {}) {
  const deps = {
    react: "^18.3.1",
    "react-dom": "^18.3.1",
    ...customDependencies,
  };

  // 1. Read dependencies from package.json if present
  const pkgFile = files.find((f) => (f.path || "").toLowerCase().endsWith("package.json"));
  if (pkgFile && typeof pkgFile.content === "string") {
    try {
      const parsed = JSON.parse(pkgFile.content);
      const pkgDeps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) };
      Object.assign(deps, pkgDeps);
    } catch {
      // Malformed package.json; continue with heuristics
    }
  }

  // 2. Inspect import statements across all files to detect common packages
  for (const file of files) {
    const code = file.content || "";
    if (code.includes("lucide-react") && !deps["lucide-react"]) {
      deps["lucide-react"] = "^0.460.0";
    }
    if (code.includes("date-fns") && !deps["date-fns"]) {
      deps["date-fns"] = "^3.6.0";
    }
    if (code.includes("recharts") && !deps["recharts"]) {
      deps["recharts"] = "^2.13.0";
    }
    if (code.includes("clsx") && !deps["clsx"]) {
      deps["clsx"] = "^2.1.1";
    }
    if (code.includes("tailwind-merge") && !deps["tailwind-merge"]) {
      deps["tailwind-merge"] = "^2.5.0";
    }
    if (code.includes("canvas-confetti") && !deps["canvas-confetti"]) {
      deps["canvas-confetti"] = "^1.9.3";
    }
    if (code.includes("uuid") && !deps["uuid"]) {
      deps["uuid"] = "^9.0.0";
    }
    if (code.includes("framer-motion") && !deps["framer-motion"]) {
      deps["framer-motion"] = "^11.11.17";
    }
  }

  return deps;
}

/**
 * Converts Orbit CodeArtifact into Sandpack file map and provider options.
 *
 * @param {object} artifact Orbit CodeArtifact
 * @param {object} options Additional configuration
 * @returns {{ files: Record<string, { code: string, hidden?: boolean, bridge?: boolean }>, dependencies: Record<string, string>, entryPoint: string, userEntryFile: string }}
 */
export function mapOrbitArtifactToSandpack(artifact = {}, options = {}) {
  const rawFiles = Array.isArray(artifact?.files) ? artifact.files : [];
  const filesMap = {};

  for (const file of rawFiles) {
    if (!file?.path) continue;
    const spPath = normalizeSandpackPath(file.path);
    filesMap[spPath] = {
      code: typeof file.content === "string" ? file.content : String(file.content || ""),
    };
  }

  // 1. Resolve application entry point
  let entryPoint = "/src/main.jsx";
  if (filesMap["/src/main.jsx"]) {
    entryPoint = "/src/main.jsx";
  } else if (filesMap["/src/index.jsx"]) {
    entryPoint = "/src/index.jsx";
  } else if (filesMap["/src/index.js"]) {
    entryPoint = "/src/index.js";
  } else if (filesMap["/src/App.jsx"]) {
    entryPoint = "/src/App.jsx";
  } else if (filesMap["/App.jsx"]) {
    entryPoint = "/App.jsx";
  } else if (filesMap["/index.html"]) {
    entryPoint = "/index.html";
  }

  // Resolve user-facing active editing file
  let userEntryFile = filesMap["/src/App.jsx"]
    ? "/src/App.jsx"
    : (filesMap["/App.jsx"] ? "/App.jsx" : entryPoint);

  // 2. Resolve or stub stylesheet imports to prevent broken CSS imports from crashing Sandpack
  for (const [path, fileObj] of Object.entries(filesMap)) {
    if (!path.endsWith(".jsx") && !path.endsWith(".js") && !path.endsWith(".tsx")) continue;
    const code = fileObj.code || "";
    const cssImports = code.match(/import\s+['"][^'"]+\.css['"]/g) || [];
    for (const statement of cssImports) {
      const match = statement.match(/['"]([^'"]+\.css)['"]/);
      if (!match) continue;
      const rawImport = match[1];
      const dir = path.substring(0, path.lastIndexOf("/"));
      let targetCssPath = rawImport.startsWith("./")
        ? `${dir}/${rawImport.slice(2)}`
        : (rawImport.startsWith("/") ? rawImport : `${dir}/${rawImport}`);
      targetCssPath = normalizeSandpackPath(targetCssPath);

      if (!filesMap[targetCssPath]) {
        const baseName = targetCssPath.split("/").pop();
        const candidate = Object.keys(filesMap).find((k) => k.endsWith(`/${baseName}`));
        if (candidate) {
          filesMap[targetCssPath] = {
            code: filesMap[candidate].code,
            bridge: true,
            hidden: true,
          };
        } else {
          filesMap[targetCssPath] = {
            code: "/* Auto-stubbed stylesheet */\n",
            bridge: true,
            hidden: true,
          };
        }
      }
    }
  }

  // 3. Ensure /public/index.html is provided with Tailwind CDN & root element
  // CRA template in Sandpack renders via /public/index.html
  const rootIndexHtml = filesMap["/index.html"]?.code || "";
  let publicHtml = filesMap["/public/index.html"]?.code || rootIndexHtml;

  if (!publicHtml) {
    publicHtml = `<!DOCTYPE html>
<html lang="en" class="h-full">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${artifact?.title || "Orbit React App"}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      html, body, #root {
        height: 100%;
        min-height: 100%;
        margin: 0;
        padding: 0;
      }
    </style>
  </head>
  <body class="h-full bg-slate-950 text-slate-100 antialiased">
    <div id="root" class="h-full min-h-full"></div>
  </body>
</html>`;
  } else {
    // Ensure Tailwind CDN is present if not already in HTML
    if (!publicHtml.includes("tailwindcss.com") && !publicHtml.includes("tailwind")) {
      if (publicHtml.includes("</head>")) {
        publicHtml = publicHtml.replace(
          "</head>",
          '  <script src="https://cdn.tailwindcss.com"></script>\n  </head>'
        );
      } else {
        publicHtml = `<script src="https://cdn.tailwindcss.com"></script>\n${publicHtml}`;
      }
    }
    // Ensure root div exists
    if (!publicHtml.includes('id="root"') && !publicHtml.includes("id='root'")) {
      if (publicHtml.includes("</body>")) {
        publicHtml = publicHtml.replace(
          "</body>",
          '  <div id="root"></div>\n</body>'
        );
      } else {
        publicHtml = `${publicHtml}\n<div id="root"></div>`;
      }
    }
  }

  filesMap["/public/index.html"] = {
    code: publicHtml,
    hidden: true,
    bridge: true,
  };

  // 4. Critical Sandpack Bridge Files:
  // Sandpack's React template (CRA) defaults to executing /index.js which imports /App.js (Hello World).
  // If user files do not supply root /index.js, bridge it to mount or import user entry file.
  const twBootstrap = `if (typeof document !== "undefined" && !document.querySelector("script[src*='tailwindcss']")) {
  const twScript = document.createElement("script");
  twScript.src = "https://cdn.tailwindcss.com";
  document.head.appendChild(twScript);
}\n`;

  if (!filesMap["/index.js"]) {
    if (filesMap["/src/main.jsx"]) {
      filesMap["/index.js"] = {
        code: `${twBootstrap}import "./styles.css";\nimport "./src/main.jsx";\n`,
        hidden: true,
        bridge: true,
      };
    } else if (filesMap["/src/index.jsx"]) {
      filesMap["/index.js"] = {
        code: `${twBootstrap}import "./styles.css";\nimport "./src/index.jsx";\n`,
        hidden: true,
        bridge: true,
      };
    } else if (filesMap["/src/index.js"]) {
      filesMap["/index.js"] = {
        code: `${twBootstrap}import "./styles.css";\nimport "./src/index.js";\n`,
        hidden: true,
        bridge: true,
      };
    } else {
      const targetApp = filesMap["/src/App.jsx"] ? "./src/App.jsx" : (filesMap["/App.jsx"] ? "./App.jsx" : "./src/App");
      filesMap["/index.js"] = {
        code: `${twBootstrap}import "./styles.css";\nimport React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "${targetApp}";

const root = createRoot(document.getElementById("root"));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
        hidden: true,
        bridge: true,
      };
    }
  }

  // Bridge /App.js so any template references resolve to user App.jsx rather than CRA's default Hello World
  if (!filesMap["/App.js"]) {
    const targetApp = filesMap["/src/App.jsx"] ? "./src/App.jsx" : (filesMap["/App.jsx"] ? "./App.jsx" : "./src/App");
    filesMap["/App.js"] = {
      code: `export { default } from "${targetApp}";\n`,
      hidden: true,
      bridge: true,
    };
  }

  // Bridge /styles.css to prevent CRA template's styles from overriding or leaking
  if (!filesMap["/styles.css"]) {
    const candidateStyle = filesMap["/src/styles/index.css"]
      ? "./src/styles/index.css"
      : (filesMap["/src/index.css"] ? "./src/index.css" : null);

    const baseCss = `*, ::before, ::after { box-sizing: border-box; }\nhtml, body, #root {\n  height: 100%;\n  min-height: 100%;\n  margin: 0;\n  padding: 0;\n  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n  -webkit-font-smoothing: antialiased;\n}\n`;

    filesMap["/styles.css"] = {
      code: candidateStyle ? `${baseCss}@import "${candidateStyle}";\n` : baseCss,
      hidden: true,
      bridge: true,
    };
  }

  // 5. Update package.json if present
  if (filesMap["/package.json"]?.code) {
    try {
      const parsedPkg = JSON.parse(filesMap["/package.json"].code);
      if (!parsedPkg.main || parsedPkg.main.startsWith("src/main")) {
        parsedPkg.main = "/index.js";
        filesMap["/package.json"].code = JSON.stringify(parsedPkg, null, 2);
      }
    } catch {
      // ignore
    }
  }

  const dependencies = extractSandpackDependencies(rawFiles, options.dependencies || {});

  return {
    files: filesMap,
    dependencies,
    entryPoint,
    bundlerEntry: "/index.js",
    userEntryFile,
  };
}

/**
 * Applies Phase 1 incremental operations (create, update, delete) to a Sandpack file map.
 *
 * @param {Record<string, { code: string }>} currentFiles
 * @param {Array<{ type: string, path: string, content?: string }>} operations
 * @returns {Record<string, { code: string }>} Updated file map
 */
export function applyOperationsToSandpack(currentFiles = {}, operations = []) {
  const updated = { ...currentFiles };

  for (const op of operations) {
    if (!op || !op.path) continue;
    const targetPath = normalizeSandpackPath(op.path);

    if (op.type === "delete") {
      delete updated[targetPath];
    } else if (op.type === "create" || op.type === "update") {
      updated[targetPath] = {
        code: typeof op.content === "string" ? op.content : String(op.content || ""),
      };
    }
  }

  return updated;
}

/**
 * Reconstructs a portable Orbit CodeArtifact from Sandpack file map,
 * stripping internal host files (e.g. /public/index.html).
 * Used for local editing ZIP export and deployment.
 *
 * @param {Record<string, { code: string }>} sandpackFiles
 * @param {object} originalArtifact
 * @returns {object} Portable Orbit CodeArtifact
 */
export function reconstructOrbitArtifactFromSandpack(sandpackFiles = {}, originalArtifact = {}) {
  const originalPaths = new Set(
    (originalArtifact?.files || []).map((f) => normalizeSandpackPath(f.path))
  );

  const files = Object.entries(sandpackFiles)
    .filter(([path, data]) => {
      if (!data || typeof data.code !== "string") return false;
      if (data.bridge || data.synthetic) return false;
      // Host and synthetic bridge files not belonging to original artifact
      if (
        (path === "/index.js" || path === "/App.js" || path === "/styles.css" || path.startsWith("/public/")) &&
        !originalPaths.has(path)
      ) {
        return false;
      }
      return true;
    })
    .map(([path, data]) => {
      const cleanPath = path.replace(/^\//, "");
      const ext = cleanPath.split(".").pop()?.toLowerCase();
      let language = "javascript";
      if (ext === "jsx" || ext === "tsx") language = "jsx";
      else if (ext === "css") language = "css";
      else if (ext === "json") language = "json";
      else if (ext === "html") language = "html";

      const byteSize =
        typeof Blob !== "undefined"
          ? new Blob([data.code]).size
          : (typeof TextEncoder !== "undefined" ? new TextEncoder().encode(data.code).length : data.code.length);

      return {
        path: cleanPath,
        content: data.code,
        language,
        size: byteSize,
      };
    });

  return {
    ...originalArtifact,
    files,
    totalFiles: files.length,
    totalSize: files.reduce((acc, f) => acc + f.size, 0),
  };
}

