import { HumanMessage } from "@langchain/core/messages";
import { getModel } from "../config/llmModels.js";
import { formatConversationContext } from "../utils/conversationContext.js";
import { extractText } from "../utils/extractText.js";
import {
    extractPdfMetadata,
    cachePdfDocument,
    getCachedPdfDocument,
} from "../utils/extractPdf.js";
import {
    compilePdfDocument,
    parsePdfDocJson,
} from "../utils/generatePdf.js";

const DEFAULT_SUGGESTED_QUESTIONS = [
    "📋 Executive Summary",
    "📊 Key Tables & Metrics",
    "⚠️ Risk Factors & Challenges",
    "🎯 Action Items & Next Steps",
];

const isCreatePdfIntent = (prompt = "") => {
    return /\b(create|generate|make|build|export|write|compile|prepare)\b.*\b(pdf|document|cheat\s*sheet|guide|handout|report)\b/i.test(prompt) ||
           /\bpdf\b.*\b(interview|question|cheat\s*sheet|guide|report|summary)\b/i.test(prompt);
};

export const pdfAgent = async (state = {}) => {
    const conversationId = state?.conversationId;
    const userPrompt = state?.prompt ?? "";
    const conversationContext = formatConversationContext(state.history);
    const onStage = typeof state?.onStage === "function" ? state.onStage : null;

    const PDF_HEARTBEAT_MESSAGES = [
        "Analyzing document structure and page contents...",
        "Extracting key sections, tables, and metrics...",
        "Verifying factual citations and page references...",
        "Synthesizing executive findings...",
    ];
    let heartbeatIdx = 0;
    let heartbeatTimer = null;
    const startHeartbeat = (stage = "reading", customMessages = PDF_HEARTBEAT_MESSAGES) => {
        heartbeatTimer = setInterval(() => {
            if (state.isAborted?.()) {
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                return;
            }
            const msg = customMessages[heartbeatIdx % customMessages.length];
            onStage?.(stage, msg);
            heartbeatIdx++;
        }, 8_000);
    };
    const stopHeartbeat = () => {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    };

    // Case 1: Fresh PDF attachment uploaded on this turn (Document Analysis Mode)
    if (state.attachment && state.attachment.mimeType === "application/pdf") {
        onStage?.("reading", "Parsing uploaded PDF metadata and extracting text...");
        const pdfDoc = await extractPdfMetadata(state.attachment);
        if (conversationId) {
            await cachePdfDocument(conversationId, pdfDoc);
        }

        const llm = getModel("pdf");
        onStage?.("reading", `Analyzing PDF document "${pdfDoc.fileName}" (${pdfDoc.pageCount} pages)...`);

        const prompt = `You are an expert PDF document analyst, researcher, and executive intelligence assistant.
Analyze the attached PDF document ("${pdfDoc.fileName}", ${pdfDoc.pageCount} pages) thoroughly and answer the user's request.

Response and citation guidelines:
- Ground your answer in the document contents.
- Cite specific pages using [Page X] whenever referencing facts, figures, sections, or quotes.
- If the user asks for a summary or general review, organize your response as:
  1. Executive Summary & Objective
  2. Core Key Findings & Highlights
  3. Notable Metrics, Tables, or Data Points
  4. Strategic Takeaways & Next Steps
- If the document does not contain the requested information, state so clearly instead of hallucinating.

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User request:
${userPrompt}
`;

        let aiResponse = "";
        startHeartbeat("reading");
        try {
            const result = await llm.invoke([
                new HumanMessage({
                    content: [
                        { type: "text", text: prompt },
                        {
                            type: "media",
                            mimeType: state.attachment.mimeType,
                            data: state.attachment.data,
                        },
                    ],
                }),
            ]);
            aiResponse = extractText(result);
            stopHeartbeat();
        } catch (geminiError) {
            stopHeartbeat();
            console.warn("Primary multimodal PDF invoke failed, falling back to Groq on extracted text:", geminiError.message);
            // Fallback: Use Groq on extracted document text
            if (pdfDoc.text) {
                const groqLlm = getModel("chat");
                const fallbackPrompt = `You are an expert PDF document analyst.
Answer the user's request using the extracted document text below from "${pdfDoc.fileName}" (${pdfDoc.pageCount} pages).
Cite specific page indicators or sections where available.

Document text excerpt:
${pdfDoc.text.slice(0, 35000)}

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User request:
${userPrompt}
`;
                const fallbackResult = await groqLlm.invoke(fallbackPrompt);
                aiResponse = extractText(fallbackResult);
            } else {
                throw geminiError;
            }
        } finally {
            stopHeartbeat();
        }

        if (!aiResponse || !aiResponse.trim()) {
            aiResponse = `I have reviewed **${pdfDoc.fileName}** (${pdfDoc.pageCount} pages). Please specify which sections or details you would like summarized.`;
        }

        return {
            ...state,
            aiResponse,
            pdfDocument: {
                fileName: pdfDoc.fileName,
                fileSize: pdfDoc.fileSize,
                pageCount: pdfDoc.pageCount,
                title: pdfDoc.title,
                dataUrl: pdfDoc.dataUrl,
            },
            suggestedQuestions: DEFAULT_SUGGESTED_QUESTIONS,
        };
    }

    // Case 2: User requests to CREATE or GENERATE a PDF document (Document Generation Mode)
    if (isCreatePdfIntent(userPrompt) || (state.agentMode === "pdf" && !state.attachment && !state.history?.length)) {
        onStage?.("generating", "Structuring executive document outline and sections...");
        const docLlm = getModel("chat");
        const prompt = `You are an executive document architect, technical writer, and publication designer.
Create a high-quality, comprehensive document based on the user request: "${userPrompt}".

Return a STRICT JSON object conforming to this exact schema (no additional text outside JSON):
{
  "title": "Short, punchy document title (3-8 words)",
  "subtitle": "Professional subtitle or topic focus",
  "sections": [
    {
      "heading": "Section Heading (e.g. 1. Core Model Architectures & Attention)",
      "items": [
        "Concise, high-impact item / question 1",
        "Concise, high-impact item / question 2",
        "Concise, high-impact item / question 3"
      ]
    }
  ]
}

Guidelines:
- Create 4 to 6 comprehensive sections covering the topic thoroughly.
- For interview questions, include specific questions and key concepts per section.
- Keep each bullet/item crisp, clear, and informative.
- Do NOT output Base64 strings, PowerShell scripts, or decoding instructions. Output strictly valid JSON.

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User request:
${userPrompt}
`;

        let rawText = "";
        startHeartbeat("generating", [
            "Structuring executive document outline and sections...",
            "Writing detailed points and explanations...",
            "Formatting typography and section headers...",
            "Compiling document into downloadable PDF...",
        ]);
        try {
            const result = await docLlm.invoke(prompt);
            rawText = extractText(result);
            stopHeartbeat();
        } catch (error) {
            stopHeartbeat();
            console.error("PDF generation LLM call failed:", error.message);
            rawText = "";
        } finally {
            stopHeartbeat();
        }

        onStage?.("parsing", "Compiling executive document into native PDF...");
        const docData = parsePdfDocJson(rawText, userPrompt);
        const compiledPdf = await compilePdfDocument(docData);

        if (conversationId) {
            await cachePdfDocument(conversationId, {
                fileName: compiledPdf.fileName,
                fileSize: compiledPdf.fileSize,
                pageCount: compiledPdf.pageCount,
                title: compiledPdf.title,
                text: docData.sections.map((s) => `${s.heading}\n${s.items.join("\n")}`).join("\n\n"),
                dataUrl: compiledPdf.dataUrl,
            });
        }

        const sectionBullets = docData.sections
            .map((sec, idx) => `**${idx + 1}. ${sec.heading}** (${sec.items.length} key points)`)
            .join("\n");

        const aiResponse = `### 📄 ${docData.title}
*${docData.subtitle}*

Your document has been compiled into an executive **${compiledPdf.pageCount}-page PDF** (${compiledPdf.fileSize}). Preview is open in the side panel.

**Document Topics Included:**
${sectionBullets}
`;

        return {
            ...state,
            aiResponse,
            pdfDocument: {
                fileName: compiledPdf.fileName,
                fileSize: compiledPdf.fileSize,
                pageCount: compiledPdf.pageCount,
                title: compiledPdf.title,
                dataUrl: compiledPdf.dataUrl,
            },
            suggestedQuestions: [
                "🔍 Add Detailed Answers & Code Solutions",
                "📊 Expand with System Design Architecture Scenarios",
                "🎯 Add Senior-Level Behavioral & Incident Questions",
            ],
        };
    }

    // Case 3: Multi-turn follow-up without re-uploading the file
    // Check Redis document cache first for this conversation
    const cachedDoc = conversationId ? await getCachedPdfDocument(conversationId) : null;
    if (cachedDoc && cachedDoc.text) {
        onStage?.("reading", `Reviewing document excerpt from "${cachedDoc.fileName}"...`);
        const groqOrGemini = getModel("chat");
        const prompt = `You are an expert PDF document analyst.
The user is asking a follow-up question regarding the document "${cachedDoc.fileName}" (${cachedDoc.pageCount} pages) previously loaded in this conversation.
Answer their question accurately and concisely using the document text below.
Cite specific pages or sections where available.

Document text excerpt:
${cachedDoc.text.slice(0, 35000)}

${conversationContext ? `Recent conversation context:\n${conversationContext}\n` : ""}
User follow-up question:
${userPrompt}
`;
        startHeartbeat("reading");
        let result = null;
        try {
            result = await groqOrGemini.invoke(prompt);
        } finally {
            stopHeartbeat();
        }
        const aiResponse = extractText(result) || `I reviewed **${cachedDoc.fileName}** (${cachedDoc.pageCount} pages), but could not find a direct answer to your question.`;
        return {
            ...state,
            aiResponse,
            pdfDocument: {
                fileName: cachedDoc.fileName,
                fileSize: cachedDoc.fileSize,
                pageCount: cachedDoc.pageCount,
                title: cachedDoc.title,
                dataUrl: cachedDoc.dataUrl,
            },
            suggestedQuestions: DEFAULT_SUGGESTED_QUESTIONS,
        };
    }

    // Case 4: Prior conversation history without document cache
    if (Array.isArray(state.history) && state.history.length > 0) {
        onStage?.("synthesizing", "Reviewing document context from prior conversation...");
        const llm = getModel("chat");
        const prompt = `You are an expert PDF document analyst.
The user is asking a follow-up question regarding a document previously discussed in this conversation.
Answer their question accurately and concisely based on the prior conversation context.
If their question requires specific pages or details that were not previously covered, answer what you can and invite them to re-attach the document using the paperclip icon (📎).

Conversation context:
${conversationContext}

User follow-up question:
${userPrompt}
`;
        const result = await llm.invoke(prompt);
        const aiResponse = extractText(result) || "I reviewed the prior conversation context, but could not produce a response. Please attach the PDF again if needed.";
        return {
            ...state,
            aiResponse,
            suggestedQuestions: DEFAULT_SUGGESTED_QUESTIONS,
        };
    }

    // Case 5: No attachment and no conversation history
    return {
        ...state,
        aiResponse: "Please attach a PDF document using the paperclip icon (📎) below so I can analyze it, or ask me to **create a PDF** on any topic (e.g. *\"Create a PDF on Gen AI interview questions\"*).",
        suggestedQuestions: [
            "Create a PDF on System Design Interview Questions",
            "Create a PDF on Microservices Architecture",
            "Create a PDF on React & Node.js Performance",
        ],
    };
};

export const pdf = pdfAgent;
