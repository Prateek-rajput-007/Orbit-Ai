import test from 'node:test';
import assert from 'node:assert/strict';
import {
    checkFileSyntax,
    validateArtifactIntegrity,
    repairMissingReactImports,
    repairTruncatedJson,
    parseCodeArtifact,
    synthesizeMissingComponent,
} from '../utils/codeArtifact.js';

test('Syntax Integrity 1: checkFileSyntax detects unterminated string in JSX', () => {
    const brokenCode = `import React from 'react';
export default function SkillsForm() {
  return (
    <section className="bg-gray-50 p-4 rounded">
      <h3 className="font-medium mb-2">Skills</h3>
      <div className="flex space-x-2 mb-2
`;
    const res = checkFileSyntax('src/components/forms/SkillsForm.jsx', brokenCode);
    assert.equal(res.valid, false);
    assert.match(res.error, /unterminated/i);
});

test('Syntax Integrity 2: checkFileSyntax validates clean JSX components', () => {
    const cleanCode = `import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';

export default function SkillsForm({ data = [], onChange }) {
  const [skills, setSkills] = useState(data);
  return (
    <div className="p-4 bg-white rounded shadow">
      <h3>Skills</h3>
      {skills.map((s, i) => <span key={i}>{s}</span>)}
    </div>
  );
}`;
    const res = checkFileSyntax('src/components/forms/SkillsForm.jsx', cleanCode);
    assert.equal(res.valid, true);
});

test('Syntax Integrity 3: validateArtifactIntegrity flags SYNTAX_ERROR for broken files', () => {
    const artifact = {
        title: 'Broken Project',
        entryFile: 'src/main.jsx',
        files: [
            { path: 'package.json', content: '{"name": "test", "dependencies": {"react": "^18.3.1", "react-dom": "^18.3.1"}}' },
            { path: 'index.html', content: '<html><body><div id="root"></div></body></html>' },
            { path: 'src/main.jsx', content: 'import React from "react";\nimport App from "./App.jsx";' },
            { path: 'src/App.jsx', content: 'export default function App() { return <div>App</div>; }' },
            { path: 'src/components/Broken.jsx', content: 'export default function Broken() { return (<div className="incomplete' },
        ],
    };
    const integrity = validateArtifactIntegrity(artifact, 'REACT_APPLICATION');
    assert.equal(integrity.valid, false);
    const syntaxErr = integrity.errors.find((e) => e.type === 'SYNTAX_ERROR');
    assert.ok(syntaxErr);
    assert.equal(syntaxErr.file, 'src/components/Broken.jsx');
});

test('Syntax Integrity 4: repairMissingReactImports purges syntax-broken component and synthesizes clean replacement', () => {
    const artifact = {
        title: 'Recovery Project',
        entryFile: 'src/main.jsx',
        files: [
            { path: 'package.json', content: '{"name": "test", "dependencies": {"react": "^18.3.1", "react-dom": "^18.3.1"}}' },
            { path: 'index.html', content: '<html><body><div id="root"></div></body></html>' },
            { path: 'src/main.jsx', content: 'import React from "react";\nimport App from "./App.jsx";' },
            { path: 'src/App.jsx', content: 'import SkillsForm from "./components/forms/SkillsForm.jsx";\nexport default function App() { return <SkillsForm data={[]} onChange={() => {}} />; }' },
            { path: 'src/components/forms/SkillsForm.jsx', content: 'export default function SkillsForm() { return (<div className="incomplete' },
        ],
    };
    const repaired = repairMissingReactImports(artifact, null, 'REACT_APPLICATION');
    assert.ok(repaired);
    assert.equal(repaired.integrity.valid, true);
    const skillsFile = repaired.files.find((f) => f.path.includes('SkillsForm'));
    assert.ok(skillsFile);
    assert.doesNotMatch(skillsFile.content, /incomplete/);
    assert.match(skillsFile.content, /export default function SkillsForm/);
    // Check that synthesized file is syntactically clean
    const synCheck = checkFileSyntax(skillsFile.path, skillsFile.content);
    assert.equal(synCheck.valid, true);
});

test('Syntax Integrity 5: repairTruncatedJson drops broken partial file from files array', () => {
    const rawJson = `{"title":"Truncated App","files":[{"path":"src/App.jsx","content":"export default function App() { return <div>App</div>; }"},{"path":"src/components/CutOff.jsx","content":"export default function CutOff() { return (<div className=\\"broken`;
    const repaired = repairTruncatedJson(rawJson);
    assert.ok(repaired);
    assert.equal(repaired.files.length, 1);
    assert.equal(repaired.files[0].path, 'src/App.jsx');
});

test('Syntax Integrity 6: end-to-end parseCodeArtifact handles truncated ResumeCraft cleanly', () => {
    const truncatedResumeCraft = `{
      "title": "ResumeCraft FullFeatured Resume Builder SaaS",
      "description": "Professional Resume Builder SaaS",
      "entryFile": "src/main.jsx",
      "files": [
        {
          "path": "package.json",
          "content": "{\\n  \\"name\\": \\"resumecraft\\",\\n  \\"version\\": \\"1.0.0\\",\\n  \\"dependencies\\": {\\n    \\"react\\": \\"^18.3.1\\",\\n    \\"react-dom\\": \\"^18.3.1\\",\\n    \\"lucide-react\\": \\"^0.460.0\\"\\n  }\\n}"
        },
        {
          "path": "index.html",
          "content": "<!DOCTYPE html><html><head><script src=\\"https://cdn.tailwindcss.com\\"></script></head><body><div id=\\"root\\"></div></body></html>"
        },
        {
          "path": "src/main.jsx",
          "content": "import React from 'react';\\nimport { createRoot } from 'react-dom/client';\\nimport App from './App.jsx';\\ncreateRoot(document.getElementById('root')).render(<App />);"
        },
        {
          "path": "src/App.jsx",
          "content": "import React, { useState } from 'react';\\nimport ResumeEditor from './components/ResumeEditor.jsx';\\nexport default function App() { return <ResumeEditor />; }"
        },
        {
          "path": "src/components/ResumeEditor.jsx",
          "content": "import React from 'react';\\nimport SkillsForm from './forms/SkillsForm.jsx';\\nexport default function ResumeEditor() { return <div><SkillsForm data={[]} onChange={() => {}} /></div>; }"
        },
        {
          "path": "src/components/forms/SkillsForm.jsx",
          "content": "import React from 'react';\\nexport default function SkillsForm() {\\n  return (\\n    <section className=\\"bg-gray-50 p-4 rounded\\">\\n      <h3 className=\\"font-medium mb-2\\">Skills</h3>\\n      <div className=\\"flex space-x-2 mb-2"
    `;

    const artifact = parseCodeArtifact(truncatedResumeCraft, 'Build ResumeCraft SaaS', null, 'REACT_APPLICATION');
    assert.ok(artifact);
    assert.equal(artifact.integrity.valid, true);
    assert.equal(artifact.integrity.errors.length, 0);

    const skillsForm = artifact.files.find((f) => f.path.includes('SkillsForm'));
    assert.ok(skillsForm);
    assert.match(skillsForm.content, /export default function SkillsForm/);
    assert.match(skillsForm.content, /Wrench/);
    assert.equal(checkFileSyntax(skillsForm.path, skillsForm.content).valid, true);
});

