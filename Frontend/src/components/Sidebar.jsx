import { useEffect, useRef, useState } from "react"
import {
  Orbit,
  Plus,
  Search,
  X,
} from "lucide-react"
import ConversationList from "./sidebar/ConversationList.jsx"
import WorkspaceProfile from "./sidebar/WorkspaceProfile.jsx"

function Sidebar({
  conversations,
  user,
  activeId,
  isOpen,
  isDesktopOpen,
  isLoading,
  isSigningOut,
  onNewChat,
  onSelectChat,
  onDeleteChat,
  onClose,
  onSignOut,
}) {
  const [query, setQuery] = useState("")
  const searchRef = useRef(null)
  const newChatShortcut =
    typeof navigator !== "undefined" && navigator.platform.includes("Mac")
      ? "⌘K"
      : "Ctrl+K"

  useEffect(() => {
    const handleSearchShortcut = (event) => {
      const target = event.target
      const isTyping =
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA"].includes(target.tagName))
      if (event.key === "/" && !isTyping) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener("keydown", handleSearchShortcut)
    return () => window.removeEventListener("keydown", handleSearchShortcut)
  }, [])

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-20 flex w-72 min-w-0 flex-col overflow-hidden border-r border-white/[0.07] bg-[#090a10]/95 backdrop-blur-xl px-3.5 pb-3 pt-3.5 shadow-2xl md:relative md:z-auto md:translate-x-0 md:shadow-none transition-[width,padding] duration-200 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      } ${isDesktopOpen ? "md:w-64" : "md:invisible md:w-0 md:border-r-0 md:px-0"}`}
      aria-label="Conversation sidebar"
      aria-hidden={!isDesktopOpen && !isOpen}
    >
      {/* Subtle atmospheric ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -left-16 -z-0 h-44 w-44 rounded-full bg-amber-500/[0.045] blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-10 -right-10 -z-0 h-40 w-40 rounded-full bg-amber-600/[0.025] blur-3xl"
      />

      {/* Brand Header */}
      <div className="relative z-10 flex h-10 items-center gap-2.5 px-1.5">
        <div className="grid size-7 place-items-center rounded-lg border border-amber-300/40 bg-gradient-to-br from-amber-200 via-accent to-amber-600 text-night shadow-[0_0_14px_rgba(234,189,88,0.25)]">
          <Orbit aria-hidden="true" size={15} strokeWidth={2.2} />
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-display text-base font-semibold tracking-tight text-ink">
            Orbit
          </span>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.2 text-[9px] font-mono text-muted-soft">
            workspace
          </span>
        </div>
        <button
          className="ml-auto grid size-7 place-items-center rounded-md text-muted transition hover:bg-white/5 hover:text-ink md:hidden cursor-pointer"
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>

      {/* New Conversation Action (Tactile CTA inspired by cta.gallery & 60fps.design) */}
      <button
        className="group relative z-10 mt-3.5 flex h-9 w-full items-center justify-between rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 text-xs font-medium text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-all duration-150 hover:border-amber-400/40 hover:bg-gradient-to-r hover:from-amber-400/[0.1] hover:to-white/[0.04] hover:shadow-md hover:shadow-amber-500/10 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        type="button"
        onClick={onNewChat}
        disabled={isLoading}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Plus
            aria-hidden="true"
            size={14}
            className="text-accent shrink-0 transition-transform duration-200 group-hover:rotate-90 group-hover:scale-110"
          />
          <span className="truncate whitespace-nowrap text-xs font-medium">New chat</span>
        </div>
        <kbd className="shrink-0 rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-mono text-muted-soft shadow-[0_1px_0_0_rgba(255,255,255,0.06)]">
          {newChatShortcut}
        </kbd>
      </button>

      {/* Conversation Filter / Search (Linear & refero.design style) */}
      <div className="relative z-10 mt-2.5 flex h-8 items-center gap-2 rounded-lg border border-white/[0.07] bg-black/40 px-2.5 text-muted shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] transition-all focus-within:border-accent-border/70 focus-within:ring-1 focus-within:ring-accent/25 focus-within:bg-black/55">
        <Search aria-hidden="true" size={13} className="shrink-0 text-muted-soft" />
        <input
          className="w-full min-w-0 border-0 bg-transparent p-0 text-xs text-ink outline-none placeholder:text-muted-soft"
          ref={searchRef}
          aria-label="Filter conversations"
          placeholder="Filter..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <kbd className="rounded border border-white/10 bg-white/5 px-1 text-[9px] font-mono text-muted-soft shadow-[0_1px_0_0_rgba(255,255,255,0.05)]">/</kbd>
      </div>

      {/* Workspace Section Header */}
      <div className="relative z-10 mb-1.5 mt-5 flex items-center justify-between px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-soft">
        <span>Conversations</span>
        <span className="rounded-full border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.2 font-mono text-[9px] text-muted-soft">
          {conversations.length}
        </span>
      </div>

      {/* Conversation Tree */}
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        query={query}
        isLoading={isLoading}
        onSelectChat={onSelectChat}
        onDeleteChat={onDeleteChat}
      />

      {/* Footer Profile */}
      <div className="relative z-10 border-t border-white/[0.07] pt-2.5">
        <WorkspaceProfile
          user={user}
          isSigningOut={isSigningOut}
          onSignOut={onSignOut}
        />
      </div>
    </aside>
  )
}

export default Sidebar
