import { Orbit } from "lucide-react"

function AssistantOrb({ small = false, className = "" }) {
  return (
    <div
      className={`relative grid shrink-0 place-items-center rounded-full border border-accent-border/60 bg-gradient-to-br from-amber-200 via-accent to-amber-600 text-night shadow-sm shadow-black/20 ${
        small ? "size-7" : "size-14 sm:size-16"
      } ${className}`}
      aria-hidden="true"
    >
      <span className="absolute inset-[1.5px] rounded-full border border-black/20" />
      <span className="absolute inset-[3px] rounded-full border border-white/30" />
      <Orbit
        className="relative z-10 text-night"
        size={small ? 14 : 26}
        strokeWidth={2.2}
      />
    </div>
  )
}

export default AssistantOrb
