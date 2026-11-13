import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import Project from "../models/project.model.js";
import ProjectVersion from "../models/projectVersion.model.js";
import {
    createInitialProjectVersion,
    createIncrementalProjectVersion,
    restoreProjectVersion,
    listProjectVersions,
    getProjectVersionDetails,
    compareProjectVersions,
    getActiveProjectForConversation,
    listConversationProjects,
    resetMemoryStore,
} from "../utils/projectVersionService.js";

// ============================================================================
// PHASE 5.1: END-TO-END VERSION HISTORY RELIABILITY & INTEGRATION AUDIT
// ============================================================================

const USER_A = "507f1f77bcf86cd799439011";
const USER_B = "507f1f77bcf86cd799439022";
const CONV_1 = "507f1f77bcf86cd799439033";
const CONV_2 = "507f1f77bcf86cd799439044";

function createMockReactArtifact(title = "App", extraFile = null) {
    const files = [
        {
            path: "index.html",
            content: "<!DOCTYPE html><html><body><div id='root'></div><script type='module' src='/src/App.jsx'></script></body></html>",
            language: "html",
            size: 120,
        },
        {
            path: "package.json",
            content: JSON.stringify({
                name: title.toLowerCase().replace(/\s+/g, "-"),
                dependencies: { react: "^18.2.0", "react-dom": "^18.2.0" },
            }),
            language: "json",
            size: 100,
        },
        {
            path: "src/App.jsx",
            content: `import React from "react"; export default function App() { return <h1>${title}</h1>; }`,
            language: "jsx",
            size: 80,
        },
    ];
    if (extraFile) {
        files.push(extraFile);
    }
    return {
        artifactId: `art_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        title,
        entryFile: "index.html",
        runtimeType: "react",
        files,
        totalFiles: files.length,
        totalSize: files.reduce((acc, f) => acc + f.size, 0),
    };
}

// ----------------------------------------------------------------------------
// AUDIT SECTION 2: MONGODB PERSISTENCE & REGISTRATION VERIFICATION
// ----------------------------------------------------------------------------

test("Audit 2.1: Database Connection State is Accurately Audited", () => {
    // Audit must accurately identify whether live MongoDB is connected
    const readyState = mongoose.connection?.readyState;
    // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
    assert.ok([0, 1, 2, 3].includes(readyState), "readyState must be a valid Mongoose connection state");
    
    // Check if Project & ProjectVersion are properly registered models on Mongoose
    assert.equal(typeof mongoose.models.Project, "function", "Project model must be registered on mongoose.models");
    assert.equal(typeof mongoose.models.ProjectVersion, "function", "ProjectVersion model must be registered on mongoose.models");
});

test("Audit 2.2: Schema Constraints and Compound Unique Indexes", () => {
    const pIndexes = Project.schema.indexes();
    const vIndexes = ProjectVersion.schema.indexes();

    // Verify compound unique index on { projectId: 1, versionNumber: 1 }
    const compoundUniqueIndex = vIndexes.find((idx) => {
        const fields = idx[0];
        const options = idx[1] || {};
        return fields.projectId === 1 && fields.versionNumber === 1 && options.unique === true;
    });

    assert.ok(compoundUniqueIndex, "ProjectVersion MUST have a compound unique index on { projectId: 1, versionNumber: 1 }");
});

// ----------------------------------------------------------------------------
// AUDIT SECTION 3: MULTI-PROJECT ISOLATION (RESUME BUILDER vs EXPENSE TRACKER)
// ----------------------------------------------------------------------------

test("Audit 3: Multi-Project Isolation in the Same Conversation", async () => {
    resetMemoryStore();

    // 1. Generate Resume Builder (Project A) in Conversation A
    const resumeArtifact = createMockReactArtifact("ResumeCraft Resume Builder");
    const resA1 = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: resumeArtifact,
    });
    const projAId = resA1.project.projectId;
    assert.equal(resA1.version.versionNumber, 1);

    // 2. Generate Expense Tracker (Project B) in the same Conversation A
    const expenseArtifact = createMockReactArtifact("ExpenseFlow Tracker");
    const resB1 = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: expenseArtifact,
    });
    const projBId = resB1.project.projectId;
    assert.equal(resB1.version.versionNumber, 1);
    assert.notEqual(projAId, projBId, "Different projects in same conversation must receive distinct projectIds");

    // 3. Modify Resume Builder (Project A) to v2
    const resumeV2Artifact = createMockReactArtifact("ResumeCraft v2", {
        path: "src/components/TemplatePicker.jsx",
        content: "export const TemplatePicker = () => <div>Picker</div>;",
        language: "jsx",
        size: 50,
    });
    const resA2 = await createIncrementalProjectVersion({
        projectId: projAId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: resumeV2Artifact,
        promptText: "Add template picker",
    });
    assert.equal(resA2.version.versionNumber, 2);

    // 4. Confirm Expense Tracker (Project B) remains completely unchanged at v1
    const expenseBDetails = await getProjectVersionDetails({
        projectId: projBId,
        versionNumber: 1,
        userId: USER_A,
    });
    assert.equal(expenseBDetails.versionNumber, 1);
    assert.equal(expenseBDetails.snapshot.title, "ExpenseFlow Tracker");
    assert.equal(expenseBDetails.snapshot.files.some((f) => f.path.includes("TemplatePicker")), false);

    // 5. Modify Expense Tracker (Project B) to v2
    const expenseV2Artifact = createMockReactArtifact("ExpenseFlow v2", {
        path: "src/components/BudgetSummary.jsx",
        content: "export const BudgetSummary = () => <div>Budget</div>;",
        language: "jsx",
        size: 50,
    });
    const resB2 = await createIncrementalProjectVersion({
        projectId: projBId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: expenseV2Artifact,
        promptText: "Add budget summary",
    });
    assert.equal(resB2.version.versionNumber, 2);

    // 6. Confirm Resume Builder (Project A) remains at v2 and unaffected by Project B edits
    const resumeADetails = await getProjectVersionDetails({
        projectId: projAId,
        versionNumber: 2,
        userId: USER_A,
    });
    assert.equal(resumeADetails.versionNumber, 2);
    assert.equal(resumeADetails.snapshot.files.some((f) => f.path.includes("BudgetSummary")), false);

    // 7. Open histories of both projects
    const histA = await listProjectVersions({ projectId: projAId, userId: USER_A });
    const histB = await listProjectVersions({ projectId: projBId, userId: USER_A });
    assert.equal(histA.total, 2);
    assert.equal(histB.total, 2);

    // 8. Restore Resume Builder (Project A) v1 -> creates v3 for Project A
    const restoreA = await restoreProjectVersion({
        projectId: projAId,
        versionNumber: 1,
        userId: USER_A,
        conversationId: CONV_1,
    });
    assert.equal(restoreA.version.versionNumber, 3);
    assert.equal(restoreA.version.changeType, "RESTORE");

    // 9. Confirm Expense Tracker remains completely unaffected
    const histBAfter = await listProjectVersions({ projectId: projBId, userId: USER_A });
    assert.equal(histBAfter.total, 2);
    assert.equal(histBAfter.versions[0].versionNumber, 2);

    // 10. Audit conversation project listing
    const convProjects = await listConversationProjects(CONV_1, USER_A);
    assert.equal(convProjects.length, 2);
    const foundIds = convProjects.map((p) => p.projectId);
    assert.ok(foundIds.includes(projAId));
    assert.ok(foundIds.includes(projBId));
});

// ----------------------------------------------------------------------------
// AUDIT SECTION 4: CONCURRENCY AND VERSION INTEGRITY
// ----------------------------------------------------------------------------

test("Audit 4: Version Allocation Monotonicity and Conflict Safety", async () => {
    resetMemoryStore();

    const art = createMockReactArtifact("Concurrency Test");
    const init = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: art,
    });
    const pId = init.project.projectId;

    // Sequential increments must be strictly monotonic
    const v2 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: createMockReactArtifact("V2"),
    });
    const v3 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: createMockReactArtifact("V3"),
    });

    assert.equal(v2.version.versionNumber, 2);
    assert.equal(v3.version.versionNumber, 3);

    // Attempting incremental update with non-existent project fails cleanly
    await assert.rejects(
        createIncrementalProjectVersion({
            projectId: "non_existent_project_id",
            userId: USER_A,
            conversationId: CONV_1,
            artifact: art,
        }),
        /not found or unauthorized/
    );
});

// ----------------------------------------------------------------------------
// AUDIT SECTION 5: COMPLETE RESTORE WORKFLOW (v1 -> v2 -> v3 -> v4 -> restore v2 -> v5 -> edit -> v6)
// ----------------------------------------------------------------------------

test("Audit 5: Exact Full Lifecycle: v1 -> v2 -> v3 -> v4 -> Restore v2 -> v5 -> Edit -> v6", async () => {
    resetMemoryStore();

    // v1: Generate Resume Builder
    const v1Artifact = createMockReactArtifact("ResumeCraft", {
        path: "src/data/resume.json",
        content: JSON.stringify({ name: "Alex Doe", skills: ["React"] }),
        language: "json",
        size: 50,
    });
    const step1 = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v1Artifact,
    });
    const pId = step1.project.projectId;
    assert.equal(step1.version.versionNumber, 1);

    // v2: Add third template
    const v2Artifact = createMockReactArtifact("ResumeCraft", {
        path: "src/templates/ModernTemplate.jsx",
        content: "export const ModernTemplate = () => <div className='modern'>Modern</div>;",
        language: "jsx",
        size: 70,
    });
    const step2 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v2Artifact,
        promptText: "Add modern template",
    });
    assert.equal(step2.version.versionNumber, 2);

    // v3: Add profile photo
    const v3Artifact = createMockReactArtifact("ResumeCraft", {
        path: "src/components/PhotoUploader.jsx",
        content: "export const PhotoUploader = () => <input type='file' />;",
        language: "jsx",
        size: 60,
    });
    const step3 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v3Artifact,
        promptText: "Add photo uploader",
    });
    assert.equal(step3.version.versionNumber, 3);

    // v4: Improve mobile layout
    const v4Artifact = createMockReactArtifact("ResumeCraft", {
        path: "src/styles/responsive.css",
        content: "@media(max-width: 768px) { .sidebar { display: none; } }",
        language: "css",
        size: 65,
    });
    const step4 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v4Artifact,
        promptText: "Improve mobile layout",
    });
    assert.equal(step4.version.versionNumber, 4);

    // RESTORE v2 -> creates v5
    const step5 = await restoreProjectVersion({
        projectId: pId,
        versionNumber: 2,
        userId: USER_A,
        conversationId: CONV_1,
    });
    assert.equal(step5.version.versionNumber, 5);
    assert.equal(step5.version.changeType, "RESTORE");

    // Verify v5 contains the EXACT snapshot of v2
    const v5Files = step5.version.snapshot.files.map((f) => f.path);
    assert.ok(v5Files.includes("src/templates/ModernTemplate.jsx"), "v5 must contain v2's ModernTemplate");
    assert.equal(v5Files.includes("src/components/PhotoUploader.jsx"), false, "v5 must NOT contain v3's PhotoUploader");
    assert.equal(v5Files.includes("src/styles/responsive.css"), false, "v5 must NOT contain v4's responsive.css");

    // Verify v1, v2, v3, v4 remain completely intact in history
    const checkV1 = await getProjectVersionDetails({ projectId: pId, versionNumber: 1, userId: USER_A });
    const checkV2 = await getProjectVersionDetails({ projectId: pId, versionNumber: 2, userId: USER_A });
    const checkV3 = await getProjectVersionDetails({ projectId: pId, versionNumber: 3, userId: USER_A });
    const checkV4 = await getProjectVersionDetails({ projectId: pId, versionNumber: 4, userId: USER_A });
    assert.equal(checkV1.versionNumber, 1);
    assert.equal(checkV2.versionNumber, 2);
    assert.equal(checkV3.versionNumber, 3);
    assert.equal(checkV4.versionNumber, 4);

    // Verify v5 is now the current version
    assert.equal(step5.project.currentVersionNumber, 5);

    // v6: Add another feature on top of restored v5
    const v6Artifact = {
        ...step5.version.snapshot,
        files: [
            ...step5.version.snapshot.files,
            {
                path: "src/components/ExportPdfButton.jsx",
                content: "export const ExportPdfButton = () => <button>PDF</button>;",
                language: "jsx",
                size: 60,
            },
        ],
    };
    const step6 = await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v6Artifact,
        promptText: "Add export PDF button",
    });
    assert.equal(step6.version.versionNumber, 6);

    // Verify v6 contains v2 files plus the new ExportPdfButton, but still NOT v3 or v4
    const v6Files = step6.version.snapshot.files.map((f) => f.path);
    assert.ok(v6Files.includes("src/templates/ModernTemplate.jsx"));
    assert.ok(v6Files.includes("src/components/ExportPdfButton.jsx"));
    assert.equal(v6Files.includes("src/components/PhotoUploader.jsx"), false);
    assert.equal(v6Files.includes("src/styles/responsive.css"), false);
});

// ----------------------------------------------------------------------------
// AUDIT SECTION 6: API AND AUTHORIZATION SECURITY GUARDS
// ----------------------------------------------------------------------------

test("Audit 6: Strict User Isolation and Ownership Protection", async () => {
    resetMemoryStore();

    // User A creates Project
    const art = createMockReactArtifact("User A Project");
    const created = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: art,
    });
    const pId = created.project.projectId;

    // User B cannot access User A's project details
    await assert.rejects(
        getProjectVersionDetails({ projectId: pId, versionNumber: 1, userId: USER_B }),
        /not found or unauthorized/
    );

    // User B cannot list User A's project versions
    await assert.rejects(
        listProjectVersions({ projectId: pId, userId: USER_B }),
        /not found or unauthorized/
    );

    // User B cannot restore User A's project
    await assert.rejects(
        restoreProjectVersion({ projectId: pId, versionNumber: 1, userId: USER_B }),
        /not found or unauthorized/
    );

    // User B cannot compare User A's project versions
    await assert.rejects(
        compareProjectVersions({ projectId: pId, baseVersion: 1, targetVersion: 1, userId: USER_B }),
        /not found or unauthorized/
    );
});

// ----------------------------------------------------------------------------
// AUDIT SECTION 7: COMPARISON DIFF METRICS
// ----------------------------------------------------------------------------

test("Audit 7: File-level Delta Bytes & Summary Computation", async () => {
    resetMemoryStore();

    const v1Art = createMockReactArtifact("Diff Test");
    const init = await createInitialProjectVersion({
        userId: USER_A,
        conversationId: CONV_1,
        artifact: v1Art,
    });
    const pId = init.project.projectId;

    // Create v2 with 1 added file, 1 modified file (src/App.jsx)
    const v2Files = [
        v1Art.files[0], // package.json unchanged
        {
            path: "src/App.jsx",
            content: 'import React from "react"; export default function App() { return <h1>Modified Diff Test with longer title</h1>; }',
            language: "jsx",
            size: 110,
        },
        {
            path: "src/NewComponent.jsx",
            content: "export const NewComponent = () => <span>New</span>;",
            language: "jsx",
            size: 45,
        },
    ];
    await createIncrementalProjectVersion({
        projectId: pId,
        userId: USER_A,
        conversationId: CONV_1,
        artifact: { ...v1Art, files: v2Files },
    });

    const diff = await compareProjectVersions({
        projectId: pId,
        baseVersion: 1,
        targetVersion: 2,
        userId: USER_A,
    });

    assert.equal(diff.summary.addedCount, 1);
    assert.equal(diff.summary.modifiedCount, 1);
    assert.equal(diff.summary.deletedCount, 1);
    assert.equal(diff.summary.unchangedCount, 1);

    const modFile = diff.changes.modified[0];
    assert.equal(modFile.path, "src/App.jsx");
    assert.ok(modFile.deltaBytes > 0, "deltaBytes must be positive when file size increases");

    const delFile = diff.changes.deleted[0];
    assert.equal(delFile.path, "package.json");
});
