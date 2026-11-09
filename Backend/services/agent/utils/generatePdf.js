import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatFileSize } from "./extractPdf.js";

const sanitizeFileName = (title = "document") => {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 45) || "document";
};

/**
 * Sanitizes Unicode characters (curly quotes, em-dashes, emojis) into safe WinAnsi characters for standard PDF fonts.
 */
export const cleanWinAnsiText = (text = "") => {
    return String(text || "")
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, "-")
        .replace(/\u2026/g, "...")
        .replace(/[\u2022\u25CF]/g, "*")
        .replace(/[^\x20-\x7E\xA0-\xFF]/g, "")
        .trim();
};

const wrapText = (text, font, fontSize, maxWidth) => {
    const clean = cleanWinAnsiText(text);
    if (!clean) return [];
    const words = clean.split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);
        if (width <= maxWidth) {
            currentLine = testLine;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
};

/**
 * Parses markdown text into structured document sections.
 */
export const parseMarkdownToDoc = (text = "", userPrompt = "") => {
    const lines = text.split("\n");
    let title = userPrompt ? userPrompt.slice(0, 50) : "Executive Document";
    let subtitle = "Curated Document Briefing";
    const sections = [];
    let currentSection = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // Skip instructions, raw base64 or decoding snippets
        if (
            line.includes("Base‑64") ||
            line.includes("Base64") ||
            line.includes("JVBER") ||
            line.includes("PowerShell") ||
            line.includes("Invoke-Item")
        ) {
            continue;
        }

        if (line.startsWith("# ")) {
            title = line.replace(/^#\s+/, "").trim();
        } else if (line.startsWith("## ") || line.startsWith("### ")) {
            if (currentSection && currentSection.items.length > 0) {
                sections.push(currentSection);
            }
            currentSection = {
                heading: line.replace(/^#+\s+/, "").replace(/^[0-9️⃣\.\s]+/, "").trim(),
                items: [],
            };
        } else if (line.startsWith("- ") || line.startsWith("* ") || /^\d+[\.\)]\s/.test(line)) {
            const cleanItem = line.replace(/^[-*\d\.\)\s]+/, "").trim();
            if (cleanItem.length > 0) {
                if (!currentSection) {
                    currentSection = { heading: "Key Topics & Questions", items: [] };
                }
                currentSection.items.push(cleanItem);
            }
        } else if (line.length > 10 && !currentSection) {
            subtitle = line.slice(0, 80);
        }
    }

    if (currentSection && currentSection.items.length > 0) {
        sections.push(currentSection);
    }

    return {
        title: cleanWinAnsiText(title),
        subtitle: cleanWinAnsiText(subtitle),
        sections: sections.length > 0 ? sections : createFallbackDoc(userPrompt, text).sections,
    };
};

/**
 * Normalizes JSON data into strict document schema.
 */
export const normalizeDoc = (data = {}, userPrompt = "") => {
    const title = cleanWinAnsiText(data.title || data.documentTitle || userPrompt.slice(0, 50) || "Executive Document");
    const subtitle = cleanWinAnsiText(data.subtitle || "Prepared by Orbit AI");
    const rawSections = Array.isArray(data.sections) ? data.sections : [];

    const sections = rawSections.map((sec, idx) => ({
        heading: cleanWinAnsiText(sec.heading || `Section ${idx + 1}`),
        items: Array.isArray(sec.items)
            ? sec.items.map((i) => cleanWinAnsiText(i)).filter(Boolean)
            : (typeof sec.content === "string" ? [cleanWinAnsiText(sec.content)] : ["Key strategic point."]),
    }));

    return {
        title,
        subtitle,
        sections: sections.length > 0 ? sections : createFallbackDoc(userPrompt).sections,
    };
};

/**
 * Creates a defensive fallback document if parsing fails.
 */
export const createFallbackDoc = (userPrompt = "", rawText = "") => {
    const title = cleanWinAnsiText(userPrompt ? userPrompt.slice(0, 50) : "Executive Guide & Assessment");
    const items = rawText
        .split("\n")
        .map((l) => cleanWinAnsiText(l))
        .filter((l) => l.length > 10 && !l.includes("Base64") && !l.includes("JVBER"))
        .slice(0, 8);

    return {
        title,
        subtitle: "Comprehensive Technical & Strategic Assessment",
        sections: [
            {
                heading: "Core Concepts & Fundamentals",
                items: items.length > 0 ? items : [
                    "Explain the core architectural differences and tradeoffs.",
                    "Key considerations for scalable production deployment.",
                    "Best practices for evaluation, monitoring, and safety.",
                ],
            },
        ],
    };
};

/**
 * Defensively extracts and parses structured document from LLM text.
 */
export const parsePdfDocJson = (text = "", userPrompt = "") => {
    if (!text || typeof text !== "string") {
        return createFallbackDoc(userPrompt);
    }

    // 1. Direct JSON parse
    try {
        const parsed = JSON.parse(text.trim());
        if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
            return normalizeDoc(parsed, userPrompt);
        }
    } catch (_) {}

    // 2. Fenced markdown block: ```json ... ```
    const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeMatch && codeMatch[1]) {
        try {
            const parsed = JSON.parse(codeMatch[1].trim());
            if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
                return normalizeDoc(parsed, userPrompt);
            }
        } catch (_) {}
    }

    // 3. Slice outermost { ... }
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1));
            if (parsed && Array.isArray(parsed.sections) && parsed.sections.length > 0) {
                return normalizeDoc(parsed, userPrompt);
            }
        } catch (_) {}
    }

    // 4. Fallback to parsing markdown outline
    return parseMarkdownToDoc(text, userPrompt);
};

/**
 * Compiles structured document sections into a styled native PDF file.
 *
 * @param {object} docData - { title, subtitle, sections: [{ heading, items: [...] }] }
 * @returns {Promise<{ fileName: string, dataUrl: string, pageCount: number, title: string, fileSize: string }>}
 */
export const compilePdfDocument = async (docData = {}) => {
    const title = cleanWinAnsiText(docData.title || "Executive Document Briefing");
    const subtitle = cleanWinAnsiText(docData.subtitle || "Prepared by Orbit AI");
    const sections = Array.isArray(docData.sections) ? docData.sections : [];

    const pdfDoc = await PDFDocument.create();
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 45;
    const contentWidth = pageWidth - margin * 2;

    const colors = {
        primaryDark: rgb(0.06, 0.09, 0.16),  // Slate 900
        accentAmber: rgb(0.96, 0.62, 0.04),  // Amber 500
        textDark: rgb(0.12, 0.16, 0.24),     // Slate 800
        textMuted: rgb(0.42, 0.48, 0.58),    // Slate 500
        borderLight: rgb(0.88, 0.91, 0.94),  // Slate 200
        bulletDot: rgb(0.85, 0.55, 0.05),
    };

    let currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    let currentY = pageHeight - 40;

    const drawHeader = (page, isFirstPage = false) => {
        // Top accent banner
        page.drawRectangle({
            x: margin,
            y: pageHeight - 34,
            width: contentWidth,
            height: 18,
            color: colors.primaryDark,
        });

        page.drawText("ORBIT AI  -  EXECUTIVE BRIEFING", {
            x: margin + 10,
            y: pageHeight - 27,
            size: 8.5,
            font: fontBold,
            color: colors.accentAmber,
        });

        if (isFirstPage) {
            currentY = pageHeight - 65;
        } else {
            currentY = pageHeight - 55;
        }
    };

    // Draw first page header
    drawHeader(currentPage, true);

    // Title Block
    const titleLines = wrapText(title, fontBold, 18, contentWidth);
    for (const line of titleLines) {
        currentPage.drawText(line, {
            x: margin,
            y: currentY,
            size: 18,
            font: fontBold,
            color: colors.primaryDark,
        });
        currentY -= 24;
    }

    if (subtitle) {
        const subtitleLines = wrapText(subtitle, fontItalic, 10.5, contentWidth);
        for (const line of subtitleLines) {
            currentPage.drawText(line, {
                x: margin,
                y: currentY,
                size: 10.5,
                font: fontItalic,
                color: colors.textMuted,
            });
            currentY -= 15;
        }
    }

    // Divider after title block
    currentY -= 6;
    currentPage.drawLine({
        start: { x: margin, y: currentY },
        end: { x: margin + contentWidth, y: currentY },
        thickness: 1.5,
        color: colors.accentAmber,
    });
    currentY -= 20;

    const checkPageBreak = (neededHeight = 35) => {
        if (currentY - neededHeight < 45) {
            currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
            drawHeader(currentPage, false);
            return true;
        }
        return false;
    };

    // Render Sections
    for (const section of sections) {
        checkPageBreak(50);

        const headingText = cleanWinAnsiText(section.heading);
        if (headingText) {
            currentPage.drawText(headingText, {
                x: margin,
                y: currentY,
                size: 12,
                font: fontBold,
                color: colors.primaryDark,
            });
            currentY -= 5;

            currentPage.drawLine({
                start: { x: margin, y: currentY },
                end: { x: margin + contentWidth, y: currentY },
                thickness: 0.8,
                color: colors.borderLight,
            });
            currentY -= 14;
        }

        // Section Items
        const items = Array.isArray(section.items) ? section.items : [];
        for (const item of items) {
            const rawItemText = typeof item === "string" ? item : String(item?.text || "");
            const itemText = cleanWinAnsiText(rawItemText);
            if (!itemText) continue;

            const isBullet = Boolean(section.isBullet ?? true);
            const indent = isBullet ? 18 : 0;
            const itemLines = wrapText(itemText, fontRegular, 10, contentWidth - indent);

            checkPageBreak(itemLines.length * 14 + 8);

            // Draw bullet indicator
            if (isBullet && itemLines.length > 0) {
                currentPage.drawCircle({
                    x: margin + 6,
                    y: currentY + 3,
                    size: 2.2,
                    color: colors.bulletDot,
                });
            }

            for (const line of itemLines) {
                currentPage.drawText(line, {
                    x: margin + indent,
                    y: currentY,
                    size: 10,
                    font: fontRegular,
                    color: colors.textDark,
                });
                currentY -= 14;
            }
            currentY -= 4;
        }
        currentY -= 10;
    }

    // Add page numbers in footer
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    pages.forEach((page, index) => {
        const footerText = `Page ${index + 1} of ${totalPages}  -  Orbit Document Intelligence`;
        page.drawText(footerText, {
            x: margin,
            y: 22,
            size: 8,
            font: fontRegular,
            color: colors.textMuted,
        });
    });

    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString("base64");
    const fileName = `${sanitizeFileName(title)}.pdf`;
    const fileSize = formatFileSize(pdfBytes.length);

    return {
        fileName,
        fileSize,
        pageCount: totalPages,
        title,
        dataUrl: `data:application/pdf;base64,${base64}`,
    };
};
