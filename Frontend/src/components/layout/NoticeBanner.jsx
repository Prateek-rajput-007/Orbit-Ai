import { AlertCircle, X } from "lucide-react"

function NoticeBanner({ message, onDismiss }) {
  if (!message) return null

  return (
    <div
      className="absolute left-1/2 top-16 z-20 mx-4 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-center gap-2.5 rounded-xl border border-red-500/25 bg-red-950/80 px-3.5 py-2.5 text-xs text-red-200 shadow-xl backdrop-blur-md"
      role="alert"
    >
      <AlertCircle aria-hidden="true" size={15} className="shrink-0 text-red-400" />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        className="grid size-6 shrink-0 place-items-center rounded-md text-red-300 hover:bg-red-900/50 hover:text-white transition cursor-pointer"
        type="button"
        aria-label="Dismiss message"
        onClick={onDismiss}
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default NoticeBanner
