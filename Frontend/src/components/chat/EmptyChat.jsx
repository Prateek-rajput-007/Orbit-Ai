import { useReducedMotion } from "framer-motion"
import { Code2, FileText, Presentation, Search } from "lucide-react"
import AssistantOrb from "./AssistantOrb.jsx"

const workflows = [
  {
    icon: Code2,
    label: "Code & Build",
    detail: "Generate applications, debug, and inspect live sandbox artifacts",
    prompt: "Build a responsive web application for: ",
    agent: "coding",
  },
  {
    icon: Search,
    label: "Research",
    detail: "Fact-checked real-time search with verified citations",
    prompt: "Research the current state of: ",
    agent: "search",
  },
  {
    icon: FileText,
    label: "Documents",
    detail: "Summarize PDFs, extract key findings, and build cheat sheets",
    prompt: "Help me analyze a document and extract key takeaways",
    agent: "pdf",
  },
  {
    icon: Presentation,
    label: "Presentations",
    detail: "Turn concepts into structured presentations with live deck viewer",
    prompt: "Create a presentation deck on: ",
    agent: "ppt",
  },
]

const quickPrompts = [
  {
    label: "Build a React dashboard",
    prompt: "Build a responsive React dashboard with live KPI metrics and dark mode",
    agent: "coding",
  },
  {
    label: "Research AI trends",
    prompt: "Research the latest breakthroughs in agentic AI architectures in 2026",
    agent: "search",
  },
  {
    label: "Summarize a PDF",
    prompt: "Summarize this PDF document, extract core takeaways, and outline action items",
    agent: "pdf",
  },
  {
    label: "Create a pitch deck",
    prompt: "Create a 6-slide executive pitch deck covering problem, solution, market, and business model",
    agent: "ppt",
  },
]

function EmptyChat({ disabled, onSend, onSelectPrompt }) {
  const reduceMotion = useReducedMotion()

  const handleCardClick = (workflow) => {
    if (onSelectPrompt) {
      onSelectPrompt(workflow.prompt, workflow.agent)
    } else {
      onSend(workflow.prompt)
    }
  }

  const handleQuickPromptClick = (quickPrompt) => {
    if (onSelectPrompt) {
      onSelectPrompt(quickPrompt.prompt, quickPrompt.agent)
    } else {
      onSend(quickPrompt.prompt)
    }
  }

  return (
    <div className="relative my-auto w-full self-center px-4 py-8 text-center sm:max-w-2xl sm:px-6">
      {/* Multi-layered luminous warm amber radial spotlight behind AssistantOrb */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-14 left-1/2 -z-10 h-72 w-96 -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-400/15 via-amber-500/5 to-transparent blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-2 left-1/2 -z-10 h-32 w-32 -translate-x-1/2 rounded-full bg-amber-400/20 blur-xl"
      />

      {/* AssistantOrb with existing behavior */}
      <div className="mx-auto mb-4 flex justify-center">
        <AssistantOrb small={false} />
      </div>

      {/* Golden Autonomous Workspace badge */}
      <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-1 text-[11px] font-medium tracking-wide text-amber-200/90 shadow-sm shadow-amber-500/5">
        <span className="size-1.5 rounded-full bg-accent animate-pulse" />
        Autonomous Workspace
      </div>

      {/* Refined two-tone heading */}
      <h1 className="mb-2 mt-3.5 font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        What would you like to{" "}
        <span className="bg-gradient-to-r from-amber-200 via-accent to-amber-400 bg-clip-text text-transparent">
          build today?
        </span>
      </h1>
      <p className="mx-auto max-w-md text-xs leading-relaxed text-muted sm:text-sm">
        Ask a question, start coding, generate a slide deck, or attach a document.
      </p>

      {/* 4 Workflow cards in a responsive grid */}
      <div className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-3 text-left sm:grid-cols-2">
        {workflows.map((workflow) => {
          const WorkflowIcon = workflow.icon
          return (
            <button
              key={workflow.label}
              type="button"
              onClick={() => handleCardClick(workflow)}
              disabled={disabled}
              className={`group flex items-start gap-3.5 rounded-xl border border-white/[0.08] bg-[#0d0e14]/90 backdrop-blur-md p-3.5 text-left shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all duration-150 hover:border-amber-400/40 hover:bg-[#12141e] hover:shadow-xl hover:shadow-amber-500/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer ${reduceMotion ? "" : "hover:-translate-y-0.5"
                }`}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.04] text-muted-soft transition-colors group-hover:border-accent-border/50 group-hover:bg-accent-soft group-hover:text-accent">
                <WorkflowIcon aria-hidden="true" size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-ink group-hover:text-ink">
                  {workflow.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted line-clamp-2">
                  {workflow.detail}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Quick Prompts compact row */}
      <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-center justify-center gap-1.5 sm:gap-2">
        <span className="mr-0.5 text-[11px] font-medium text-muted-soft">Try:</span>
        {quickPrompts.map((quickPrompt) => (
          <button
            key={quickPrompt.label}
            type="button"
            onClick={() => handleQuickPromptClick(quickPrompt)}
            disabled={disabled}
            className="inline-flex items-center rounded-lg border border-white/[0.08] bg-[#0d0e14]/80 backdrop-blur-sm px-3 py-1 text-xs text-muted transition hover:border-amber-400/35 hover:bg-amber-400/[0.06] hover:text-ink hover:shadow-sm hover:shadow-amber-500/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {quickPrompt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export default EmptyChat
