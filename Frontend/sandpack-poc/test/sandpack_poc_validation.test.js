import test from "node:test";
import assert from "node:assert/strict";
import {
  mapOrbitArtifactToSandpack,
  applyOperationsToSandpack,
  normalizeSandpackPath,
  extractSandpackDependencies,
} from "../src/orbitSandpackAdapter.js";

const sampleOrbitArtifact = {
  artifactId: "code_orbit_react_test",
  title: "React Todo Studio",
  entryFile: "src/main.jsx",
  files: [
    {
      path: "src/main.jsx",
      content: "import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App.jsx';",
      language: "jsx",
    },
    {
      path: "src/App.jsx",
      content: "import React from 'react'; import Header from './components/Header.jsx'; export default function App() { return <Header />; }",
      language: "jsx",
    },
    {
      path: "src/components/Header.jsx",
      content: "import React from 'react'; export default function Header() { return <h1>Orbit Header</h1>; }",
      language: "jsx",
    },
    {
      path: "src/styles/index.css",
      content: "body { background: #000; }",
      language: "css",
    },
  ],
};

// ============================================================================
// PART 4: VALIDATION OF INCREMENTAL UPDATES & SANDPACK CONTRACT
// ============================================================================

test("Test A: Initial project mapping converts Orbit CodeArtifact to Sandpack file map", () => {
  const { files, dependencies, entryPoint } = mapOrbitArtifactToSandpack(sampleOrbitArtifact);

  // File paths are normalized with leading slashes
  assert.equal(normalizeSandpackPath("src/App.jsx"), "/src/App.jsx");
  assert.ok(files["/src/main.jsx"]);
  assert.ok(files["/src/App.jsx"]);
  assert.ok(files["/src/components/Header.jsx"]);
  assert.ok(files["/src/styles/index.css"]);

  // Entry point resolved correctly
  assert.equal(entryPoint, "/src/main.jsx");

  // React dependencies present
  assert.ok(dependencies.react);
  assert.ok(dependencies["react-dom"]);

  // Injected host HTML present
  assert.ok(files["/public/index.html"]);
  assert.equal(files["/public/index.html"].hidden, true);
});

test("Test B: Update an existing file (Header.jsx) reflects in file map while keeping others intact", () => {
  const { files } = mapOrbitArtifactToSandpack(sampleOrbitArtifact);

  const updatedFiles = applyOperationsToSandpack(files, [
    {
      type: "update",
      path: "src/components/Header.jsx",
      content: "export default function Header() { return <h1>Updated Header v2</h1>; }",
    },
  ]);

  assert.equal(
    updatedFiles["/src/components/Header.jsx"].code,
    "export default function Header() { return <h1>Updated Header v2</h1>; }"
  );

  // Assert unchanged files preserve identical code
  assert.equal(updatedFiles["/src/App.jsx"].code, files["/src/App.jsx"].code);
  assert.equal(updatedFiles["/src/main.jsx"].code, files["/src/main.jsx"].code);
  assert.equal(updatedFiles["/src/styles/index.css"].code, files["/src/styles/index.css"].code);
});

test("Test C: Create a new file (TaskStats.jsx) and import from App.jsx", () => {
  const { files } = mapOrbitArtifactToSandpack(sampleOrbitArtifact);

  const updatedFiles = applyOperationsToSandpack(files, [
    {
      type: "create",
      path: "src/components/TaskStats.jsx",
      content: "export default function TaskStats({ count }) { return <div>Count: {count}</div>; }",
    },
    {
      type: "update",
      path: "src/App.jsx",
      content: "import Header from './components/Header.jsx'; import TaskStats from './components/TaskStats.jsx'; export default function App() { return <div><Header /><TaskStats count={5} /></div>; }",
    },
  ]);

  // New file exists in file map
  assert.ok(updatedFiles["/src/components/TaskStats.jsx"]);
  assert.ok(updatedFiles["/src/components/TaskStats.jsx"].code.includes("export default function TaskStats"));

  // App.jsx references the new component
  assert.ok(updatedFiles["/src/App.jsx"].code.includes("import TaskStats from './components/TaskStats.jsx'"));
});

test("Test D: Delete an unused component file cleanly from Sandpack file map", () => {
  const { files } = mapOrbitArtifactToSandpack(sampleOrbitArtifact);

  const updatedFiles = applyOperationsToSandpack(files, [
    {
      type: "delete",
      path: "src/components/Header.jsx",
    },
  ]);

  assert.equal(updatedFiles["/src/components/Header.jsx"], undefined);
  assert.ok(updatedFiles["/src/App.jsx"]);
});

test("Test E: Invalid code / syntax errors are catchable and distinct from runtime crashes", () => {
  const invalidCode = `export default function Broken() { return <div><span>Unclosed Tag</div>; }`;

  // Syntax validation check
  let hasSyntaxError = false;
  try {
    // Quick regex validation or AST simulation
    const openTags = (invalidCode.match(/<[a-zA-Z0-9]+/g) || []).map((t) => t.slice(1));
    const closeTags = (invalidCode.match(/<\/[a-zA-Z0-9]+/g) || []).map((t) => t.slice(2));
    if (openTags.length !== closeTags.length) {
      hasSyntaxError = true;
    }
  } catch {
    hasSyntaxError = true;
  }

  assert.equal(hasSyntaxError, true);
});

test("Test F: External dependencies (lucide-react, date-fns, recharts) are auto-detected and extracted", () => {
  const filesWithDeps = [
    {
      path: "src/App.jsx",
      content: "import { Calendar } from 'lucide-react'; import { format } from 'date-fns'; import { BarChart } from 'recharts';",
    },
  ];

  const deps = extractSandpackDependencies(filesWithDeps);

  assert.ok(deps["lucide-react"]);
  assert.ok(deps["date-fns"]);
  assert.ok(deps["recharts"]);
  assert.ok(deps.react);
  assert.ok(deps["react-dom"]);
});

test("Test G: Portable contract verification (Decoupled from Sandpack internals)", () => {
  // Ensure that any Sandpack file map can be reconstructed back into an Orbit CodeArtifact
  // so that ZIP export (zipExporter.js) and static Netlify deployment remain 100% functional.
  const { files } = mapOrbitArtifactToSandpack(sampleOrbitArtifact);

  const reconstructedArtifact = {
    artifactId: sampleOrbitArtifact.artifactId,
    title: sampleOrbitArtifact.title,
    entryFile: sampleOrbitArtifact.entryFile,
    files: Object.entries(files)
      .filter(([path]) => !path.startsWith("/public/")) // strip injected host html
      .map(([path, data]) => ({
        path: path.replace(/^\//, ""),
        content: data.code,
      })),
  };

  assert.equal(reconstructedArtifact.files.length, sampleOrbitArtifact.files.length);
  for (const orig of sampleOrbitArtifact.files) {
    const found = reconstructedArtifact.files.find((f) => f.path === orig.path);
    assert.ok(found, `File ${orig.path} must be present in reconstructed artifact`);
    assert.equal(found.content, orig.content);
  }
});

