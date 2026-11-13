import { useEffect, useRef, useState } from "react"
import { ArrowUp, Check, ChevronDown, Paperclip, Square, X } from "lucide-react"
import { AGENT_OPTIONS, AGENT_FILE_ACCEPT, isAttachmentSupportedByAgent } from "../../config/agents.js"

function MessageComposer({
  agentMode,
  onAgentModeChange,
  isSending,
  isDisabled,
  onSend,
  onStop,
  draft: externalDraft,
  onDraftChange,
  activeProject = null,
  onClearActiveProject = null,
}) {
  const [internalDraft, setInternalDraft] = useState("")
  const draft = externalDraft !== undefined ? externalDraft : internalDraft
  const setDraft = onDraftChange || setInternalDraft
  const [attachment, setAttachment] = useState(null)
  const [fileError, setFileError] = useState("")
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const agentMenuRef = useRef(null)
  const selectedAgent = AGENT_OPTIONS.find(({ value }) => value === agentMode) ?? AGENT_OPTIONS[0]

  useEffect(() => {
    if (externalDraft !== undefined && textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
      if (externalDraft) {
        textareaRef.current.focus()
      }
    }
  }, [externalDraft])

  useEffect(() => {
    if (!agentMenuOpen) return undefined

    const closeOnOutsideClick = (event) => {
      if (!agentMenuRef.current?.contains(event.target)) setAgentMenuOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsideClick)
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick)
  }, [agentMenuOpen])

  useEffect(() => {
    if (!isSending) return undefined
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onStop?.()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSending, onStop])

  const submit = (event) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || isSending || isDisabled) return
    setDraft("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
    onSend(text, attachment, agentMode)
    setAttachment(null)
    setFileError("")
  }

  const handleDraftChange = (event) => {
    setDraft(event.target.value)
    event.target.style.height = "auto"
    event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`
  }

  const handleFileChange = (event) => {
    const file = event.target.files?.[0] ?? null
    event.target.value = ""
    if (!file) return

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
    const isImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type)
    const matchesMode =
      agentMode === "auto" ||
      (agentMode === "pdf" && isPdf) ||
      (agentMode === "vision" && isImage)

    if (!isPdf && !isImage) {
      setFileError("Please choose a PDF, JPEG, PNG, or WebP file.")
      return
    }
    if (!matchesMode) {
      setFileError(`This agent mode only accepts ${agentMode === "pdf" ? "PDF documents" : "image files"}.`)
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setFileError("Files must be 10 MB or smaller.")
      return
    }
    setAttachment(file)
    setFileError("")
  }

  const selectAgent = (nextMode) => {
    onAgentModeChange(nextMode)
    setAgentMenuOpen(false)
    const supportedByMode = isAttachmentSupportedByAgent(nextMode, attachment)

    if (attachment && !supportedByMode) {
      setAttachment(null)
      setFileError("Attachment removed: not supported by the selected agent.")
    } else {
      setFileError("")
    }
  }

  const canAttach = ["auto", "pdf", "vision"].includes(agentMode)
  const acceptedFiles =
    agentMode === "pdf"
      ? AGENT_FILE_ACCEPT.pdf
      : agentMode === "vision"
        ? AGENT_FILE_ACCEPT.vision
        : AGENT_FILE_ACCEPT.all
  const canSend = Boolean(draft.trim()) && !isSending && !isDisabled

  const placeholderText =
    agentMode === "pdf" && !attachment
      ? "Ask a question about a PDF or click 📎 to attach one..."
      : agentMode === "vision" && !attachment
        ? "Ask a question about an image or click 📎 to attach one..."
        : "Ask a question, write code, or create something..."

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl px-3 pb-3 sm:px-6 sm:pb-4">
      <form
        className="rounded-2xl border border-white/[0.09] bg-[#0c0d14]/90 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.6),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-all duration-200 focus-within:border-amber-400/50 focus-within:ring-2 focus-within:ring-amber-400/15 focus-within:shadow-[0_16px_50px_rgba(0,0,0,0.7),0_0_24px_rgba(234,189,88,0.12),inset_0_1px_0_0_rgba(255,255,255,0.12)] sm:p-3.5"
        onSubmit={submit}
      >
        {/* Active Project Target Context Pill */}
        {activeProject && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 mb-2 rounded-lg bg-accent/10 border border-accent/25 text-xs text-accent w-fit max-w-full">
            <span className="size-1.5 rounded-full bg-accent animate-pulse" />
            <span className="font-semibold text-ink-soft">Targeting:</span>
            <span className="font-mono text-ink font-semibold truncate max-w-[200px] sm:max-w-[320px]">
              {activeProject.title || "Active Project"}
            </span>
            <span className="px-1 py-0.2 rounded bg-accent/20 text-[10px] font-mono text-accent">
              v{activeProject.version || 1}
            </span>
            {onClearActiveProject && (
              <button
                type="button"
                onClick={onClearActiveProject}
                className="ml-1 p-0.5 rounded hover:bg-white/10 text-muted hover:text-ink transition cursor-pointer"
                title="Deselect project (prompt will target conversation or create new project)"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        <textarea
          className="block max-h-44 min-h-10 w-full resize-none border-0 bg-transparent px-1 pb-2 pt-0.5 text-xs sm:text-sm leading-relaxed text-ink outline-none placeholder:text-muted-soft disabled:opacity-60"
          aria-label="Message Orbit"
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={handleDraftChange}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) submit(event)
          }}
          placeholder={placeholderText}
          disabled={isSending || isDisabled}
        />

        {attachment && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-ink-soft">
            <Paperclip aria-hidden="true" className="shrink-0 text-accent" size={13} />
            <span className="min-w-0 flex-1 truncate text-xs">{attachment.name}</span>
            <button
              className="grid size-5 place-items-center rounded text-muted hover:bg-white/10 hover:text-ink cursor-pointer"
              type="button"
              aria-label="Remove attachment"
              onClick={() => setAttachment(null)}
              disabled={isSending}
            >
              <X aria-hidden="true" size={13} />
            </button>
          </div>
        )}

        {fileError && (
          <p className="mb-2 text-xs text-red-300" role="alert">
            {fileError}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-white/[0.08] pt-2">
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Agent Mode Selector */}
            <div
              className="relative"
              ref={agentMenuRef}
              onKeyDown={(event) => {
                if (event.key === "Escape") setAgentMenuOpen(false)
              }}
            >
              <button
                className="inline-flex h-7.5 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 text-xs text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)] transition-all hover:border-amber-400/30 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                type="button"
                aria-label="Agent mode"
                aria-haspopup="menu"
                aria-expanded={agentMenuOpen}
                onClick={() => setAgentMenuOpen((isOpen) => !isOpen)}
                disabled={isSending || isDisabled}
              >
                <span className="font-medium text-[11px]">{selectedAgent.label}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={`shrink-0 text-muted transition-transform ${agentMenuOpen ? "rotate-180" : ""}`}
                  size={12}
                />
              </button>

              {agentMenuOpen && (
                <div
                  className="absolute bottom-full left-0 z-30 mb-1.5 max-h-72 w-44 overflow-y-auto rounded-xl border border-white/10 bg-surface-elevated p-1 shadow-2xl"
                  role="menu"
                  aria-label="Agent options"
                >
                  {AGENT_OPTIONS.map(({ value, label }) => (
                    <button
                      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition cursor-pointer ${
                        value === agentMode
                          ? "bg-accent/15 text-accent font-medium"
                          : "text-ink-soft hover:bg-white/5 hover:text-ink"
                      }`}
                      key={value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={value === agentMode}
                      onClick={() => selectAgent(value)}
                    >
                      <span>{label}</span>
                      {value === agentMode && <Check aria-hidden="true" size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Hidden File Input */}
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept={acceptedFiles}
              onChange={handleFileChange}
              aria-label="Choose a PDF or image"
            />

            {/* Attachment Button */}
            <button
              className="grid size-7.5 place-items-center rounded-lg text-muted transition-all hover:bg-white/[0.06] hover:text-ink disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
              type="button"
              title={
                canAttach
                  ? "Attach PDF or image (max 10 MB)"
                  : "Attachments supported for Auto, PDF, and Vision"
              }
              aria-label="Attach file"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canAttach || isSending || isDisabled}
            >
              <Paperclip aria-hidden="true" size={15} />
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            {isSending ? (
              <span className="hidden text-[11px] text-muted-soft sm:block">
                <kbd className="mr-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
                  Esc
                </kbd>
                to stop
              </span>
            ) : (
              <span className="hidden text-[11px] text-muted-soft sm:block">
                <kbd className="mr-1 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">
                  Enter
                </kbd>
                to send
              </span>
            )}
            {isSending ? (
              <button
                className="grid size-7.5 place-items-center rounded-lg bg-accent text-neutral-950 shadow-[0_0_12px_rgba(234,189,88,0.35)] hover:bg-amber-300 hover:scale-105 active:scale-95 transition-all duration-150 cursor-pointer"
                type="button"
                onClick={onStop}
                aria-label="Stop generating"
                title="Stop generating (Esc)"
              >
                <Square aria-hidden="true" size={11} className="fill-current text-neutral-950" />
              </button>
            ) : (
              <button
                className={`grid size-7.5 place-items-center rounded-lg transition-all duration-150 cursor-pointer ${
                  canSend
                    ? "bg-gradient-to-br from-amber-200 via-accent to-amber-500 text-night shadow-[0_0_14px_rgba(234,189,88,0.35)] hover:shadow-[0_0_20px_rgba(234,189,88,0.5)] hover:scale-105 active:scale-95"
                    : "cursor-not-allowed border border-white/[0.05] bg-white/[0.03] text-muted-soft/60"
                }`}
                type="submit"
                aria-label="Send message"
                disabled={!canSend}
              >
                <ArrowUp aria-hidden="true" size={15} strokeWidth={2.2} />
              </button>
            )}
          </div>
        </div>
      </form>
      <p className="mb-0 mt-1.5 text-center text-[10px] text-muted-soft">
        Orbit can make mistakes. Verify important information.
      </p>
    </div>
  )
}

export default MessageComposer
