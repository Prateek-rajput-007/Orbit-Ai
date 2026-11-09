import test from "node:test";
import assert from "node:assert/strict";
import {
    sanitizePath,
    detectLanguage,
    repairIncompleteJavascript,
    transformScriptForSandbox,
    bundleCodePreview,
    parseCodeArtifact,
    normalizeCodeProject,
} from "../utils/codeArtifact.js";
import { transformScriptForSandboxClient, bundleCodePreviewClient } from "../../../../Frontend/src/lib/codePreviewBundler.js";

test("CodeArtifact - sanitizePath prevents directory traversal and cleans drive letters", () => {
    assert.equal(sanitizePath("../../etc/passwd"), "etc/passwd");
    assert.equal(sanitizePath("C:\\Windows\\system32\\calc.exe"), "Windows/system32/calc.exe");
    assert.equal(sanitizePath("./src/components/App.jsx"), "src/components/App.jsx");
    assert.equal(sanitizePath(""), "index.html");
});

test("CodeArtifact - detectLanguage detects proper language from extension", () => {
    assert.equal(detectLanguage("index.html"), "html");
    assert.equal(detectLanguage("styles.css"), "css");
    assert.equal(detectLanguage("script.js"), "javascript");
    assert.equal(detectLanguage("App.jsx"), "jsx");
    assert.equal(detectLanguage("main.py"), "python");
    assert.equal(detectLanguage("unknown.xyz"), "text");
});

test("CodeArtifact - repairIncompleteJavascript never breaks valid JS with comments containing braces", () => {
    const validWithComment = `// Config: { debug: true, max: 10 }\nfunction test() {\n  return 42;\n}\n`;
    const repaired = repairIncompleteJavascript(validWithComment);
    assert.equal(repaired, validWithComment);
    assert.doesNotThrow(() => new Function(repaired));

    const validMultiLineComment = `/* {\n * block comment with braces {\n */\nconst x = 100;\n`;
    const repaired2 = repairIncompleteJavascript(validMultiLineComment);
    assert.equal(repaired2, validMultiLineComment);
    assert.doesNotThrow(() => new Function(repaired2));
});

test("CodeArtifact - repairIncompleteJavascript repairs unclosed braces and truncated statements", () => {
    const unclosed = `function calculate() {\n  const a = 1;\n  if (a > 0) {\n    return a;`;
    const repaired = repairIncompleteJavascript(unclosed);
    assert.doesNotThrow(() => new Function(repaired));
    assert.ok(repaired.endsWith("}"));
});

test("CodeArtifact - transformScriptForSandbox strips ES module exports for inline execution", () => {
    const modCode = `export function greet(name) { return 'Hello ' + name; }\nexport const VERSION = '1.0.0';\nexport default greet;`;
    const transformed = transformScriptForSandbox(modCode);
    assert.ok(!transformed.includes("export default"));
    assert.ok(!transformed.includes("export function"));
    assert.ok(transformed.includes("function greet"));
    assert.doesNotThrow(() => new Function(transformed + "\nreturn greet('Orbit');"));
});

test("CodeArtifact - bundleCodePreview inlines CSS and JS with attributes and updated CSP", () => {
    const files = [
        {
            path: "index.html",
            content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="./css/styles.css"></head><body><div id="app"></div><script type="module" src="./js/script.js" defer></script></body></html>`,
            language: "html"
        },
        {
            path: "css/styles.css",
            content: `body { background-color: #0f172a; }`,
            language: "css"
        },
        {
            path: "js/script.js",
            content: `export function render() { document.getElementById('app').textContent = 'Loaded'; }\nrender();`,
            language: "javascript"
        }
    ];

    const bundled = bundleCodePreview(files, "index.html");
    assert.ok(bundled.includes("/* Inlined: css/styles.css */"), "CSS must be inlined");
    assert.ok(bundled.includes("/* Inlined: js/script.js */"), "JS must be inlined");
    assert.ok(!bundled.includes('src="./js/script.js"'), "Original script src tag must be replaced");
    assert.ok(bundled.includes("img-src * data: blob: https:"), "CSP must permit CDN and external images");
    assert.ok(bundled.includes("orbit-sandbox-shims"), "Sandbox shims must be present");
});

test("CodeArtifact - normalizeCodeProject safely handles object content and resolves entry file", () => {
    const raw = {
        title: "Test Dashboard",
        entryFile: "nonexistent.html",
        files: [
            { path: "public/index.html", content: "<html><body>App</body></html>" },
            { path: "config.json", content: { api: "https://api.example.com", port: 3000 } }
        ]
    };

    const project = normalizeCodeProject(raw, "create dashboard");
    assert.equal(project.entryFile, "public/index.html", "entryFile should resolve to existing HTML");
    const jsonFile = project.files.find(f => f.path === "config.json");
    assert.ok(jsonFile && typeof jsonFile.content === "string");
    assert.ok(jsonFile.content.includes("https://api.example.com"));
});

test("CodeArtifact - parseCodeArtifact handles truncated JSON auto-repair", () => {
    const truncatedJson = `\`\`\`json
{
  "title": "Truncated Calculator",
  "description": "A calculator that was truncated",
  "files": [
    {
      "path": "index.html",
      "content": "<!DOCTYPE html><html><body><h1>Calc</h1></body></html>",
      "language": "html"
    },
    {
      "path": "js/app.js",
      "content": "console.log('calc');
`; // truncated before closing strings and brackets

    const project = parseCodeArtifact(truncatedJson, "calculator");
    assert.ok(project);
    assert.ok(project.files.length > 0);
    assert.ok(project.files.some(f => f.path === "index.html"));
});

test("Frontend Bundler - bundleCodePreviewClient mirrors backend bundling and export stripping", () => {
    const files = [
        { path: "index.html", content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Client Preview</h1><script src="main.js"></script></body></html>` },
        { path: "styles.css", content: `h1 { color: gold; }` },
        { path: "main.js", content: `export const message = 'Client works';\nconsole.log(message);` }
    ];

    const bundledClient = bundleCodePreviewClient(files, "index.html");
    assert.ok(bundledClient.includes("/* Inlined: styles.css */"));
    assert.ok(bundledClient.includes("/* Inlined: main.js */"));
    assert.ok(bundledClient.includes("const message = 'Client works'"));
    assert.ok(!bundledClient.includes("export const message"));
    assert.ok(bundledClient.includes("img-src * data: blob: https:"));
});

test("SSE Stream Processor - ignores keepalive comments and correctly preserves event across chunk boundaries", () => {
    let currentEvent = "message";
    let capturedData = null;
    let stageMessages = [];

    const processLines = (lines) => {
        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            if (!line || line.startsWith(":")) {
                continue; // SSE comment keepalive ignored
            }
            if (line.startsWith("event: ")) {
                currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
                const parsed = JSON.parse(line.slice(6));
                if (currentEvent === "stage") {
                    stageMessages.push(parsed.message);
                } else if (currentEvent === "ready") {
                    capturedData = parsed;
                }
            }
        }
    };

    // Chunk 1: Keepalive comment followed by stage update
    processLines([": keepalive", "event: stage", "data: {\"message\":\"Analyzing image composition...\"}"]);
    assert.equal(stageMessages.length, 1);
    assert.equal(stageMessages[0], "Analyzing image composition...");

    // Chunk 2: Event header arriving in one chunk, data arriving in next chunk
    processLines([": keepalive", "event: ready"]);
    // Simulating next chunk arriving with data:
    processLines(["data: {\"aiResponse\":\"Analysis complete\",\"userMessageId\":\"u1\",\"assistantMessageId\":\"a1\"}"]);

    assert.ok(capturedData !== null, "Ready data must be captured even when split across chunk boundaries");
    assert.equal(capturedData.aiResponse, "Analysis complete");
    assert.equal(capturedData.assistantMessageId, "a1");
});

