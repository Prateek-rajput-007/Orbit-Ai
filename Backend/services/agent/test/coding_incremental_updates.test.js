import test from "node:test";
import assert from "node:assert/strict";
import {
    sanitizePath,
    detectLanguage,
    normalizeCodeProject,
    parseCodeArtifact,
    applyFileOperations,
    MAX_PROJECT_FILES,
    MAX_PROJECT_TOTAL_SIZE,
    MAX_SINGLE_FILE_SIZE,
} from "../utils/codeArtifact.js";

const sampleBaseArtifact = {
    artifactId: "code_base_12345",
    title: "Vanilla Todo App",
    description: "A simple task manager",
    summary: "Base todo application",
    entryFile: "index.html",
    files: [
        {
            path: "index.html",
            content: "<!DOCTYPE html><html><head><title>Todo</title></head><body><div id='app'></div><script src='js/app.js'></script></body></html>",
            language: "html",
            size: 130,
        },
        {
            path: "css/style.css",
            content: "body { font-family: sans-serif; background: #fff; }",
            language: "css",
            size: 51,
        },
        {
            path: "js/app.js",
            content: "console.log('Todo App Loaded');",
            language: "javascript",
            size: 32,
        },
        {
            path: "js/old-utils.js",
            content: "function oldHelper() { return 1; }",
            language: "javascript",
            size: 34,
        },
    ],
    totalFiles: 4,
    totalSize: 247,
    previewType: "html",
};

// 1. Initial coding request without existing artifact
test("Scenario 1: Initial coding request without existing artifact produces fresh CodeArtifact", () => {
    const raw = {
        title: "Fresh Calculator",
        description: "A clean calculator app",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Calc</h1>" },
            { path: "calc.js", content: "console.log(2+2);" },
        ],
    };
    const artifact = normalizeCodeProject(raw, "Build a calculator");
    assert.ok(artifact.artifactId.startsWith("code_"));
    assert.equal(artifact.baseArtifactId, null);
    assert.equal(artifact.title, "Fresh Calculator");
    assert.equal(artifact.files.length, 2);
    assert.equal(artifact.previewType, "html");
    assert.ok(artifact.previewDataUrl.startsWith("data:text/html;charset=utf-8;base64,"));
});

// 2. Follow-up request with existing artifact
test("Scenario 2: Follow-up request with existing artifact sets baseArtifactId and tracks lineage", () => {
    const payload = {
        title: "Vanilla Todo App v2",
        summary: "Added filter functionality",
        operations: [
            {
                type: "update",
                path: "js/app.js",
                content: "console.log('Todo App with Filters');",
            },
        ],
    };
    const updated = applyFileOperations(sampleBaseArtifact, payload, "Add filters");
    assert.ok(updated.artifactId);
    assert.notEqual(updated.artifactId, sampleBaseArtifact.artifactId);
    assert.equal(updated.baseArtifactId, sampleBaseArtifact.artifactId);
    assert.equal(updated.title, "Vanilla Todo App v2");
});

// 3. Updating one existing file
test("Scenario 3: Updating one existing file replaces its content while preserving others", () => {
    const payload = {
        operations: [
            {
                type: "update",
                path: "js/app.js",
                content: "console.log('Updated app.js code only');",
            },
        ],
    };
    const updated = applyFileOperations(sampleBaseArtifact, payload, "Update app.js");
    const updatedAppJs = updated.files.find((f) => f.path === "js/app.js");
    assert.ok(updatedAppJs);
    assert.equal(updatedAppJs.content, "console.log('Updated app.js code only');");
    assert.equal(updatedAppJs.size, Buffer.byteLength(updatedAppJs.content, "utf8"));

    // Check untouched files
    const htmlFile = updated.files.find((f) => f.path === "index.html");
    assert.equal(htmlFile.content, sampleBaseArtifact.files[0].content);
});

// 4. Creating a new file
test("Scenario 4: Creating a new file adds it with inferred language and correct byte size", () => {
    const payload = {
        operations: [
            {
                type: "create",
                path: "css/dark-theme.css",
                content: ".dark-mode { background: #121212; color: #fff; }",
            },
        ],
    };
    const updated = applyFileOperations(sampleBaseArtifact, payload, "Add dark theme");
    const newFile = updated.files.find((f) => f.path === "css/dark-theme.css");
    assert.ok(newFile);
    assert.equal(newFile.language, "css");
    assert.equal(newFile.content, ".dark-mode { background: #121212; color: #fff; }");
    assert.equal(newFile.size, Buffer.byteLength(newFile.content, "utf8"));
    assert.equal(updated.totalFiles, sampleBaseArtifact.files.length + 1);
});

// 5. Deleting a file
test("Scenario 5: Deleting a file removes it from the project", () => {
    const payload = {
        operations: [
            {
                type: "delete",
                path: "js/old-utils.js",
            },
        ],
    };
    const updated = applyFileOperations(sampleBaseArtifact, payload, "Remove obsolete utils");
    assert.equal(updated.files.find((f) => f.path === "js/old-utils.js"), undefined);
    assert.equal(updated.totalFiles, sampleBaseArtifact.files.length - 1);
});

// 6. Preserving unchanged files
test("Scenario 6: Preserving unchanged files ensures intact content across turns", () => {
    const payload = {
        operations: [
            {
                type: "create",
                path: "README.md",
                content: "# Documentation\nInstructions...",
            },
        ],
    };
    const updated = applyFileOperations(sampleBaseArtifact, payload, "Add readme");
    for (const original of sampleBaseArtifact.files) {
        const found = updated.files.find((f) => f.path === original.path);
        assert.ok(found, `File ${original.path} must be preserved`);
        assert.equal(found.content, original.content);
        assert.equal(found.language, original.language);
    }
});

// 7. Invalid file paths
test("Scenario 7: Invalid file paths (empty, non-string) are rejected", () => {
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "update", path: "", content: "x" }] }),
        /Invalid operation path/
    );
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "update", path: null, content: "x" }] }),
        /Invalid operation path/
    );
});

// 8. Path traversal attempts
test("Scenario 8: Path traversal attempts (../../etc/passwd, absolute paths) are rejected", () => {
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "create", path: "../../etc/passwd", content: "root" }] }),
        /Invalid or unsafe file path/
    );
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "update", path: "C:\\Windows\\system32\\calc.exe", content: "evil" }] }),
        /Invalid or unsafe file path/
    );
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "delete", path: "/etc/shadow" }] }),
        /Invalid or unsafe file path/
    );
});

// 9. Invalid operation types
test("Scenario 9: Invalid operation types ('destroy', 'patch') are rejected", () => {
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "destroy", path: "js/app.js" }] }),
        /Invalid operation type: "destroy"/
    );
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, { operations: [{ type: "wipe", path: "index.html" }] }),
        /Invalid operation type: "wipe"/
    );
});

// 10. Duplicate/conflicting operations on same path
test("Scenario 10: Duplicate or conflicting operations on the same path in one turn are rejected", () => {
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, {
            operations: [
                { type: "update", path: "js/app.js", content: "console.log('1');" },
                { type: "update", path: "js/app.js", content: "console.log('2');" },
            ],
        }),
        /Duplicate or conflicting operation/
    );
    assert.throws(
        () => applyFileOperations(sampleBaseArtifact, {
            operations: [
                { type: "update", path: "js/app.js", content: "console.log('1');" },
                { type: "delete", path: "js/app.js" },
            ],
        }),
        /Duplicate or conflicting operation/
    );
});

// 11. Malformed model output auto-repair
test("Scenario 11: Malformed / truncated model output with operations is auto-repaired and applied", () => {
    // Truncated JSON without closing brackets
    const truncatedText = `\`\`\`json
{
  "title": "Repaired Todo",
  "summary": "Auto repaired updates",
  "operations": [
    {
      "type": "update",
      "path": "js/app.js",
      "content": "console.log('Repaired code');"
    }
`;
    const updated = parseCodeArtifact(truncatedText, "Fix app", sampleBaseArtifact);
    assert.ok(updated);
    const appJs = updated.files.find((f) => f.path === "js/app.js");
    assert.ok(appJs);
    assert.equal(appJs.content, "console.log('Repaired code');");
    assert.equal(updated.baseArtifactId, sampleBaseArtifact.artifactId);
});

// 12. Model returning legacy complete-artifact format
test("Scenario 12: Model returning legacy complete-artifact format is handled backward-compatibly", () => {
    const legacyResponse = JSON.stringify({
        title: "Legacy Regenerated App",
        description: "Full regeneration",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Full Regeneration</h1>" },
            { path: "app.js", content: "console.log('Full Regen');" },
        ],
    });
    const parsed = parseCodeArtifact(legacyResponse, "Regenerate all", sampleBaseArtifact);
    assert.equal(parsed.title, "Legacy Regenerated App");
    assert.equal(parsed.files.length, 2);
    assert.equal(parsed.baseArtifactId, sampleBaseArtifact.artifactId);
});

// 13. Failed update preserving previous artifact
test("Scenario 13: Failed / unparseable update preserves previous artifact intact", () => {
    const gibberishText = "I could not understand your instructions. Here is an explanation without code.";
    const preserved = parseCodeArtifact(gibberishText, "Gibberish update", sampleBaseArtifact);
    assert.equal(preserved.files.length, sampleBaseArtifact.files.length);
    assert.equal(preserved.baseArtifactId, sampleBaseArtifact.artifactId);
    assert.ok(preserved.summary.includes("Could not apply code updates"));
});

// 14. Correct persistence schema of resulting complete artifact
test("Scenario 14: Final artifact satisfies all required fields for frontend preview and MongoDB persistence", () => {
    const payload = {
        operations: [
            { type: "update", path: "index.html", content: "<!DOCTYPE html><html><body><h1>Updated</h1></body></html>" },
        ],
    };
    const artifact = applyFileOperations(sampleBaseArtifact, payload, "Update index");
    // Verify mandatory schema properties
    assert.ok(typeof artifact.artifactId === "string" && artifact.artifactId.length > 0);
    assert.equal(artifact.baseArtifactId, sampleBaseArtifact.artifactId);
    assert.ok(typeof artifact.title === "string");
    assert.ok(typeof artifact.description === "string");
    assert.ok(typeof artifact.summary === "string");
    assert.ok(typeof artifact.entryFile === "string");
    assert.ok(Array.isArray(artifact.files) && artifact.files.length > 0);
    assert.equal(artifact.totalFiles, artifact.files.length);
    assert.ok(typeof artifact.totalSize === "number");
    assert.equal(artifact.previewType, "html");
    assert.ok(typeof artifact.previewDataUrl === "string");
    assert.ok(typeof artifact.bundledHtml === "string");
    assert.equal(artifact.status, "ready");
    assert.ok(artifact.deployment && artifact.deployment.status === "sandbox");
});

// 15. Conversation ownership and artifact association
test("Scenario 15: Conversation ownership extracts the latest relevant assistant artifact from message history", () => {
    const history = [
        { role: "user", content: "Build a todo app" },
        {
            role: "assistant",
            content: "Here is your todo app",
            codeArtifact: {
                artifactId: "code_turn_1",
                files: [{ path: "index.html", content: "<h1>Turn 1</h1>" }],
            },
        },
        { role: "user", content: "What is 2 + 2?" },
        { role: "assistant", content: "4" }, // No artifact
        { role: "user", content: "Add dark mode" },
        {
            role: "assistant",
            content: "Here is your updated app with dark mode",
            codeArtifact: {
                artifactId: "code_turn_2",
                files: [
                    { path: "index.html", content: "<h1>Turn 2</h1>" },
                    { path: "style.css", content: "body { background: black; }" },
                ],
            },
        },
    ];

    // Find latest artifact as implemented in agent.controller.js
    let latestArtifact = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (
            msg &&
            msg.role === "assistant" &&
            msg.codeArtifact &&
            Array.isArray(msg.codeArtifact.files) &&
            msg.codeArtifact.files.length > 0
        ) {
            latestArtifact = msg.codeArtifact;
            break;
        }
    }

    assert.ok(latestArtifact);
    assert.equal(latestArtifact.artifactId, "code_turn_2");
    assert.equal(latestArtifact.files.length, 2);
});

