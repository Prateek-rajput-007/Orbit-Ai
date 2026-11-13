import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import os from "os";

import {
    findFrontendNodeModules,
    validateBuildOutput,
    sanitizeBuildErrorMessage,
    buildReactProjectToStatic,
} from "../utils/deployment/reactBuildService.js";
import {
    validateDeploymentPayload,
    deployArtifactProject,
} from "../utils/deployment/deploymentManager.js";
import { packProjectZip } from "../utils/deployment/netlifyAdapter.js";
import { isReactProject } from "../utils/codeArtifact.js";

test("Phase 4 - Test 1: Frontend node_modules resolution & build output validator", () => {
    const fModules = findFrontendNodeModules();
    assert.ok(fs.existsSync(fModules), "Frontend/node_modules directory must exist on disk");
    assert.ok(fs.existsSync(path.join(fModules, "vite")), "Vite must be installed in Frontend/node_modules");

    // validateBuildOutput passes for valid static bundle
    const validBundle = [
        { path: "index.html", content: "<!DOCTYPE html><html><head><script src='./assets/index.js'></script></head><body><div id='root'></div></body></html>" },
        { path: "assets/index.js", content: "console.log('bundled');" },
    ];
    assert.equal(validateBuildOutput(validBundle), true);

    // Rejects empty bundle
    assert.throws(() => validateBuildOutput([]), /no output files/i);

    // Rejects bundle missing index.html
    assert.throws(
        () => validateBuildOutput([{ path: "assets/index.js", content: "console.log(1);" }]),
        /index\.html is missing or empty/i
    );

    // Rejects bundle missing compiled JS asset
    assert.throws(
        () => validateBuildOutput([{ path: "index.html", content: "<html></html>" }]),
        /no compiled JavaScript bundle/i
    );

    // Rejects bundle exceeding size limit
    assert.throws(
        () => validateBuildOutput(validBundle, { maxOutputBytes: 10 }),
        /exceeds maximum limit/i
    );
});

test("Phase 4 - Test 2: Error message sanitizer removes machine-specific temporary paths", () => {
    const rawError = "Error in C:\\Users\\user\\AppData\\Local\\Temp\\orbit-build-12345/src/App.jsx: Unexpected token (10:5)";
    const sanitized = sanitizeBuildErrorMessage(rawError, "C:\\Users\\user\\AppData\\Local\\Temp\\orbit-build-12345");
    assert.ok(!sanitized.includes("orbit-build-12345"), "Must strip temp folder path");
    assert.ok(sanitized.includes("src/App.jsx"), "Must preserve relative file path");
});

test("Phase 4 - Test 3: Complete React production build with multi-file JSX and Lucide icons", async () => {
    const projectFiles = [
        {
            path: "index.html",
            content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>CalcFlow Pro</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-white">
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>`,
        },
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

const root = createRoot(document.getElementById("root"));
root.render(<App />);`,
        },
        {
            path: "src/components/Header.jsx",
            content: `import React from "react";
import { Sparkles, Calculator } from "lucide-react";

export default function Header({ title }) {
  return (
    <header className="p-4 bg-slate-800 flex items-center gap-2">
      <Calculator className="w-6 h-6 text-indigo-400" />
      <h1 className="text-xl font-bold">{title}</h1>
      <Sparkles className="w-4 h-4 text-amber-400" />
    </header>
  );
}`,
        },
        {
            path: "src/App.jsx",
            content: `import React, { useState } from "react";
import Header from "./components/Header.jsx";

export default function App() {
  const [val, setVal] = useState(0);
  return (
    <div className="min-h-screen">
      <Header title="CalcFlow Application" />
      <main className="p-6">
        <button onClick={() => setVal(v => v + 1)} className="px-4 py-2 bg-indigo-600 rounded">
          Count: {val}
        </button>
      </main>
    </div>
  );
}`,
        },
        {
            path: "package.json",
            content: JSON.stringify({
                name: "calcflow",
                dependencies: {
                    react: "^19.0.0",
                    "react-dom": "^19.0.0",
                    "lucide-react": "^1.0.0",
                },
            }),
        },
    ];

    const result = await buildReactProjectToStatic(projectFiles, { title: "CalcFlow Pro" });

    assert.equal(result.success, true, "Build must succeed");
    assert.equal(result.status, "built");
    assert.ok(Array.isArray(result.files), "Result must have files array");

    // Output must contain compiled index.html
    const indexHtml = result.files.find((f) => f.path === "index.html");
    assert.ok(indexHtml, "dist must contain index.html");
    assert.ok(indexHtml.content.includes("<script type=\"module\""), "index.html must reference module script");
    assert.ok(indexHtml.content.includes("assets/"), "index.html must point to assets directory");

    // Output must contain compiled JS bundle
    const jsAsset = result.files.find((f) => f.path.startsWith("assets/") && f.path.endsWith(".js"));
    assert.ok(jsAsset, "dist must contain compiled JavaScript asset in assets/");
    assert.ok(jsAsset.content.length > 500, "Compiled bundle must contain bundled React & icons code");

    // Must NOT contain raw JSX files in output
    const hasRawJsx = result.files.some((f) => f.path.endsWith(".jsx"));
    assert.equal(hasRawJsx, false, "Production build output must never contain raw .jsx source files");
});

test("Phase 4 - Test 4: Synthesizes missing root index.html and src/main.jsx entry point", async () => {
    // Project provides ONLY App.jsx without index.html or main.jsx
    const bareFiles = [
        {
            path: "src/App.jsx",
            content: `import React, { useState } from "react";
export default function App() {
  const [active, setActive] = useState(true);
  return <div className="p-4"><h1>Bare App: {active ? "Active" : "Inactive"}</h1></div>;
}`,
        },
    ];

    const result = await buildReactProjectToStatic(bareFiles, { title: "Auto Entry Test" });

    assert.equal(result.success, true, "Build must succeed with synthesized entry point");
    const indexHtml = result.files.find((f) => f.path === "index.html");
    assert.ok(indexHtml, "Must generate valid index.html");
    assert.ok(indexHtml.content.includes("<div id=\"root\"></div>"), "Synthesized HTML must have root container");
});

test("Phase 4 - Test 5: Bundles project CSS into production stylesheet asset", async () => {
    const filesWithCss = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/styles.css",
            content: `body { background-color: #0b0f19; color: #38bdf8; font-family: ui-monospace; }`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() {
  return <h1>Styled React App</h1>;
}`,
        },
    ];

    const result = await buildReactProjectToStatic(filesWithCss);
    assert.equal(result.success, true);

    const cssAsset = result.files.find((f) => f.path.startsWith("assets/") && f.path.endsWith(".css"));
    assert.ok(cssAsset, "dist must contain compiled CSS stylesheet");
    assert.ok(cssAsset.content.includes("#0b0f19"), "CSS bundle must contain declared styles");

    const indexHtml = result.files.find((f) => f.path === "index.html");
    assert.ok(indexHtml.content.includes(cssAsset.path), "index.html must reference the compiled CSS bundle");
});

test("Phase 4 - Test 6: Catches syntax errors gracefully without throwing or leaving temp files", async () => {
    const brokenFiles = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() {
  // Syntax error: unterminated string literal
  const title = "Unterminated string;
  return <h1>{title}</h1>;
}`,
        },
    ];

    const result = await buildReactProjectToStatic(brokenFiles);

    assert.equal(result.success, false, "Build must fail for broken syntax");
    assert.equal(result.status, "build_failed");
    assert.ok(typeof result.error === "string", "Must provide error message");
    assert.ok(
        result.error.toLowerCase().includes("syntax") || result.error.toLowerCase().includes("error"),
        `Error must mention syntax or compilation failure: ${result.error}`
    );
});

test("Phase 4 - Test 7: Path traversal attempt is blocked safely", async () => {
    const maliciousFiles = [
        {
            path: "../../malicious.js",
            content: "console.log('exploit');",
        },
        {
            path: "src/App.jsx",
            content: "export default function App() { return null; }",
        },
    ];

    const result = await buildReactProjectToStatic(maliciousFiles);
    assert.equal(result.success, false);
    assert.equal(result.status, "build_failed");
    assert.ok(result.error.toLowerCase().includes("security violation") || result.error.toLowerCase().includes("traversal"));
});

test("Phase 4 - Test 8: Legacy HTML project bypasses React build and deploys directly", async () => {
    const legacyProject = [
        {
            path: "index.html",
            content: `<!DOCTYPE html><html><head><title>Legacy Site</title><link rel="stylesheet" href="styles.css"></head><body><h1>Hello Legacy</h1><script src="app.js"></script></body></html>`,
        },
        {
            path: "styles.css",
            content: "body { background: black; color: white; }",
        },
        {
            path: "app.js",
            content: "console.log('legacy script running');",
        },
    ];

    // isReactProject must return false
    assert.equal(isReactProject(legacyProject), false, "Legacy HTML project must not be detected as React");

    // deployArtifactProject with no tokens configured returns status: "unconfigured" cleanly
    const deployResult = await deployArtifactProject({
        files: legacyProject,
        title: "legacy-test",
        provider: "netlify",
    });

    // In local test environment without NETLIFY_AUTH_TOKEN, returns unconfigured
    assert.equal(deployResult.success, false);
    assert.equal(deployResult.status, "unconfigured");
    assert.ok(deployResult.error.includes("NETLIFY_AUTH_TOKEN"));
});

test("Phase 4 - Test 9: React project triggers build before deployment payload validation", async () => {
    const reactProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() { return <div><h1>React Deploy Test</h1></div>; }`,
        },
        {
            path: "package.json",
            content: JSON.stringify({ dependencies: { react: "^19.0.0" } }),
        },
    ];

    assert.equal(isReactProject(reactProject), true, "Must detect React project");

    // When deploying without NETLIFY_AUTH_TOKEN:
    // It must first compile through Vite successfully, and only THEN reach Netlify adapter and report unconfigured!
    const deployResult = await deployArtifactProject({
        files: reactProject,
        title: "react-deploy-test",
        provider: "netlify",
    });

    assert.equal(deployResult.success, false);
    // Notice: status is "unconfigured" (meaning Vite build passed and reached the Netlify adapter token check),
    // NOT "build_failed"!
    assert.equal(deployResult.status, "unconfigured");
    assert.ok(deployResult.error.includes("NETLIFY_AUTH_TOKEN"));
});

test("Phase 4 - Test 10: Broken React project fails at build stage and never attempts deployment", async () => {
    const brokenReactProject = [
        {
            path: "src/main.jsx",
            content: `import React from "react";
import App from "./App.jsx";
import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(<App />);`,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react";
export default function App() {
  // Syntax error
  return <div><button>Unclosed button</div>;
}`,
        },
    ];

    const deployResult = await deployArtifactProject({
        files: brokenReactProject,
        title: "broken-react",
        provider: "netlify",
    });

    assert.equal(deployResult.success, false);
    assert.equal(deployResult.status, "build_failed", "Must fail with status: 'build_failed'");
    assert.ok(deployResult.error.includes("React production build failed"));
});

test("Phase 4 - Test 11: Netlify packProjectZip packs compiled static Vite bundle with root index.html", async () => {
    const compiledViteBundle = [
        {
            path: "index.html",
            content: `<!DOCTYPE html><html><head><script type="module" crossorigin src="./assets/index-abc.js"></script><link rel="stylesheet" crossorigin href="./assets/index-def.css"></head><body><div id="root"></div></body></html>`,
        },
        {
            path: "assets/index-abc.js",
            content: "console.log('compiled bundle');",
        },
        {
            path: "assets/index-def.css",
            content: "body { margin: 0; }",
        },
    ];

    const { zipBuffer, preparedFiles } = await packProjectZip(compiledViteBundle, "vite-pack-test");

    assert.ok(Buffer.isBuffer(zipBuffer), "Must return binary Buffer");
    assert.ok(zipBuffer.length > 100, "ZIP buffer must be non-empty");

    const rootIndex = preparedFiles.find((f) => f.path === "index.html");
    assert.ok(rootIndex, "index.html must sit at the root of the prepared deploy tree");
    assert.ok(rootIndex.content.includes("src=\"./assets/index-abc.js\""));
    assert.ok(rootIndex.content.includes("href=\"./assets/index-def.css\""));
});

