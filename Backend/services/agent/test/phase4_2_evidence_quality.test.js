/**
 * @file phase4_2_evidence_quality.test.js
 * @description Comprehensive test suite for Phase 4.2: Evidence Quality & Citation Reliability.
 *
 * Verifies:
 * 1. A directly supported factual claim.
 * 2. A valid citation with irrelevant chunk content.
 * 3. A claim supported by multiple chunks.
 * 4. A response with mixed supported and unsupported claims.
 * 5. Conflicting evidence across two documents.
 * 6. An answer with citations but no actual evidence.
 * 7. An unknown source ID.
 * 8. A fabricated page number.
 * 9. A verifier timeout.
 * 10. Malformed verifier output.
 * 11. A question that cannot be answered from the PDF.
 * 12. A non-PDF agent regression check.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import {
    validateAnswerCitations,
    validateAnswerCitationsAsync,
    EVIDENCE_STATUS,
    CONFIDENCE_LEVELS,
} from "../pdf/answer/citationValidation.service.js";
import {
    extractClaimsWithSources,
    evaluateClaimAgainstChunk,
    evaluateClaimAgainstSources,
    verifyClaimsWithLLM,
    CLAIM_STATUS,
} from "../pdf/answer/claimVerification.service.js";
import { pdfAgent } from "../agents/pdf-agent.js";
import { groqFast } from "../config/llmModels.js";
import { cachePdfDocument } from "../utils/extractPdf.js";
import redis from "../../../shared/redis/redis.js";

describe("Orbit PDF Agent — Phase 4.2: Evidence Quality & Citation Reliability", () => {
    let origGroqInvoke = null;

    before(() => {
        if (groqFast) {
            origGroqInvoke = groqFast.invoke;
            groqFast.invoke = async () => ({
                content: "In Fiscal 2025, the company achieved 25% ARR growth [S1].",
            });
        }
    });

    after(() => {
        if (groqFast && origGroqInvoke) {
            groqFast.invoke = origGroqInvoke;
        }
        if (redis && typeof redis.disconnect === "function") {
            try {
                redis.disconnect();
            } catch {}
        }
    });

    // =========================================================================
    // 1. Directly Supported Factual Claim
    // =========================================================================
    test("1. A directly supported factual claim receives SUPPORTED status and HIGH confidence", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 3,
                    pageEnd: 3,
                    section: "Financial Highlights",
                    content: "Annual recurring revenue (ARR) grew by 25% year-over-year in Fiscal 2025.",
                    documentId: "doc_annual_report",
                    documentName: "AnnualReport2025.pdf",
                },
            ],
        ]);

        const rawText = "In Fiscal 2025, the company achieved 25% ARR growth [S1].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "ARR growth rate" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.HIGH);
        assert.equal(result.citations.length, 1);
        assert.equal(result.citations[0].hasClaimSupport, true);
        assert.equal(result.citations[0].pageStart, 3);
        assert.equal(result.answer, "In Fiscal 2025, the company achieved 25% ARR growth [1].");
    });

    // =========================================================================
    // 2. Valid Citation with Irrelevant Chunk Content
    // =========================================================================
    test("2. A valid citation pointing to irrelevant chunk content is flagged as unsupported", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 8,
                    pageEnd: 8,
                    section: "Cafeteria Services",
                    content: "The corporate dining facility is open daily from 8:00 AM to 4:00 PM.",
                    documentId: "doc_handbook",
                    documentName: "EmployeeHandbook.pdf",
                },
            ],
        ]);

        // The answer claims a 90% profit surge citing S1, but S1 is about cafeteria hours!
        const rawText = "Net profit surged by 90% across all European divisions [S1].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "profit increase" });

        // Must NOT receive SUPPORTED!
        assert.notEqual(result.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.LOW);
        assert.equal(result.citations[0].hasClaimSupport, false);
    });

    // =========================================================================
    // 3. Claim Supported by Multiple Chunks
    // =========================================================================
    test("3. A claim supported across multiple distinct chunks verifies successfully", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 2,
                    pageEnd: 2,
                    section: "Revenue",
                    content: "Total software subscription revenue reached $150M.",
                    documentId: "doc_q4",
                    documentName: "Q4Report.pdf",
                },
            ],
            [
                "S2",
                {
                    sourceId: "S2",
                    citationNumber: 2,
                    pageStart: 5,
                    pageEnd: 5,
                    section: "Cash Flow",
                    content: "Free cash flow expanded to $45M for the full year.",
                    documentId: "doc_q4",
                    documentName: "Q4Report.pdf",
                },
            ],
        ]);

        const rawText = "The company generated $150M in subscription revenue [S1] and $45M in free cash flow [S2].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "revenue and cash flow" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.HIGH);
        assert.equal(result.citations.length, 2);
        assert.ok(result.citations[0].hasClaimSupport);
        assert.ok(result.citations[1].hasClaimSupport);
    });

    // =========================================================================
    // 4. Mixed Supported and Unsupported Claims
    // =========================================================================
    test("4. A response with mixed supported and unsupported claims receives PARTIALLY_SUPPORTED", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 1,
                    pageEnd: 1,
                    section: "Growth",
                    content: "Cloud platform customers increased to 5,000 active enterprises.",
                    documentId: "doc_a",
                    documentName: "Metrics.pdf",
                },
            ],
            [
                "S2",
                {
                    sourceId: "S2",
                    citationNumber: 2,
                    pageStart: 4,
                    pageEnd: 4,
                    section: "Facilities",
                    content: "Parking permits must be renewed annually in September.",
                    documentId: "doc_a",
                    documentName: "Metrics.pdf",
                },
            ],
        ]);

        // First claim is true and supported by S1.
        // Second claim asserts 99.999% uptime citing S2, which has nothing about uptime.
        const rawText = "Cloud customers grew to 5,000 active enterprises [S1]. Infrastructure maintained 99.999% uptime [S2].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "cloud metrics" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.PARTIALLY_SUPPORTED);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.MEDIUM);
        assert.equal(result.citations.length, 2);
        assert.equal(result.citations[0].hasClaimSupport, true);
        assert.equal(result.citations[1].hasClaimSupport, false);
    });

    // =========================================================================
    // 5. Conflicting Evidence Across Two Documents
    // =========================================================================
    test("5. Conflicting evidence across sources triggers CONFLICTING_EVIDENCE status", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 2,
                    pageEnd: 2,
                    section: "Fiscal 2024",
                    content: "Operating margins increased by 14% across global operations.",
                    documentId: "doc_v1",
                    documentName: "Report2024.pdf",
                },
            ],
            [
                "S2",
                {
                    sourceId: "S2",
                    citationNumber: 2,
                    pageStart: 7,
                    pageEnd: 7,
                    section: "Fiscal 2024 Restatement",
                    content: "Operating margins decreased by 8% due to supply chain restructuring.",
                    documentId: "doc_v2",
                    documentName: "Restated2024.pdf",
                },
            ],
        ]);

        const rawText = "There is a conflict between sources: Report2024 indicates margins increased by 14% [S1], but Restated2024 contradicts this by stating margins decreased by 8% [S2].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "operating margins" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.CONFLICTING_EVIDENCE);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.LOW);
        assert.equal(result.citations.length, 2);
    });

    // =========================================================================
    // 6. Answer with Citations but No Actual Evidence
    // =========================================================================
    test("6. An answer with citations that provide no evidence receives INSUFFICIENT_EVIDENCE", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 1,
                    pageEnd: 1,
                    section: "Disclaimer",
                    content: "This document contains forward-looking statements subject to risks and uncertainties.",
                    documentId: "doc_disc",
                    documentName: "Disclaimer.pdf",
                },
            ],
        ]);

        const rawText = "Total quantum computer patents filed reached 1,400 units in Tokyo [S1].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "quantum computing patents" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.LOW);
    });

    // =========================================================================
    // 7. Unknown Source ID Rejection
    // =========================================================================
    test("7. An unknown source ID [S99] is pruned and recorded as invalid", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 5,
                    pageEnd: 5,
                    section: "Security",
                    content: "Multi-factor authentication is enforced for all administrative logins.",
                    documentId: "doc_sec",
                    documentName: "SecurityPolicy.pdf",
                },
            ],
        ]);

        const rawText = "MFA is mandatory for admins [S1]. Zero trust architecture is planned [S99].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "security" });

        assert.ok(!result.answer.includes("[S99]"), "Hallucinated tag [S99] must be stripped");
        assert.equal(result.invalidSourceCount, 1);
        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.PARTIALLY_SUPPORTED);
    });

    // =========================================================================
    // 8. Fabricated Page Number Rejection
    // =========================================================================
    test("8. Fabricated page numbers in LLM text are ignored in favor of trusted metadata", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 12, // Trusted extracted page
                    pageEnd: 12,
                    section: "Taxation",
                    content: "Effective global corporate tax rate settled at 21.5%.",
                    documentId: "doc_tax",
                    documentName: "TaxSummary.pdf",
                },
            ],
        ]);

        // Model hallucinates "page 100" in its text
        const rawText = "According to page 100, the effective tax rate was 21.5% [S1].";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "tax rate" });

        assert.equal(result.citations[0].pageStart, 12, "Must resolve to trusted page 12, not 100");
        assert.equal(result.citations[0].pageEnd, 12);
        assert.equal(result.citations[0].documentName, "TaxSummary.pdf");
    });

    // =========================================================================
    // 9. Verifier Timeout Handling
    // =========================================================================
    test("9. Verifier timeout triggers conservative fallback without crashing or throwing", async () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 2,
                    pageEnd: 2,
                    section: "Sales",
                    content: "International sales represented 42% of total revenue.",
                    documentId: "doc_sales",
                    documentName: "Sales.pdf",
                },
            ],
        ]);

        // Mock a hanging verifier model that exceeds timeout
        const hangingModel = {
            invoke: () => new Promise((resolve) => setTimeout(() => resolve({ content: "[]" }), 2000)),
        };

        const rawText = "International sales reached 42% of revenue [S1].";
        const result = await validateAnswerCitationsAsync({
            rawText,
            sourceMap,
            query: "international sales",
            verifierModel: hangingModel,
            timeoutMs: 50, // Short timeout
        });

        // Safe deterministic evaluation fallback succeeds
        assert.ok(result.answer);
        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(result.citations.length, 1);
    });

    // =========================================================================
    // 10. Malformed Verifier Output Handling
    // =========================================================================
    test("10. Malformed verifier output falls back to deterministic verification cleanly", async () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 1,
                    pageEnd: 1,
                    section: "Summary",
                    content: "Headcount increased by 300 engineers in 2024.",
                    documentId: "doc_hc",
                    documentName: "Team.pdf",
                },
            ],
        ]);

        // Mock verifier returning non-JSON gibberish
        const malformedModel = {
            invoke: async () => ({ content: "Here is my evaluation: INVALID_NON_JSON_GIBBERISH!!!" }),
        };

        const rawText = "Headcount added 300 engineers in 2024 [S1].";
        const result = await validateAnswerCitationsAsync({
            rawText,
            sourceMap,
            query: "engineering headcount",
            verifierModel: malformedModel,
        });

        assert.ok(result.answer);
        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.SUPPORTED);
        assert.equal(result.citations[0].hasClaimSupport, true);
    });

    // =========================================================================
    // 11. Question That Cannot Be Answered from the PDF
    // =========================================================================
    test("11. Question that cannot be answered from PDF yields INSUFFICIENT_EVIDENCE", () => {
        const sourceMap = new Map([
            [
                "S1",
                {
                    sourceId: "S1",
                    citationNumber: 1,
                    pageStart: 1,
                    pageEnd: 1,
                    section: "Intro",
                    content: "Introduction to software engineering principles.",
                    documentId: "doc_cs",
                    documentName: "SE.pdf",
                },
            ],
        ]);

        const rawText = "The document does not contain sufficient information to determine the CEO's personal home address.";
        const result = validateAnswerCitations({ rawText, sourceMap, query: "CEO home address" });

        assert.equal(result.evidenceStatus, EVIDENCE_STATUS.INSUFFICIENT_EVIDENCE);
        assert.equal(result.confidence, CONFIDENCE_LEVELS.LOW);
        assert.equal(result.citations.length, 0);
    });

    // =========================================================================
    // 12. Non-PDF Agent Regression Check
    // =========================================================================
    test("12. Non-PDF agent prompt creates normal response without crashing or corrupting state", async () => {
        const nonPdfState = {
            prompt: "Create an executive PDF cheat sheet on modern backend microservices architecture",
            conversationId: `conv_nonpdf_${Date.now()}`,
            userId: "user_regression_12",
        };

        const response = await pdfAgent(nonPdfState);
        assert.ok(response.aiResponse);
        assert.ok(response.pdfDocument);
        assert.ok(response.pdfDocument.fileName.includes(".pdf"));
    });
});
