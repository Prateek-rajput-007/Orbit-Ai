const MAX_HISTORY_MESSAGES = 12
const MAX_MESSAGE_CHARACTERS = 2500
const MAX_CONTEXT_CHARACTERS = 12000

export const getRecentConversationMessages = (history = []) => {
    if (!Array.isArray(history)) {
        throw new Error("Conversation history must be an array")
    }

    let remainingCharacters = MAX_CONTEXT_CHARACTERS
    const recentMessages = history.slice(-MAX_HISTORY_MESSAGES).reverse()
    const selected = []

    for (const message of recentMessages) {
        if (!["user", "assistant"].includes(message.role) || typeof message.content !== "string") {
            continue
        }

        const prefix = message.role === "user" ? "User: " : "Assistant: "
        const availableCharacters = Math.min(MAX_MESSAGE_CHARACTERS, remainingCharacters - prefix.length)
        if (availableCharacters <= 0) break
        const content = message.content.slice(-availableCharacters)
        selected.push({ role: message.role, content })
        remainingCharacters -= prefix.length + content.length
    }

    return selected.reverse()
}

export const formatConversationContext = (history = []) =>
    getRecentConversationMessages(history)
        .map(({ role, content }) => `${role === "user" ? "User" : "Assistant"}: ${content}`)
        .join("\n\n")
