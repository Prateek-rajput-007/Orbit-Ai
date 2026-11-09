import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Presentation,
  Volume2,
  FileCheck,
} from "lucide-react"

export default function SlideDeckViewer({ slides = [], presentationFile = null }) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [showNotes, setShowNotes] = useState(false)
  const [downloadSuccess, setDownloadSuccess] = useState(false)

  if (!Array.isArray(slides) || slides.length === 0) {
    return null
  }

  const totalSlides = slides.length
  const currentSlide = slides[currentSlideIndex] || slides[0]
  const isTitleSlide = currentSlideIndex === 0

  const handlePrev = () => {
    setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : prev))
  }

  const handleNext = () => {
    setCurrentSlideIndex((prev) => (prev < totalSlides - 1 ? prev + 1 : prev))
  }

  const handleDownload = () => {
    if (!presentationFile?.dataUrl) return

    try {
      const link = document.createElement("a")
      link.href = presentationFile.dataUrl
      link.download = presentationFile.fileName || "orbit-presentation.pptx"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setDownloadSuccess(true)
      setTimeout(() => setDownloadSuccess(false), 2500)
    } catch (err) {
      console.error("Failed to trigger download:", err)
    }
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-lg">
      {/* Deck Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-2.5 bg-surface-subtle">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Presentation size={15} />
          </div>
          <div>
            <h4 className="text-xs sm:text-sm font-semibold text-ink">
              {presentationFile?.deckTitle || "Presentation Deck"}
            </h4>
            <p className="text-[11px] text-muted">
              Slide {currentSlideIndex + 1} of {totalSlides}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {currentSlide?.speakerNotes && (
            <button
              type="button"
              onClick={() => setShowNotes((prev) => !prev)}
              className={`flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition cursor-pointer ${
                showNotes
                  ? "bg-accent/15 text-accent border border-accent-border/50"
                  : "bg-white/5 text-muted hover:bg-white/10 hover:text-ink border border-white/10"
              }`}
              title="Toggle speaker notes"
            >
              <Volume2 size={12} />
              <span>Notes</span>
            </button>
          )}

          {presentationFile?.dataUrl && (
            <button
              type="button"
              onClick={handleDownload}
              className="flex h-7 items-center gap-1 rounded-lg bg-accent hover:bg-amber-300 px-2.5 text-xs font-semibold text-night transition active:scale-95 cursor-pointer"
              title="Download presentation (.pptx)"
            >
              {downloadSuccess ? (
                <>
                  <FileCheck size={12} className="text-emerald-950" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Download size={12} />
                  <span>Download .pptx</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Slide Canvas */}
      <div className="relative min-h-[280px] sm:min-h-[320px] p-6 sm:p-8 flex flex-col justify-between bg-black/50">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlideIndex}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="flex-1 flex flex-col justify-center"
          >
            {isTitleSlide ? (
              // Title Slide
              <div className="my-auto py-4 border-l-2 border-accent pl-5 sm:pl-7">
                <span className="inline-block rounded bg-white/5 px-2 py-0.5 text-[10px] font-mono text-muted uppercase tracking-wider mb-2">
                  Title Slide
                </span>
                <h2 className="text-xl sm:text-2xl lg:text-3xl font-semibold text-ink tracking-tight leading-tight">
                  {currentSlide.title}
                </h2>
                {currentSlide.subtitle && (
                  <p className="mt-2 text-sm sm:text-base text-accent font-medium">
                    {currentSlide.subtitle}
                  </p>
                )}
                {Array.isArray(currentSlide.bullets) && currentSlide.bullets.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {currentSlide.bullets.map((bullet, idx) => (
                      <span
                        key={idx}
                        className="rounded-md bg-white/5 border border-white/10 px-2.5 py-0.5 text-xs text-muted"
                      >
                        {bullet}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Content Slide
              <div className="flex-1 flex flex-col">
                <div className="border-b border-white/10 pb-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-muted">
                      Slide {currentSlideIndex + 1}
                    </span>
                    {currentSlide.subtitle && (
                      <span className="text-xs text-muted italic">
                        {currentSlide.subtitle}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-1 text-lg sm:text-xl font-semibold text-ink">
                    {currentSlide.title}
                  </h3>
                </div>

                <ul className="space-y-2.5 my-auto">
                  {Array.isArray(currentSlide.bullets) &&
                    currentSlide.bullets.map((bullet, bIdx) => (
                      <li key={bIdx} className="flex items-start gap-2.5 text-xs sm:text-sm text-ink-soft">
                        <span className="mt-1.5 size-1.5 rounded-full bg-accent flex-shrink-0" />
                        <span className="leading-relaxed">{bullet}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Speaker Notes Overlay */}
        {showNotes && currentSlide?.speakerNotes && (
          <div className="mt-4 rounded-lg border border-white/10 bg-surface-subtle p-3 text-xs text-ink-soft">
            <div className="flex items-center gap-1 font-semibold text-accent mb-1 text-[11px]">
              <Volume2 size={12} />
              <span>Speaker Notes:</span>
            </div>
            <p className="leading-relaxed text-muted text-xs">{currentSlide.speakerNotes}</p>
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between border-t border-white/10 px-4 py-2 bg-surface-subtle">
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentSlideIndex === 0}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted transition hover:bg-white/5 hover:text-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          <ChevronLeft size={14} />
          <span>Previous</span>
        </button>

        {/* Slide indicator dots */}
        <div className="flex items-center gap-1.5">
          {slides.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlideIndex(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all cursor-pointer ${
                idx === currentSlideIndex
                  ? "w-5 bg-accent"
                  : "w-1.5 bg-white/20 hover:bg-white/40"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={handleNext}
          disabled={currentSlideIndex === totalSlides - 1}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted transition hover:bg-white/5 hover:text-ink disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
        >
          <span>Next</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
