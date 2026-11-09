import api from "../../api/api.js"

export const createConversation = async () => {
  const { data } = await api.post("/api/chat/create-conversation")
  const conversation = data?.conversation
  const id = conversation?._id ?? conversation?.id
  if (!id) {
    throw new Error("The server did not return the created conversation.")
  }

  return {
    id,
    title: conversation.title ?? "New conversation",
    updatedAt: new Date(
      conversation.updatedAt ?? conversation.timestamp ?? Date.now(),
    ).getTime(),
    messages: [],
  }
}