import api from "../../api/api.js"

export const saveMessage = async (conversationId, role, content) => {
  const { data } = await api.post("/api/chat/save-message", {
    conversationId,
    role,
    content,
  })
  return data?.message
}

export const updateConversation = async (conversationId, title) => {
  const { data } = await api.put("/api/chat/update-conversation", {
    conversationId,
    title,
  })
  return data?.conversation
}

export const deleteConversation = async (conversationId) => {
  await api.delete("/api/chat/delete-conversation", {
    data: { conversationId },
  })
}

export const deployArtifactRequest = async ({ conversationId, messageId, artifact, provider = "netlify" }) => {
  const { data } = await api.post("/api/agent/deploy", {
    conversationId,
    messageId,
    artifact,
    provider,
  })
  return data
}
