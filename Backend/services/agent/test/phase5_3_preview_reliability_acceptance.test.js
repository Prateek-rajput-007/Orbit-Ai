import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    checkFileSyntax,
    repairCodeFileSyntax,
    repairMissingReactImports,
    validateArtifactIntegrity,
    synthesizeMissingComponent,
} from "../utils/codeArtifact.js";
import {
    mapOrbitArtifactToSandpack,
    reconstructOrbitArtifactFromSandpack,
    extractSandpackDependencies,
} from "../../../../Frontend/src/lib/orbitSandpackAdapter.js";

describe("Phase 5.3: Preview Reliability & Functional Preservation Acceptance Audit", () => {
    describe("1. Truncated JSX Syntax Detection & Non-Destructive In-Place Repair", () => {
        it("Test 1: Truncated JSX Element (<button onClick={addEntry)", () => {
            const broken = `import React from "react";
export default function ActionButton({ addEntry }) {
  return (
    <div>
      <button
        onClick={addEntry`;
            const checkInitial = checkFileSyntax("src/components/ActionButton.jsx", broken);
            assert.equal(checkInitial.valid, false, "Initial broken snippet must fail syntax check");

            const repaired = repairCodeFileSyntax("src/components/ActionButton.jsx", broken);
            assert.ok(repaired, "repairCodeFileSyntax must return repaired code");
            const checkRepaired = checkFileSyntax("src/components/ActionButton.jsx", repaired);
            assert.equal(checkRepaired.valid, true, "Repaired code must have valid syntax");
            assert.ok(repaired.includes("addEntry"), "Original addEntry prop must be preserved");
        });

        it("Test 1b (Screenshot Reproduction): Unclosed button on separate lines", () => {
            const broken = `import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export default function WorkExperienceForm({ data, onChange }) {
  const [entries, setEntries] = useState(data || []);
  const addEntry = () => setEntries([...entries, { company: "", position: "" }]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold">Experience</h2>
      <button
        onClick={addEntry}
`;
            const checkInitial = checkFileSyntax("src/components/forms/WorkExperienceForm.jsx", broken);
            assert.equal(checkInitial.valid, false, "Screenshot syntax error must fail syntax check");

            const repaired = repairCodeFileSyntax("src/components/forms/WorkExperienceForm.jsx", broken);
            assert.ok(repaired, "Must repair screenshot syntax error");
            const checkRepaired = checkFileSyntax("src/components/forms/WorkExperienceForm.jsx", repaired);
            assert.equal(checkRepaired.valid, true, "Repaired WorkExperienceForm must compile cleanly");
            assert.ok(repaired.includes("setEntries"), "Must preserve setEntries state handler");
            assert.ok(repaired.includes("addEntry"), "Must preserve addEntry handler");
            assert.ok(repaired.includes("company"), "Must preserve company data structure");
        });

        it("Test 2: Missing closing JSX tag", () => {
            const broken = `import React from "react";
export default function Card() {
  return (
    <div className="card">
      <h2>Title</h2>
      <p>Content
  );`;
            const checkInitial = checkFileSyntax("src/components/Card.jsx", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/components/Card.jsx", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/components/Card.jsx", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(repaired.includes("<div className=\"card\">"));
            assert.ok(repaired.includes("<h2>Title</h2>"));
        });

        it("Test 3: Unclosed string literal", () => {
            const broken = `export const APP_NAME = "ResumeCraft;\nexport const VERSION = "1.0.0";`;
            const checkInitial = checkFileSyntax("src/utils/constants.js", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/utils/constants.js", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/utils/constants.js", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(repaired.includes("ResumeCraft"));
        });

        it("Test 4: Missing closing bracket / brace", () => {
            const broken = `import React, { useState } from "react";
export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
`;
            // Missing component closing brace
            const checkInitial = checkFileSyntax("src/components/Counter.jsx", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/components/Counter.jsx", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/components/Counter.jsx", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(repaired.includes("useSetState") === false);
            assert.ok(repaired.includes("useState(0)"));
        });

        it("Test 5: Invalid import/export syntax", () => {
            const broken = `import { from "react";
import React, { useState } from "react";
export default function App() {
  return <div>App</div>;
}`;
            const checkInitial = checkFileSyntax("src/App.jsx", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/App.jsx", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/App.jsx", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(!repaired.includes("import { from"));
            assert.ok(repaired.includes("export default function App"));
        });

        it("Test 6: Incomplete arrow function", () => {
            const broken = `import { useState } from "react";
export const useToggle = (initial = false) => {
  const [val, setVal] = useState(initial);
  const toggle = () => {
`;
            const checkInitial = checkFileSyntax("src/hooks/useToggle.js", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/hooks/useToggle.js", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/hooks/useToggle.js", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(repaired.includes("setVal"));
        });

        it("Test 7: Broken component return statement", () => {
            const broken = `import React from "react";
export default function Header() {
  return (
    <header className="p-4 bg-slate-900 text-white">
      <h1>ResumeCraft SaaS</h1>
`;
            const checkInitial = checkFileSyntax("src/components/Header.jsx", broken);
            assert.equal(checkInitial.valid, false);

            const repaired = repairCodeFileSyntax("src/components/Header.jsx", broken);
            assert.ok(repaired);
            const checkRepaired = checkFileSyntax("src/components/Header.jsx", repaired);
            assert.equal(checkRepaired.valid, true);
            assert.ok(repaired.includes("ResumeCraft SaaS"));
        });
    });

    describe("2. Functional Preservation Verification (ResumeCraft)", () => {
        it("Test 8: Preserves all rich form logic during auto-repair rather than blanking out", () => {
            const fullResumeForm = `import React, { useState } from "react";
import { Plus, Trash2, Briefcase } from "lucide-react";

export default function WorkExperienceForm({ data = [], onChange }) {
  const [items, setItems] = useState(data);

  const addItem = () => {
    const next = [...items, { id: Date.now(), company: "Acme Corp", position: "Lead Engineer", startDate: "2022", endDate: "Present" }];
    setItems(next);
    onChange?.(next);
  };

  const removeItem = (id) => {
    const next = items.filter(it => it.id !== id);
    setItems(next);
    onChange?.(next);
  };

  return (
    <section className="p-4 border rounded-xl bg-white shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Briefcase size={18} /> Work Experience
        </h3>
        <button
          type="button"
          onClick={addItem}
          className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
        >
          <Plus size={14} className="inline mr-1" /> Add Job
        </button>
      </div>
      {items.map(item => (
        <div key={item.id} className="p-3 mb-2 border rounded">
          <input
            value={item.company}
            placeholder="Company"
            className="w-full border p-1 rounded mb-2"
          />
          <button
            onClick={() => removeItem(item.id)}
`; // Intentionally truncated at button onClick

            const brokenArtifact = {
                artifactId: "resumecraft-001",
                entryFile: "src/main.jsx",
                previewType: "react",
                files: [
                    {
                        path: "src/main.jsx",
                        content: `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\ncreateRoot(document.getElementById("root")).render(<App />);`,
                        language: "jsx",
                        size: 150,
                    },
                    {
                        path: "src/App.jsx",
                        content: `import React from "react";\nimport WorkExperienceForm from "./components/forms/WorkExperienceForm.jsx";\nexport default function App() { return <WorkExperienceForm />; }`,
                        language: "jsx",
                        size: 150,
                    },
                    {
                        path: "src/components/forms/WorkExperienceForm.jsx",
                        content: fullResumeForm,
                        language: "jsx",
                        size: Buffer.byteLength(fullResumeForm, "utf8"),
                    },
                    {
                        path: "package.json",
                        content: JSON.stringify({
                            dependencies: { react: "^18.3.1", "react-dom": "^18.3.1", "lucide-react": "^0.460.0" },
                        }),
                        language: "json",
                        size: 100,
                    },
                ],
            };

            const integrity = validateArtifactIntegrity(brokenArtifact, "react-sandpack");
            assert.equal(integrity.valid, false, "Initial artifact must fail due to truncated syntax");

            const repairedArtifact = repairMissingReactImports(brokenArtifact, integrity, "react-sandpack");
            assert.ok(repairedArtifact, "Must successfully repair artifact");
            assert.equal(repairedArtifact.integrity?.valid, true, "Repaired artifact integrity must be valid");

            const repairedFile = repairedArtifact.files.find((f) => f.path.includes("WorkExperienceForm.jsx"));
            assert.ok(repairedFile, "WorkExperienceForm.jsx must exist in repaired artifact");

            // Verify functional preservation
            assert.ok(repairedFile.content.includes("addItem"), "Must preserve addItem logic");
            assert.ok(repairedFile.content.includes("removeItem"), "Must preserve removeItem logic");
            assert.ok(repairedFile.content.includes("Acme Corp"), "Must preserve default company data");
            assert.ok(repairedFile.content.includes("Lead Engineer"), "Must preserve position data");
            assert.ok(repairedFile.content.includes("Briefcase"), "Must preserve Briefcase icon");
        });
    });

    describe("3. File Tree Visibility & Multi-folder Structure", () => {
        it("Test 9: Multi-folder structure preserves all user files and hides internal bridge files", () => {
            const multiFolderArtifact = {
                artifactId: "resumecraft-multitree",
                title: "ResumeCraft SaaS",
                entryFile: "src/main.jsx",
                previewType: "react",
                files: [
                    { path: "src/main.jsx", content: 'import React from "react";\nimport "./styles/index.css";\nexport default function Main() {}', language: "jsx" },
                    { path: "src/App.jsx", content: 'import React from "react";\nimport Header from "./components/layout/Header.jsx";\nexport default function App() {}', language: "jsx" },
                    { path: "src/components/layout/Header.jsx", content: 'export default function Header() {}', language: "jsx" },
                    { path: "src/components/forms/PersonalInfoForm.jsx", content: 'export default function PersonalInfoForm() {}', language: "jsx" },
                    { path: "src/components/forms/WorkExperienceForm.jsx", content: 'export default function WorkExperienceForm() {}', language: "jsx" },
                    { path: "src/hooks/useResume.js", content: 'export const useResume = () => ({});', language: "javascript" },
                    { path: "src/utils/pdfExport.js", content: 'export const exportToPdf = () => {};', language: "javascript" },
                    { path: "src/constants/templates.js", content: 'export const TEMPLATES = ["modern", "classic"];', language: "javascript" },
                    { path: "src/styles/index.css", content: 'body { margin: 0; }', language: "css" },
                    { path: "package.json", content: '{"dependencies": {"react": "^18.3.1"}}', language: "json" },
                ],
            };

            const sandpackSetup = mapOrbitArtifactToSandpack(multiFolderArtifact);
            const sandpackKeys = Object.keys(sandpackSetup.files);

            // User files must all be present without hidden flag
            const expectedUserPaths = [
                "/src/main.jsx",
                "/src/App.jsx",
                "/src/components/layout/Header.jsx",
                "/src/components/forms/PersonalInfoForm.jsx",
                "/src/components/forms/WorkExperienceForm.jsx",
                "/src/hooks/useResume.js",
                "/src/utils/pdfExport.js",
                "/src/constants/templates.js",
                "/src/styles/index.css",
                "/package.json",
            ];

            for (const expected of expectedUserPaths) {
                assert.ok(sandpackKeys.includes(expected), `Missing user file in Sandpack map: ${expected}`);
                assert.notEqual(
                    sandpackSetup.files[expected]?.hidden,
                    true,
                    `User file must NOT be marked hidden: ${expected}`
                );
            }

            // Internal bridge files must be marked hidden: true and bridge: true
            const internalBridges = ["/index.js", "/App.js", "/styles.css", "/public/index.html"];
            for (const bridge of internalBridges) {
                assert.ok(sandpackKeys.includes(bridge), `Missing bridge file: ${bridge}`);
                assert.equal(sandpackSetup.files[bridge]?.hidden, true, `Bridge file must be hidden: ${bridge}`);
                assert.equal(sandpackSetup.files[bridge]?.bridge, true, `Bridge file must have bridge flag: ${bridge}`);
            }

            // Reconstructing portable artifact must strip internal bridge files
            const reconstructed = reconstructOrbitArtifactFromSandpack(sandpackSetup.files, multiFolderArtifact);
            const reconstructedPaths = reconstructed.files.map((f) => f.path);
            assert.ok(!reconstructedPaths.includes("index.js"), "Reconstructed artifact must NOT contain bridge index.js");
            assert.ok(!reconstructedPaths.includes("App.js"), "Reconstructed artifact must NOT contain bridge App.js");
            assert.ok(!reconstructedPaths.includes("styles.css"), "Reconstructed artifact must NOT contain bridge styles.css");
            assert.ok(!reconstructedPaths.includes("public/index.html"), "Reconstructed artifact must NOT contain public/index.html");
            assert.equal(reconstructed.files.length, multiFolderArtifact.files.length, "Reconstructed file count must match original user files count exactly");
        });
    });

    describe("4. Sandpack Adapter Height & Responsive CSS Resilience", () => {
        it("Test 10: Sandpack bridge CSS and public HTML enforce 100% full-height container", () => {
            const artifact = {
                artifactId: "resumecraft-css",
                title: "ResumeCraft Full-Height Test",
                files: [
                    { path: "src/App.jsx", content: "export default function App() { return <div>App</div>; }" },
                ],
            };

            const sandpackSetup = mapOrbitArtifactToSandpack(artifact);

            // Check public/index.html
            const publicHtml = sandpackSetup.files["/public/index.html"]?.code || "";
            assert.ok(publicHtml.includes("height: 100%"), "public/index.html must specify height: 100%");
            assert.ok(publicHtml.includes("min-height: 100%"), "public/index.html must specify min-height: 100%");
            assert.ok(publicHtml.includes('id="root"'), "public/index.html must include root mount point");

            // Check styles.css
            const stylesCss = sandpackSetup.files["/styles.css"]?.code || "";
            assert.ok(stylesCss.includes("height: 100%"), "styles.css must enforce height: 100%");
            assert.ok(stylesCss.includes("min-height: 100%"), "styles.css must enforce min-height: 100%");
            assert.ok(stylesCss.includes("box-sizing: border-box"), "styles.css must set box-sizing: border-box");
        });
    });
});

