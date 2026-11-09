import redis from "../../../shared/redis/redis.js";

/**
 * Formats byte size into human readable string (KB or MB).
 */
export const formatFileSize = (bytes = 0) => {
    if (!bytes || bytes <= 0) return "0 KB";
    if (bytes < 1024 * 1024) {
        return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Normalizes and extracts metadata from an uploaded image attachment.
 *
 * @param {object} attachment - { name, mimeType, data (base64 string) }
 * @returns {{ fileName: string, fileSize: string, mimeType: string, dataUrl: string }}
 */
export const extractImageMetadata = (attachment = {}) => {
    const fileName = attachment.name || "image.png";
    const mimeType = attachment.mimeType || "image/png";
    const rawData = attachment.data || "";

    let fileSize = "Image";
    if (rawData) {
        const approxBytes = Math.round((rawData.length * 3) / 4);
        fileSize = formatFileSize(approxBytes);
    }

    const dataUrl = rawData ? `data:${mimeType};base64,${rawData}` : null;

    return {
        fileName,
        fileSize,
        mimeType,
        data: rawData,
        dataUrl,
    };
};

/**
 * Caches image data and visual context in Redis for 24-hour seamless multi-turn conversations.
 */
export const cacheVisionImage = async (conversationId, imageData) => {
    try {
        if (!conversationId || !imageData) return;
        const key = `vision-image-${conversationId}`;
        await redis.set(key, JSON.stringify(imageData), "EX", 24 * 60 * 60);
    } catch (err) {
        console.warn("Unable to cache vision image in Redis:", err.message);
    }
};

/**
 * Retrieves cached image data for a conversation from Redis.
 */
export const getCachedVisionImage = async (conversationId) => {
    try {
        if (!conversationId) return null;
        const key = `vision-image-${conversationId}`;
        const raw = await redis.get(key);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn("Unable to read cached vision image from Redis:", err.message);
        return null;
    }
};
