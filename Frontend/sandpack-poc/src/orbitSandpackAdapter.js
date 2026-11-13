/**
 * Orbit <-> Sandpack Runtime Adapter.
 *
 * Bridges Orbit's portable CodeArtifact format:
 *   {
 *     artifactId: string,
 *     entryFile: string,
 *     files: [{ path: string, content: string, language: string }]
 *   }
 * into Sandpack's expected file map:
 *   {
 *     "/path/to/file": { code: string, active?: boolean, hidden?: boolean }
 *   }
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

  // Inspect import statements across all files to detect common packages
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
  }

  return deps;
}

/**
 * Converts Orbit CodeArtifact into Sandpack file map and provider options.
 *
 * @param {object} artifact Orbit CodeArtifact
 * @param {object} options Additional configuration
 * @returns {{ files: Record<string, { code: string }>, dependencies: Record<string, string>, entryPoint: string }}
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

  // Resolve entry point
  let entryPoint = "/src/main.jsx";
  if (filesMap["/src/main.jsx"]) {
    entryPoint = "/src/main.jsx";
  } else if (filesMap["/src/index.js"]) {
    entryPoint = "/src/index.js";
  } else if (filesMap["/App.jsx"] || filesMap["/src/App.jsx"]) {
    entryPoint = filesMap["/src/App.jsx"] ? "/src/App.jsx" : "/App.jsx";
  } else if (filesMap["/index.html"]) {
    entryPoint = "/index.html";
  }

  // Automatically inject index.html if not provided
  if (!filesMap["/public/index.html"] && !filesMap["/index.html"]) {
    filesMap["/public/index.html"] = {
      code: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${artifact?.title || "Orbit React App"}</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`,
      hidden: true,
    };
  }

  const dependencies = extractSandpackDependencies(rawFiles, options.dependencies || {});

  return {
    files: filesMap,
    dependencies,
    entryPoint,
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

