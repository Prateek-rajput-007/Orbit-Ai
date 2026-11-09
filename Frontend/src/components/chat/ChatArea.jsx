import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import EmptyChat from "./EmptyChat.jsx"
import Message from "./Message.jsx"
import MessageComposer from "./MessageComposer.jsx"

function ChatArea({
  messages,
  isLoading,
  isSending,
  activeTurnId,
  generatingStage = "",
  streamingText = "",
  onSend,
  onStop,
  onOpenArtifact,
}) {
  const bottomRef = useRef(null)
  const [agentMode, setAgentMode] = useState("auto")
  const [composerDraft, setComposerDraft] = useState("")
  const hasMessages = messages.length > 0

  const handleSelectPrompt = (promptText, preferredMode) => {
    setComposerDraft(promptText)
    if (preferredMode) {
      setAgentMode(preferredMode)
    }
  }

  const handleActionClick = useCallback(
    (prompt) => {
      onSend(prompt, null, "pdf")
    },
    [onSend],
  )

  useEffect(() => {
    if (!bottomRef.current) return
    if (streamingText) {
      bottomRef.current.scrollIntoView({ behavior: "auto", block: "end" })
    } else {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" })
    }
  }, [messages.length, isSending, streamingText])

  const isCodingProgress =
    agentMode === "coding" ||
    (Boolean(generatingStage) &&
      !streamingText &&
      (generatingStage.toLowerCase().includes("code") ||
        generatingStage.toLowerCase().includes("application") ||
        generatingStage.toLowerCase().includes("architecture") ||
        generatingStage.toLowerCase().includes("project") ||
        generatingStage.toLowerCase().includes("sandbox") ||
        generatingStage.toLowerCase().includes("synthesizing full-stack") ||
        generatingStage.toLowerCase().includes("parsing multi-file")))

  const displayMessages = useMemo(() => {
    if (!isSending) return messages
    const assistantClientKey = activeTurnId
      ? `${activeTurnId}-assistant`
      : "active-streaming-assistant"
    return [
      ...messages,
      {
        id: assistantClientKey,
        clientKey: assistantClientKey,
        role: "assistant",
        content: streamingText,
        isStreaming: true,
        generatingStage,
        isCodingProgress,
      },
    ]
  }, [messages, isSending, activeTurnId, streamingText, generatingStage, isCodingProgress])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#07080b] overflow-hidden">
      {/* Ambient Nebula & Gold Lighting Layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        {/* Top-center warm amber atmospheric spotlight */}
        <div className="absolute -top-36 left-1/2 h-[640px] w-[960px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-400/[0.12] via-amber-500/[0.035] to-transparent blur-[140px]" />
        {/* Secondary subtle left ambient glow */}
        <div className="absolute top-[35%] -left-36 h-[500px] w-[500px] rounded-full bg-amber-600/[0.045] blur-[170px]" />
        {/* Secondary subtle right ambient glow */}
        <div className="absolute top-[65%] -right-36 h-[520px] w-[520px] rounded-full bg-amber-400/[0.035] blur-[180px]" />
        {/* Architectural micro-grid with radial vignette mask */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff07_1px,transparent_1px),linear-gradient(to_bottom,#ffffff07_1px,transparent_1px)] bg-[size:3.5rem_3.5rem] [mask-image:radial-gradient(ellipse_80%_70%_at_50%_30%,#000_65%,transparent_100%)] opacity-75" />
      </div>

      <div className="relative z-0 flex min-h-0 flex-1 flex-col overflow-y-auto">
        {isLoading ? (
          <div className="my-auto text-center text-xs text-muted" role="status">
            Loading conversations...
          </div>
        ) : !hasMessages && !isSending ? (
          <EmptyChat
            onSend={(text) => onSend(text, null, agentMode)}
            onSelectPrompt={handleSelectPrompt}
            disabled={isLoading || isSending}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {displayMessages.map((message) => (
              <Message
                message={message}
                key={message.clientKey || message.id || message._id}
                onActionClick={handleActionClick}
                onOpenArtifact={onOpenArtifact}
              />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      <MessageComposer
        draft={composerDraft}
        onDraftChange={setComposerDraft}
        agentMode={agentMode}
        onAgentModeChange={setAgentMode}
        isSending={isSending}
        isDisabled={isLoading}
        onStop={onStop}
        onSend={(text, attachment, mode) => {
          setComposerDraft("")
          onSend(text, attachment, mode)
        }}
      />
    </div>
  )
}

export default ChatArea
