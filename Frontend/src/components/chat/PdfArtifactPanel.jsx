import { useState, useMemo, useEffect } from "react"
import { motion } from "framer-motion"
import downloadFile from "../../lib/download.js"
import {
  X,
  Download,
  FileCheck,
  FileText,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

/**
 * Safely converts a data URL (base64) into a Blob URL.
 * Modern browsers block top-frame navigation to data: URIs (e.g. window.open or target="_blank"),
 * which causes "Open in Tab" to fail or open about:blank#blocked.
 * Blob URLs are treated as trusted same-origin resources by Chromium and open cleanly in tabs.
 */
function createPdfBlobUrl(source) {
  if (!source || typeof source !== "string") return ""
  if (source.startsWith("blob:") || source.startsWith("http://") || source.startsWith("https://")) {
    return source
  }

  try {
    const commaIndex = source.indexOf(",")
    const base64Data = commaIndex !== -1 ? source.slice(commaIndex + 1) : source
    const mimeMatch = source.match(/^data:([^;]+);/)
    const mimeType = mimeMatch ? mimeMatch[1] : "application/pdf"

    const binaryString = window.atob(base64Data)
    const len = binaryString.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }

    const blob = new Blob([bytes], { type: mimeType })
    return URL.createObjectURL(blob)
  } catch (err) {
    console.error("[PdfArtifactPanel] Failed to convert dataUrl to Blob URL:", err)
    return source
  }
}

export default function PdfArtifactPanel({ document: pdfDoc, onClose }) {
  const [zoom, setZoom] = useState(1)
  const [downloadSuccess, setDownloadSuccess] = useState(false)
  const [userPage, setUserPage] = useState(null)
  const [prevDocRef, setPrevDocRef] = useState(pdfDoc)

  const dataUrl = pdfDoc?.dataUrl || ""

  // Create a blob URL for safe embedding and reliable new-tab navigation
  const blobUrl = useMemo(() => {
    return createPdfBlobUrl(dataUrl)
  }, [dataUrl])

  // Clean up Blob URL when unmounted (delayed to allow newly opened tabs to finish rendering)
  useEffect(() => {
    return () => {
      if (blobUrl && blobUrl.startsWith("blob:")) {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(blobUrl)
          } catch (err) {
            console.debug("[PdfArtifactPanel] Revocation notice:", err)
          }
        }, 60_000)
      }
    }
  }, [blobUrl])

  if (pdfDoc !== prevDocRef) {
    setPrevDocRef(pdfDoc)
    setUserPage(null)
  }

  if (!pdfDoc) return null

  const fileName = pdfDoc.fileName || "Document.pdf"
  const pageCount = pdfDoc.pageCount || 1
  const fileSize = pdfDoc.fileSize || ""

  const currentPage = Math.max(1, Math.min(pageCount, userPage ?? pdfDoc.initialPage ?? pdfDoc.page ?? 1))

  const handlePrevPage = () => setUserPage(Math.max(1, currentPage - 1))
  const handleNextPage = () => setUserPage(Math.min(pageCount, currentPage + 1))

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.15, 1.8))
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.15, 0.7))
  const handleResetZoom = () => setZoom(1)

  const handleDownload = () => {
    if (!dataUrl) return
    const targetName = fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`
    downloadFile(dataUrl, targetName)
    setDownloadSuccess(true)
    setTimeout(() => setDownloadSuccess(false), 2500)
  }

  const handleOpenInTab = (e) => {
    if (!dataUrl) return
    e.preventDefault()

    const targetUrl = (blobUrl && blobUrl.startsWith("blob:"))
      ? blobUrl
      : (createPdfBlobUrl(dataUrl) || dataUrl)

    const urlWithPage = `${targetUrl}#page=${currentPage}`

    // 1. Open new tab directly without 'noreferrer' to preserve same-origin context for Blob URLs.
    // 2. Explicitly sever window.opener to protect against reverse-tabnabbing security vulnerabilities.
    try {
      const win = window.open(urlWithPage, "_blank")
      if (win) {
        win.opener = null
        return
      }
    } catch (err) {
      console.warn("[PdfArtifactPanel] window.open failed, falling back to anchor:", err)
    }

    // Fallback if popup blocker intercepted window.open: programmatic anchor click with rel="noopener"
    const a = document.createElement("a")
    a.href = urlWithPage
    a.target = "_blank"
    a.rel = "noopener" // Note: NOT noreferrer, which strips origin and breaks Blob URLs in Chromium
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 28, stiffness: 240 }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-sidebar shadow-2xl backdrop-blur-xl sm:w-[480px] md:w-[520px] lg:w-[560px] xl:relative xl:inset-auto xl:w-[520px] 2xl:w-[600px] shrink-0"
      aria-label="Document Artifact Preview Panel"
    >
      {/* Top Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-surface-subtle">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
            <FileText size={15} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-display text-xs sm:text-sm font-semibold text-ink" title={fileName}>
              {fileName}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
              {fileSize && <span>• {fileSize}</span>}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Page navigation controls */}
          {pageCount > 1 && (
            <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
              <button
                type="button"
                onClick={handlePrevPage}
                disabled={currentPage <= 1}
                className="p-1 rounded text-muted hover:bg-white/10 hover:text-ink disabled:opacity-30 transition cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft size={12} />
              </button>
              <span className="px-1 text-[10px] font-mono text-muted">
                {currentPage}/{pageCount}
              </span>
              <button
                type="button"
                onClick={handleNextPage}
                disabled={currentPage >= pageCount}
                className="p-1 rounded text-muted hover:bg-white/10 hover:text-ink disabled:opacity-30 transition cursor-pointer"
                title="Next page"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          )}

          {/* Zoom controls */}
          <div className="hidden sm:flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 rounded text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer"
              title="Zoom out"
            >
              <ZoomOut size={12} />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="px-1 text-[10px] font-mono text-muted hover:text-ink transition cursor-pointer"
              title="Reset zoom"
            >
              <RotateCcw size={10} />
            </button>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 rounded text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer"
              title="Zoom in"
            >
              <ZoomIn size={12} />
            </button>
          </div>

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            className="flex h-7 items-center gap-1 rounded-lg bg-accent hover:bg-amber-300 px-2.5 text-xs font-semibold text-night transition active:scale-95 cursor-pointer"
            title="Download PDF"
          >
            {downloadSuccess ? (
              <>
                <FileCheck size={11} className="text-emerald-950" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <Download size={11} />
                <span>Download</span>
              </>
            )}
          </button>

          {/* Close Panel Button */}
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer"
            title="Close panel"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Document View Body */}
      <div className="flex-1 overflow-auto bg-black/40 p-2 sm:p-3">
        <div
          className="mx-auto h-full min-h-[450px] w-full rounded-xl border border-white/10 bg-white shadow-xl overflow-hidden transition-transform duration-100"
          style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
        >
          {(blobUrl || dataUrl) ? (
            <object
              key={`${blobUrl || dataUrl}-${currentPage}`}
              data={`${blobUrl || dataUrl}#page=${currentPage}&toolbar=0&navpanes=0`}
              type="application/pdf"
              className="h-full w-full"
            >
              <iframe
                key={`${blobUrl || dataUrl}-${currentPage}`}
                src={`${blobUrl || dataUrl}#page=${currentPage}&toolbar=0&navpanes=0`}
                title={fileName}
                className="h-full w-full border-0"
              />
            </object>
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-muted text-xs">
              Document content ready for download.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Panel Status Footer */}
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/10 px-4 bg-surface-subtle text-[11px] text-muted">
        <span className="truncate">Orbit Document Engine • Side-by-Side View</span>
        {dataUrl && (
          <a
            href={`${blobUrl || dataUrl}#page=${currentPage}`}
            target="_blank"
            rel="noopener"
            onClick={handleOpenInTab}
            className="flex items-center gap-1 text-accent hover:underline transition cursor-pointer"
            title={`Open ${fileName} at Page ${currentPage} in a new tab`}
          >
            <span>Open in Tab</span>
            <ExternalLink size={9} />
          </a>
        )}
      </div>
    </motion.aside>
  )
}
