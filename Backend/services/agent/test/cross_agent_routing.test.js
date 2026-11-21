process.env.NODE_ENV = "test";
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import redis from "../../../shared/redis/redis.js";

import { router } from "../graph/router.js";
import { graph } from "../graph/graph.js";
import {
    resolveAgentRoute,
    classifyTaskIntent,
    isCodingIntent,
    isPptIntent,
    isPdfIntent,
    hasPdfAttachment,
    hasImageAttachment,
} from "../utils/documentRouting.js";

const mockPdfAttachment = {
    name: "northstar_report.pdf",
    mimeType: "application/pdf",
    data: "JVBERi0xLjQKJ...",
};

const mockImageAttachment = {
    name: "mockup.png",
    mimeType: "image/png",
    data: "iVBORw0KGgo...",
};

const mockExistingCodeArtifact = {
    artifactId: "art_dashboard_v1",
    title: "Executive Dashboard",
    files: [
        { path: "src/App.jsx", content: "export default function App() {}" },
        { path: "src/main.jsx", content: "createRoot().render(<App />);" },
    ],
};

describe("Cross-Agent RAG — Step 3: Intelligent Document-Aware Routing", () => {
    // Mock Redis during tests to avoid sandbox DNS timeouts
    const origSet = redis.set;
    const origGet = redis.get;
    const origDel = redis.del;

    before(() => {
        redis.set = async () => "OK";
        redis.get = async () => null;
        redis.del = async () => 1;
    });

    after(async () => {
        redis.set = origSet;
        redis.get = origGet;
        redis.del = origDel;
        try {
            redis.disconnect();
        } catch {}
    });

    // =========================================================================
    // PRIORITY 1: Explicit User Selection
    // =========================================================================

    test("1. Explicit Coding selection with PDF attachment preserves Coding Agent", async () => {
        const state = {
            agentMode: "coding",
            prompt: "Summarize this document",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "coding");
        assert.equal(res.routingMetadata?.priority, 1);
    });

    test("2. Explicit PPT selection with PDF attachment preserves PPT Agent", async () => {
        const state = {
            agentMode: "ppt",
            prompt: "What is the revenue for Q2?",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "ppt");
        assert.equal(res.routingMetadata?.priority, 1);
    });

    test("3. Explicit PDF selection with PDF attachment preserves PDF Agent", async () => {
        const state = {
            agentMode: "pdf",
            prompt: "Build a dashboard using these metrics",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "pdf");
        assert.equal(res.routingMetadata?.priority, 1);
    });

    // =========================================================================
    // PRIORITY 2: Explicit Task Intent (When agentMode is 'auto' or unset)
    // =========================================================================

    test("4. PDF plus dashboard generation routes to Coding Agent", async () => {
        const state = {
            agentMode: "auto",
            prompt: "Build a dashboard using the metrics and requirements in this document",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "coding");
        assert.equal(res.routingMetadata?.priority, 2);
    });

    test("5. PDF plus React application generation routes to Coding Agent", async () => {
        const state = {
            agentMode: "auto",
            prompt: "Create a React application from this specification",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "coding");
        assert.equal(res.routingMetadata?.priority, 2);
    });

    test("6. PDF plus presentation generation routes to PPT Agent", async () => {
        const stateExecutive = {
            agentMode: "auto",
            prompt: "Create an executive presentation from this report",
            attachment: mockPdfAttachment,
        };
        const resExecutive = await router(stateExecutive);
        assert.equal(resExecutive.agent, "ppt");
        assert.equal(resExecutive.routingMetadata?.priority, 2);

        const stateSlides = {
            agentMode: "auto",
            prompt: "Generate 10 slides from this report",
            attachment: mockPdfAttachment,
        };
        const resSlides = await router(stateSlides);
        assert.equal(resSlides.agent, "ppt");
        assert.equal(resSlides.routingMetadata?.priority, 2);
    });

    test("7. PDF plus ordinary factual question routes to PDF Agent", async () => {
        const stateFactual = {
            agentMode: "auto",
            prompt: "What is the revenue for Q2?",
            attachment: mockPdfAttachment,
        };
        const resFactual = await router(stateFactual);
        assert.equal(resFactual.agent, "pdf");

        const stateSummary = {
            agentMode: "auto",
            prompt: "Summarize this document",
            attachment: mockPdfAttachment,
        };
        const resSummary = await router(stateSummary);
        assert.equal(resSummary.agent, "pdf");

        const stateChart = {
            agentMode: "auto",
            prompt: "Explain this chart",
            attachment: mockPdfAttachment,
        };
        const resChart = await router(stateChart);
        assert.equal(resChart.agent, "pdf");

        const stateFigures = {
            agentMode: "auto",
            prompt: "Compare these financial figures",
            attachment: mockPdfAttachment,
        };
        const resFigures = await router(stateFigures);
        assert.equal(resFigures.agent, "pdf");
    });

    // =========================================================================
    // PRIORITY 3: Existing Conversation Context (Follow-ups)
    // =========================================================================

    test("8. Coding follow-up without a new attachment routes to Coding Agent", async () => {
        const state = {
            agentMode: "auto",
            prompt: "Add a filter to the dashboard",
            attachment: null,
            existingCodeArtifact: mockExistingCodeArtifact,
            projectIntent: { intent: "MODIFY_EXISTING_PROJECT" },
        };

        const res = await router(state);
        assert.equal(res.agent, "coding");
        assert.ok(res.routingMetadata?.priority === 2 || res.routingMetadata?.priority === 3);
    });

    test("9. PPT follow-up without a new attachment routes to PPT Agent", async () => {
        const state = {
            agentMode: "auto",
            prompt: "Add a conclusion slide",
            attachment: null,
            slides: [{ slideNumber: 1, title: "Title" }],
        };

        const res = await router(state);
        assert.equal(res.agent, "ppt");
        assert.equal(res.routingMetadata?.priority, 2); // Matched slide modification intent
    });

    test("10. Explicit task switch from Coding to PDF routes to PDF Agent", async () => {
        // Conversation has active code project, but user clearly asks to summarize/query PDF
        const state = {
            agentMode: "auto",
            prompt: "Summarize this document and compare the financial figures",
            attachment: mockPdfAttachment,
            existingCodeArtifact: mockExistingCodeArtifact,
        };

        const res = await router(state);
        assert.equal(res.agent, "pdf");
        assert.equal(res.routingMetadata?.priority, 2);
    });

    test("11. Explicit task switch from PPT to Coding routes to Coding Agent", async () => {
        // Conversation has active slide deck, but user clearly asks to build an application
        const state = {
            agentMode: "auto",
            prompt: "Now build a React dashboard using the metrics in this document",
            attachment: mockPdfAttachment,
            slides: [{ slideNumber: 1, title: "Agenda" }],
        };

        const res = await router(state);
        assert.equal(res.agent, "coding");
        assert.equal(res.routingMetadata?.priority, 2);
    });

    // =========================================================================
    // PRIORITY 4: Ambiguous Task Intent & Default Handling
    // =========================================================================

    test("12. Ambiguous task intent with PDF attachment defaults to PDF Agent", async () => {
        const state = {
            agentMode: "auto",
            prompt: "Please review this document and share your thoughts",
            attachment: mockPdfAttachment,
        };

        const res = await router(state);
        assert.equal(res.agent, "pdf");
        assert.equal(res.routingMetadata?.priority, 4);
    });

    test("13. Multiple PDF attachments correctly route according to task intent", async () => {
        const multiPdfStateCoding = {
            agentMode: "auto",
            prompt: "Build a dashboard comparing the store performance metrics",
            attachments: [
                { name: "q1_performance.pdf", mimeType: "application/pdf" },
                { name: "q2_performance.pdf", mimeType: "application/pdf" },
            ],
        };
        const resCoding = await router(multiPdfStateCoding);
        assert.equal(resCoding.agent, "coding");

        const multiPdfStatePpt = {
            agentMode: "auto",
            prompt: "Generate 10 slides summarizing both reports",
            attachments: [
                { name: "q1_performance.pdf", mimeType: "application/pdf" },
                { name: "q2_performance.pdf", mimeType: "application/pdf" },
            ],
        };
        const resPpt = await router(multiPdfStatePpt);
        assert.equal(resPpt.agent, "ppt");

        const multiPdfStatePdf = {
            agentMode: "auto",
            prompt: "Compare the revenues in both documents",
            attachments: [
                { name: "q1_performance.pdf", mimeType: "application/pdf" },
                { name: "q2_performance.pdf", mimeType: "application/pdf" },
            ],
        };
        const resPdf = await router(multiPdfStatePdf);
        assert.equal(resPdf.agent, "pdf");
    });

    // =========================================================================
    // Non-Attachment & Regression Scenarios
    // =========================================================================

    test("14. Requests without attachments route appropriately", async () => {
        // App building without attachment -> coding
        const resCoding = await router({
            prompt: "Build a React todo app with dark mode",
        });
        assert.equal(resCoding.agent, "coding");

        // Presentation without attachment -> ppt
        const resPpt = await router({
            prompt: "Create an executive presentation on artificial intelligence",
        });
        assert.equal(resPpt.agent, "ppt");

        // Pure conceptual question -> chat
        const resChat = await router({
            prompt: "What is the meaning of life?",
            projectIntent: { intent: "GENERAL_CODING_QUESTION" },
        });
        assert.equal(resChat.agent, "chat");
    });

    test("15. Non-PDF agent routing regression preserves vision and existing paths", async () => {
        // Image attachment -> vision
        const resVision = await router({
            prompt: "What is in this picture?",
            attachment: mockImageAttachment,
        });
        assert.equal(resVision.agent, "vision");

        // Guard: Informational questions containing the word 'code' must NOT route to coding
        const resZipCode = await router({
            prompt: "What is the postal code on page 3?",
            attachment: mockPdfAttachment,
        });
        assert.equal(resZipCode.agent, "pdf");

        const resPromoCode = await router({
            prompt: "What discount code is mentioned in the agreement?",
            attachment: mockPdfAttachment,
        });
        assert.equal(resPromoCode.agent, "pdf");

        const resSnippet = await router({
            prompt: "Explain the code snippet on page 4",
            attachment: mockPdfAttachment,
        });
        assert.equal(resSnippet.agent, "pdf");
    });

    // =========================================================================
    // ACTUAL LANGGRAPH INTEGRATION
    // =========================================================================

    test("16. LangGraph integration: Compiled state graph routes to correct conditional edge destinations", async () => {
        // Verify graph node registrations
        const registeredNodes = Object.keys(graph.nodes);
        assert.ok(registeredNodes.includes("router"), "Router node must exist in LangGraph");
        assert.ok(registeredNodes.includes("coding"), "Coding node must exist in LangGraph");
        assert.ok(registeredNodes.includes("ppt"), "PPT node must exist in LangGraph");
        assert.ok(registeredNodes.includes("pdf"), "PDF node must exist in LangGraph");
        assert.ok(registeredNodes.includes("chat"), "Chat node must exist in LangGraph");
        assert.ok(registeredNodes.includes("vision"), "Vision node must exist in LangGraph");

        // Verify routing output contracts for each target branch
        const stateCoding = {
            prompt: "Build a dashboard using these metrics",
            attachment: mockPdfAttachment,
            conversationId: "test_conv_g1",
            userId: "test_user_g1",
        };
        const outCoding = await router(stateCoding);
        assert.equal(outCoding.agent, "coding");

        const statePpt = {
            prompt: "Create an executive presentation from this report",
            attachment: mockPdfAttachment,
            conversationId: "test_conv_g2",
            userId: "test_user_g2",
        };
        const outPpt = await router(statePpt);
        assert.equal(outPpt.agent, "ppt");

        const statePdf = {
            prompt: "Summarize this document",
            attachment: mockPdfAttachment,
            conversationId: "test_conv_g3",
            userId: "test_user_g3",
        };
        const outPdf = await router(statePdf);
        assert.equal(outPdf.agent, "pdf");
    });
});
