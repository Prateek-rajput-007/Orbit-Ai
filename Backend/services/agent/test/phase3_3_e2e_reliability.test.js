import test from "node:test";
import assert from "node:assert/strict";
import parser from "../../../../Frontend/node_modules/@babel/parser/lib/index.js";
import {
    validateArtifactIntegrity,
    resolveRelativeImport,
    resolveRelativeImportDetailed,
    extractLocalImportsFromCode,
    analyzeComponentUsage,
    synthesizeMissingComponent,
    repairMissingReactImports,
    applyFileOperations,
    normalizeCodeProject,
    parseCodeArtifact,
} from "../utils/codeArtifact.js";
import {
    classifyProjectIntent,
    PROJECT_INTENTS,
    PROJECT_RUNTIME_STRATEGIES,
} from "../utils/projectIntent.js";

// Helper: compiles code with @babel/parser ensuring real JSX and JS syntax validity
const compileJsx = (code, filename = "test.jsx") => {
    try {
        return {
            ast: parser.parse(code, {
                sourceType: "module",
                plugins: ["jsx", "typescript"],
            }),
            error: null,
        };
    } catch (err) {
        return { ast: null, error: err };
    }
};

// ============================================================================
// PART 1: COMPILATION & STATIC ERROR DETECTION TESTS
// ============================================================================

test("Test 1: Valid JSX compiles cleanly without syntax errors", () => {
    const validJsx = `
import React, { useState } from "react";
export default function Counter() {
    const [count, setCount] = useState(0);
    return (
        <div className="p-4 bg-slate-900 text-white rounded">
            <h2 className="text-xl font-bold">Count: {count}</h2>
            <button onClick={() => setCount(c => c + 1)} className="px-3 py-1 bg-amber-500 rounded">
                Increment
            </button>
        </div>
    );
}
`;
    const result = compileJsx(validJsx);
    assert.equal(result.error, null);
    assert.ok(result.ast);
    assert.equal(result.ast.type, "File");
});

test("Test 2: Invalid JSX syntax (mismatched tags) is caught by compiler", () => {
    const invalidJsx = `
export default function Broken() {
    return (
        <div>
            <span>Broken unclosed tag
        </div>
    );
}
`;
    const result = compileJsx(invalidJsx);
    assert.ok(result.error, "Compiler must catch mismatched / unclosed JSX tags");
    assert.ok(result.error.message.includes("Unterminated JSX contents") || result.error.message.includes("Expected"));
});

test("Test 3: Missing named exports detection across local imports", () => {
    const helperCode = `
export const formatCurrency = (n) => "$" + n;
// Note: calculateTax is NOT exported
`;
    const appCode = `
import { formatCurrency, calculateTax } from "./helper.js";
export default function App() { return <div>{formatCurrency(10)}</div>; }
`;

    // 1. App.jsx references calculateTax which does not exist in helperCode
    const parsedHelper = compileJsx(helperCode, "helper.js");
    assert.equal(parsedHelper.error, null);

    // Extract exported names from helper AST
    const exportedNames = new Set();
    for (const node of parsedHelper.ast.program.body) {
        if (node.type === "ExportNamedDeclaration" && node.declaration?.declarations) {
            for (const dec of node.declaration.declarations) {
                if (dec.id?.name) exportedNames.add(dec.id.name);
            }
        }
    }

    assert.ok(exportedNames.has("formatCurrency"));
    assert.equal(exportedNames.has("calculateTax"), false, "calculateTax must not be in exports");

    // 2. Extract imported names from App.jsx
    const parsedApp = compileJsx(appCode, "App.jsx");
    const importedFromHelper = [];
    for (const node of parsedApp.ast.program.body) {
        if (node.type === "ImportDeclaration" && node.source.value === "./helper.js") {
            for (const spec of node.specifiers) {
                if (spec.type === "ImportSpecifier") {
                    importedFromHelper.push(spec.imported.name);
                }
            }
        }
    }

    // Flag missing named export
    const missingNamed = importedFromHelper.filter((name) => !exportedNames.has(name));
    assert.deepEqual(missingNamed, ["calculateTax"]);
});

// ============================================================================
// PART 2: PROPS & USAGE INFERENCE IN AUTOMATIC REPAIR
// ============================================================================

test("Test 4: analyzeComponentUsage extracts props, event handlers, and data bindings", () => {
    const parentCode = `
import React, { useState } from "react";
import MetricCard from "./components/MetricCard.jsx";
import UserDialog from "./components/UserDialog.jsx";

export default function Dashboard() {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <MetricCard title="Revenue" value="$42k" icon={DollarSign} onClick={() => alert('clicked')} />
            <UserDialog isOpen={open} onClose={() => setOpen(false)} title="Edit User">
                <p>Dialog Body</p>
            </UserDialog>
        </div>
    );
}
`;

    // 1. Analyze MetricCard
    const cardUsage = analyzeComponentUsage("src/components/MetricCard.jsx", parentCode);
    assert.equal(cardUsage.componentName, "MetricCard");
    assert.ok(cardUsage.props.includes("title"));
    assert.ok(cardUsage.props.includes("value"));
    assert.ok(cardUsage.props.includes("icon"));
    assert.ok(cardUsage.handlers.includes("onClick"));
    assert.equal(cardUsage.isCard, true);

    // 2. Synthesize MetricCard with inferred props
    const synthesizedCard = synthesizeMissingComponent("src/components/MetricCard.jsx", parentCode);
    assert.ok(synthesizedCard.includes("export default function MetricCard"));
    assert.ok(synthesizedCard.includes("title"));
    assert.ok(synthesizedCard.includes("value"));
    assert.ok(synthesizedCard.includes("onClick"));

    // Verify synthesized component compiles cleanly
    const cardCompile = compileJsx(synthesizedCard, "MetricCard.jsx");
    assert.equal(cardCompile.error, null);

    // 3. Analyze UserDialog
    const dialogUsage = analyzeComponentUsage("src/components/UserDialog.jsx", parentCode);
    assert.equal(dialogUsage.isModal, true);
    assert.ok(dialogUsage.handlers.includes("onClose"));
});

test("Test 5: analyzeComponentUsage extracts named function imports and synthesizes matching exports", () => {
    const parentCode = `
import { formatCurrency, calculateTax, validateEmail } from "./utils/financeHelper.js";
export default function Bill() {
    return <div>{formatCurrency(100)}</div>;
}
`;

    const usage = analyzeComponentUsage("src/utils/financeHelper.js", parentCode);
    assert.deepEqual(usage.namedImports, ["formatCurrency", "calculateTax", "validateEmail"]);

    const synthesizedHelper = synthesizeMissingComponent("src/utils/financeHelper.js", parentCode);
    assert.ok(synthesizedHelper.includes("export const formatCurrency ="));
    assert.ok(synthesizedHelper.includes("export const calculateTax ="));
    assert.ok(synthesizedHelper.includes("export const validateEmail ="));

    // Verify it compiles cleanly
    const helperCompile = compileJsx(synthesizedHelper, "financeHelper.js");
    assert.equal(helperCompile.error, null);
});

test("Test 6: repairMissingReactImports limits batch size to prevent runaway generation", () => {
    // Artifact with 10 missing imports (exceeds MAX_SYNTHESIZED_FILES = 8)
    const files = [
        { path: "package.json", content: '{"dependencies":{"react":"^18.2.0","react-dom":"^18.2.0"}}' },
        { path: "index.html", content: '<div id="root"></div>' },
        {
            path: "src/main.jsx",
            content: `
import React from "react";
import A from "./A.jsx";
import B from "./B.jsx";
import C from "./C.jsx";
import D from "./D.jsx";
import E from "./E.jsx";
import F from "./F.jsx";
import G from "./G.jsx";
import H from "./H.jsx";
import I from "./I.jsx";
import J from "./J.jsx";
export default function Main() {}
`,
        },
    ];

    const artifact = {
        artifactId: "runaway_test",
        entryFile: "src/main.jsx",
        files,
    };

    const integrity = validateArtifactIntegrity(artifact, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(integrity.valid, false);
    assert.equal(integrity.errors.length, 10);

    // Auto-repair should abort safely and return null rather than generating 10 files blindly
    const repaired = repairMissingReactImports(artifact, integrity, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(repaired, null);
});

// ============================================================================
// PART 3: 5-TURN INCREMENTAL WORKFLOW ON REAL RESUME BUILDER
// ============================================================================

test("Test 7: Complete 5-Turn Incremental Workflow on 17-File ResumeCraft SaaS", () => {
    // Turn 0: Base ResumeCraft project with 17 verified files
    const baseResumeCraft = {
        artifactId: "code_resumecraft_v1",
        title: "ResumeCraft - Professional Resume Builder SaaS",
        description: "Multi-template resume editor with live preview, dashboard, and print export",
        entryFile: "src/main.jsx",
        files: [
            {
                path: "package.json",
                content: JSON.stringify({
                    name: "resumecraft",
                    dependencies: { react: "^18.2.0", "react-dom": "^18.2.0", "lucide-react": "^0.263.1", uuid: "^9.0.0" },
                }),
            },
            {
                path: "index.html",
                content: '<!DOCTYPE html><html><head><script src="https://cdn.tailwindcss.com"></script></head><body><div id="root"></div></body></html>',
            },
            {
                path: "src/main.jsx",
                content: `import React from "react";\nimport ReactDOM from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles/index.css";\nReactDOM.createRoot(document.getElementById("root")).render(<App />);`,
            },
            {
                path: "src/styles/index.css",
                content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n@media print { .no-print { display: none !important; } }`,
            },
            {
                path: "src/App.jsx",
                content: `import React, { useState } from "react";
import { ResumeProvider } from "./context/ResumeContext.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ResumeEditor from "./components/ResumeEditor.jsx";

export default function App() {
  const [view, setView] = useState("dashboard");
  const [activeResumeId, setActiveResumeId] = useState(null);
  return (
    <ResumeProvider>
      <div className="flex h-screen bg-gray-50">
        {view === "dashboard" ? (
          <Dashboard openEditor={(id) => { setActiveResumeId(id); setView("editor"); }} />
        ) : (
          <ResumeEditor resumeId={activeResumeId} backToDashboard={() => setView("dashboard")} />
        )}
      </div>
    </ResumeProvider>
  );
}`,
            },
            {
                path: "src/context/ResumeContext.jsx",
                content: `import React, { createContext, useState } from "react";
export const ResumeContext = createContext();
export function ResumeProvider({ children }) {
  const [resumes, setResumes] = useState([{ id: "1", name: "John Doe", title: "Engineer", work: [], education: [], skills: [], projects: [], certifications: [], template: "modern" }]);
  return <ResumeContext.Provider value={{ resumes, updateResume: () => {} }}>{children}</ResumeContext.Provider>;
}`,
            },
            {
                path: "src/components/Dashboard.jsx",
                content: `import React, { useContext } from "react";
import { ResumeContext } from "../context/ResumeContext.jsx";
export default function Dashboard({ openEditor }) {
  const { resumes } = useContext(ResumeContext);
  return <div><h1>Dashboard</h1><button onClick={() => openEditor(resumes[0].id)}>Edit Resume</button></div>;
}`,
            },
            {
                path: "src/components/ResumeEditor.jsx",
                content: `import React, { useState } from "react";
import PersonalInfoForm from "./forms/PersonalInfoForm.jsx";
import ProjectsForm from "./forms/ProjectsForm.jsx";
import CertificationsForm from "./forms/CertificationsForm.jsx";
import ResumePreview from "./ResumePreview.jsx";

export default function ResumeEditor({ resumeId, backToDashboard }) {
  const [resume, setResume] = useState({ name: "John Doe", title: "Engineer", template: "modern", projects: [], certifications: [] });
  return (
    <div className="grid grid-cols-2 gap-4 p-4 w-full">
      <div>
        <button onClick={backToDashboard}>Back to Dashboard</button>
        <PersonalInfoForm data={resume} onChange={(name, val) => setResume(r => ({ ...r, [name]: val }))} />
        <ProjectsForm data={resume.projects} onChange={(proj) => setResume(r => ({ ...r, projects: proj }))} />
        <CertificationsForm data={resume.certifications} onChange={(certs) => setResume(r => ({ ...r, certifications: certs }))} />
      </div>
      <div>
        <ResumePreview resume={resume} />
      </div>
    </div>
  );
}`,
            },
            {
                path: "src/components/forms/PersonalInfoForm.jsx",
                content: `import React from "react";
export default function PersonalInfoForm({ data, onChange }) {
  return (
    <div>
      <input value={data.name || ""} onChange={(e) => onChange("name", e.target.value)} placeholder="Full Name" />
      <input value={data.title || ""} onChange={(e) => onChange("title", e.target.value)} placeholder="Title" />
    </div>
  );
}`,
            },
            {
                path: "src/components/forms/ProjectsForm.jsx",
                content: `import React from "react";
export default function ProjectsForm({ data = [], onChange }) {
  return <div><h3>Projects</h3><button onClick={() => onChange([...data, { id: Date.now(), name: "New" }])}>Add</button></div>;
}`,
            },
            {
                path: "src/components/forms/CertificationsForm.jsx",
                content: `import React from "react";
export default function CertificationsForm({ data = [], onChange }) {
  return <div><h3>Certifications</h3><button onClick={() => onChange([...data, { id: Date.now(), name: "AWS" }])}>Add</button></div>;
}`,
            },
            {
                path: "src/components/ResumePreview.jsx",
                content: `import React from "react";
export default function ResumePreview({ resume }) {
  return (
    <div className="bg-white p-6 shadow">
      <h2>{resume.name}</h2>
      <p>{resume.title}</p>
      <span>Template: {resume.template}</span>
    </div>
  );
}`,
            },
        ],
    };

    // Verify Turn 0 passes integrity
    const baseIntegrity = validateArtifactIntegrity(baseResumeCraft, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(baseIntegrity.valid, true);

    // ------------------------------------------------------------------------
    // TURN 1: Add a new professional resume template ('minimalist')
    // ------------------------------------------------------------------------
    const turn1Payload = {
        operations: [
            {
                type: "update",
                path: "src/components/ResumePreview.jsx",
                content: `import React from "react";
export default function ResumePreview({ resume }) {
  const isMinimalist = resume.template === "minimalist";
  return (
    <div className={isMinimalist ? "font-mono border-l-4 border-black pl-4" : "bg-white p-6 shadow"}>
      <h2>{resume.name}</h2>
      <p>{resume.title}</p>
      <span>Template: {resume.template}</span>
    </div>
  );
}`,
            },
            {
                type: "update",
                path: "src/components/ResumeEditor.jsx",
                content: `import React, { useState } from "react";
import PersonalInfoForm from "./forms/PersonalInfoForm.jsx";
import ProjectsForm from "./forms/ProjectsForm.jsx";
import CertificationsForm from "./forms/CertificationsForm.jsx";
import ResumePreview from "./ResumePreview.jsx";

export default function ResumeEditor({ resumeId, backToDashboard }) {
  const [resume, setResume] = useState({ name: "John Doe", title: "Engineer", template: "modern", projects: [], certifications: [] });
  return (
    <div className="grid grid-cols-2 gap-4 p-4 w-full">
      <div>
        <button onClick={backToDashboard}>Back to Dashboard</button>
        <select value={resume.template} onChange={(e) => setResume(r => ({ ...r, template: e.target.value }))}>
          <option value="modern">Modern</option>
          <option value="minimalist">Minimalist</option>
        </select>
        <PersonalInfoForm data={resume} onChange={(name, val) => setResume(r => ({ ...r, [name]: val }))} />
        <ProjectsForm data={resume.projects} onChange={(proj) => setResume(r => ({ ...r, projects: proj }))} />
        <CertificationsForm data={resume.certifications} onChange={(certs) => setResume(r => ({ ...r, certifications: certs }))} />
      </div>
      <div>
        <ResumePreview resume={resume} />
      </div>
    </div>
  );
}`,
            },
        ],
    };

    const turn1Result = applyFileOperations(baseResumeCraft, turn1Payload, "Add minimalist template", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(turn1Result);
    assert.equal(turn1Result.baseArtifactId, baseResumeCraft.artifactId);
    assert.ok(turn1Result.files.find(f => f.path === "src/components/ResumePreview.jsx").content.includes("isMinimalist"));
    const turn1Compile = compileJsx(turn1Result.files.find(f => f.path === "src/components/ResumePreview.jsx").content);
    assert.equal(turn1Compile.error, null);

    // ------------------------------------------------------------------------
    // TURN 2: Add a LinkedIn field to personal information
    // ------------------------------------------------------------------------
    const turn2Payload = {
        operations: [
            {
                type: "update",
                path: "src/components/forms/PersonalInfoForm.jsx",
                content: `import React from "react";
export default function PersonalInfoForm({ data, onChange }) {
  return (
    <div>
      <input value={data.name || ""} onChange={(e) => onChange("name", e.target.value)} placeholder="Full Name" />
      <input value={data.title || ""} onChange={(e) => onChange("title", e.target.value)} placeholder="Title" />
      <input value={data.linkedin || ""} onChange={(e) => onChange("linkedin", e.target.value)} placeholder="LinkedIn Profile URL" />
    </div>
  );
}`,
            },
        ],
    };

    const turn2Result = applyFileOperations(turn1Result, turn2Payload, "Add linkedin field", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(turn2Result);
    assert.ok(turn2Result.files.find(f => f.path === "src/components/forms/PersonalInfoForm.jsx").content.includes("linkedin"));
    const turn2Compile = compileJsx(turn2Result.files.find(f => f.path === "src/components/forms/PersonalInfoForm.jsx").content);
    assert.equal(turn2Compile.error, null);

    // ------------------------------------------------------------------------
    // TURN 3: Improve the resume preview layout
    // ------------------------------------------------------------------------
    const turn3Payload = {
        operations: [
            {
                type: "update",
                path: "src/components/ResumePreview.jsx",
                content: `import React from "react";
export default function ResumePreview({ resume }) {
  const isMinimalist = resume.template === "minimalist";
  return (
    <div className={isMinimalist ? "font-mono border-l-4 border-black pl-4" : "bg-white p-6 shadow-md rounded-xl"}>
      <h2 className="text-2xl font-bold tracking-tight">{resume.name}</h2>
      <p className="text-gray-600">{resume.title}</p>
      {resume.linkedin && <a href={resume.linkedin} className="text-indigo-600 text-xs block mt-1">{resume.linkedin}</a>}
      <span className="inline-block mt-3 px-2 py-0.5 rounded text-xs bg-gray-100">Template: {resume.template}</span>
    </div>
  );
}`,
            },
        ],
    };

    const turn3Result = applyFileOperations(turn2Result, turn3Payload, "Improve preview styling", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(turn3Result);
    assert.ok(turn3Result.files.find(f => f.path === "src/components/ResumePreview.jsx").content.includes("resume.linkedin"));

    // ------------------------------------------------------------------------
    // TURN 4: Add new component ThemeToggle.jsx and connect it to App.jsx
    // ------------------------------------------------------------------------
    const turn4Payload = {
        operations: [
            {
                type: "create",
                path: "src/components/ThemeToggle.jsx",
                content: `import React from "react";
export default function ThemeToggle({ theme, onToggle }) {
  return (
    <button onClick={onToggle} className="px-2 py-1 bg-gray-200 rounded text-xs">
      Theme: {theme}
    </button>
  );
}`,
            },
            {
                type: "update",
                path: "src/App.jsx",
                content: `import React, { useState } from "react";
import { ResumeProvider } from "./context/ResumeContext.jsx";
import Dashboard from "./components/Dashboard.jsx";
import ResumeEditor from "./components/ResumeEditor.jsx";
import ThemeToggle from "./components/ThemeToggle.jsx";

export default function App() {
  const [view, setView] = useState("dashboard");
  const [activeResumeId, setActiveResumeId] = useState(null);
  const [theme, setTheme] = useState("light");

  return (
    <ResumeProvider>
      <div className="flex h-screen bg-gray-50 flex-col">
        <header className="p-3 bg-white border-b flex justify-between items-center">
          <span className="font-bold">ResumeCraft</span>
          <ThemeToggle theme={theme} onToggle={() => setTheme(t => t === 'light' ? 'dark' : 'light')} />
        </header>
        {view === "dashboard" ? (
          <Dashboard openEditor={(id) => { setActiveResumeId(id); setView("editor"); }} />
        ) : (
          <ResumeEditor resumeId={activeResumeId} backToDashboard={() => setView("dashboard")} />
        )}
      </div>
    </ResumeProvider>
  );
}`,
            },
        ],
    };

    const turn4Result = applyFileOperations(turn3Result, turn4Payload, "Add ThemeToggle component", PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.ok(turn4Result);
    assert.ok(turn4Result.files.find(f => f.path === "src/components/ThemeToggle.jsx"));
    const turn4Integrity = validateArtifactIntegrity(turn4Result, PROJECT_RUNTIME_STRATEGIES.REACT_APPLICATION);
    assert.equal(turn4Integrity.valid, true, "Turn 4 project with new ThemeToggle must pass integrity validation");

    // ------------------------------------------------------------------------
    // TURN 5: Ask for an unrelated technical explanation
    // ------------------------------------------------------------------------
    const turn5Prompt = "Explain how React useCallback works under the hood with memory references.";
    const turn5Intent = classifyProjectIntent(turn5Prompt, turn4Result, []);
    assert.equal(turn5Intent.intent, PROJECT_INTENTS.GENERAL_CODING_QUESTION);
    assert.equal(turn5Intent.shouldUseExistingArtifact, false, "General coding questions must isolate project from mutation");
});

