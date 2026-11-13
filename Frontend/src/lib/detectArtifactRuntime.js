/**
 * Artifact Runtime Detection Engine for Orbit.
 *
 * Deterministically classifies an Orbit CodeArtifact into one of four runtimes:
 * 1. REACT: Modern multi-file React/JSX project (executes via Sandpack).
 * 2. LEGACY_HTML: Vanilla HTML/CSS/JS project (executes via existing sandboxed iframe).
 * 3. UNSUPPORTED: Valid code files but no web-runnable entry point (e.g. backend Python/Node/SQL).
 * 4. INVALID: Corrupted, missing, or empty artifact files.
 */

export const ARTIFACT_RUNTIMES = {
  REACT: "REACT",
  LEGACY_HTML: "LEGACY_HTML",
  UNSUPPORTED: "UNSUPPORTED",
  INVALID: "INVALID",
};

/**
 * Checks if a file path represents a React/JSX component or module.
 */
function isReactFilePath(filePath = "") {
  const lower = filePath.toLowerCase();
  return (
    lower.endsWith(".jsx") ||
    lower.endsWith(".tsx") ||
    lower.includes("components/") ||
    lower.includes("src/app.") ||
    lower.includes("src/main.")
  );
}

/**
 * Checks if file content contains explicit React imports, JSX tags, or component declarations.
 */
function hasReactCodeSignatures(content = "") {
  if (typeof content !== "string" || !content) return false;
  return (
    /from\s+["']react["']/.test(content) ||
    /from\s+["']react-dom(\/client)?["']/.test(content) ||
    /import\s+React\b/.test(content) ||
    /export\s+default\s+function\s+[A-Z]/.test(content) ||
    /const\s+[A-Z][a-zA-Z0-9]*\s*=\s*\(.*?\)\s*=>/.test(content) ||
    /createRoot\s*\(/.test(content)
  );
}

/**
 * Detects the appropriate runtime execution engine for a CodeArtifact.
 *
 * @param {object|null} artifact Orbit CodeArtifact
 * @returns {{
 *   runtime: "REACT"|"LEGACY_HTML"|"UNSUPPORTED"|"INVALID",
 *   reason: string,
 *   entryFile: string,
 *   hasPackageJson: boolean
 * }}
 */
export function detectArtifactRuntime(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return {
      runtime: ARTIFACT_RUNTIMES.INVALID,
      reason: "Artifact is null or not an object.",
      entryFile: "",
      hasPackageJson: false,
    };
  }

  const files = Array.isArray(artifact.files) ? artifact.files : [];
  if (files.length === 0) {
    return {
      runtime: ARTIFACT_RUNTIMES.INVALID,
      reason: "Artifact contains no files.",
      entryFile: "",
      hasPackageJson: false,
    };
  }

  const filePaths = files.map((f) => (f.path || "").toLowerCase().replace(/\\+/g, "/"));
  const packageJsonFile = files.find((f) => (f.path || "").toLowerCase().endsWith("package.json"));
  const hasPackageJson = Boolean(packageJsonFile);

  // Check 1: Package.json specifies React dependencies
  if (packageJsonFile && typeof packageJsonFile.content === "string") {
    try {
      const parsedPkg = JSON.parse(packageJsonFile.content);
      const allDeps = {
        ...(parsedPkg.dependencies || {}),
        ...(parsedPkg.devDependencies || {}),
      };
      if (allDeps.react || allDeps["react-dom"]) {
        return {
          runtime: ARTIFACT_RUNTIMES.REACT,
          reason: "package.json declares react dependency.",
          entryFile: artifact.entryFile || "src/main.jsx",
          hasPackageJson: true,
        };
      }
    } catch {
      // Malformed package.json; fall through to structural and content heuristics
    }
  }

  // Check 2: Recognizable React project structure (e.g. src/App.jsx, src/main.jsx, components/*.jsx)
  const hasReactFiles = files.some(
    (f) => isReactFilePath(f.path) || hasReactCodeSignatures(f.content)
  );

  const hasStandardReactEntry = filePaths.some(
    (p) =>
      p.endsWith("app.jsx") ||
      p.endsWith("app.tsx") ||
      p.endsWith("main.jsx") ||
      p.endsWith("main.tsx") ||
      p.endsWith("index.jsx") ||
      p.endsWith("index.tsx")
  );

  // Check 3: Does it have index.html?
  const htmlFile = files.find((f) => (f.path || "").toLowerCase().endsWith(".html"));

  // If it has distinct React files and React entry, or React files without an index.html:
  if (hasReactFiles && (hasStandardReactEntry || !htmlFile)) {
    return {
      runtime: ARTIFACT_RUNTIMES.REACT,
      reason: "Project contains React JSX components and modular imports.",
      entryFile: artifact.entryFile || (hasStandardReactEntry ? "src/App.jsx" : "App.jsx"),
      hasPackageJson,
    };
  }

  // Check 4: Legacy HTML/CSS/JS project
  if (htmlFile) {
    return {
      runtime: ARTIFACT_RUNTIMES.LEGACY_HTML,
      reason: "Project has a standard index.html entry point for iframe preview.",
      entryFile: htmlFile.path,
      hasPackageJson,
    };
  }

  // Check 5: Code exists, but no web entry point (e.g. python, node script, sql, bash)
  const isBackendOrScript = files.some((f) => {
    const ext = (f.path || "").split(".").pop()?.toLowerCase();
    return ["py", "sql", "sh", "bash", "go", "rs", "java", "c", "cpp"].includes(ext);
  });

  if (isBackendOrScript) {
    return {
      runtime: ARTIFACT_RUNTIMES.UNSUPPORTED,
      reason: "Non-web code project (backend or utility script) with no runnable web entry point.",
      entryFile: files[0].path,
      hasPackageJson,
    };
  }

  // Fallback: If only vanilla JS and CSS files exist, legacy iframe can host them
  const hasJsOrCss = files.some((f) => {
    const p = (f.path || "").toLowerCase();
    return p.endsWith(".js") || p.endsWith(".css");
  });

  if (hasJsOrCss) {
    return {
      runtime: ARTIFACT_RUNTIMES.LEGACY_HTML,
      reason: "Vanilla script and style files can be inlined into host document.",
      entryFile: files[0].path,
      hasPackageJson,
    };
  }

  return {
    runtime: ARTIFACT_RUNTIMES.UNSUPPORTED,
    reason: "No recognizable web entry file found.",
    entryFile: files[0]?.path || "",
    hasPackageJson,
  };
}
