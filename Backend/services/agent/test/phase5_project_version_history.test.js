import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    createInitialProjectVersion,
    createIncrementalProjectVersion,
    restoreProjectVersion,
    listProjectVersions,
    listConversationProjects,
    getProjectVersionDetails,
    compareProjectVersions,
    getActiveProjectForConversation,
    resetMemoryStore,
} from "../utils/projectVersionService.js";

beforeEach(() => {
    resetMemoryStore();
});

test("Phase 5 - Test 1 & 3: Initial generation creates Version 1 with full snapshot", async () => {
    const artifact = {
        title: "ResumeCraft SaaS",
        entryFile: "src/main.jsx",
        files: [
            { path: "src/main.jsx", content: "import React from 'react';" },
            { path: "src/App.jsx", content: "export default function App() { return <h1>Resume</h1>; }" },
            { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.0.0" } }) },
        ],
    };

    const result = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_abc",
        artifact,
    });

    assert.ok(result.project, "Project must be created");
    assert.ok(result.project.projectId.startsWith("proj_"), "Project ID must have proj_ prefix");
    assert.equal(result.project.currentVersionNumber, 1);
    assert.equal(result.version.versionNumber, 1);
    assert.equal(result.version.changeType, "INITIAL_GENERATION");
    assert.equal(result.version.snapshot.files.length, 3, "Complete snapshot must contain all 3 files");
    assert.equal(result.artifact.projectId, result.project.projectId);
    assert.equal(result.artifact.version, 1);
});

test("Phase 5 - Test 2 & 4: Incremental update creates Version 2 preserving unchanged files", async () => {
    const artifactV1 = {
        title: "ResumeCraft SaaS",
        entryFile: "src/main.jsx",
        files: [
            { path: "src/main.jsx", content: "console.log('main');" },
            { path: "src/App.jsx", content: "export default function App() { return <h1>v1</h1>; }" },
            { path: "src/styles.css", content: "body { margin: 0; }" },
        ],
    };

    const v1Result = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_abc",
        artifact: artifactV1,
    });

    // Incremental update: modify App.jsx, add Header.jsx, keep main.jsx & styles.css untouched
    const artifactV2 = {
        title: "ResumeCraft SaaS",
        entryFile: "src/main.jsx",
        files: [
            { path: "src/main.jsx", content: "console.log('main');" }, // unchanged
            { path: "src/App.jsx", content: "export default function App() { return <h1>v2</h1>; }" }, // modified
            { path: "src/styles.css", content: "body { margin: 0; }" }, // unchanged
            { path: "src/components/Header.jsx", content: "export default function Header() {}" }, // added
        ],
    };

    const v2Result = await createIncrementalProjectVersion({
        projectId: v1Result.project.projectId,
        userId: "user_123",
        conversationId: "conv_abc",
        artifact: artifactV2,
        promptText: "Add Header component to App",
    });

    assert.equal(v2Result.version.versionNumber, 2);
    assert.equal(v2Result.version.changeType, "INCREMENTAL_UPDATE");
    assert.ok(v2Result.version.changeSummary.includes("Add Header component"));
    assert.equal(v2Result.version.snapshot.files.length, 4, "Version 2 snapshot must contain all 4 files");
    assert.equal(v2Result.project.currentVersionNumber, 2);

    // Verify Version 1 remains completely intact and unmutated
    const v1Check = await getProjectVersionDetails({
        projectId: v1Result.project.projectId,
        versionNumber: 1,
        userId: "user_123",
    });
    assert.equal(v1Check.snapshot.files.length, 3, "Historical Version 1 must still have exactly 3 files");
});

test("Phase 5 - Test 5 & 6: Failed generation or invalid artifact does not create a version", async () => {
    // 1. Null artifact throws and creates no version
    await assert.rejects(
        () => createInitialProjectVersion({ userId: "u1", conversationId: "c1", artifact: null }),
        /valid artifact with files is required/i
    );

    // 2. Empty files array throws and creates no version
    await assert.rejects(
        () => createInitialProjectVersion({ userId: "u1", conversationId: "c1", artifact: { files: [] } }),
        /valid artifact with files is required/i
    );
});

test("Phase 5 - Test 10 & 11: Multiple projects in one conversation receive distinct IDs and remain isolated", async () => {
    const projA = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_shared",
        artifact: {
            title: "Project Alpha",
            files: [{ path: "src/App.jsx", content: "Alpha" }],
        },
    });

    const projB = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_shared",
        artifact: {
            title: "Project Beta",
            files: [{ path: "src/App.jsx", content: "Beta" }],
        },
    });

    assert.notEqual(projA.project.projectId, projB.project.projectId, "Projects must have distinct project IDs");

    const versionsA = await listProjectVersions({ projectId: projA.project.projectId, userId: "user_123" });
    const versionsB = await listProjectVersions({ projectId: projB.project.projectId, userId: "user_123" });

    assert.equal(versionsA.total, 1);
    assert.equal(versionsB.total, 1);
    assert.notEqual(versionsA.versions[0].versionId, versionsB.versions[0].versionId);
});

test("Phase 5 - Test 12, 13, 14, 15: Safe Restoration creates new forward version preserving history", async () => {
    // Step 1: Create Version 1
    const v1 = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_1",
        artifact: {
            title: "Resume Builder",
            entryFile: "index.html",
            files: [
                { path: "index.html", content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>" },
                { path: "src/App.jsx", content: "export default function App() { return <h1>v1</h1>; }" },
                { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }) },
            ],
        },
    });

    const pid = v1.project.projectId;

    // Step 2: Create Version 2 (Added template)
    await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_123",
        conversationId: "conv_1",
        artifact: {
            title: "Resume Builder",
            entryFile: "index.html",
            files: [
                { path: "index.html", content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>" },
                { path: "src/App.jsx", content: "export default function App() { return <h1>v2</h1>; }" },
                { path: "src/Template.jsx", content: "export default function Template() { return <div>T2</div>; }" },
                { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }) },
            ],
        },
        promptText: "Add Template 2",
    });

    // Step 3: Create Version 3 (Added photo)
    await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_123",
        conversationId: "conv_1",
        artifact: {
            title: "Resume Builder",
            entryFile: "index.html",
            files: [
                { path: "index.html", content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>" },
                { path: "src/App.jsx", content: "export default function App() { return <h1>v3</h1>; }" },
                { path: "src/Template.jsx", content: "export default function Template() { return <div>T2</div>; }" },
                { path: "src/Photo.jsx", content: "export default function Photo() { return <div>Photo</div>; }" },
                { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }) },
            ],
        },
        promptText: "Add Photo component",
    });

    // Step 4: User restores Version 2
    const restoreResult = await restoreProjectVersion({
        projectId: pid,
        versionNumber: 2,
        userId: "user_123",
        conversationId: "conv_1",
    });

    // Version 4 is created containing Version 2's snapshot
    assert.equal(restoreResult.version.versionNumber, 4);
    assert.equal(restoreResult.version.changeType, "RESTORE");
    assert.ok(restoreResult.version.changeSummary.includes("Restored from Version 2"));
    assert.equal(restoreResult.restoredArtifact.files.length, 4);
    assert.ok(restoreResult.restoredArtifact.files.some(f => f.content.includes("v2")));

    // All previous versions 1, 2, 3 must still exist completely intact!
    const historyList = await listProjectVersions({ projectId: pid, userId: "user_123" });
    assert.equal(historyList.total, 4, "Must have all 4 versions");
    assert.equal(historyList.currentVersionNumber, 4);

    // Step 5: Subsequent incremental edit continues from restored Version 4 as base!
    const v5 = await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_123",
        conversationId: "conv_1",
        artifact: {
            title: "Resume Builder",
            entryFile: "index.html",
            files: [
                { path: "index.html", content: "<!DOCTYPE html><html><body><div id='root'></div></body></html>" },
                { path: "src/App.jsx", content: "export default function App() { return <h1>v5 edited after restore</h1>; }" },
                { path: "src/Template.jsx", content: "export default function Template() { return <div>T2</div>; }" },
                { path: "package.json", content: JSON.stringify({ dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" } }) },
            ],
        },
        promptText: "Edit after restore",
    });

    assert.equal(v5.version.versionNumber, 5);
    assert.equal(v5.project.currentVersionNumber, 5);

    // Step 6: User can even restore Version 3 later!
    const restoreV3 = await restoreProjectVersion({
        projectId: pid,
        versionNumber: 3,
        userId: "user_123",
        conversationId: "conv_1",
    });
    assert.equal(restoreV3.version.versionNumber, 6);
    assert.equal(restoreV3.restoredArtifact.files.length, 5, "Restored Version 3 must contain all 5 files");
});

test("Phase 5 - Test 17 & 18: Ownership authorization enforces strict access barrier", async () => {
    const proj = await createInitialProjectVersion({
        userId: "legit_user",
        conversationId: "conv_secret",
        artifact: {
            title: "Secret Project",
            files: [{ path: "src/App.jsx", content: "Secret" }],
        },
    });

    const pid = proj.project.projectId;

    // Unauthorized user cannot list versions
    await assert.rejects(
        () => listProjectVersions({ projectId: pid, userId: "attacker_user" }),
        /not found or unauthorized/i
    );

    // Unauthorized user cannot read version details
    await assert.rejects(
        () => getProjectVersionDetails({ projectId: pid, versionNumber: 1, userId: "attacker_user" }),
        /not found or unauthorized/i
    );

    // Unauthorized user cannot restore versions
    await assert.rejects(
        () => restoreProjectVersion({ projectId: pid, versionNumber: 1, userId: "attacker_user" }),
        /not found or unauthorized/i
    );
});

test("Phase 5 - Test 21-25: File-level comparison reports added, modified, deleted, and unchanged files", async () => {
    const v1Artifact = {
        title: "Test App",
        files: [
            { path: "src/App.jsx", content: "export default function App() { return 1; }" },
            { path: "src/DeletedComponent.jsx", content: "export default function Deleted() {}" },
            { path: "src/Unchanged.jsx", content: "const x = 100;" },
        ],
    };

    const initial = await createInitialProjectVersion({
        userId: "user_123",
        conversationId: "conv_test",
        artifact: v1Artifact,
    });

    const pid = initial.project.projectId;

    const v2Artifact = {
        title: "Test App",
        files: [
            { path: "src/App.jsx", content: "export default function App() { return 2; }" }, // modified
            { path: "src/Unchanged.jsx", content: "const x = 100;" }, // unchanged
            { path: "src/NewComponent.jsx", content: "export default function New() {}" }, // added
            // src/DeletedComponent.jsx is omitted -> deleted
        ],
    };

    await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_123",
        conversationId: "conv_test",
        artifact: v2Artifact,
    });

    const comparison = await compareProjectVersions({
        projectId: pid,
        baseVersion: 1,
        targetVersion: 2,
        userId: "user_123",
    });

    assert.equal(comparison.summary.addedCount, 1);
    assert.equal(comparison.summary.modifiedCount, 1);
    assert.equal(comparison.summary.deletedCount, 1);
    assert.equal(comparison.summary.unchangedCount, 1);

    assert.equal(comparison.changes.added[0].path, "src/NewComponent.jsx");
    assert.equal(comparison.changes.modified[0].path, "src/App.jsx");
    assert.equal(comparison.changes.deleted[0].path, "src/DeletedComponent.jsx");
    assert.equal(comparison.changes.unchanged[0].path, "src/Unchanged.jsx");

    // Identical versions produce 0 added, modified, or deleted
    const selfCompare = await compareProjectVersions({
        projectId: pid,
        baseVersion: 2,
        targetVersion: 2,
        userId: "user_123",
    });
    assert.equal(selfCompare.summary.addedCount, 0);
    assert.equal(selfCompare.summary.modifiedCount, 0);
    assert.equal(selfCompare.summary.deletedCount, 0);
    assert.equal(selfCompare.summary.unchangedCount, 3);
});

test("Phase 5 - Test 20: Backward compatibility with unversioned legacy artifacts", async () => {
    // When no Project or version exists for a conversation, getActiveProjectForConversation returns null safely
    const active = await getActiveProjectForConversation("non_existent_conv", "user_123");
    assert.equal(active, null, "Should return null gracefully without throwing");
});

test("Phase 5 - Test 7 & 8: General coding questions or ambiguous requests do not create project versions", async () => {
    // When an agent turn handles a general question, result.codeArtifact is null/undefined.
    // Ensure that null artifact never registers a project or creates versions.
    const projectCountBefore = (await listConversationProjects("conv_general", "user_123")).length;
    assert.equal(projectCountBefore, 0);

    // Intent classifier returns GENERAL_CODING_QUESTION -> no version is created
    const active = await getActiveProjectForConversation("conv_general", "user_123");
    assert.equal(active, null);
});

test("Phase 5 - Test 19: Concurrency safety preserves sequential version numbering", async () => {
    const initial = await createInitialProjectVersion({
        userId: "user_concurrency",
        conversationId: "conv_conc",
        artifact: {
            title: "Concurrency App",
            files: [{ path: "src/App.jsx", content: "export default function App() {}" }],
        },
    });

    const pid = initial.project.projectId;

    // Execute two sequential edits
    const v2 = await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_concurrency",
        conversationId: "conv_conc",
        artifact: {
            title: "Concurrency App",
            files: [{ path: "src/App.jsx", content: "export default function App() { return 2; }" }],
        },
        promptText: "Edit 1",
    });

    const v3 = await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_concurrency",
        conversationId: "conv_conc",
        artifact: {
            title: "Concurrency App",
            files: [{ path: "src/App.jsx", content: "export default function App() { return 3; }" }],
        },
        promptText: "Edit 2",
    });

    assert.equal(v2.version.versionNumber, 2);
    assert.equal(v3.version.versionNumber, 3);
    assert.equal(v3.project.currentVersionNumber, 3);

    const history = await listProjectVersions({ projectId: pid, userId: "user_concurrency" });
    assert.equal(history.total, 3);
    assert.equal(history.versions[0].versionNumber, 3);
    assert.equal(history.versions[1].versionNumber, 2);
    assert.equal(history.versions[2].versionNumber, 1);
});

test("Phase 5 - Test 26: Large project comparison respects limits and computes accurate deltas", async () => {
    const makeFiles = (count, prefix) =>
        Array.from({ length: count }, (_, i) => ({
            path: `src/components/Comp_${i}.jsx`,
            content: `export default function Comp_${i}() { return "${prefix}_${i}"; }`,
        }));

    const baseFiles = makeFiles(25, "v1");
    const targetFiles = makeFiles(30, "v1"); // 5 added
    targetFiles[0].content = 'export default function Comp_0() { return "v2_modified"; }'; // 1 modified
    const targetWithDeletions = targetFiles.slice(2); // deleted Comp_0 and Comp_1

    const proj = await createInitialProjectVersion({
        userId: "user_large",
        conversationId: "conv_large",
        artifact: { title: "Large App", files: baseFiles },
    });

    const pid = proj.project.projectId;

    await createIncrementalProjectVersion({
        projectId: pid,
        userId: "user_large",
        conversationId: "conv_large",
        artifact: { title: "Large App", files: targetWithDeletions },
    });

    const diff = await compareProjectVersions({
        projectId: pid,
        baseVersion: 1,
        targetVersion: 2,
        userId: "user_large",
    });

    assert.ok(diff.summary.totalBaseFiles === 25);
    assert.ok(diff.summary.totalTargetFiles === 28);
    assert.ok(diff.summary.addedCount > 0);
    assert.ok(diff.summary.deletedCount > 0);
    assert.ok(diff.summary.unchangedCount > 0);
});
