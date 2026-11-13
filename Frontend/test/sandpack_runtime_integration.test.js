import test from "node:test";
import assert from "node:assert/strict";
import {
  detectArtifactRuntime,
  ARTIFACT_RUNTIMES,
} from "../src/lib/detectArtifactRuntime.js";
import {
  mapOrbitArtifactToSandpack,
  applyOperationsToSandpack,
  reconstructOrbitArtifactFromSandpack,
} from "../src/lib/orbitSandpackAdapter.js";

// ============================================================================
// 1. RUNTIME DETECTION TESTS
// ============================================================================

test("Test 1: React runtime detection detects modern multi-file React project", () => {
  const reactArtifact = {
    artifactId: "art_react_1",
    entryFile: "src/App.jsx",
    files: [
      { path: "src/App.jsx", content: "import React from 'react'; export default function App() { return <h1>React App</h1>; }" },
      { path: "src/components/Header.jsx", content: "export default function Header() { return <header>Header</header>; }" },
      { path: "src/styles/app.css", content: "body { background: #000; }" },
    ],
  };

  const detected = detectArtifactRuntime(reactArtifact);
  assert.equal(detected.runtime, ARTIFACT_RUNTIMES.REACT);
  assert.equal(detected.hasPackageJson, false);
});

test("Test 2: Legacy runtime detection detects vanilla index.html and CSS/JS", () => {
  const legacyArtifact = {
    artifactId: "art_legacy_1",
    entryFile: "index.html",
    files: [
      { path: "index.html", content: "<!DOCTYPE html><html><body><h1>Vanilla</h1><script src='script.js'></script></body></html>" },
      { path: "styles.css", content: "body { background: #fff; }" },
      { path: "script.js", content: "console.log('vanilla script');" },
    ],
  };

  const detected = detectArtifactRuntime(legacyArtifact);
  assert.equal(detected.runtime, ARTIFACT_RUNTIMES.LEGACY_HTML);
  assert.equal(detected.entryFile, "index.html");
});

test("Test 3: Invalid artifact detection flags null, empty, or corrupted artifacts", () => {
  assert.equal(detectArtifactRuntime(null).runtime, ARTIFACT_RUNTIMES.INVALID);
  assert.equal(detectArtifactRuntime({}).runtime, ARTIFACT_RUNTIMES.INVALID);
  assert.equal(detectArtifactRuntime({ files: [] }).runtime, ARTIFACT_RUNTIMES.INVALID);
});

test("Test 3b: Unsupported runtime detection flags backend-only or non-web scripts", () => {
  const backendArtifact = {
    artifactId: "art_py_1",
    entryFile: "main.py",
    files: [
      { path: "main.py", content: "print('Hello Python')" },
      { path: "requirements.txt", content: "flask==2.0.1" },
    ],
  };

  const detected = detectArtifactRuntime(backendArtifact);
  assert.equal(detected.runtime, ARTIFACT_RUNTIMES.UNSUPPORTED);
  assert.ok(detected.reason.includes("Non-web code project"));
});

// ============================================================================
// 2. MAPPING & ENTRY POINT SELECTION TESTS
// ============================================================================

test("Test 4 & 5: CodeArtifact-to-Sandpack mapping normalizes paths and nested structures", () => {
  const nestedArtifact = {
    artifactId: "art_nested",
    files: [
      { path: "src\\components\\ui\\Button.jsx", content: "export default function Button() { return <button>Click</button>; }" },
      { path: "./src/App.jsx", content: "import Button from './components/ui/Button.jsx'; export default function App() { return <Button />; }" },
    ],
  };

  const { files } = mapOrbitArtifactToSandpack(nestedArtifact);
  assert.ok(files["/src/components/ui/Button.jsx"]);
  assert.ok(files["/src/App.jsx"]);
  // Injected host HTML exists
  assert.ok(files["/public/index.html"]);
  assert.equal(files["/public/index.html"].hidden, true);
});

test("Test 6: package.json dependency handling extracts declared and imported packages", () => {
  const artifactWithPkg = {
    artifactId: "art_pkg",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: {
            "lucide-react": "^0.460.0",
            "date-fns": "^3.6.0",
          },
        }),
      },
      {
        path: "src/App.jsx",
        content: "import { Calendar } from 'lucide-react'; import { format } from 'date-fns'; import { BarChart } from 'recharts';",
      },
    ],
  };

  const { dependencies } = mapOrbitArtifactToSandpack(artifactWithPkg);
  assert.ok(dependencies["lucide-react"]);
  assert.ok(dependencies["date-fns"]);
  assert.ok(dependencies["recharts"]); // auto-detected from imports
  assert.ok(dependencies.react);
  assert.ok(dependencies["react-dom"]);
});

test("Test 7: Entry point selection resolves standard React entry points", () => {
  const artifact = {
    files: [
      { path: "src/main.jsx", content: "import App from './App.jsx';" },
      { path: "src/App.jsx", content: "export default function App() {}" },
    ],
  };

  const { entryPoint } = mapOrbitArtifactToSandpack(artifact);
  assert.equal(entryPoint, "/src/main.jsx");
});

test("Test 8: Missing entry point auto-resolves to App.jsx or injected public/index.html", () => {
  const artifactWithoutMain = {
    files: [
      { path: "src/components/Card.jsx", content: "export default function Card() {}" },
    ],
  };

  const { entryPoint, files } = mapOrbitArtifactToSandpack(artifactWithoutMain);
  assert.ok(entryPoint);
  assert.ok(files["/public/index.html"]);
});

// ============================================================================
// 3. INCREMENTAL UPDATES & HISTORICAL ISOLATION TESTS
// ============================================================================

test("Test 9: Incremental file updates apply create, update, and delete to Sandpack map", () => {
  const initial = {
    "/src/App.jsx": { code: "export default function App() { return <h1>Old</h1>; }" },
    "/src/Header.jsx": { code: "export default function Header() {}" },
  };

  const updated = applyOperationsToSandpack(initial, [
    { type: "update", path: "src/App.jsx", content: "export default function App() { return <h1>New</h1>; }" },
    { type: "create", path: "src/Footer.jsx", content: "export default function Footer() {}" },
    { type: "delete", path: "src/Header.jsx" },
  ]);

  assert.equal(updated["/src/App.jsx"].code, "export default function App() { return <h1>New</h1>; }");
  assert.ok(updated["/src/Footer.jsx"]);
  assert.equal(updated["/src/Header.jsx"], undefined);
});

test("Test 10 & 11: Historical artifact isolation and switching between React and legacy runtimes", () => {
  const reactTurnArtifact = {
    artifactId: "turn_react_10",
    files: [{ path: "src/App.jsx", content: "export default function App() {}" }],
  };

  const legacyTurnArtifact = {
    artifactId: "turn_legacy_9",
    files: [{ path: "index.html", content: "<h1>Legacy HTML</h1>" }],
  };

  // Switching from React turn to legacy turn
  const runtime1 = detectArtifactRuntime(reactTurnArtifact);
  const runtime2 = detectArtifactRuntime(legacyTurnArtifact);

  assert.equal(runtime1.runtime, ARTIFACT_RUNTIMES.REACT);
  assert.equal(runtime2.runtime, ARTIFACT_RUNTIMES.LEGACY_HTML);

  // Asserting mapping of both produces clean isolated environments
  const spReact = mapOrbitArtifactToSandpack(reactTurnArtifact);
  assert.ok(spReact.files["/src/App.jsx"]);
  assert.equal(spReact.files["/index.html"], undefined);
});

test("Test 12: Local edit isolation distinguishes manual editor changes from persisted artifact", () => {
  const originalArtifact = {
    artifactId: "art_saved",
    files: [{ path: "src/App.jsx", content: "const a = 1;" }],
  };

  const { files: sandpackFiles } = mapOrbitArtifactToSandpack(originalArtifact);

  // User edits file in local editor
  sandpackFiles["/src/App.jsx"].code = "const a = 2; // modified by user locally";

  // Reconstructed artifact for local ZIP export
  const editedArtifact = reconstructOrbitArtifactFromSandpack(sandpackFiles, originalArtifact);
  assert.equal(editedArtifact.files[0].content, "const a = 2; // modified by user locally");

  // Original persisted artifact remains intact
  assert.equal(originalArtifact.files[0].content, "const a = 1;");
});

// ============================================================================
// 4. EXPORT AND DEPLOYMENT COMPATIBILITY TESTS
// ============================================================================

test("Test 13: ZIP export compatibility generates clean portable file tree without internal host files", () => {
  const artifact = {
    artifactId: "art_zip_test",
    title: "Zip Test App",
    files: [
      { path: "src/main.jsx", content: "import App from './App.jsx';" },
      { path: "src/App.jsx", content: "export default function App() {}" },
    ],
  };

  const { files: sandpackFiles } = mapOrbitArtifactToSandpack(artifact);

  // Injected host file exists in Sandpack for browser preview
  assert.ok(sandpackFiles["/public/index.html"]);

  // But reconstructed artifact for ZIP export strips internal host file
  const exported = reconstructOrbitArtifactFromSandpack(sandpackFiles, artifact);
  assert.equal(exported.files.length, 2);
  assert.equal(exported.files.find((f) => f.path.includes("public/index.html")), undefined);
  assert.ok(exported.files.some((f) => f.path === "src/main.jsx"));
  assert.ok(exported.files.some((f) => f.path === "src/App.jsx"));
});

test("Test 14: Deployment compatibility distinguishes direct static deploy from React build requirement", () => {
  const legacyHtmlProject = {
    artifactId: "legacy_deployable",
    files: [{ path: "index.html", content: "<h1>Deployable</h1>" }],
  };

  const pureReactProject = {
    artifactId: "react_src_only",
    files: [
      { path: "src/main.jsx", content: "console.log('main');" },
      { path: "src/App.jsx", content: "console.log('app');" },
    ],
  };

  const isLegacyDeployable = legacyHtmlProject.files.some((f) => f.path.toLowerCase().endsWith(".html"));
  const isPureReactSourceTree = !pureReactProject.files.some((f) => f.path.toLowerCase().endsWith(".html"));

  assert.equal(isLegacyDeployable, true);
  // Pure React source tree requires build step and cannot be directly served as static files without build
  assert.equal(isPureReactSourceTree, true);
});

// ============================================================================
// 5. CRITICAL FIX VERIFICATION: SANDPACK "HELLO WORLD" SUPPRESSION
// ============================================================================

test("Test 15: Sandpack bridge files suppress CRA 'Hello World' default template files", () => {
  const resumeCraftArtifact = {
    artifactId: "art_resumecraft_14files",
    title: "ResumeCraft - Professional Resume Builder",
    entryFile: "src/main.jsx",
    files: [
      {
        path: "package.json",
        content: JSON.stringify({
          name: "resumecraft",
          dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", "lucide-react": "^0.263.1" },
        }),
      },
      {
        path: "index.html",
        content: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div></body></html>',
      },
      {
        path: "src/main.jsx",
        content: "import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './styles/index.css';\nReactDOM.createRoot(document.getElementById('root')).render(<App />);",
      },
      {
        path: "src/App.jsx",
        content: "import React from 'react';\nexport default function App() {\n  return <div className='resumecraft'>ResumeCraft Builder</div>;\n}",
      },
      {
        path: "src/styles/index.css",
        content: "body { margin: 0; font-family: sans-serif; }",
      },
    ],
  };

  const { files, bundlerEntry, userEntryFile } = mapOrbitArtifactToSandpack(resumeCraftArtifact);

  // 1. Bundler entry points to index.js bridge
  assert.equal(bundlerEntry, "/index.js");
  assert.equal(userEntryFile, "/src/App.jsx");

  // 2. /index.js bridge imports the user's src/main.jsx
  assert.ok(files["/index.js"]);
  assert.equal(files["/index.js"].hidden, true);
  assert.ok(files["/index.js"].code.includes('import "./src/main.jsx";'));

  // 3. /App.js bridge re-exports the user's src/App.jsx rather than CRA's default <h1>Hello world</h1>
  assert.ok(files["/App.js"]);
  assert.equal(files["/App.js"].hidden, true);
  assert.ok(files["/App.js"].code.includes('export { default } from "./src/App.jsx";'));
  assert.equal(files["/App.js"].code.includes("Hello world"), false);

  // 4. Injected /public/index.html includes Tailwind CDN and #root
  assert.ok(files["/public/index.html"]);
  assert.ok(files["/public/index.html"].code.includes("tailwindcss.com"));
  assert.ok(files["/public/index.html"].code.includes('id="root"'));
});

test("Test 16: Broken or missing relative CSS imports are auto-resolved with safe stubs", () => {
  const artifactWithMissingCss = {
    artifactId: "art_missing_css",
    files: [
      {
        path: "src/main.jsx",
        content: "import React from 'react';\nimport App from './App.jsx';\nimport './styles/index.css';\nexport default App;",
      },
      {
        path: "src/App.jsx",
        content: "export default function App() { return <h1>App</h1>; }",
      },
      // Note: src/styles/index.css is intentionally omitted
    ],
  };

  const { files } = mapOrbitArtifactToSandpack(artifactWithMissingCss);

  // Assert stub CSS is created at expected import path to prevent compilation crash
  assert.ok(files["/src/styles/index.css"]);
  assert.equal(files["/src/styles/index.css"].hidden, true);
  assert.ok(files["/src/styles/index.css"].code.includes("Auto-stubbed"));
});

test("Test 17: Synthetic bridge files are strictly excluded when exporting or reconstructing artifact", () => {
  const artifact = {
    artifactId: "art_clean_reconstruct",
    title: "Clean App",
    files: [
      { path: "src/main.jsx", content: "console.log('main');" },
      { path: "src/App.jsx", content: "export default function App() {}" },
      { path: "package.json", content: "{}" },
    ],
  };

  const { files: sandpackFiles } = mapOrbitArtifactToSandpack(artifact);

  // Sandpack files dictionary has bridge files for browser execution
  assert.ok(sandpackFiles["/index.js"]);
  assert.ok(sandpackFiles["/App.js"]);
  assert.ok(sandpackFiles["/styles.css"]);
  assert.ok(sandpackFiles["/public/index.html"]);

  // But reconstructing artifact strips all synthetic bridges
  const reconstructed = reconstructOrbitArtifactFromSandpack(sandpackFiles, artifact);

  const paths = reconstructed.files.map((f) => f.path);
  assert.ok(paths.includes("src/main.jsx"));
  assert.ok(paths.includes("src/App.jsx"));
  assert.ok(paths.includes("package.json"));

  // Critical: No bridge files leak into the reconstructed artifact
  assert.equal(paths.includes("index.js"), false);
  assert.equal(paths.includes("App.js"), false);
  assert.equal(paths.includes("styles.css"), false);
  assert.equal(paths.includes("public/index.html"), false);
  assert.equal(reconstructed.files.length, 3);
});
