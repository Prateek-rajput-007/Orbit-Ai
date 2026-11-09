import { useState } from "react"
import downloadFile from "../../lib/download.js"
import {
  FileText,
  Layers,
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck,
  Eye,
} from "lucide-react"

export default function PdfDocumentCard({
  pdfDocument = null,
  suggestedQuestions = [],
  onActionClick,
  onOpenArtifact,
  disabled = false,
}) {
  const [downloadSuccess, setDownloadSuccess] = useState(false)

  if (!pdfDocument && (!suggestedQuestions || suggestedQuestions.length === 0)) {
    return null
  }

  const fileName = pdfDocument?.fileName || "Document.pdf"
  const pageCount = pdfDocument?.pageCount || 1
  const fileSize = pdfDocument?.fileSize || ""
  const hasDownloadSource = Boolean(pdfDocument?.dataUrl)

  const handleDownload = () => {
    if (!hasDownloadSource) return
    const targetName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`
    downloadFile(pdfDocument.dataUrl, targetName)
    setDownloadSuccess(true)
    setTimeout(() => setDownloadSuccess(false), 2500)
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-surface p-3.5 shadow-lg">
      {/* Document Header */}
      {pdfDocument && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
              <FileText size={16} />
            </div>
            <div className="min-w-0">
              <h4 className="truncate text-xs sm:text-sm font-semibold text-ink" title={fileName}>
                {fileName}
              </h4>
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1 font-mono">
                  <Layers size={10} />
                  {pageCount} {pageCount === 1 ? "page" : "pages"}
                </span>
                {fileSize && <span>• {fileSize}</span>}
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 size={10} />
                  Indexed
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5">
            {hasDownloadSource && (
              <button
                type="button"
                onClick={() => onOpenArtifact && onOpenArtifact(pdfDocument)}
                className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2.5 text-xs font-medium text-ink transition active:scale-95 cursor-pointer"
                title="View document in panel"
              >
                <Eye size={12} className="text-muted-soft" />
                <span>View</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              className="flex h-7 items-center gap-1 rounded-lg bg-accent hover:bg-amber-300 px-2.5 text-xs font-semibold text-night transition active:scale-95 cursor-pointer"
              title="Download PDF"
            >
              {downloadSuccess ? (
                <>
                  <FileCheck size={12} className="text-emerald-950" />
                  <span>Saved</span>
                </>
              ) : (
                <>
                  <Download size={12} />
                  <span>Download</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Suggested Follow-up Action Chips */}
      {Array.isArray(suggestedQuestions) && suggestedQuestions.length > 0 && (
        <div className={pdfDocument ? "pt-3" : ""}>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted">
            <FileText size={12} className="text-accent" />
            <span>Suggested queries:</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {suggestedQuestions.map((question, idx) => (
              <button
                key={idx}
                type="button"
                disabled={disabled}
                onClick={() => onActionClick && onActionClick(question)}
                className="group inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-ink-soft transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ink disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
              >
                <span>{question}</span>
                <ArrowRight
                  size={11}
                  className="text-muted-soft transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
