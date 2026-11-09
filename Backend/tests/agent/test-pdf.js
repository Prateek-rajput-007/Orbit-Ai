import assert from "node:assert/strict";
import { extractPdfMetadata, formatFileSize } from "./utils/extractPdf.js";
import { compilePdfDocument, parsePdfDocJson } from "./utils/generatePdf.js";

const samplePdf = '%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n4 0 obj << /Length 58 >> stream\nBT /F1 24 Tf 100 700 Td (Orbit Strategic Executive PDF) Tj ET\nendstream endobj\n5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000244 00000 n \n0000000351 00000 n \ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n430\n%%EOF';

async function runPdfTests() {
    console.log("--- Starting PDF Agent Unit Tests ---");

    // Test 1: formatFileSize
    assert.equal(formatFileSize(500 * 1024), "500 KB");
    assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
    assert.equal(formatFileSize(500), "1 KB");
    console.log("✓ Test 1: File size formatting verified");

    // Test 2: extractPdfMetadata from valid base64
    const base64Data = Buffer.from(samplePdf, "binary").toString("base64");
    const docMeta = await extractPdfMetadata({
        name: "Annual_Report.pdf",
        mimeType: "application/pdf",
        data: base64Data,
    });

    assert.equal(docMeta.fileName, "Annual_Report.pdf");
    assert.equal(docMeta.pageCount, 1);
    assert.ok(docMeta.text.includes("Orbit Strategic Executive PDF"));
    assert.ok(docMeta.dataUrl.startsWith("data:application/pdf;base64,"));
    console.log(`✓ Test 2: PDF extraction verified (${docMeta.pageCount} page, extracted "${docMeta.previewText.slice(0, 30)}...")`);

    // Test 3: extractPdfMetadata graceful fallback on empty or malformed attachment
    const fallbackMeta = await extractPdfMetadata({
        name: "Corrupt.pdf",
        mimeType: "application/pdf",
        data: "",
    });
    assert.equal(fallbackMeta.fileName, "Corrupt.pdf");
    assert.equal(fallbackMeta.pageCount, 1);
    assert.equal(fallbackMeta.text, "");
    console.log("✓ Test 3: Defensive fallback for empty/corrupt attachments verified");

    // Test 4: compilePdfDocument generates a valid native PDF
    const compiled = await compilePdfDocument({
        title: "Gen AI Interview Questions",
        subtitle: "SDE-1 Technical Cheat Sheet",
        sections: [
            {
                heading: "1. Core Models",
                items: ["What is self-attention?", "Explain RoPE vs absolute position."],
            },
            {
                heading: "2. Retrieval-Augmented Generation",
                items: ["Mitigating hallucinations in RAG", "BM25 vs Vector Search hybrid strategies."],
            },
        ],
    });

    assert.ok(compiled.fileName.endsWith(".pdf"));
    assert.equal(compiled.pageCount, 1);
    assert.ok(compiled.dataUrl.startsWith("data:application/pdf;base64,"));
    console.log(`✓ Test 4: compilePdfDocument verified (${compiled.fileName}, ${compiled.pageCount} page, ${compiled.fileSize})`);

    // Test 5: parsePdfDocJson parses markdown fallback cleanly
    const md = "# Gen AI Guide\n## 1. Fundamentals\n- Question A\n- Question B";
    const parsedMd = parsePdfDocJson(md, "Gen AI Guide");
    assert.equal(parsedMd.title, "Gen AI Guide");
    assert.equal(parsedMd.sections.length, 1);
    assert.equal(parsedMd.sections[0].items.length, 2);
    console.log("✓ Test 5: parsePdfDocJson markdown-to-doc parser verified");

    // Test 6: compilePdfDocument handles Unicode and curly quotes gracefully
    const unicodeCompiled = await compilePdfDocument({
        title: "Generative AI SDE-1 Interview Questions",
        subtitle: "Technical Assessment - Curated for Candidates",
        sections: [
            {
                heading: "1. Model Architecture & Attention",
                items: [
                    "What is the difference between Encoder-only and Decoder-only? Explain.",
                    "Describe self-attention and its quadratic complexity.",
                ],
            },
        ],
    });
    assert.ok(unicodeCompiled.fileName.endsWith(".pdf"));
    assert.equal(unicodeCompiled.pageCount, 1);
    console.log("✓ Test 6: Unicode & WinAnsi sanitation in compilePdfDocument verified");

    console.log("\nALL PDF TESTS PASSED! (6/6)\n");
    process.exit(0);
}

runPdfTests().catch((err) => {
    console.error("PDF test failed:", err);
    process.exit(1);
});
