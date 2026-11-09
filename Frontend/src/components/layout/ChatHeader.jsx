import { Menu, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip.jsx"

function ChatHeader({
  title,
  isDisabled,
  isMobileSidebarOpen,
  isDesktopSidebarOpen,
  onOpenSidebar,
  onToggleDesktopSidebar,
  onNewChat,
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#07080b]/80 px-4 backdrop-blur-xl shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.02)] md:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/5 hover:text-ink md:hidden cursor-pointer"
          type="button"
          aria-label="Open sidebar"
          aria-expanded={isMobileSidebarOpen}
          onClick={onOpenSidebar}
        >
          <Menu aria-hidden="true" size={18} />
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="hidden size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-white/5 hover:text-ink md:grid cursor-pointer"
              type="button"
              aria-label={isDesktopSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
              aria-expanded={isDesktopSidebarOpen}
              onClick={onToggleDesktopSidebar}
            >
              {isDesktopSidebarOpen ? (
                <PanelLeftClose aria-hidden="true" size={17} />
              ) : (
                <PanelLeftOpen aria-hidden="true" size={17} />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="border-white/10 bg-sidebar text-ink text-xs"
          >
            {isDesktopSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          </TooltipContent>
        </Tooltip>

        {/* Breadcrumb capsule (inspired by navbar.gallery) */}
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.025] px-2.5 py-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
          <span className="font-display text-xs font-semibold text-ink">Orbit</span>
          <span className="text-muted-soft text-xs">/</span>
          <span className="truncate text-xs text-muted max-w-44 sm:max-w-72">
            {title}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Live workspace readiness pill */}
        <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-0.5 text-[11px] font-mono text-emerald-300">
          <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Ready
        </div>

        {/* Tactile New Chat action */}
        <button
          className="group flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] px-2.5 text-xs font-medium text-ink shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)] transition-all duration-150 hover:border-amber-400/35 hover:bg-gradient-to-r hover:from-amber-400/[0.08] hover:to-white/[0.04] hover:shadow-sm hover:shadow-amber-500/5 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          type="button"
          onClick={onNewChat}
          disabled={isDisabled}
        >
          <Plus size={14} className="text-accent transition-transform duration-200 group-hover:rotate-90" />
          <span className="hidden sm:inline">New chat</span>
        </button>
      </div>
    </header>
  )
}

export default ChatHeader
