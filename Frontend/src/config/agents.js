/**
 * Centralized AI Agent Registry & Configuration
 * Single source of truth for agent modes, labels, and file acceptance.
 */
export const AGENT_OPTIONS = [
  { value: "auto", label: "Auto", description: "Autonomous multi-agent routing" },
  { value: "chat", label: "Chat", description: "Direct conversational assistant" },
  { value: "search", label: "Search", description: "Fact-checked research with citations" },
  { value: "coding", label: "Coding", description: "Full-stack code generation & sandboxing" },
  { value: "pdf", label: "PDF", description: "Document analysis & extraction" },
  { value: "ppt", label: "Presentation", description: "Slide decks with visual layouts" },
  { value: "vision", label: "Vision", description: "Visual understanding & image inspection" },
]

export const AGENT_FILE_ACCEPT = {
  pdf: ".pdf,application/pdf",
  vision: "image/jpeg,image/png,image/webp",
  all: ".pdf,application/pdf,image/jpeg,image/png,image/webp",
}

export const isAttachmentSupportedByAgent = (agentMode, file) => {
  if (!file) return true
  const isPdf = file.type === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")
  const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type)

  if (agentMode === "auto") return isPdf || isImage
  if (agentMode === "pdf") return isPdf
  if (agentMode === "vision") return isImage
  return false
}

