import test from "node:test";
import assert from "node:assert/strict";
import {
    determineProjectRuntimeStrategy,
    classifyProjectIntent,
    PROJECT_INTENTS,
    PROJECT_RUNTIME_STRATEGIES,
    isArtifactReactProject,
} from "../utils/projectIntent.js";
import {
    parseCodeArtifact,
    normalizeCodeProject,
    applyFileOperations,
    isReactProject,
    extractNpmDependenciesFromCode,
    resolveRelativeImport,
    syncReactDependencies,
    ensureReactHtmlShell,
    validateArtifactIntegrity,
} from "../utils/codeArtifact.js";
import { detectArtifactRuntime, ARTIFACT_RUNTIMES } from "../../../../Frontend/src/lib/detectArtifactRuntime.js";
import { mapOrbitArtifactToSandpack, reconstructOrbitArtifactFromSandpack } from "../../../../Frontend/src/lib/orbitSandpackAdapter.js";

// ============================================================================
// PART 1: RUNTIME STRATEGY SELECTION & INTENT TESTS
// ============================================================================

test("Test 1a: Modern application requests default to REACT_APPLICATION", () => {
    const prompts = [
        "Build a modern Resume Builder SaaS application using React.",
        "Build an admin dashboard with analytics",
        "Create an e-commerce frontend store",
        "Build a project management kanban app",
        "Create a Spotify clone music player",
    ];

    for (const prompt of prompts) {
        const strategy = determineProjectRuntimeStrategy(prompt, null);
        assert.equal(
            strategy,
            PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION,
            `Expected ${prompt} to select REACT_APPLICATION`
        );
    }
});

test("Test 1b: Vanilla HTML/JS requests select LEGACY_WEB_APPLICATION", () => {
    const legacyPrompts = [
        "Make a simple HTML landing page",
        "Build a vanilla JavaScript calculator",
        "Create a pure HTML and CSS portfolio site",
        "Build a static website without react",
    ];

    for (const prompt of legacyPrompts) {
        const strategy = determineProjectRuntimeStrategy(prompt, null);
        assert.equal(
            strategy,
            PROJECT_RUNTIME_STRATEGIES.LEGACY_WEB_APPLICATION,
            `Expected ${prompt} to select LEGACY_WEB_APPLICATION`
        );
    }
});

test("Test 1c: Modifying existing project preserves its runtime strategy", () => {
    const existingReactArtifact = {
        artifactId: "art_react_001",
        title: "Resume Builder",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0"}}' },
            { path: "src/main.jsx", content: "import React from 'react';" },
            { path: "src/App.jsx", content: "export default function App() {}" },
        ],
    };

    const existingLegacyArtifact = {
        artifactId: "art_legacy_001",
        title: "Landing Page",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Hello</h1>" },
            { path: "style.css", content: "body { color: red; }" },
            { path: "script.js", content: "console.log('hi');" },
        ],
    };

    // Follow-up to React app preserves React
    const reactFollowUp = determineProjectRuntimeStrategy("Add dark mode", existingReactArtifact);
    assert.equal(reactFollowUp, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);

    // Follow-up to Legacy app preserves Legacy
    const legacyFollowUp = determineProjectRuntimeStrategy("Update button color", existingLegacyArtifact);
    assert.equal(legacyFollowUp, PROJECT_RUNTIME_STRATEGIES.LEGACY_WEB_APPLICATION);

    // Explicit migration request upgrades legacy to React
    const migration = determineProjectRuntimeStrategy("Migrate this project to React", existingLegacyArtifact);
    assert.equal(migration, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
});

// ============================================================================
// PART 2: REACT ARTIFACT SCHEMA & VALIDATION TESTS
// ============================================================================

test("Test 2: normalizeCodeProject ensures package.json and HTML shell for React projects", () => {
    const rawReactProject = {
        title: "Todo React",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "src/main.jsx",
                content: `import React, { StrictMode } from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);`,
            },
            {
                path: "src/App.jsx",
                content: `import React from 'react';\nimport { Check } from 'lucide-react';\nexport default function App() { return <h1><Check /> Todo</h1>; }`,
            },
        ],
    };

    const normalized = normalizeCodeProject(rawReactProject, "Build a React todo app", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);

    // package.json was auto-synthesized with React and detected lucide-react
    const pkg = normalized.files.find((f) => f.path === "package.json");
    assert.ok(pkg, "package.json should exist");
    const parsedPkg = JSON.parse(pkg.content);
    assert.equal(parsedPkg.dependencies.react, "^18.2.0");
    assert.equal(parsedPkg.dependencies["react-dom"], "^18.2.0");
    assert.equal(parsedPkg.dependencies["lucide-react"], "^0.263.1");

    // index.html was auto-synthesized with root div
    const html = normalized.files.find((f) => f.path === "index.html");
    assert.ok(html, "index.html should exist");
    assert.ok(html.content.includes('<div id="root"></div>'));

    assert.equal(normalized.entryFile, "src/main.jsx");
    assert.equal(normalized.previewType, "html");
});

test("Test 3: Relative import resolution and missing local import detection", () => {
    // Relative path resolution tests
    assert.equal(resolveRelativeImport("./components/Header.jsx", "src/App.jsx"), "src/components/Header.jsx");
    assert.equal(resolveRelativeImport("../styles/index.css", "src/components/Card.jsx"), "src/styles/index.css");
    assert.equal(resolveRelativeImport("./App.jsx", "src/main.jsx"), "src/App.jsx");

    // Static integrity check on artifact with missing relative import
    const brokenArtifact = {
        files: [
            {
                path: "src/main.jsx",
                content: "import React from 'react'; import App from './App.jsx';",
            },
            // Note: src/App.jsx is intentionally missing!
            {
                path: "package.json",
                content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}',
            },
        ],
    };

    const integrity = validateArtifactIntegrity(brokenArtifact, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    assert.ok(integrity.errors.some((e) => e.includes("Missing relative import") && e.includes("./App.jsx")));
});

// ============================================================================
// PART 3: COMPLETE RESUME BUILDER REACT APP GENERATION
// ============================================================================

test("Test 4: Generates a complete, multi-file Resume Builder React SaaS application", () => {
    const resumeBuilderRaw = {
        title: "Orbit Resume Builder SaaS",
        description: "Professional multi-template Resume Builder with live preview and PDF export",
        summary: "Modular React SPA featuring personal info, education, work experience, skill editors, template switching, and responsive design.",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "package.json",
                content: JSON.stringify({
                    name: "orbit-resume-builder",
                    version: "1.0.0",
                    private: true,
                    dependencies: {
                        react: "^18.2.0",
                        "react-dom": "^18.2.0",
                        "lucide-react": "^0.263.1",
                    },
                }, null, 2),
                language: "json",
            },
            {
                path: "index.html",
                content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Orbit Resume Builder</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-slate-950 text-slate-100 min-h-screen">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>`,
                language: "html",
            },
            {
                path: "src/main.jsx",
                content: `import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles/index.css';

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);`,
                language: "jsx",
            },
            {
                path: "src/styles/index.css",
                content: `@media print {
  body { background: white !important; color: black !important; }
  .no-print { display: none !important; }
  .print-area { width: 100% !important; margin: 0 !important; box-shadow: none !important; }
}`,
                language: "css",
            },
            {
                path: "src/components/Dashboard.jsx",
                content: `import React from 'react';
import { FileText, Download, LayoutTemplate } from 'lucide-react';

export default function Dashboard({ activeTemplate, setActiveTemplate, onPrint }) {
  return (
    <header className="no-print h-16 border-b border-slate-800 bg-slate-900 px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <FileText className="text-amber-400 size-6" />
        <h1 className="text-lg font-bold tracking-tight text-white">Orbit Resume Studio</h1>
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setActiveTemplate(activeTemplate === 'modern' ? 'classic' : 'modern')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800 text-xs font-medium text-slate-200 hover:bg-slate-700 transition"
        >
          <LayoutTemplate size={14} />
          <span>Switch to {activeTemplate === 'modern' ? 'Classic' : 'Modern'}</span>
        </button>
        <button
          onClick={onPrint}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-xs font-semibold text-slate-950 transition"
        >
          <Download size={14} />
          <span>Export PDF</span>
        </button>
      </div>
    </header>
  );
}`,
                language: "jsx",
            },
            {
                path: "src/components/PersonalInfoForm.jsx",
                content: `import React from 'react';

export default function PersonalInfoForm({ data, onChange }) {
  return (
    <div className="space-y-3 p-4 rounded-xl border border-slate-800 bg-slate-900/60">
      <h3 className="text-sm font-semibold text-amber-400">Personal Information</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input
          type="text"
          value={data.fullName || ''}
          placeholder="Full Name"
          onChange={(e) => onChange('fullName', e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
        />
        <input
          type="email"
          value={data.email || ''}
          placeholder="Email Address"
          onChange={(e) => onChange('email', e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white"
        />
        <input
          type="text"
          value={data.title || ''}
          placeholder="Professional Title"
          onChange={(e) => onChange('title', e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white sm:col-span-2"
        />
      </div>
    </div>
  );
}`,
                language: "jsx",
            },
            {
                path: "src/templates/ModernTemplate.jsx",
                content: `import React from 'react';

export default function ModernTemplate({ resume }) {
  return (
    <div className="print-area p-8 bg-white text-slate-900 rounded-lg shadow-xl min-h-[600px]">
      <header className="border-b border-slate-200 pb-4 mb-6">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">{resume.personal.fullName || 'Your Name'}</h1>
        <p className="text-sm font-semibold text-amber-600">{resume.personal.title || 'Professional Title'}</p>
        <p className="text-xs text-slate-500 mt-1">{resume.personal.email}</p>
      </header>
    </div>
  );
}`,
                language: "jsx",
            },
            {
                path: "src/templates/ClassicTemplate.jsx",
                content: `import React from 'react';

export default function ClassicTemplate({ resume }) {
  return (
    <div className="print-area p-8 bg-slate-50 text-slate-950 rounded-lg font-serif min-h-[600px]">
      <header className="text-center border-b-2 border-slate-900 pb-4 mb-6">
        <h1 className="text-2xl font-bold uppercase tracking-wider">{resume.personal.fullName || 'Your Name'}</h1>
        <p className="text-xs italic text-slate-700">{resume.personal.email}</p>
      </header>
    </div>
  );
}`,
                language: "jsx",
            },
            {
                path: "src/App.jsx",
                content: `import React, { useState } from 'react';
import Dashboard from './components/Dashboard.jsx';
import PersonalInfoForm from './components/PersonalInfoForm.jsx';
import ModernTemplate from './templates/ModernTemplate.jsx';
import ClassicTemplate from './templates/ClassicTemplate.jsx';

export default function App() {
  const [template, setTemplate] = useState('modern');
  const [resume, setResume] = useState({
    personal: { fullName: 'Alex Mercer', email: 'alex@orbit.dev', title: 'Senior Staff Engineer' },
  });

  const handlePersonalChange = (field, val) => {
    setResume((prev) => ({ ...prev, personal: { ...prev.personal, [field]: val } }));
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      <Dashboard activeTemplate={template} setActiveTemplate={setTemplate} onPrint={handlePrint} />
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="space-y-4 no-print">
          <PersonalInfoForm data={resume.personal} onChange={handlePersonalChange} />
        </section>
        <section className="flex justify-center items-start">
          {template === 'modern' ? <ModernTemplate resume={resume} /> : <ClassicTemplate resume={resume} />}
        </section>
      </main>
    </div>
  );
}`,
                language: "jsx",
            },
        ],
    };

    const artifact = normalizeCodeProject(resumeBuilderRaw, "Build modern Resume Builder SaaS in React", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);

    assert.equal(artifact.totalFiles, 9);
    assert.equal(artifact.entryFile, "src/main.jsx");
    assert.equal(isReactProject(artifact), true);

    // Verify static integrity
    const integrity = validateArtifactIntegrity(artifact, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, true, `Integrity failed with: ${integrity.errors.join(", ")}`);

    // Verify Sandpack runtime compatibility
    const runtime = detectArtifactRuntime(artifact);
    assert.equal(runtime.runtime, ARTIFACT_RUNTIMES.REACT);

    const sandpackData = mapOrbitArtifactToSandpack(artifact);
    assert.ok(sandpackData.files["/src/main.jsx"], "Sandpack has main.jsx");
    assert.ok(sandpackData.files["/src/App.jsx"], "Sandpack has App.jsx");
    assert.ok(sandpackData.files["/package.json"], "Sandpack has package.json");
    assert.equal(sandpackData.dependencies["lucide-react"], "^0.263.1");
});

// ============================================================================
// PART 4: 5-TURN INCREMENTAL WORKFLOW ON RESUME BUILDER
// ============================================================================

test("Test 5: 5-Turn Incremental Workflow on Full 9-File React Resume Builder", () => {
    // Shared 9-file Resume Builder definition
    const resumeBuilderRaw = {
        title: "Orbit Resume Builder SaaS",
        description: "Professional multi-template Resume Builder with live preview and PDF export",
        summary: "Modular React SPA featuring personal info, education, work experience, skill editors, template switching, and responsive design.",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "package.json",
                content: JSON.stringify({
                    name: "orbit-resume-builder",
                    version: "1.0.0",
                    private: true,
                    dependencies: {
                        react: "^18.2.0",
                        "react-dom": "^18.2.0",
                        "lucide-react": "^0.263.1",
                    },
                }, null, 2),
                language: "json",
            },
            {
                path: "index.html",
                content: `<!DOCTYPE html><html lang="en"><head><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>`,
                language: "html",
            },
            {
                path: "src/main.jsx",
                content: `import React, { StrictMode } from 'react'; import { createRoot } from 'react-dom/client'; import App from './App.jsx'; import './styles/index.css'; createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);`,
                language: "jsx",
            },
            {
                path: "src/styles/index.css",
                content: `@media print { body { background: white !important; } .no-print { display: none !important; } }`,
                language: "css",
            },
            {
                path: "src/components/Dashboard.jsx",
                content: `import React from 'react'; import { FileText, Download } from 'lucide-react'; export default function Dashboard({ onPrint }) { return <header><button onClick={onPrint}><Download /> Export</button></header>; }`,
                language: "jsx",
            },
            {
                path: "src/components/PersonalInfoForm.jsx",
                content: `import React from 'react'; export default function PersonalInfoForm({ data, onChange }) { return <input value={data.name || ''} onChange={(e) => onChange('name', e.target.value)} />; }`,
                language: "jsx",
            },
            {
                path: "src/templates/ModernTemplate.jsx",
                content: `import React from 'react'; export default function ModernTemplate({ resume }) { return <div>Modern: {resume.name}</div>; }`,
                language: "jsx",
            },
            {
                path: "src/templates/ClassicTemplate.jsx",
                content: `import React from 'react'; export default function ClassicTemplate({ resume }) { return <div>Classic: {resume.name}</div>; }`,
                language: "jsx",
            },
            {
                path: "src/App.jsx",
                content: `import React, { useState } from 'react'; import Dashboard from './components/Dashboard.jsx'; import PersonalInfoForm from './components/PersonalInfoForm.jsx'; import ModernTemplate from './templates/ModernTemplate.jsx'; import ClassicTemplate from './templates/ClassicTemplate.jsx'; export default function App() { return <div><Dashboard /><PersonalInfoForm /><ModernTemplate /><ClassicTemplate /></div>; }`,
                language: "jsx",
            },
        ],
    };

    // TURN 1: Initial creation of full 9-file Resume Builder
    const turn1 = normalizeCodeProject(resumeBuilderRaw, "Build modern Resume Builder SaaS in React", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn1.totalFiles, 9, "Turn 1 must have exactly 9 initial files");
    assert.equal(turn1.baseArtifactId, null);

    // TURN 2: Add 3rd template (ExecutiveTemplate.jsx) -> creates 1 new file, updates App.jsx
    const turn2Ops = {
        title: "Resume Builder - Executive Template",
        operations: [
            {
                type: "create",
                path: "src/templates/ExecutiveTemplate.jsx",
                content: `import React from 'react'; export default function ExecutiveTemplate({ resume }) { return <div className="p-8 border border-amber-600">Executive: {resume.name}</div>; }`,
            },
            {
                type: "update",
                path: "src/App.jsx",
                content: `import React from 'react'; import Dashboard from './components/Dashboard.jsx'; import PersonalInfoForm from './components/PersonalInfoForm.jsx'; import ModernTemplate from './templates/ModernTemplate.jsx'; import ClassicTemplate from './templates/ClassicTemplate.jsx'; import ExecutiveTemplate from './templates/ExecutiveTemplate.jsx'; export default function App() { return <div><Dashboard /><PersonalInfoForm /><ModernTemplate /><ClassicTemplate /><ExecutiveTemplate /></div>; }`,
            },
        ],
    };
    const turn2 = applyFileOperations(turn1, turn2Ops, "Add executive template", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn2.totalFiles, 10, "Turn 2 must have exactly 10 files (9 initial + 1 created)");
    assert.equal(turn2.baseArtifactId, turn1.artifactId);
    assert.ok(turn2.files.some((f) => f.path === "src/templates/ExecutiveTemplate.jsx"));

    // TURN 3: Add profile photo upload field -> updates existing PersonalInfoForm.jsx (NOT create!)
    const turn3Ops = {
        operations: [
            {
                type: "update",
                path: "src/components/PersonalInfoForm.jsx",
                content: `import React from 'react'; export default function PersonalInfoForm({ data, onChange, onPhotoUpload }) { return <div><input type="file" onChange={onPhotoUpload} /><input value={data.name || ''} onChange={(e) => onChange('name', e.target.value)} /></div>; }`,
            },
        ],
    };
    const turn3 = applyFileOperations(turn2, turn3Ops, "Add profile photo upload field", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn3.totalFiles, 10, "Turn 3 must preserve 10 files (1 updated, 0 created)");
    assert.equal(turn3.baseArtifactId, turn2.artifactId);
    assert.ok(turn3.files.find((f) => f.path === "src/components/PersonalInfoForm.jsx").content.includes('type="file"'));

    // TURN 4: Improve mobile styling -> updates src/styles/index.css
    const turn4Ops = {
        operations: [
            {
                type: "update",
                path: "src/styles/index.css",
                content: `@media (max-width: 640px) { .print-area { padding: 1rem !important; } } @media print { body { background: white !important; } .no-print { display: none !important; } }`,
            },
        ],
    };
    const turn4 = applyFileOperations(turn3, turn4Ops, "Improve mobile styling", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn4.totalFiles, 10, "Turn 4 must preserve 10 files (1 updated, 0 created)");
    assert.equal(turn4.baseArtifactId, turn3.artifactId);
    assert.ok(turn4.files.find((f) => f.path === "src/styles/index.css").content.includes("max-width: 640px"));

    // TURN 5: Update PDF export behavior -> updates src/components/Dashboard.jsx
    const turn5Ops = {
        operations: [
            {
                type: "update",
                path: "src/components/Dashboard.jsx",
                content: `import React, { useState } from 'react'; import { FileText, Download, Check } from 'lucide-react'; export default function Dashboard({ onPrint }) { const [done, setDone] = useState(false); return <header><button onClick={() => { onPrint(); setDone(true); }}>{done ? <Check /> : <Download />} Export PDF</button></header>; }`,
            },
        ],
    };
    const turn5 = applyFileOperations(turn4, turn5Ops, "Update PDF export behavior with visual confirmation", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn5.totalFiles, 10, "Turn 5 must preserve 10 files (1 updated, 0 created)");
    assert.equal(turn5.baseArtifactId, turn4.artifactId);
    assert.ok(turn5.files.find((f) => f.path === "src/components/Dashboard.jsx").content.includes("setDone(true)"));

    // Validate Sandpack compatibility of final Turn 5 artifact
    const sandpack = mapOrbitArtifactToSandpack(turn5);
    assert.ok(Object.keys(sandpack.files).length >= 10);
    assert.ok(sandpack.files["/src/templates/ExecutiveTemplate.jsx"]);
    assert.ok(sandpack.files["/src/components/PersonalInfoForm.jsx"]);
    assert.ok(sandpack.files["/index.js"]); // Sandpack bridge file
    assert.ok(sandpack.files["/App.js"]); // Sandpack bridge file
    assert.equal(sandpack.dependencies["lucide-react"], "^0.263.1");
    // Ensure reconstructed artifact strips bridge files and restores exact 10 files
    const reconstructed = reconstructOrbitArtifactFromSandpack(sandpack.files, turn5);
    assert.equal(reconstructed.files.length, 10);

    // Lineage verification: Turn 5 -> Turn 4 -> Turn 3 -> Turn 2 -> Turn 1
    assert.equal(turn5.baseArtifactId, turn4.artifactId);
    assert.equal(turn4.baseArtifactId, turn3.artifactId);
    assert.equal(turn3.baseArtifactId, turn2.artifactId);
    assert.equal(turn2.baseArtifactId, turn1.artifactId);
});

test("Test 5b: New project isolation: completely fresh expense tracker does not inherit Resume Builder files", () => {
    const previousResumeArtifact = {
        artifactId: "art_prev_resume",
        title: "Resume Builder",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0"}}' },
            { path: "src/main.jsx", content: "export default function Main() {}" },
            { path: "src/App.jsx", content: "export default function App() {}" },
            { path: "src/templates/ModernTemplate.jsx", content: "export default function Modern() {}" },
        ],
    };

    const intent = classifyProjectIntent("Build a completely new expense tracker application from scratch", previousResumeArtifact);
    assert.equal(intent.intent, PROJECT_INTENTS.CREATE_NEW_PROJECT);
    assert.equal(intent.shouldUseExistingArtifact, false);

    // Fresh expense tracker project generated independently
    const freshExpenseTrackerRaw = {
        title: "Expense Tracker",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"name":"expense-tracker","dependencies":{"react":"^18.2.0"}}' },
            { path: "src/main.jsx", content: "export default function Main() {}" },
            { path: "src/App.jsx", content: "export default function App() {}" },
            { path: "src/components/ExpenseList.jsx", content: "export default function ExpenseList() {}" },
        ],
    };
    const freshArtifact = normalizeCodeProject(freshExpenseTrackerRaw, "Build new expense tracker", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(freshArtifact.baseArtifactId, null);
    assert.equal(freshArtifact.files.some((f) => f.path.includes("ModernTemplate.jsx")), false);
    assert.equal(previousResumeArtifact.files.length, 4);
});

// ============================================================================
// PART 5: LEGACY COMPATIBILITY & GENERAL CODING QUESTION HANDLING
// ============================================================================

test("Test 6: Legacy HTML/CSS/JS project remains on legacy iframe without forced React migration", () => {
    const legacyProject = {
        artifactId: "art_legacy_100",
        title: "Vanilla Calculator",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<div id='calc'></div><script src='calc.js'></script>" },
            { path: "calc.js", content: "console.log('calculate');" },
            { path: "style.css", content: "body { background: #111; }" },
        ],
    };

    const updateOps = {
        operations: [
            { type: "update", path: "style.css", content: "body { background: #222; font-family: sans-serif; }" },
        ],
    };

    const updatedLegacy = applyFileOperations(legacyProject, updateOps, "Make background darker", PROJECT_RUNTIME_STRATEGIES.LEGACY_WEB_APPLICATION);
    assert.equal(isReactProject(updatedLegacy), false);

    const runtime = detectArtifactRuntime(updatedLegacy);
    assert.equal(runtime.runtime, ARTIFACT_RUNTIMES.LEGACY_HTML);
});

test("Test 7: General coding questions are routed away from project generation", () => {
    const questions = [
        "Explain how React useEffect cleanup works",
        "What is the difference between useMemo and useCallback?",
        "How do closures work in JavaScript?",
    ];

    for (const q of questions) {
        const intent = classifyProjectIntent(q, null);
        assert.equal(intent.intent, PROJECT_INTENTS.GENERAL_CODING_QUESTION);
        assert.equal(intent.shouldUseExistingArtifact, false);
    }
});

test("Test 8: Malformed generation output preserves existing artifact safely", () => {
    const validArtifact = {
        artifactId: "art_valid_prev",
        title: "Resume Builder",
        entryFile: "src/main.jsx",
        files: [
            { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
            { path: "index.html", content: '<!DOCTYPE html><html><body><div id="root"></div></body></html>' },
            { path: "src/main.jsx", content: "export default function Main() {}" },
        ],
    };

    // Completely unparseable model response
    const brokenText = "Sorry, I hit a token limit and { broken json: [}";
    const preserved = parseCodeArtifact(brokenText, "Add section", validArtifact, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);

    assert.equal(preserved.artifactId !== validArtifact.artifactId, true);
    assert.equal(preserved.baseArtifactId, validArtifact.artifactId);
    assert.equal(preserved.files.length, 3);
    assert.ok(preserved.summary.includes("Could not apply code updates. Existing project preserved."));
});
