import { PDFParse } from "pdf-parse";
import redis from "../../../shared/redis/redis.js";

/**
 * Formats raw byte count into human-readable string (KB/MB).
 */
export const formatFileSize = (bytes = 0) => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Extracts clean text and metadata from an uploaded PDF attachment.
 *
 * @param {object} attachment - { name, mimeType, data (base64 string) }
 * @returns {Promise<{ fileName: string, fileSize: string, pageCount: number, title: string, text: string, previewText: string }>}
 */
export const extractPdfMetadata = async (attachment = {}) => {
    const fileName = attachment.name || "document.pdf";
    const dataUrl = attachment.data ? `data:application/pdf;base64,${attachment.data}` : null;

    if (!attachment.data) {
        return {
            fileName,
            fileSize: "0 KB",
            pageCount: 1,
            title: fileName.replace(/\.pdf$/i, ""),
            text: "",
            previewText: "",
            dataUrl: null,
        };
    }

    try {
        const buffer = Buffer.from(attachment.data, "base64");
        const fileSize = formatFileSize(buffer.length);

        const parser = new PDFParse({ data: buffer });
        const info = await parser.getInfo();
        const textResult = await parser.getText();
        await parser.destroy();

        const rawText = textResult?.text ? textResult.text.trim() : "";
        const pageCount = Number(info?.total) || 1;
        const title = info?.info?.Title?.trim() || fileName.replace(/\.pdf$/i, "");

        return {
            fileName,
            fileSize,
            pageCount,
            title,
            text: rawText,
            previewText: rawText.slice(0, 350),
            dataUrl,
        };
    } catch (err) {
        console.warn("PDF extraction fallback triggered:", err.message);
        return {
            fileName,
            fileSize: "PDF Document",
            pageCount: 1,
            title: fileName.replace(/\.pdf$/i, ""),
            text: "",
            previewText: "",
            dataUrl,
        };
    }
};

/**
 * Caches extracted PDF metadata and text in Redis for seamless multi-turn conversation memory.
 */
export const cachePdfDocument = async (conversationId, docData) => {
    try {
        if (!conversationId || !docData) return;
        const key = `pdf-doc-${conversationId}`;
        await redis.set(key, JSON.stringify(docData), "EX", 24 * 60 * 60);
    } catch (err) {
        console.warn("Unable to cache PDF in Redis:", err.message);
    }
};

/**
 * Retrieves cached PDF document data for a conversation from Redis.
 */
export const getCachedPdfDocument = async (conversationId) => {
    try {
        if (!conversationId) return null;
        const key = `pdf-doc-${conversationId}`;
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn("Unable to read cached PDF from Redis:", err.message);
        return null;
    }
};
