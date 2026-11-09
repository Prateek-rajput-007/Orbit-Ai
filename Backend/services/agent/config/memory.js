import redis from "../../../shared/redis/redis.js"
import { getMessages } from "../utils/getMessages.js"

const parseMessages = (rawMessages) => {
    try {
        const messages = JSON.parse(rawMessages)
        return Array.isArray(messages) ? messages : null
    } catch (error) {
        if (error instanceof SyntaxError) {
            return null
        }
        throw error
    }
}

const logCacheError = (operation, error) => {
    console.error(`Unable to ${operation} conversation memory cache:`, error)
}

const getMemoryKey = (conversationId, userId) => `messages-${userId}-${conversationId}`

export const getMemory = async (conversationId, userId) => {
    if (!conversationId || !userId) {
        throw new Error("conversationId and userId are required to load conversation memory")
    }
    const key = getMemoryKey(conversationId, userId)
    let cached
    try {
        cached = await redis.get(key)
    } catch (error) {
        logCacheError("read", error)
        return getMessages(conversationId, userId)
    }

    if (cached !== null) {
        const messages = parseMessages(cached)
        if (messages !== null) {
            return messages
        }
        try {
            await redis.del(key)
        } catch (error) {
            logCacheError("clear invalid", error)
        }
    }

    const messages = await getMessages(conversationId, userId)
    try {
        await redis.set(key, JSON.stringify(messages), "EX", 24 * 60 * 60)
    } catch (error) {
        logCacheError("write", error)
    }

    return messages
}

export const invalidateMemory = async (conversationId, userId) => {
    if (!conversationId || !userId) {
        throw new Error("conversationId and userId are required to invalidate conversation memory")
    }
    try {
        await redis.del(getMemoryKey(conversationId, userId))
    } catch (error) {
        logCacheError("invalidate", error)
    }
}