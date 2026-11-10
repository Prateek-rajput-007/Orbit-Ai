import test from "node:test";
import assert from "node:assert/strict";
import {
    applyFileOperations,
    parseCodeArtifact,
    normalizeCodeProject,
    MAX_PROJECT_FILES,
    MAX_PROJECT_TOTAL_SIZE,
    MAX_SINGLE_FILE_SIZE,
} from "../utils/codeArtifact.js";

// ============================================================================
// 1. VERIFY THE COMPLETE REQUEST LIFECYCLE
// ============================================================================
test("Lifecycle: Trace and verify end-to-end request flow components", () => {
    // Step 1: User request simulation
    const req = {
        body: {
            prompt: "Add dark mode to my todo app",
            conversationId: "conv_test_123",
            agentMode: "auto",
        },
        user: { _id: "user_test_456" },
        headers: { accept: "text/event-stream" },
    };

    // Step 2: Conversation history retrieval simulation (getMemory)
    const history = [
        { role: "user", content: "Build a todo app" },
        {
            role: "assistant",
            content: "Here is your todo app",
            codeArtifact: {
                artifactId: "code_base_100",
                title: "Todo App",
                entryFile: "index.html",
                files: [
                    { path: "index.html", content: "<h1>Todo</h1>", language: "html", size: 13 },
                    { path: "app.js", content: "console.log('todo');", language: "javascript", size: 20 },
                ],
            },
        },
    ];

    // Step 3: Latest artifact selection (agent.controller.js lines 278-294)
    let existingCodeArtifact = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (
            msg &&
            msg.role === "assistant" &&
            msg.codeArtifact &&
            Array.isArray(msg.codeArtifact.files) &&
            msg.codeArtifact.files.length > 0
        ) {
            existingCodeArtifact = msg.codeArtifact;
            break;
        }
    }
    assert.ok(existingCodeArtifact);
    assert.equal(existingCodeArtifact.artifactId, "code_base_100");

    // Step 4: graph.invoke payload construction
    const graphState = {
        prompt: req.body.prompt,
        conversationId: req.body.conversationId,
        history: history.map(({ role, content }) => ({ role, content })),
        agentMode: req.body.agentMode,
        existingCodeArtifact,
    };
    // Ensure history mapped for graph does NOT duplicate file payloads to other agents
    assert.equal(graphState.history[1].codeArtifact, undefined);
    assert.ok(graphState.existingCodeArtifact.files.length > 0);

    // Step 5: Router metadata context check (router.js lines 58-65)
    const hasExistingProject =
        graphState?.existingCodeArtifact &&
        Array.isArray(graphState.existingCodeArtifact.files) &&
        graphState.existingCodeArtifact.files.length > 0;
    const projectSummary = hasExistingProject
        ? `Active Project in Conversation: "${graphState.existingCodeArtifact.title || "Web Application"}" (files: ${(graphState.existingCodeArtifact.files || []).map((f) => f.path).join(", ")})`
        : "No active code project in conversation";
    assert.ok(projectSummary.includes('Active Project in Conversation: "Todo App"'));
    assert.ok(projectSummary.includes("files: index.html, app.js"));

    // Step 6: Coding Agent operation handling
    const mockModelOutput = JSON.stringify({
        title: "Todo App (Dark Mode)",
        description: "Todo app with dark theme",
        summary: "Added dark mode styling",
        operations: [
            {
                type: "update",
                path: "index.html",
                content: "<h1 class='dark'>Todo</h1>",
            },
            {
                type: "create",
                path: "dark.css",
                content: "body.dark { background: #111; color: #eee; }",
            },
        ],
    });

    // Step 7: applyFileOperations execution
    const updatedArtifact = parseCodeArtifact(mockModelOutput, req.body.prompt, existingCodeArtifact);
    assert.ok(updatedArtifact);
    assert.equal(updatedArtifact.baseArtifactId, "code_base_100");
    assert.equal(updatedArtifact.files.length, 3);
    assert.ok(updatedArtifact.files.some((f) => f.path === "dark.css"));

    // Step 8: saveTurn payload verification
    const assistantMessageToSave = {
        content: `### ${updatedArtifact.title}\n\nUpdated app preview ready`,
        codeArtifact: updatedArtifact,
    };
    assert.equal(assistantMessageToSave.codeArtifact.baseArtifactId, "code_base_100");
    assert.equal(assistantMessageToSave.codeArtifact.files.length, 3);

    // Step 9: Frontend response format
    const finalPayload = {
        aiResponse: assistantMessageToSave.content,
        codeArtifact: updatedArtifact,
    };
    assert.ok(finalPayload.codeArtifact.bundledHtml);
    assert.ok(finalPayload.codeArtifact.previewDataUrl);
    assert.equal(finalPayload.codeArtifact.totalFiles, 3);
});

// ============================================================================
// 2. VERIFY ARTIFACT SELECTION & CONVERSATION ISOLATION
// ============================================================================
test("Isolation: Artifact selected exclusively from the active conversation", () => {
    const convA_history = [
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_conv_A",
                files: [{ path: "index.html", content: "<h1>Conv A</h1>" }],
            },
        },
    ];

    const convB_history = [
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_conv_B",
                files: [{ path: "index.html", content: "<h1>Conv B</h1>" }],
            },
        },
    ];

    const findArtifact = (hist) => {
        for (let i = hist.length - 1; i >= 0; i--) {
            const msg = hist[i];
            if (msg?.codeArtifact?.files?.length > 0) return msg.codeArtifact;
        }
        return null;
    };

    assert.equal(findArtifact(convA_history).artifactId, "art_conv_A");
    assert.equal(findArtifact(convB_history).artifactId, "art_conv_B");
});

test("Isolation: Latest valid artifact selected when multiple artifacts exist", () => {
    const history = [
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_turn_1",
                files: [{ path: "index.html", content: "<h1>v1</h1>" }],
            },
        },
        { role: "user", content: "General question" },
        { role: "assistant", content: "Explanation text without codeArtifact" },
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_turn_3",
                files: [{ path: "index.html", content: "<h1>v3</h1>" }],
            },
        },
        { role: "user", content: "Another question" },
        { role: "assistant", content: "Another response without artifact" },
    ];

    let selected = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.codeArtifact?.files?.length > 0) {
            selected = msg.codeArtifact;
            break;
        }
    }
    assert.ok(selected);
    assert.equal(selected.artifactId, "art_turn_3");
});

test("Isolation: Empty or invalid artifact (files: []) is ignored", () => {
    const history = [
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_valid_old",
                files: [{ path: "index.html", content: "<h1>Valid</h1>" }],
            },
        },
        {
            role: "assistant",
            codeArtifact: {
                artifactId: "art_empty",
                files: [], // empty files array
            },
        },
    ];

    let selected = null;
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.codeArtifact && Array.isArray(msg.codeArtifact.files) && msg.codeArtifact.files.length > 0) {
            selected = msg.codeArtifact;
            break;
        }
    }
    assert.ok(selected);
    assert.equal(selected.artifactId, "art_valid_old");
});

test("Isolation: Completely new project request produces fresh files without inheriting old project files", () => {
    const existingTodoArtifact = {
        artifactId: "todo_123",
        title: "Todo App",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Todo</h1>", language: "html", size: 13 },
            { path: "todo.js", content: "const todos = [];", language: "javascript", size: 18 },
        ],
    };

    // User asks for completely new calculator application
    const newCalculatorOutput = JSON.stringify({
        title: "Calculator App",
        description: "Standard Calculator",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Calculator</h1>", language: "html" },
            { path: "calc.js", content: "function calculate() {}", language: "javascript" },
        ],
    });

    const parsed = parseCodeArtifact(newCalculatorOutput, "Create a completely new calculator application", existingTodoArtifact);
    assert.equal(parsed.title, "Calculator App");
    assert.equal(parsed.files.length, 2);
    // Old files must not be present
    assert.equal(parsed.files.find((f) => f.path === "todo.js"), undefined);
    assert.ok(parsed.files.some((f) => f.path === "calc.js"));
});

// ============================================================================
// 3. VERIFY AGENT ROUTING & CONTEXT ISOLATION
// ============================================================================
test("Routing & Context Isolation: Router receives only minimal metadata, not file contents", () => {
    const bigFileContent = "x".repeat(50_000);
    const existing = {
        title: "Heavy Project",
        files: [
            { path: "index.html", content: bigFileContent },
            { path: "style.css", content: bigFileContent },
        ],
    };

    const hasExistingProject = existing?.files?.length > 0;
    const routerContext = hasExistingProject
        ? `Active Project in Conversation: "${existing.title || "Web Application"}" (files: ${(existing.files || []).map((f) => f.path).join(", ")})`
        : "No active code project in conversation";

    // Router context is tiny (< 100 bytes) and never includes the 100 KB file bodies
    assert.ok(routerContext.length < 200);
    assert.ok(!routerContext.includes(bigFileContent));
});

test("Routing: General coding explanation does not modify existing project", () => {
    const existing = {
        artifactId: "proj_1",
        files: [{ path: "index.html", content: "<h1>App</h1>" }],
    };

    // Model returns an explanation without any JSON or operations
    const explanationText = "In JavaScript, a closure is the combination of a function bundled together with references to its surrounding state.";
    const result = parseCodeArtifact(explanationText, "Explain closures in JavaScript", existing);

    // Existing artifact is preserved intact without corruption
    assert.equal(result.baseArtifactId, "proj_1");
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].path, "index.html");
});

// ============================================================================
// 4. VERIFY ACTUAL PERSISTENCE AND FAILURE BEHAVIOR
// ============================================================================
test("Persistence Safety: Historical artifact remains immutable when new artifact is created", () => {
    const originalArtifact = {
        artifactId: "code_original",
        title: "Original Project",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Original</h1>", language: "html", size: 17 },
            { path: "app.js", content: "console.log('original');", language: "javascript", size: 24 },
        ],
    };

    // Deep freeze / snapshot original
    const snapshot = JSON.stringify(originalArtifact);

    const payload = {
        operations: [
            { type: "update", path: "index.html", content: "<h1>Mutated</h1>" },
            { type: "create", path: "new.js", content: "console.log('new');" },
            { type: "delete", path: "app.js" },
        ],
    };

    const updated = applyFileOperations(originalArtifact, payload, "Mutate project");

    // Assert that the original object was NOT mutated
    assert.equal(JSON.stringify(originalArtifact), snapshot);
    assert.equal(originalArtifact.files.length, 2);
    assert.equal(originalArtifact.files[0].content, "<h1>Original</h1>");

    // Updated object has the changes
    assert.equal(updated.files.length, 2);
    assert.equal(updated.files.find((f) => f.path === "index.html").content, "<h1>Mutated</h1>");
    assert.equal(updated.files.find((f) => f.path === "app.js"), undefined);
});

test("Persistence Safety: Failed parsing preserves previous valid artifact", () => {
    const base = {
        artifactId: "base_safe_1",
        title: "Safe Base",
        entryFile: "index.html",
        files: [{ path: "index.html", content: "<h1>Safe</h1>", language: "html", size: 13 }],
    };

    const corruptOutput = "{ \"operations\": [ { type: \"broken_json";
    const result = parseCodeArtifact(corruptOutput, "Break it", base);

    assert.ok(result);
    assert.equal(result.baseArtifactId, "base_safe_1");
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].content, "<h1>Safe</h1>");
    assert.ok(result.summary.includes("Could not apply code updates"));
});

// ============================================================================
// 5. VERIFY LIMITS AND VALIDATION
// ============================================================================
test("Limits: Exceeding 50 files limit is strictly rejected", () => {
    const base = {
        artifactId: "base_limit",
        entryFile: "index.html",
        files: [{ path: "index.html", content: "<h1>Root</h1>", language: "html", size: 13 }],
    };

    // Attempt to add 50 more files (total 51)
    const operations = [];
    for (let i = 1; i <= 50; i++) {
        operations.push({
            type: "create",
            path: `file_${i}.js`,
            content: `// file ${i}`,
        });
    }

    assert.throws(
        () => applyFileOperations(base, { operations }, "Add 50 files"),
        /exceeds maximum allowed limit of 50 files/
    );
});

test("Limits: Exceeding 5 MB total project limit is strictly rejected", () => {
    const base = {
        artifactId: "base_size_limit",
        entryFile: "index.html",
        files: [{ path: "index.html", content: "<h1>Root</h1>", language: "html", size: 13 }],
    };

    // 3 files of 1.8 MB each = 5.4 MB total
    const bigContent = "a".repeat(1_800_000);
    const operations = [
        { type: "create", path: "big1.js", content: bigContent },
        { type: "create", path: "big2.js", content: bigContent },
        { type: "create", path: "big3.js", content: bigContent },
    ];

    assert.throws(
        () => applyFileOperations(base, { operations }, "Exceed 5MB"),
        /exceeds maximum allowed limit of 5 MB/
    );
});

test("Limits: Single file exceeding 2 MB is strictly rejected", () => {
    const base = {
        artifactId: "base_single_size",
        entryFile: "index.html",
        files: [{ path: "index.html", content: "<h1>Root</h1>", language: "html", size: 13 }],
    };

    const hugeContent = "a".repeat(2 * 1024 * 1024 + 10);
    assert.throws(
        () => applyFileOperations(base, {
            operations: [{ type: "create", path: "huge.js", content: hugeContent }],
        }, "Add huge file"),
        /exceeds single file limit of 2 MB/
    );
});

test("Limits: 75 KB model-context budget and omitted-file reporting", () => {
    const MAX_CONTEXT_FILE_BYTES = 75_000;
    const baseFiles = [
        { path: "index.html", content: "x".repeat(30_000), language: "html", size: 30_000 },
        { path: "app.js", content: "x".repeat(30_000), language: "javascript", size: 30_000 },
        { path: "extra1.js", content: "x".repeat(20_000), language: "javascript", size: 20_000 }, // 80k total -> should be omitted
        { path: "extra2.js", content: "x".repeat(10_000), language: "javascript", size: 10_000 },
    ];

    const sortedFiles = [...baseFiles].sort((a, b) => (a.size || 0) - (b.size || 0));
    const includedFiles = [];
    const omittedFiles = [];

    let accumulatedBytes = 0;
    for (const file of sortedFiles) {
        const fileBytes = Buffer.byteLength(file.content || "", "utf8");
        if (accumulatedBytes + fileBytes <= MAX_CONTEXT_FILE_BYTES) {
            includedFiles.push(file);
            accumulatedBytes += fileBytes;
        } else {
            omittedFiles.push(file);
        }
    }

    assert.ok(accumulatedBytes <= MAX_CONTEXT_FILE_BYTES);
    assert.ok(omittedFiles.length > 0);
    assert.equal(includedFiles.length + omittedFiles.length, baseFiles.length);

    // Verify omitted notice message formatting
    const omittedNotice = omittedFiles.length > 0
        ? `Notice: The following ${omittedFiles.length} file(s) were omitted from the prompt due to context size limits: ${omittedFiles.map((f) => `\`${f.path}\``).join(", ")}.`
        : "";
    assert.ok(omittedNotice.includes("omitted from the prompt due to context size limits"));
});

test("Validation: Deleting active entry file without another HTML file is rejected", () => {
    const base = {
        artifactId: "base_entry_del",
        entryFile: "index.html",
        files: [
            { path: "index.html", content: "<h1>Only HTML</h1>", language: "html", size: 18 },
            { path: "app.js", content: "console.log('hi');", language: "javascript", size: 18 },
        ],
    };

    assert.throws(
        () => applyFileOperations(base, {
            operations: [{ type: "delete", path: "index.html" }],
        }),
        /Cannot delete entry file "index.html" without an alternative HTML entry point/
    );
});

// ============================================================================
// 6. FUNCTIONAL MULTI-TURN WORKFLOW SCENARIOS
// ============================================================================
test("Functional: 5-Turn Incremental Workflow (Todo App -> Dark Mode -> Filters -> Button Style -> New Calculator)", () => {
    // --- TURN 1: Initial Todo Generation ---
    const turn1Output = {
        title: "Todo Master",
        description: "Interactive task manager",
        summary: "Created initial todo app",
        entryFile: "index.html",
        files: [
            {
                path: "index.html",
                content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><div id="todo-container"><input id="new-todo"><button id="add-btn">Add Task</button><ul id="todo-list"></ul></div><script src="app.js"></script></body></html>`,
                language: "html",
            },
            {
                path: "style.css",
                content: `body { font-family: sans-serif; background: #fafafa; } #add-btn { background: blue; color: white; }`,
                language: "css",
            },
            {
                path: "app.js",
                content: `document.addEventListener('DOMContentLoaded', () => { window.todos = []; function render() {} });`,
                language: "javascript",
            },
        ],
    };
    const turn1Artifact = normalizeCodeProject(turn1Output, "Generate a new Todo application");
    assert.equal(turn1Artifact.baseArtifactId, null);
    assert.equal(turn1Artifact.files.length, 3);

    // --- TURN 2: Add Dark Mode ---
    const turn2Update = {
        title: "Todo Master",
        summary: "Added dark mode toggle and dark theme styles",
        operations: [
            {
                type: "update",
                path: "style.css",
                content: `body { font-family: sans-serif; background: #fafafa; } body.dark { background: #181818; color: #fff; } #add-btn { background: blue; color: white; }`,
            },
            {
                type: "create",
                path: "darkmode.js",
                content: `function toggleDark() { document.body.classList.toggle('dark'); }`,
            },
        ],
    };
    const turn2Artifact = applyFileOperations(turn1Artifact, turn2Update, "Add dark mode. Preserve all existing Todo functionality.");
    assert.equal(turn2Artifact.baseArtifactId, turn1Artifact.artifactId);
    assert.equal(turn2Artifact.files.length, 4);
    // index.html and app.js must be untouched
    assert.equal(turn2Artifact.files.find((f) => f.path === "index.html").content, turn1Artifact.files.find((f) => f.path === "index.html").content);
    assert.equal(turn2Artifact.files.find((f) => f.path === "app.js").content, turn1Artifact.files.find((f) => f.path === "app.js").content);
    assert.ok(turn2Artifact.files.find((f) => f.path === "style.css").content.includes("body.dark"));

    // --- TURN 3: Add Task Filters ---
    const turn3Update = {
        title: "Todo Master",
        summary: "Added task filters for All, Active and Completed",
        operations: [
            {
                type: "create",
                path: "filters.js",
                content: `function filterTasks(status) { return window.todos.filter(t => status === 'all' || t.status === status); }`,
            },
            {
                type: "update",
                path: "index.html",
                content: `<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><div id="todo-container"><div id="filters"><button>All</button><button>Active</button><button>Completed</button></div><input id="new-todo"><button id="add-btn">Add Task</button><ul id="todo-list"></ul></div><script src="app.js"></script><script src="darkmode.js"></script><script src="filters.js"></script></body></html>`,
            },
        ],
    };
    const turn3Artifact = applyFileOperations(turn2Artifact, turn3Update, "Add task filters for All, Active and Completed.");
    assert.equal(turn3Artifact.baseArtifactId, turn2Artifact.artifactId);
    assert.equal(turn3Artifact.files.length, 5);
    // Dark mode styles from turn 2 must still exist
    assert.ok(turn3Artifact.files.find((f) => f.path === "style.css").content.includes("body.dark"));
    // New filters.js exists
    assert.ok(turn3Artifact.files.some((f) => f.path === "filters.js"));

    // --- TURN 4: Change Primary Button Styling (Preserve task logic) ---
    const turn4Update = {
        title: "Todo Master",
        summary: "Updated button styling with amber gradient and rounded pill corners",
        operations: [
            {
                type: "update",
                path: "style.css",
                content: `body { font-family: sans-serif; background: #fafafa; } body.dark { background: #181818; color: #fff; } #add-btn { background: linear-gradient(135deg, #f59e0b, #d97706); color: black; border-radius: 9999px; }`,
            },
        ],
    };
    const turn4Artifact = applyFileOperations(turn3Artifact, turn4Update, "Change the primary button styling. Do not modify the task logic.");
    assert.equal(turn4Artifact.baseArtifactId, turn3Artifact.artifactId);
    assert.equal(turn4Artifact.files.length, 5);
    // Button style is updated
    assert.ok(turn4Artifact.files.find((f) => f.path === "style.css").content.includes("#add-btn { background: linear-gradient"));
    // All filters and scripts from turns 1, 2, 3 are preserved
    assert.ok(turn4Artifact.files.some((f) => f.path === "filters.js"));
    assert.ok(turn4Artifact.files.some((f) => f.path === "darkmode.js"));
    assert.ok(turn4Artifact.files.some((f) => f.path === "app.js"));

    // --- TURN 5: Create a completely new calculator application ---
    const turn5NewAppOutput = JSON.stringify({
        title: "Quick Calc",
        description: "Scientific & standard calculator",
        entryFile: "index.html",
        files: [
            {
                path: "index.html",
                content: `<!DOCTYPE html><html><body><div id="calculator"><input id="display"><div class="keys"><button>7</button><button>8</button><button>9</button></div></div><script src="calc.js"></script></body></html>`,
                language: "html",
            },
            {
                path: "calc.css",
                content: `#calculator { width: 300px; margin: 0 auto; }`,
                language: "css",
            },
            {
                path: "calc.js",
                content: `function appendNum(n) { document.getElementById('display').value += n; }`,
                language: "javascript",
            },
        ],
    });

    const turn5Artifact = parseCodeArtifact(turn5NewAppOutput, "Create a completely new calculator application", turn4Artifact);
    assert.equal(turn5Artifact.title, "Quick Calc");
    assert.equal(turn5Artifact.files.length, 3);
    // Must NOT have any of the old todo files
    assert.equal(turn5Artifact.files.find((f) => f.path === "darkmode.js"), undefined);
    assert.equal(turn5Artifact.files.find((f) => f.path === "filters.js"), undefined);
    assert.equal(turn5Artifact.files.find((f) => f.path === "app.js"), undefined);
    assert.ok(turn5Artifact.files.some((f) => f.path === "calc.js"));
    assert.ok(turn5Artifact.files.some((f) => f.path === "calc.css"));
});
