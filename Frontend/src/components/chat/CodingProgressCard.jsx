import { useState, useEffect } from "react"
import { Code2, Clock, CheckCircle2, Loader2 } from "lucide-react"

export default function CodingProgressCard({ generatingStage = "" }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const isParsing =
    generatingStage.toLowerCase().includes("parsing") ||
    generatingStage.toLowerCase().includes("validating")
  const isSaving =
    generatingStage.toLowerCase().includes("persisting") ||
    generatingStage.toLowerCase().includes("saving")

  const steps = [
    {
      id: 1,
      name: "Architecture & File Structure",
      detail: "Configuring multi-file layout and dependencies",
      status: "completed",
    },
    {
      id: 2,
      name: "Writing Application Source Code",
      detail: "Generating markup, styling, and application logic",
      status: isSaving || isParsing ? "completed" : "active",
    },
    {
      id: 3,
      name: "Sandbox Environment",
      detail: "Configuring iframe security policies and state persistence",
      status: isSaving ? "completed" : isParsing ? "active" : "pending",
    },
    {
      id: 4,
      name: "Compiling Artifact Package",
      detail: "Bundling sandbox preview and downloadable archive",
      status: isSaving ? "active" : "pending",
    },
  ]

  return (
    <div className="my-3 w-full max-w-xl overflow-hidden rounded-xl border border-white/10 bg-surface shadow-lg">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-surface-subtle px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Code2 size={15} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-semibold text-ink">
                Coding Agent
              </h4>
              <span className="rounded bg-accent/15 px-1.5 py-0.2 text-[10px] font-medium text-accent">
                Active
              </span>
            </div>
            <p className="text-[11px] text-muted truncate max-w-xs">
              {generatingStage || "Generating application files..."}
            </p>
          </div>
        </div>

        {/* Stopwatch */}
        <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-[11px] text-muted">
          <Clock size={12} className="text-accent" />
          <span>{elapsedSeconds}s</span>
        </div>
      </div>

      {/* Checklist */}
      <div className="space-y-1.5 p-3">
        {steps.map((step) => {
          const isDone = step.status === "completed"
          const isActive = step.status === "active"

          return (
            <div
              key={step.id}
              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors ${
                isActive
                  ? "bg-white/[0.04] border border-white/10"
                  : isDone
                  ? "bg-transparent"
                  : "opacity-40"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckCircle2 size={13} className="text-emerald-400" />
                ) : isActive ? (
                  <Loader2 size={13} className="animate-spin text-accent" />
                ) : (
                  <div className="size-3 rounded-full border border-white/20" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between">
                  <p
                    className={`text-xs font-medium ${
                      isActive ? "text-ink" : isDone ? "text-ink-soft" : "text-muted"
                    }`}
                  >
                    {step.name}
                  </p>
                  <span className="text-[10px] font-mono text-muted-soft">
                    {isDone ? "Done" : isActive ? "Working" : "Queued"}
                  </span>
                </div>
                <p className="text-[11px] text-muted truncate">{step.detail}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Progress Line */}
      <div className="h-0.5 w-full overflow-hidden bg-white/5">
        <div className="h-full w-full bg-accent/60 animate-pulse" />
      </div>
    </div>
  )
}
