export const queryKeys = {
  currentUser: ["auth", "current-user"],
  conversations: (userId) => ["conversations", userId],
  messages: (conversationId) => ["messages", conversationId],
}
