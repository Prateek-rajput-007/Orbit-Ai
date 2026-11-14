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

  const stageLower = (generatingStage || "").toLowerCase()
  const isParsing =
    stageLower.includes("parsing") ||
    stageLower.includes("validating") ||
    stageLower.includes("integrity")
  const isSaving =
    stageLower.includes("persisting") ||
    stageLower.includes("saving") ||
    stageLower.includes("history")

  // Determine active step index: 1, 2, 3, or 4
  let currentStep = 1
  let progressPercent = 25

  if (isSaving) {
    currentStep = 4
    progressPercent = 95
  } else if (isParsing) {
    currentStep = 3
    progressPercent = 75
  } else if (elapsedSeconds >= 2) {
    currentStep = 2
    progressPercent = Math.min(65, 35 + elapsedSeconds * 4)
  }

  const steps = [
    {
      id: 1,
      name: "Planning & Architecture",
      detail: "Designing component hierarchy, state tree, and styling system",
      status: currentStep > 1 ? "completed" : "active",
    },
    {
      id: 2,
      name: "Synthesizing React Source Code",
      detail: "Writing modular JSX components, state hooks, and application logic",
      status: currentStep > 2 ? "completed" : currentStep === 2 ? "active" : "pending",
    },
    {
      id: 3,
      name: "AST Integrity & Syntax Validation",
      detail: "Auto-verifying JSX structure, clean imports, and export relationships",
      status: currentStep > 3 ? "completed" : currentStep === 3 ? "active" : "pending",
    },
    {
      id: 4,
      name: "Interactive Workspace Setup",
      detail: "Initializing live Sandpack runtime, file explorer, and preview canvas",
      status: currentStep === 4 ? "active" : "pending",
    },
  ]

  return (
    <div className="my-3 w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.09] bg-[#0c0d14]/90 backdrop-blur-xl shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.06)]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.025] px-3.5 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7.5 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/[0.08] text-accent shadow-sm shadow-amber-500/10">
            <Code2 size={15} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-semibold text-ink">Coding Agent</h4>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                <span className="size-1 rounded-full bg-accent animate-pulse" />
                Active
              </span>
            </div>
            <p className="text-[11px] text-muted truncate max-w-xs sm:max-w-sm">
              {generatingStage || "Generating application files..."}
            </p>
          </div>
        </div>

        {/* Stopwatch */}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-muted">
          <Clock size={12} className="text-accent" />
          <span>{elapsedSeconds}s</span>
        </div>
      </div>

      {/* 4-Step Checklist */}
      <div className="space-y-1.5 p-3">
        {steps.map((step) => {
          const isDone = step.status === "completed"
          const isActive = step.status === "active"

          return (
            <div
              key={step.id}
              className={`flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-all duration-200 ${
                isActive
                  ? "bg-amber-400/[0.05] border border-amber-400/20 shadow-[0_0_12px_rgba(234,189,88,0.04)]"
                  : isDone
                  ? "bg-transparent border border-transparent"
                  : "opacity-40 border border-transparent"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {isDone ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : isActive ? (
                  <Loader2 size={14} className="animate-spin text-accent" />
                ) : (
                  <div className="size-3.5 rounded-full border border-white/20" />
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
                  <span
                    className={`text-[10px] font-mono ${
                      isActive
                        ? "text-amber-300 font-semibold"
                        : isDone
                        ? "text-emerald-400"
                        : "text-muted-soft"
                    }`}
                  >
                    {isDone ? "Done" : isActive ? "Working" : "Queued"}
                  </span>
                </div>
                <p className="text-[11px] text-muted truncate mt-0.5">{step.detail}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Stepped Dynamic Gradient Progress Bar */}
      <div className="h-1 w-full overflow-hidden bg-white/5">
        <div
          className="h-full bg-gradient-to-r from-amber-500 via-accent to-amber-300 transition-all duration-500 ease-out shadow-[0_0_8px_rgba(234,189,88,0.5)]"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  )
}
