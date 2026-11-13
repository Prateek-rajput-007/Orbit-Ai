import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchProjectVersions,
  fetchProjectVersionDetails,
} from "../src/features/conversations/projectVersionActions.js";
import { mapOrbitArtifactToSandpack } from "../src/lib/orbitSandpackAdapter.js";

// ============================================================================
// PHASE 5: FRONTEND PROJECT VERSION HISTORY & SNAPSHOT INTEGRATION TESTS
// ============================================================================

test("Test 1: projectVersionActions gracefully handles falsy projectId without crashing", async () => {
  const result = await fetchProjectVersions(null);
  assert.deepEqual(result, { versions: [], total: 0 });

  const details = await fetchProjectVersionDetails(null, 1);
  assert.equal(details, null);

  const missingVer = await fetchProjectVersionDetails("proj_123", null);
  assert.equal(missingVer, null);
});

test("Test 2: Historical snapshot preview state derivation is non-destructive", () => {
  const activeArtifact = {
    projectId: "proj_flow_1",
    version: 3,
    versionNumber: 3,
    files: [
      { path: "src/App.jsx", content: "export default function App() { return <div>Active v3</div>; }" },
      { path: "src/feature.jsx", content: "export const Feature = () => <div>Feature v3</div>;" },
    ],
  };

  const historicalSnapshot = {
    projectId: "proj_flow_1",
    version: 1,
    versionNumber: 1,
    files: [
      { path: "src/App.jsx", content: "export default function App() { return <div>Initial v1</div>; }" },
    ],
  };

  // When previewing historical snapshot (previewingVersion = 1):
  let previewingVersion = 1;
  let displayedArtifact = previewingVersion && historicalSnapshot ? historicalSnapshot : activeArtifact;

  assert.equal(displayedArtifact.versionNumber, 1);
  assert.equal(displayedArtifact.files.length, 1);
  assert.equal(displayedArtifact.files[0].content.includes("Initial v1"), true);
  // Active artifact state was NOT mutated
  assert.equal(activeArtifact.versionNumber, 3);
  assert.equal(activeArtifact.files.length, 2);

  // When user exits preview (previewingVersion = null):
  previewingVersion = null;
  displayedArtifact = previewingVersion && historicalSnapshot ? historicalSnapshot : activeArtifact;

  assert.equal(displayedArtifact.versionNumber, 3);
  assert.equal(displayedArtifact.files.length, 2);
  assert.equal(displayedArtifact.files[0].content.includes("Active v3"), true);
});

test("Test 3: Restored historical version creates forward artifact compatible with Sandpack workspace", () => {
  const restoredArtifact = {
    artifactId: "art_restored_5",
    projectId: "proj_flow_1",
    version: 4,
    versionNumber: 4,
    changeType: "RESTORE",
    changeSummary: "Restored from version 1",
    runtimeType: "react",
    entryFile: "src/App.jsx",
    files: [
      {
        path: "src/App.jsx",
        content: "import React from 'react'; export default function App() { return <h1>Restored App</h1>; }",
      },
      {
        path: "package.json",
        content: JSON.stringify({
          dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
        }),
      },
    ],
  };

  const sandpackConfig = mapOrbitArtifactToSandpack(restoredArtifact);
  assert.ok(sandpackConfig.files["/src/App.jsx"]);
  assert.equal(sandpackConfig.files["/src/App.jsx"].code.includes("Restored App"), true);
  assert.equal(sandpackConfig.bundlerEntry, "/index.js");
  assert.ok(sandpackConfig.dependencies.react);
  assert.equal(restoredArtifact.versionNumber, 4);
});

test("Test 4: Version comparison logic handles added, modified, deleted and unchanged files", () => {
  const v1Files = [
    { path: "src/App.jsx", content: "const a = 1;" },
    { path: "src/old.js", content: "old logic" },
    { path: "src/common.css", content: "body { margin: 0; }" },
  ];

  const v2Files = [
    { path: "src/App.jsx", content: "const a = 2;\nconst b = 3;" }, // modified
    { path: "src/newFeature.js", content: "new feature" }, // added
    { path: "src/common.css", content: "body { margin: 0; }" }, // unchanged
    // src/old.js deleted
  ];

  // Emulate diff comparison calculation
  const v1Map = new Map(v1Files.map((f) => [f.path, f.content]));
  const v2Map = new Map(v2Files.map((f) => [f.path, f.content]));

  const added = [];
  const modified = [];
  const unchanged = [];
  const deleted = [];

  for (const [path, content] of v2Map.entries()) {
    if (!v1Map.has(path)) {
      added.push({ path, size: content.length });
    } else if (v1Map.get(path) !== content) {
      modified.push({ path, oldSize: v1Map.get(path).length, newSize: content.length });
    } else {
      unchanged.push({ path });
    }
  }

  for (const [path, content] of v1Map.entries()) {
    if (!v2Map.has(path)) {
      deleted.push({ path, size: content.length });
    }
  }

  assert.equal(added.length, 1);
  assert.equal(added[0].path, "src/newFeature.js");
  assert.equal(modified.length, 1);
  assert.equal(modified[0].path, "src/App.jsx");
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].path, "src/old.js");
  assert.equal(unchanged.length, 1);
  assert.equal(unchanged[0].path, "src/common.css");
});
