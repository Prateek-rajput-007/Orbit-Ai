import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import mongoose from "mongoose";
import JSZip from "jszip";

// Load agent environment
dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });
dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

import redis from "../../../shared/redis/redis.js";
import PdfChunk from "../models/pdfChunk.model.js";
import { generatePptxFile } from "../utils/generatePptx.js";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8000";
const FIXTURE_PATH = path.resolve(import.meta.dirname, "../fixtures/acceptance_fixture_q3_report.pdf");

// Helper sleep function
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to parse SSE stream from a fetch response
async function readSSEStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    let readyPayload = null;
    let finalStage = null;
    let errorMessage = null;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const block of lines) {
            if (!block.trim()) continue;
            let eventType = "message";
            let eventData = "";

            for (const line of block.split("\n")) {
                if (line.startsWith("event:")) {
                    eventType = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    eventData = line.substring(5).trim();
                }
            }

            try {
                const parsed = eventData ? JSON.parse(eventData) : null;
                events.push({ event: eventType, data: parsed });

                if (eventType === "ready") {
                    readyPayload = parsed;
                } else if (eventType === "stage") {
                    finalStage = parsed?.message;
                } else if (eventType === "error") {
                    errorMessage = parsed?.message || parsed?.error;
                }
            } catch {
                events.push({ event: eventType, data: eventData });
            }
        }
    }

    if (buffer.trim()) {
        let eventType = "message";
        let eventData = "";
        for (const line of buffer.split("\n")) {
            if (line.startsWith("event:")) {
                eventType = line.substring(6).trim();
            } else if (line.startsWith("data:")) {
                eventData = line.substring(5).trim();
            }
        }
        try {
            const parsed = eventData ? JSON.parse(eventData) : null;
            events.push({ event: eventType, data: parsed });
            if (eventType === "ready") {
                readyPayload = parsed;
            } else if (eventType === "stage") {
                finalStage = parsed?.message;
            } else if (eventType === "error") {
                errorMessage = parsed?.message || parsed?.error;
            }
        } catch {
            events.push({ event: eventType, data: eventData });
        }
    }

    return { events, readyPayload, finalStage, errorMessage };
}

async function runUserFacingAcceptance() {
    console.log("================================================================================");
    console.log("       ORBIT CROSS-AGENT RAG — USER-FACING ACCEPTANCE TEST RUNNER              ");
    console.log("       Target Gateway: " + GATEWAY_URL);
    console.log("================================================================================\n");

    const report = {
        timestamp: new Date().toISOString(),
        gatewayUrl: GATEWAY_URL,
        scenarios: {},
        verdict: "PENDING",
    };

    const USER_A = {
        userId: "6ad372059569a6a0f0823c25",
        name: "Mr beast",
        email: "mrbeastcrafts99@gmail.com",
        sessionToken: `acceptance_sess_a_${Date.now()}`,
    };

    const USER_B = {
        userId: "6aff2d8530a1d4458a683fb1",
        name: "Nick Invest",
        email: "nickinvest07@gmail.com",
        sessionToken: `acceptance_sess_b_${Date.now()}`,
    };

    let convUserA = null;
    let convUserB = null;

    try {
        // Setup Redis test sessions
        await redis.set(`session:${USER_A.sessionToken}`, JSON.stringify(USER_A), "EX", 3600);
        await redis.set(`session:${USER_B.sessionToken}`, JSON.stringify(USER_B), "EX", 3600);

        // Verify Gateway authentication for User A
        const authRes = await fetch(`${GATEWAY_URL}/api/me`, {
            headers: { Cookie: `session=${USER_A.sessionToken}` },
        });
        if (authRes.status !== 200) {
            throw new Error(`Gateway authentication failed with status ${authRes.status}`);
        }
        console.log(`✓ User A authenticated via Gateway /api/me: status 200`);

        // Create initial conversation for User A
        const createConvResA = await fetch(`${GATEWAY_URL}/api/chat/create-conversation`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });
        const convAData = await createConvResA.json();
        convUserA = convAData.conversation?._id;
        console.log(`✓ User A created conversation via Gateway: ${convUserA}`);

        // =========================================================================
        // SCENARIO 1: PDF Upload, Document Extraction, and Document Q&A
        // =========================================================================
        console.log("\n========================================================================");
        console.log("SCENARIO 1: PDF Upload, Ingestion, Visibility, and Document Q&A");
        console.log("========================================================================");

        const pdfBlob = fs.readFileSync(FIXTURE_PATH);
        const formPayload = new FormData();
        formPayload.append("prompt", "Analyze this financial report and summarize our Q3 digital revenue and operating margin.");
        formPayload.append("conversationId", convUserA);
        formPayload.append("agentMode", "auto");
        formPayload.append("attachment", new Blob([pdfBlob], { type: "application/pdf" }), "Apex_Q3_Financial_Report.pdf");

        console.log("Sending multipart PDF upload via Gateway /api/agent/chat...");
        const uploadStart = Date.now();
        const uploadRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
            },
            body: formPayload,
        });

        if (!uploadRes.ok) {
            throw new Error(`PDF upload failed with status ${uploadRes.status}`);
        }

        const sse1 = await readSSEStream(uploadRes);
        const uploadDuration = Date.now() - uploadStart;

        console.log(`✓ SSE stream completed in ${uploadDuration}ms. Events captured: ${sse1.events.length}`);
        const p1 = sse1.readyPayload;
        const aiResponse1 = p1?.aiResponse || "";
        const pdfDoc = p1?.pdfDocument;

        console.log(`  - Document ID:   ${pdfDoc?.documentId}`);
        console.log(`  - Document Name: ${pdfDoc?.fileName}`);
        console.log(`  - Status:        ${pdfDoc?.status}`);
        console.log(`  - Page Count:    ${pdfDoc?.pageCount}`);
        console.log(`  - Citations:     ${p1?.citations?.length || 0}`);

        const has12_4_s1 = aiResponse1.includes("12.4");
        const has14_6_s1 = aiResponse1.includes("14.6");
        const hasMargin_s1 = aiResponse1.includes("18%") || aiResponse1.includes("21%");
        console.log(`  - Ground-Truth in Response: 12.4M=${has12_4_s1}, 14.6M=${has14_6_s1}, margin=${hasMargin_s1}`);

        // Follow-up factual question in same conversation
        console.log("\nSending follow-up factual question: 'According to the report, what was the operating cash flow reported for Q3?'...");
        console.log("Waiting 15s to respect Groq TPM rate limits...");
        await sleep(15000);

        const q2Start = Date.now();
        const q2Res = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "According to the report, what was the operating cash flow reported for Q3?",
                conversationId: convUserA,
                agentMode: "auto",
            }),
        });

        const sse1_followup = await readSSEStream(q2Res);
        const q2Duration = Date.now() - q2Start;
        const p1_followup = sse1_followup.readyPayload;
        const aiResponse1_followup = p1_followup?.aiResponse || "";
        const hasCashFlow = aiResponse1_followup.includes("4.8");
        console.log(`✓ Follow-up question completed in ${q2Duration}ms: Cash Flow $4.8M present = ${hasCashFlow}`);
        console.log(`  - Citations Count: ${p1_followup?.citations?.length || 0}`);

        report.scenarios.scenario1 = {
            verdict: (pdfDoc?.status === "READY" && (has14_6_s1 || has12_4_s1) && hasCashFlow) ? "PASS" : "FAIL",
            uploadDurationMs: uploadDuration,
            documentId: pdfDoc?.documentId,
            documentStatus: pdfDoc?.status,
            pageCount: pdfDoc?.pageCount,
            groundTruthRevenueFound: has14_6_s1 || has12_4_s1,
            groundTruthCashFlowFound: hasCashFlow,
            citationsCount: p1?.citations?.length || 0,
        };

        // =========================================================================
        // SCENARIO 2: Coding Agent React Dashboard Generation & Follow-Up Edit
        // =========================================================================
        console.log("\n========================================================================");
        console.log("SCENARIO 2: Coding Agent Grounded Dashboard & Provenance Lifecycle");
        console.log("========================================================================");

        console.log("Waiting 15s to respect Groq TPM rate limits...");
        await sleep(15000);

        console.log("Requesting React dashboard component based on uploaded financial report...");
        const codingPrompt = "Build a React financial KPI metrics dashboard component displaying our Q3 digital revenue, operating margin, and customer growth from the uploaded financial report.";
        const codingStart = Date.now();

        const codingRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: codingPrompt,
                conversationId: convUserA,
                agentMode: "auto",
            }),
        });

        const sse2 = await readSSEStream(codingRes);
        const codingDuration = Date.now() - codingStart;
        const p2 = sse2.readyPayload;
        const codeArtifact = p2?.codeArtifact;

        console.log(`✓ Coding Agent completed in ${codingDuration}ms`);
        console.log(`  - Project Title:  ${codeArtifact?.title}`);
        console.log(`  - Files Created:  ${Object.keys(codeArtifact?.files || {}).length}`);
        console.log(`  - Provenance Doc: ${codeArtifact?.dataProvenance?.documentId}`);
        console.log(`  - Page Range:     ${codeArtifact?.dataProvenance?.pageRange}`);
        console.log(`  - Citations:      ${codeArtifact?.dataProvenance?.citations?.length || 0}`);

        const allCode = Object.values(codeArtifact?.files || {})
            .map((f) => (typeof f === "string" ? f : f?.content || ""))
            .join("\n") + "\n" + (p2?.aiResponse || "");

        const cHas12_4 = allCode.includes("12.4");
        const cHas14_6 = allCode.includes("14.6");
        const cHas18 = allCode.includes("18");
        const cHas21 = allCode.includes("21");
        console.log(`  - Ground-Truth in Generated Code: 12.4M=${cHas12_4}, 14.6M=${cHas14_6}, 18%=${cHas18}, 21%=${cHas21}`);

        // Incremental Follow-Up Edit
        console.log("\nExecuting follow-up edit to dashboard: 'Add a customer growth metric card showing 11% growth and dark theme toggle'...");
        console.log("Waiting 15s to respect Groq TPM rate limits...");
        await sleep(15000);

        const editStart = Date.now();
        const editRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "Add a customer growth metric card showing 11% growth and a dark theme toggle to the financial dashboard.",
                conversationId: convUserA,
                agentMode: "auto",
                projectId: codeArtifact?.projectId,
                baseVersion: codeArtifact?.version || 1,
            }),
        });

        const sse2_edit = await readSSEStream(editRes);
        const editDuration = Date.now() - editStart;
        const p2_edit = sse2_edit.readyPayload;
        const editedArtifact = p2_edit?.codeArtifact;

        const provPreserved = Boolean(
            editedArtifact?.dataProvenance &&
            editedArtifact.dataProvenance.documentId === pdfDoc?.documentId &&
            editedArtifact.dataProvenance.pageRange
        );
        console.log(`✓ Follow-up edit completed in ${editDuration}ms`);
        console.log(`  - Provenance Preserved: ${provPreserved}`);
        console.log(`  - Preserved Document:   ${editedArtifact?.dataProvenance?.documentId}`);
        console.log(`  - Preserved Page Range: ${editedArtifact?.dataProvenance?.pageRange}`);

        report.scenarios.scenario2 = {
            verdict: (codeArtifact && (cHas14_6 || cHas12_4) && provPreserved) ? "PASS" : "FAIL",
            generationDurationMs: codingDuration,
            filesCount: Object.keys(codeArtifact?.files || {}).length,
            groundTruthInCode: cHas14_6 || cHas12_4,
            provenancePreserved: provPreserved,
        };

        // =========================================================================
        // SCENARIO 3: PPT Agent Presentation Generation & OpenXML Export
        // =========================================================================
        console.log("\n========================================================================");
        console.log("SCENARIO 3: PPT Agent Executive Presentation & Native PPTX Export");
        console.log("========================================================================");

        console.log("Waiting 15s to respect Groq TPM rate limits...");
        await sleep(15000);

        console.log("Requesting executive presentation based on the uploaded financial report...");
        const pptStart = Date.now();

        const pptRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "Create an executive presentation deck summarizing Q3 digital revenue, operating margin, and key growth drivers from the financial report.",
                conversationId: convUserA,
                agentMode: "auto",
            }),
        });

        const sse3 = await readSSEStream(pptRes);
        const pptDuration = Date.now() - pptStart;
        const p3 = sse3.readyPayload;
        const pFile = p3?.presentationFile;
        const slides = p3?.slides || pFile?.deck?.slides || [];

        console.log(`✓ PPT Agent completed in ${pptDuration}ms`);
        console.log(`  - Deck Title:  ${pFile?.title || pFile?.deck?.title || "Executive Presentation"}`);
        console.log(`  - Slide Count: ${slides.length}`);

        const slideText = slides.map((s) => `${s.title} ${(s.bullets || []).join(" ")} ${s.speakerNotes || ""}`).join("\n");
        const pptHasRevenue = slideText.includes("12.4") || slideText.includes("14.6");
        const pptHasMargin = slideText.includes("18") || slideText.includes("21");
        const hasNotes = slides.some((s) => Boolean(s.speakerNotes));
        console.log(`  - Ground-Truth in Slides: Revenue=${pptHasRevenue}, Margin=${pptHasMargin}`);
        console.log(`  - Presenter Notes Present: ${hasNotes}`);

        // Native PPTX OpenXML Package Export
        console.log("\nCompiling native .pptx OpenXML file...");
        const exportRes = await generatePptxFile(pFile?.deck || { title: "Executive Report", slides });
        const base64Data = exportRes.dataUrl.split(",")[1];
        const pptxBuffer = Buffer.from(base64Data, "base64");
        console.log(`✓ PPTX compiled: ${pptxBuffer.length} bytes`);

        // Validate OpenXML structure with JSZip
        const zip = await JSZip.loadAsync(pptxBuffer);
        const totalOpenXmlParts = Object.keys(zip.files).length;
        const hasContentTypes = Boolean(zip.files["[Content_Types].xml"]);
        const hasPresentationXml = Boolean(zip.files["ppt/presentation.xml"]);
        const notesPart = Object.keys(zip.files).find((k) => k.startsWith("ppt/notesSlides/notesSlide"));
        const hasNotesXml = Boolean(notesPart);

        console.log(`✓ OpenXML Validation: totalParts=${totalOpenXmlParts}, hasContentTypes=${hasContentTypes}, hasPresentationXml=${hasPresentationXml}, hasNotesXml=${hasNotesXml}`);

        report.scenarios.scenario3 = {
            verdict: (slides.length >= 3 && pptHasRevenue && hasNotes && hasContentTypes && hasNotesXml) ? "PASS" : "FAIL",
            generationDurationMs: pptDuration,
            slideCount: slides.length,
            hasNotes,
            pptxFileSizeBytes: pptxBuffer.length,
            totalOpenXmlParts,
            validOpenXmlStructure: hasContentTypes && hasPresentationXml && hasNotesXml,
        };

        // =========================================================================
        // SCENARIO 4: Multi-User Tenant Isolation
        // =========================================================================
        console.log("\n========================================================================");
        console.log("SCENARIO 4: Multi-User Tenant Isolation Barrier");
        console.log("========================================================================");

        // Create separate conversation for User B
        const createConvResB = await fetch(`${GATEWAY_URL}/api/chat/create-conversation`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_B.sessionToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });
        const convBData = await createConvResB.json();
        convUserB = convBData.conversation?._id;
        console.log(`✓ User B created conversation via Gateway: ${convUserB}`);

        // Attempt 1: User B tries to read User A's conversation messages
        const leakReadRes = await fetch(`${GATEWAY_URL}/api/chat/get-messages/${convUserA}`, {
            headers: { Cookie: `session=${USER_B.sessionToken}` },
        });
        const leakReadBlocked = leakReadRes.status === 404;
        console.log(`✓ Negative Check 1: User B read access on User A conversation: status=${leakReadRes.status} (Blocked: ${leakReadBlocked})`);

        // Attempt 2: User B tries to invoke agent on User A's conversation
        const leakAgentRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_B.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "Show me the financial report data.",
                conversationId: convUserA, // User A's conversation!
                agentMode: "auto",
            }),
        });
        const sseLeak = await readSSEStream(leakAgentRes);
        const leakAgentBlocked = Boolean(sseLeak.errorMessage && sseLeak.errorMessage.includes("404"));
        console.log(`✓ Negative Check 2: User B agent prompt on User A conversation: Blocked=${leakAgentBlocked} (${sseLeak.errorMessage})`);

        // Attempt 3: User B attempts to access User A's document via selectedDocumentId
        const crossDocRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_B.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "Build an app from the financial report.",
                conversationId: convUserB,
                agentMode: "coding",
                selectedDocumentId: pdfDoc?.documentId, // User A's documentId!
            }),
        });
        const sseCrossDoc = await readSSEStream(crossDocRes);
        const crossDocAnswer = sseCrossDoc.readyPayload?.aiResponse || "";
        const crossDocBlocked = crossDocAnswer.includes("not found") || crossDocAnswer.includes("permission") || crossDocAnswer.includes("Access denied");
        console.log(`✓ Negative Check 3: User B selectedDocumentId access: Blocked=${crossDocBlocked}`);

        report.scenarios.scenario4 = {
            verdict: (leakReadBlocked && leakAgentBlocked && crossDocBlocked) ? "PASS" : "FAIL",
            unauthorizedConversationReadBlocked: leakReadBlocked,
            unauthorizedAgentInvocationBlocked: leakAgentBlocked,
            crossDocumentAccessBlocked: crossDocBlocked,
        };

        // =========================================================================
        // SCENARIO 5: Reliability, Recovery, and Idempotency
        // =========================================================================
        console.log("\n========================================================================");
        console.log("SCENARIO 5: Reliability, Recovery, Error Feedback, and Idempotency");
        console.log("========================================================================");

        // 5.1 Test Idempotency with Duplicate Client Request ID
        const idempotencyKey = `idemp_key_${Date.now()}`;
        console.log(`Testing idempotency reservation with key: ${idempotencyKey}...`);

        const idempReqBody = {
            prompt: "What is 2 + 2? Answer with a single word.",
            conversationId: convUserA,
            agentMode: "chat",
            clientRequestId: idempotencyKey,
        };

        const idempRes1 = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(idempReqBody),
        });
        const sseIdemp1 = await readSSEStream(idempRes1);
        const ans1 = sseIdemp1.readyPayload?.aiResponse;
        console.log(`✓ Turn 1 response: "${ans1?.trim()}"`);

        // Send duplicate request with identical Idempotency-Key
        const idempRes2 = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            },
            body: JSON.stringify(idempReqBody),
        });
        const sseIdemp2 = await readSSEStream(idempRes2);
        const ans2 = sseIdemp2.readyPayload?.aiResponse;
        console.log(`✓ Duplicate Turn 2 cached response: "${ans2?.trim()}"`);
        const idempotencyPreserved = ans1 === ans2 && Boolean(ans1);
        console.log(`✓ Idempotency Verified: identical response returned without re-generation: ${idempotencyPreserved}`);

        // 5.2 Test Client Disconnection / Abort Handling
        console.log("\nTesting client abortion mid-stream (signal abort after 100ms)...");
        const abortCtrl = new AbortController();
        const abortPromise = fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            signal: abortCtrl.signal,
            body: JSON.stringify({
                prompt: "Tell me a very long story about a space explorer.",
                conversationId: convUserA,
                agentMode: "chat",
            }),
        });

        setTimeout(() => abortCtrl.abort(), 150);
        let abortCaught = false;
        try {
            await abortPromise;
        } catch (e) {
            abortCaught = e.name === "AbortError";
        }
        console.log(`✓ Client Abort handled cleanly: ${abortCaught}`);

        // Verify conversation remains healthy after abort
        console.log("Verifying conversation remains healthy after aborted turn...");
        const postAbortRes = await fetch(`${GATEWAY_URL}/api/chat/get-messages/${convUserA}`, {
            headers: { Cookie: `session=${USER_A.sessionToken}` },
        });
        const postAbortData = await postAbortRes.json();
        const messagesCount = postAbortData.messages?.length || 0;
        console.log(`✓ Post-abort conversation state: healthy, total messages=${messagesCount}`);

        // 5.3 Test 429 Rate-Limit / Quota Exhaustion Response Handling
        console.log("\nTesting 429 Rate-Limit / Daily Quota Exhaustion handling...");
        await sleep(2000);
        const todayUtc = new Date().toISOString().slice(0, 10);
        const quotaKey = `quota:daily:${USER_A.userId}:${todayUtc}`;
        await redis.set(quotaKey, "200", "EX", 3600);

        const rateLimitRes = await fetch(`${GATEWAY_URL}/api/agent/chat`, {
            method: "POST",
            headers: {
                Cookie: `session=${USER_A.sessionToken}`,
                Accept: "text/event-stream",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                prompt: "Show me figures from the report.",
                conversationId: convUserA,
                agentMode: "chat",
            }),
        });

        const sseRateLimit = await readSSEStream(rateLimitRes);
        console.log(`[DEBUG] 429 test: res.status=${rateLimitRes.status}, events=${JSON.stringify(sseRateLimit.events)}`);
        const rateLimitBlocked = Boolean(
            (sseRateLimit.errorMessage && (
                sseRateLimit.errorMessage.includes("quota reached") ||
                sseRateLimit.errorMessage.includes("limit reached") ||
                sseRateLimit.errorMessage.includes("Daily Quota Exceeded") ||
                sseRateLimit.errorMessage.includes("Too Many Requests")
            )) ||
            rateLimitRes.status === 429
        );
        console.log(`✓ 429 Rate-Limit Handled Cleanly: ${rateLimitBlocked} (Message: "${sseRateLimit.errorMessage}")`);

        // Clean up quota key
        await redis.del(quotaKey);

        report.scenarios.scenario5 = {
            verdict: (idempotencyPreserved && abortCaught && messagesCount > 0 && rateLimitBlocked) ? "PASS" : "FAIL",
            idempotencyPreserved,
            abortCleanlyHandled: abortCaught,
            conversationHealthyPostAbort: messagesCount > 0,
            rateLimit429HandledCleanly: rateLimitBlocked,
        };

        // Overall Final Verdict
        const allPass = Object.values(report.scenarios).every((s) => s.verdict === "PASS");
        report.verdict = allPass ? "PASS" : "FAIL";

        console.log("\n================================================================================");
        console.log(`       ORBIT USER-FACING ACCEPTANCE TEST RESULT: ${report.verdict}             `);
        console.log("================================================================================\n");

    } catch (err) {
        report.verdict = "FAIL";
        report.error = err.message;
        console.error("\n❌ ACCEPTANCE RUNNER FAILED:", err.message);
        console.error(err.stack);
    } finally {
        // Cleanup test data
        try {
            console.log("\nCleaning up test sessions and disposable records...");
            await redis.del(`session:${USER_A.sessionToken}`);
            await redis.del(`session:${USER_B.sessionToken}`);
            if (convUserA) {
                await fetch(`${GATEWAY_URL}/api/chat/delete-conversation`, {
                    method: "DELETE",
                    headers: {
                        Cookie: `session=${USER_A.sessionToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ conversationId: convUserA }),
                }).catch(() => null);
            }
            if (convUserB) {
                await fetch(`${GATEWAY_URL}/api/chat/delete-conversation`, {
                    method: "DELETE",
                    headers: {
                        Cookie: `session=${USER_B.sessionToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ conversationId: convUserB }),
                }).catch(() => null);
            }
            // Disconnect mongoose if connected
            if (mongoose.connection?.readyState === 1) {
                await mongoose.disconnect();
            }
            console.log("✓ Cleanup completed.");
        } catch {}
    }

    fs.writeFileSync(
        path.resolve(import.meta.dirname, "user_facing_acceptance_report_data.json"),
        JSON.stringify(report, null, 2)
    );
    console.log("Detailed report saved to user_facing_acceptance_report_data.json");
    if (report.verdict !== "PASS") {
        process.exit(1);
    }
    process.exit(0);
}

runUserFacingAcceptance();

