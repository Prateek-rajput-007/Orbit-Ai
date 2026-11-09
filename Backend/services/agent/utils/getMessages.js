import axios from "axios"

const getChatServiceUrl = () => {
    const chatServiceUrl = (process.env.CHAT_SERVICE_URL || process.env.CHAT_SERVICE)?.replace(/\/+$/, "")
    if (!chatServiceUrl) {
        throw new Error("CHAT_SERVICE_URL (or CHAT_SERVICE) is not configured")
    }
    return chatServiceUrl
}

const getUserHeaders = (userId) => {
    if (!userId) {
        throw new Error("userId is required to access conversation history")
    }
    return { headers: { "user-id": userId } }
}

export const getMessages = async (conversationId, userId) => {
    if (!conversationId) {
        throw new Error("conversationId is required to load message history")
    }

    const { data } = await axios.get(
        `${getChatServiceUrl()}/chat/get-messages/${encodeURIComponent(conversationId)}`,
        getUserHeaders(userId),
    )
    if (!Array.isArray(data.messages)) {
        throw new Error("Chat service returned an invalid message history")
    }

    return data.messages
}

export const saveTurn = async (conversationId, userId, userContent, assistantMessage, userAttachment = null) => {
    const { data } = await axios.post(
        `${getChatServiceUrl()}/chat/save-turn`,
        {
            conversationId,
            userMessage: {
                content: userContent,
                attachment: userAttachment,
            },
            assistantMessage,
        },
        getUserHeaders(userId),
    )
    if (!Array.isArray(data.messages) || data.messages.length !== 2) {
        throw new Error("Chat service returned an invalid saved turn")
    }
    return data.messages
}

export const updateArtifactDeployment = async (conversationId, messageId, userId, deployment) => {
    if (!conversationId || !messageId) return null;
    try {
        const { data } = await axios.post(
            `${getChatServiceUrl()}/chat/update-deployment`,
            {
                conversationId,
                messageId,
                deployment,
            },
            getUserHeaders(userId)
        );
        return data.message;
    } catch (err) {
        console.warn("Unable to persist deployment record to chat service:", err.message);
        return null;
    }
};
