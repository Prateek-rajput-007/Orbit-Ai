import api from "../../api/api.js"

export const toMessage = (message, index) => ({
  id: message._id ?? message.id,
  clientKey: message.clientKey || message._id || message.id || `msg-${index}`,
  role: message.role,
  content: message.content,
  images: Array.isArray(message.images) ? message.images : [],
  searchResults: Array.isArray(message.searchResults) ? message.searchResults : [],
  slides: Array.isArray(message.slides) ? message.slides : [],
  presentationFile: message.presentationFile ?? null,
  pdfDocument: message.pdfDocument ?? null,
  codeArtifact: message.codeArtifact ?? null,
  imageAttachment: message.imageAttachment ?? null,
  attachment: message.attachment ?? null,
  suggestedQuestions: Array.isArray(message.suggestedQuestions) ? message.suggestedQuestions : [],
})

export const toConversationSummary = (conversation) => ({
  id: conversation._id ?? conversation.id,
  title: conversation.title ?? "New conversation",
  updatedAt: new Date(
    conversation.updatedAt ?? conversation.timestamp ?? Date.now(),
  ).getTime(),
})

export const getConversationSummaries = async () => {
  const { data } = await api.get("/api/chat/get-conversations")
  const conversations = data?.conversations
  if (!Array.isArray(conversations)) {
    throw new Error("The server returned an invalid conversations response.")
  }

  return conversations.map(toConversationSummary)
}

export const fetchConversationMessages = async (conversationId) => {
  if (!conversationId) return []
  const { data } = await api.get(
    `/api/chat/get-messages/${encodeURIComponent(conversationId)}`,
  )
  if (!Array.isArray(data?.messages)) {
    throw new Error("The server returned an invalid messages response.")
  }
  return data.messages
    .slice()
    .sort(
      (left, right) =>
        new Date(left.timestamp ?? left.createdAt ?? 0) -
        new Date(right.timestamp ?? right.createdAt ?? 0),
    )
    .map(toMessage)
}

export const getConversation = getConversationSummaries
