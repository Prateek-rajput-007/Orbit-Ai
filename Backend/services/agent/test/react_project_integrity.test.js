import test from "node:test";
import assert from "node:assert/strict";
import {
    validateArtifactIntegrity,
    resolveRelativeImport,
    resolveRelativeImportDetailed,
    extractLocalImportsFromCode,
    synthesizeMissingComponent,
    repairMissingReactImports,
    applyFileOperations,
    normalizeCodeProject,
} from "../utils/codeArtifact.js";
import { PROJECT_RUNTIME_STRATEGIES } from "../utils/projectIntent.js";

// ============================================================================
// SUITE: React Project Integrity Validation & Missing Import Resolution
// ============================================================================

test("Scenario 1: Clean React project with valid relative imports passes with 0 errors", () => {
    const validProject = {
        title: "Clean React App",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "package.json",
                content: JSON.stringify({
                    name: "clean-app",
                    dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
                }),
            },
            {
                path: "index.html",
                content: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
            },
            {
                path: "src/main.jsx",
                content: `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\ncreateRoot(document.getElementById("root")).render(<App />);`,
            },
            {
                path: "src/App.jsx",
                content: `import React from "react";\nimport Header from "./components/Header.jsx";\nexport default function App() { return <Header />; }`,
            },
            {
                path: "src/components/Header.jsx",
                content: `import React from "react";\nexport default function Header() { return <h1>Header</h1>; }`,
            },
        ],
    };

    const integrity = validateArtifactIntegrity(validProject, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, true);
    assert.equal(integrity.errors.length, 0);
});

test("Scenario 2: Missing nested component triggers MISSING_LOCAL_IMPORT with file and importPath", () => {
    const brokenProject = {
        title: "Broken Nested Import",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "package.json",
                content: JSON.stringify({ dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" } }),
            },
            { path: "index.html", content: '<div id="root"></div>' },
            {
                path: "src/main.jsx",
                content: 'import React from "react";\nimport App from "./App.jsx";',
            },
            {
                path: "src/App.jsx",
                content: 'import React from "react";\nimport Card from "./components/cards/Card.jsx";',
            },
            // Note: Card.jsx is missing
        ],
    };

    const integrity = validateArtifactIntegrity(brokenProject, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const err = integrity.errors.find((e) => e.type === "MISSING_LOCAL_IMPORT");
    assert.ok(err, "Should have MISSING_LOCAL_IMPORT error");
    assert.equal(err.file, "src/App.jsx");
    assert.equal(err.importPath, "./components/cards/Card.jsx");
    assert.equal(err.resolvedPath, "src/components/cards/Card.jsx");
});

test("Scenario 3: Missing stylesheet import (side-effect import) triggers error", () => {
    const code = 'import React from "react";\nimport "./styles/theme.css";\nexport default function App() {}';
    const extracted = extractLocalImportsFromCode(code);
    assert.ok(extracted.includes("./styles/theme.css"), "Should extract side-effect CSS import");

    const project = {
        title: "Missing CSS",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            {
                path: "src/main.jsx",
                content: 'import React from "react";\nimport "./styles/theme.css";\nimport App from "./App.jsx";',
            },
            { path: "src/App.jsx", content: 'export default function App() {}' },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const cssErr = integrity.errors.find((e) => e.importPath === "./styles/theme.css");
    assert.ok(cssErr, "Should flag missing stylesheet error");
    assert.equal(cssErr.type, "MISSING_LOCAL_IMPORT");
    assert.equal(cssErr.resolvedPath, "src/styles/theme.css");
});

test("Scenario 4: Missing utility / helper import triggers error", () => {
    const project = {
        title: "Missing Util",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App.jsx";' },
            {
                path: "src/App.jsx",
                content: 'import { formatDate } from "./utils/dateHelper.js";',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const utilErr = integrity.errors.find((e) => e.importPath === "./utils/dateHelper.js");
    assert.ok(utilErr, "Should flag missing utility import");
    assert.equal(utilErr.resolvedPath, "src/utils/dateHelper.js");
});

test("Scenario 5: Extensionless imports (./Button -> src/components/Button.jsx) resolve correctly", () => {
    const project = {
        title: "Extensionless Imports",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App";' },
            {
                path: "src/App.jsx",
                content: 'import Button from "./components/Button";\nexport default function App() { return <Button />; }',
            },
            {
                path: "src/components/Button.jsx",
                content: 'export default function Button() { return <button>Click</button>; }',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, true, "Extensionless imports should resolve to .jsx files");
    assert.equal(integrity.errors.length, 0);
});

test("Scenario 6: Directory index imports (./components -> src/components/index.jsx) resolve correctly", () => {
    const project = {
        title: "Directory Index Imports",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App.jsx";' },
            {
                path: "src/App.jsx",
                content: 'import Components from "./components";',
            },
            {
                path: "src/components/index.jsx",
                content: 'export default function Components() {}',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, true, "Directory index imports should resolve to /index.jsx");
    assert.equal(integrity.errors.length, 0);
});

test("Scenario 7: External npm package imports (lucide-react, react, canvas-confetti) are NOT treated as missing local files", () => {
    const code = `
import React, { useState } from "react";
import { Plus, Trash, Check } from "lucide-react";
import confetti from "canvas-confetti";
import axios from "axios";
import "./App.css";
`;
    const localImports = extractLocalImportsFromCode(code);
    assert.deepEqual(localImports, ["./App.css"], "Only relative imports should be extracted as local files");
    assert.ok(!localImports.includes("lucide-react"));
    assert.ok(!localImports.includes("canvas-confetti"));
    assert.ok(!localImports.includes("axios"));
    assert.ok(!localImports.includes("react"));
});

test("Scenario 8: Dynamic imports (import('./HeavyComponent')) are extracted and validated", () => {
    const code = `
import React, { Suspense, lazy } from "react";
const HeavyModal = lazy(() => import("./components/HeavyModal.jsx"));
`;
    const extracted = extractLocalImportsFromCode(code);
    assert.ok(extracted.includes("./components/HeavyModal.jsx"), "Dynamic imports must be extracted");

    const project = {
        title: "Dynamic Import Test",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: code },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const dynamicErr = integrity.errors.find((e) => e.importPath === "./components/HeavyModal.jsx");
    assert.ok(dynamicErr, "Dynamic import to missing component must trigger error");
});

test("Scenario 9: Re-exports (export { default } from './OtherComponent') are validated", () => {
    const code = `export { default as Button } from "./Button.jsx";\nexport * from "./Card.jsx";`;
    const extracted = extractLocalImportsFromCode(code);
    assert.ok(extracted.includes("./Button.jsx"));
    assert.ok(extracted.includes("./Card.jsx"));

    const project = {
        title: "Re-exports Test",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import { Button } from "./components";' },
            { path: "src/components/index.jsx", content: code },
            { path: "src/components/Button.jsx", content: 'export default function Button() {}' },
            // Card.jsx missing
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const cardErr = integrity.errors.find((e) => e.importPath === "./Card.jsx");
    assert.ok(cardErr, "Re-export of missing module must trigger error");
});

test("Scenario 10: Root-escaping traversal (../../outside.js) triggers PATH_TRAVERSAL error", () => {
    const detailed = resolveRelativeImportDetailed("../../outside.js", "src/App.jsx");
    assert.equal(detailed.isPathTraversal, true);
    assert.equal(detailed.resolvedPath, null);

    const project = {
        title: "Path Traversal Test",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App.jsx";' },
            {
                path: "src/App.jsx",
                content: 'import Malicious from "../../outside.js";',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const traversalErr = integrity.errors.find((e) => e.type === "PATH_TRAVERSAL");
    assert.ok(traversalErr, "Should flag PATH_TRAVERSAL");
    assert.equal(traversalErr.file, "src/App.jsx");
});

test("Scenario 11: Case sensitivity: importing ./button.jsx when file is Button.jsx triggers INCORRECT_CASING", () => {
    const project = {
        title: "Casing Mismatch Test",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App.jsx";' },
            {
                path: "src/App.jsx",
                content: 'import Button from "./components/button.jsx";\nexport default function App() {}',
            },
            {
                path: "src/components/Button.jsx", // Casing is capital B!
                content: 'export default function Button() {}',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(project, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    const casingErr = integrity.errors.find((e) => e.type === "INCORRECT_CASING");
    assert.ok(casingErr, "Should detect INCORRECT_CASING");
    assert.equal(casingErr.file, "src/App.jsx");
    assert.equal(casingErr.importPath, "./components/button.jsx");
    assert.equal(casingErr.resolvedPath, "src/components/Button.jsx");
});

test("Scenario 12: Incremental update corrupting project preserves previous valid artifact", () => {
    const existingValidProject = {
        artifactId: "code_valid_123",
        title: "Stable App",
        description: "Stable project before broken update",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            { path: "src/main.jsx", content: 'import App from "./App.jsx";' },
            { path: "src/App.jsx", content: 'export default function App() { return <h1>Stable</h1>; }' },
        ],
    };

    // Incremental operation attempts to update App.jsx with an unresolvable path traversal import
    const brokenUpdatePayload = {
        operations: [
            {
                type: "update",
                path: "src/App.jsx",
                content: 'import EscapedModule from "../../escaped.js";\nexport default function App() {}',
            },
        ],
    };

    const result = applyFileOperations(
        existingValidProject,
        brokenUpdatePayload,
        "Add service",
        PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION
    );

    // It should have safely preserved the existing valid project!
    assert.ok(result, "Result must not be null");
    assert.equal(result.baseArtifactId, existingValidProject.artifactId);
    const appFile = result.files.find((f) => f.path === "src/App.jsx");
    // Verify App.jsx was not corrupted with the unresolvable import
    assert.ok(appFile.content.includes("Stable"), "App.jsx should remain uncorrupted");
});

test("Scenario 13: Automatic repair resolves missing components/styles and yields valid artifact", () => {
    const brokenArtifact = {
        artifactId: "code_broken_1",
        title: "Repairable App",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<div id="root"></div>' },
            {
                path: "src/main.jsx",
                content: 'import React from "react";\nimport "./styles/index.css";\nimport App from "./App.jsx";',
            },
            {
                path: "src/App.jsx",
                content: 'import React from "react";\nimport SettingsForm from "./components/SettingsForm.jsx";\nexport default function App() { return <SettingsForm />; }',
            },
        ],
    };

    const initialIntegrity = validateArtifactIntegrity(brokenArtifact, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(initialIntegrity.valid, false);
    assert.equal(initialIntegrity.errors.length, 2);

    const repaired = repairMissingReactImports(brokenArtifact, initialIntegrity, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(repaired, "Artifact should be successfully repaired");

    const repairedIntegrity = validateArtifactIntegrity(repaired, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(repairedIntegrity.valid, true, "Repaired project must pass integrity check with 0 errors");

    const cssFile = repaired.files.find((f) => f.path === "src/styles/index.css");
    assert.ok(cssFile, "Synthesized src/styles/index.css must be present");
    assert.ok(cssFile.content.includes("@tailwind"));

    const formFile = repaired.files.find((f) => f.path === "src/components/SettingsForm.jsx");
    assert.ok(formFile, "Synthesized src/components/SettingsForm.jsx must be present");
    assert.ok(formFile.content.includes("export default function SettingsForm"));
});

test("Scenario 14: Exact ResumeEditor + ProjectsForm / CertificationsForm / ResumePreview / styles/index.css scenario", () => {
    // Recreate the exact ResumeCraft Resume Builder project structure that caused the Sandpack error
    const resumeProject = {
        artifactId: "code_resumebuilder_test",
        title: "ResumeCraft Resume Builder",
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
                content: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
            },
            {
                path: "src/main.jsx",
                content: `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles/index.css";\nReactDOM.createRoot(document.getElementById("root")).render(<App />);`,
            },
            {
                path: "src/App.jsx",
                content: `import React from "react";\nimport ResumeEditor from "./components/ResumeEditor.jsx";\nexport default function App() { return <ResumeEditor />; }`,
            },
            {
                path: "src/components/ResumeEditor.jsx",
                content: `import React from "react";
import PersonalInfoForm from "./forms/PersonalInfoForm.jsx";
import ProjectsForm from "./forms/ProjectsForm.jsx";
import CertificationsForm from "./forms/CertificationsForm.jsx";
import ResumePreview from "./ResumePreview.jsx";

export default function ResumeEditor() {
  return (
    <div>
      <PersonalInfoForm />
      <ProjectsForm />
      <CertificationsForm />
      <ResumePreview />
    </div>
  );
}`,
            },
            {
                path: "src/components/forms/PersonalInfoForm.jsx",
                content: `export default function PersonalInfoForm() { return <div>Personal Info</div>; }`,
            },
            // Note: ProjectsForm.jsx, CertificationsForm.jsx, ResumePreview.jsx, and styles/index.css are omitted by LLM!
        ],
    };

    // 1. Validate that the integrity gate catches all 4 missing files
    const validation = validateArtifactIntegrity(resumeProject, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(validation.valid, false, "Must detect project as invalid");
    assert.equal(validation.errors.length, 4, "Must identify all 4 missing files");

    const errorPaths = validation.errors.map((e) => e.resolvedPath);
    assert.ok(errorPaths.includes("src/styles/index.css"));
    assert.ok(errorPaths.includes("src/components/forms/ProjectsForm.jsx"));
    assert.ok(errorPaths.includes("src/components/forms/CertificationsForm.jsx"));
    assert.ok(errorPaths.includes("src/components/ResumePreview.jsx"));

    // 2. Perform automated repair
    const repaired = repairMissingReactImports(resumeProject, validation, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(repaired, "Must repair Resume Builder application");

    // 3. Confirm 100% integrity validation on repaired project
    const finalValidation = validateArtifactIntegrity(repaired, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(finalValidation.valid, true, "Repaired project must pass with 0 errors");
    assert.equal(finalValidation.errors.length, 0);

    // 4. Verify all synthesized components are complete, high-quality, and functional
    const projectsForm = repaired.files.find((f) => f.path === "src/components/forms/ProjectsForm.jsx");
    assert.ok(projectsForm.content.includes("export default function ProjectsForm"));
    assert.ok(projectsForm.content.includes("addProject"));

    const certsForm = repaired.files.find((f) => f.path === "src/components/forms/CertificationsForm.jsx");
    assert.ok(certsForm.content.includes("export default function CertificationsForm"));
    assert.ok(certsForm.content.includes("addCert"));

    const preview = repaired.files.find((f) => f.path === "src/components/ResumePreview.jsx");
    assert.ok(preview.content.includes("export default function ResumePreview"));
    assert.ok(preview.content.includes("Work Experience"));

    const css = repaired.files.find((f) => f.path === "src/styles/index.css");
    assert.ok(css.content.includes("@tailwind base"));
    assert.ok(css.content.includes("@media print"));
});
