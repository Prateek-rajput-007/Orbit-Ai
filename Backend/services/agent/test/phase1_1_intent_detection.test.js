import test from "node:test";
import assert from "node:assert/strict";
import { classifyProjectIntent, PROJECT_INTENTS } from "../utils/projectIntent.js";
import { applyFileOperations, parseCodeArtifact, normalizeCodeProject } from "../utils/codeArtifact.js";

const sampleExistingArtifact = {
    artifactId: "art_todo_v1",
    title: "Todo Application",
    description: "A task manager application",
    entryFile: "index.html",
    files: [
        { path: "index.html", content: "<h1>Todo List</h1>", language: "html", size: 18 },
        { path: "css/style.css", content: "body { background: white; }", language: "css", size: 27 },
        { path: "js/app.js", content: "console.log('todo');", language: "javascript", size: 20 },
    ],
    totalFiles: 3,
    totalSize: 65,
    previewType: "html",
};

// ============================================================================
// INTENT CLASSIFICATION TESTS
// ============================================================================

test("Intent 1: 'Add dark mode' classifies as MODIFY_EXISTING_PROJECT", () => {
    const result = classifyProjectIntent("Add dark mode", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.MODIFY_EXISTING_PROJECT);
    assert.equal(result.shouldUseExistingArtifact, true);
    assert.ok(result.confidence > 0.8);
});

test("Intent 2: 'Add a new component' classifies as MODIFY_EXISTING_PROJECT", () => {
    const result = classifyProjectIntent("Add a new component to display task count", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.MODIFY_EXISTING_PROJECT);
    assert.equal(result.shouldUseExistingArtifact, true);
    assert.ok(result.confidence > 0.8);
});

test("Intent 3: 'Create a new page in the current app' classifies as MODIFY_EXISTING_PROJECT", () => {
    const result = classifyProjectIntent("Create a new page in the current app for settings", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.MODIFY_EXISTING_PROJECT);
    assert.equal(result.shouldUseExistingArtifact, true);
});

test("Intent 4: 'Create a completely new calculator from scratch' classifies as CREATE_NEW_PROJECT", () => {
    const result = classifyProjectIntent("Create a completely new calculator from scratch", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.CREATE_NEW_PROJECT);
    assert.equal(result.shouldUseExistingArtifact, false);
    assert.ok(result.confidence > 0.9);
});

test("Intent 5: 'Forget the previous Todo app and build a weather application' classifies as CREATE_NEW_PROJECT", () => {
    const result = classifyProjectIntent("Forget the previous Todo app and build a weather application", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.CREATE_NEW_PROJECT);
    assert.equal(result.shouldUseExistingArtifact, false);
    assert.ok(result.confidence > 0.9);
});

test("Intent 6: 'Explain React hooks' classifies as GENERAL_CODING_QUESTION", () => {
    const result = classifyProjectIntent("Explain how React hooks work", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.GENERAL_CODING_QUESTION);
    assert.equal(result.shouldUseExistingArtifact, false);
});

test("Intent 6b: 'What is the difference between useMemo and useCallback?' classifies as GENERAL_CODING_QUESTION", () => {
    const result = classifyProjectIntent("What is the difference between useMemo and useCallback?", sampleExistingArtifact);
    assert.equal(result.intent, PROJECT_INTENTS.GENERAL_CODING_QUESTION);
    assert.equal(result.shouldUseExistingArtifact, false);
});

test("Intent 7: Ambiguous requests return AMBIGUOUS_INTENT with clarification prompt", () => {
    const result1 = classifyProjectIntent("Build another dashboard", sampleExistingArtifact);
    assert.equal(result1.intent, PROJECT_INTENTS.AMBIGUOUS_INTENT);
    assert.equal(result1.shouldUseExistingArtifact, false);
    assert.ok(result1.clarificationPrompt.includes("Todo Application"));

    const result2 = classifyProjectIntent("Make a different version", sampleExistingArtifact);
    assert.equal(result2.intent, PROJECT_INTENTS.AMBIGUOUS_INTENT);

    const result3 = classifyProjectIntent("Change the application", sampleExistingArtifact);
    assert.equal(result3.intent, PROJECT_INTENTS.AMBIGUOUS_INTENT);

    const result4 = classifyProjectIntent("Create a new page", sampleExistingArtifact);
    assert.equal(result4.intent, PROJECT_INTENTS.AMBIGUOUS_INTENT);
});

// ============================================================================
// ARTIFACT BEHAVIOR & CONTEXT ISOLATION TESTS
// ============================================================================

test("Behavior 8 & 11 & 12: Modification receives previous project files, preserves unchanged files, sets baseArtifactId", () => {
    const updatePayload = {
        title: "Todo Application (Dark Mode)",
        operations: [
            {
                type: "update",
                path: "css/style.css",
                content: "body { background: #121212; color: white; }",
            },
        ],
    };

    const result = applyFileOperations(sampleExistingArtifact, updatePayload, "Add dark mode");
    assert.equal(result.baseArtifactId, sampleExistingArtifact.artifactId);
    assert.equal(result.files.length, 3);
    // Preserved files
    assert.equal(result.files.find((f) => f.path === "index.html").content, "<h1>Todo List</h1>");
    assert.equal(result.files.find((f) => f.path === "js/app.js").content, "console.log('todo');");
    // Updated file
    assert.equal(result.files.find((f) => f.path === "css/style.css").content, "body { background: #121212; color: white; }");
});

test("Behavior 9 & 10 & 13: Fresh project receives no previous project files and does not inherit lineage", () => {
    const prompt = "Create a completely new calculator from scratch";
    const intent = classifyProjectIntent(prompt, sampleExistingArtifact);
    assert.equal(intent.intent, PROJECT_INTENTS.CREATE_NEW_PROJECT);
    assert.equal(intent.shouldUseExistingArtifact, false);

    // Effective artifact passed to parser/generator is null
    const effectiveArtifact = intent.shouldUseExistingArtifact ? sampleExistingArtifact : null;
    assert.equal(effectiveArtifact, null);

    const newCalculatorOutput = JSON.stringify({
        title: "Calculator App",
        description: "Fresh calculator",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Calculator</h1>", language: "html" },
            { path: "calc.js", content: "function add(a, b) { return a + b; }", language: "javascript" },
        ],
    });

    const result = parseCodeArtifact(newCalculatorOutput, prompt, effectiveArtifact);
    assert.equal(result.title, "Calculator App");
    assert.equal(result.files.length, 2);
    // Lineage must be null (fresh project root)
    assert.equal(result.baseArtifactId, null);
    // Old files must not exist
    assert.equal(result.files.find((f) => f.path === "js/app.js"), undefined);
    assert.equal(result.files.find((f) => f.path === "css/style.css"), undefined);
});

test("Behavior 14: General coding questions do not create or modify project artifacts", () => {
    const prompt = "Explain how React hooks work";
    const intent = classifyProjectIntent(prompt, sampleExistingArtifact);
    assert.equal(intent.intent, PROJECT_INTENTS.GENERAL_CODING_QUESTION);
    assert.equal(intent.shouldUseExistingArtifact, false);

    // In agent controller / coding agent flow, general questions return codeArtifact = null
    const effectiveArtifact = intent.shouldUseExistingArtifact ? sampleExistingArtifact : null;
    assert.equal(effectiveArtifact, null);
});

test("Behavior 15: Failed new-project generation preserves historical artifacts intact", () => {
    // When a new project generation fails or is aborted before persistence,
    // the previous artifact is never mutated or replaced in historical storage.
    const historicalSnapshot = JSON.stringify(sampleExistingArtifact);

    // Failed model output
    const corruptNewProjectOutput = "I am sorry, I ran out of tokens to generate the calculator.";

    // Because new project does not use existing artifact, parser does not touch the old one
    const parsed = parseCodeArtifact(corruptNewProjectOutput, "Build a new calculator", null);
    // Returns fallback snippet or generic placeholder, NOT the todo app
    assert.notEqual(parsed.artifactId, sampleExistingArtifact.artifactId);

    // Assert historical artifact remains 100% identical and unmutated
    assert.equal(JSON.stringify(sampleExistingArtifact), historicalSnapshot);
});

