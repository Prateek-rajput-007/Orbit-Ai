import { memo, useEffect, useState } from "react"
import {
  Check,
  Copy,
  Paperclip,
  ZoomIn,
  X,
  Download,
  FileCheck,
  AlertCircle,
} from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import downloadFile from "../../lib/download.js"
import AssistantOrb from "./AssistantOrb.jsx"
import SlideDeckViewer from "./SlideDeckViewer.jsx"
import PdfDocumentCard from "./PdfDocumentCard.jsx"
import CodeArtifactCard from "./CodeArtifactCard.jsx"
import CodingProgressCard from "./CodingProgressCard.jsx"

function Message({ message, onActionClick, onOpenArtifact }) {
  const [copied, setCopied] = useState(false)
  const [zoomImage, setZoomImage] = useState(null)
  const [downloadedUrl, setDownloadedUrl] = useState(null)
  const isUser = message.role === "user"

  useEffect(() => {
    if (!copied) return undefined
    const timeoutId = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
    } catch (error) {
      console.error("Unable to copy message:", error)
    }
  }

  const handleDownloadImage = async (url, title = "orbit-image") => {
    if (!url) return
    const safeTitle =
      (title || "orbit-image")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 30) || "image"
    try {
      const res = await fetch(url, { mode: "cors" })
      if (!res.ok) throw new Error("Fetch error")
      const blob = await res.blob()
      downloadFile(blob, `${safeTitle}.jpg`)
    } catch {
      downloadFile(url, `${safeTitle}.jpg`)
    }
    setDownloadedUrl(url)
    setTimeout(() => setDownloadedUrl(null), 2500)
  }

  return (
    <>
      <article
        className={`group mb-6 flex items-start gap-3 ${isUser ? "justify-end" : ""}`}
      >
        {!isUser && <AssistantOrb small />}
        <div
          className={`min-w-0 ${
            isUser
              ? "max-w-xl rounded-2xl rounded-tr-sm border border-white/10 bg-white/[0.05] px-4 py-2.5 shadow-sm"
              : "flex-1 pt-0.5"
          }`}
        >
          {!isUser && (
            <div className="mb-1.5 text-xs font-semibold text-ink">Orbit</div>
          )}
          {isUser ? (
            <div className="flex flex-col gap-2">
              {message.attachment?.dataUrl && (
                <div className="relative group max-w-xs overflow-hidden rounded-xl border border-white/10 bg-black/40">
                  <img
                    src={message.attachment.dataUrl}
                    alt={message.attachment.name || "Uploaded image"}
                    className="max-h-60 w-auto rounded-lg object-contain cursor-zoom-in transition duration-150 hover:opacity-95"
                    onClick={() => setZoomImage(message.attachment.dataUrl)}
                  />
                  <div className="flex items-center justify-between px-2.5 py-1 text-[11px] font-mono text-muted bg-black/60 backdrop-blur-sm">
                    <span className="truncate max-w-[200px]">
                      {message.attachment.name || "image.png"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[10px] text-accent">
                      <ZoomIn size={11} />
                      Zoom
                    </span>
                  </div>
                </div>
              )}
              {message.attachment && !message.attachment.dataUrl && (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1 text-xs text-accent">
                  <Paperclip size={12} />
                  <span className="truncate">{message.attachment.name}</span>
                </div>
              )}
              {message.content && (
                <p className="m-0 whitespace-pre-wrap break-words text-xs sm:text-sm leading-relaxed text-ink">
                  {message.content}
                </p>
              )}
              {message.status === "error" && (
                <div className="mt-1 flex items-center gap-1.5 text-xs text-red-400 font-mono">
                  <AlertCircle size={13} className="shrink-0" />
                  <span className="truncate">
                    Not delivered: {message.error || "Request failed"}
                  </span>
                </div>
              )}
            </div>
          ) : message.isCodingProgress ? (
            <CodingProgressCard generatingStage={message.generatingStage} />
          ) : message.isStreaming && !message.content ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex h-5 items-center gap-1.5" aria-label="Thinking">
                {[0, 1, 2].map((dot) => (
                  <span
                    className="size-1.5 animate-typing rounded-full bg-accent/80"
                    key={dot}
                    style={{ animationDelay: `${dot * 140}ms` }}
                  />
                ))}
              </div>
              {message.generatingStage && (
                <span className="text-[11px] text-muted font-mono">
                  {message.generatingStage}
                </span>
              )}
            </div>
          ) : (
            <>
              {message.isStreaming && message.generatingStage && (
                <div className="mb-2 flex items-center gap-2 text-[11px] font-mono text-muted">
                  <span className="size-1.5 rounded-full bg-accent animate-pulse" />
                  <span>{message.generatingStage}</span>
                </div>
              )}
              <div className="break-words text-xs sm:text-sm leading-relaxed text-ink-soft [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-4 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-ink [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:my-0.5 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-5 [&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-accent-ink [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-white/10 [&_pre]:bg-black/40 [&_pre]:p-3.5 [&_pre_code]:bg-transparent [&_pre_code]:p-0">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    a: (props) => (
                      <a {...props} target="_blank" rel="noreferrer" />
                    ),
                    table: (props) => (
                      <div className="my-3 overflow-x-auto rounded-lg border border-white/10">
                        <table className="w-full border-collapse text-xs" {...props} />
                      </div>
                    ),
                    th: (props) => (
                      <th className="border border-white/10 bg-white/5 px-3 py-2 text-left font-semibold text-ink" {...props} />
                    ),
                    td: (props) => (
                      <td className="border border-white/10 px-3 py-2 text-ink-soft" {...props} />
                    ),
                    img: ({ src, alt, ...props }) => {
                      if (
                        !src ||
                        src.includes("oaidalleapiprodscus.blob.core.windows.net") ||
                        src.includes("XXXXXXXX")
                      ) {
                        return null
                      }
                      return (
                        <span className="my-3 block max-w-md overflow-hidden rounded-xl border border-white/10 bg-black/40">
                          <img
                            src={src}
                            alt={alt || "Illustration"}
                            className="max-h-96 w-auto rounded-lg object-contain cursor-zoom-in"
                            loading="lazy"
                            onClick={() => setZoomImage(src)}
                            onError={(e) => {
                              e.currentTarget.style.display = "none"
                            }}
                            {...props}
                          />
                        </span>
                      )
                    },
                  }}
                >
                  {message.content}
                </ReactMarkdown>
                {message.isStreaming && (
                  <span className="inline-block w-1.5 h-3.5 ml-1 align-text-bottom bg-accent animate-pulse" aria-hidden="true" />
                )}
              </div>

              {message.pdfDocument && (
                <PdfDocumentCard
                  pdfDocument={message.pdfDocument}
                  suggestedQuestions={message.suggestedQuestions}
                  onActionClick={onActionClick}
                  onOpenArtifact={onOpenArtifact}
                />
              )}

              {message.codeArtifact && (
                <CodeArtifactCard
                  codeArtifact={message.codeArtifact}
                  messageId={message.id || message._id}
                  conversationId={message.conversationId}
                  onOpenArtifact={onOpenArtifact}
                />
              )}

              {Array.isArray(message.slides) && message.slides.length > 0 && (
                <SlideDeckViewer
                  slides={message.slides}
                  presentationFile={message.presentationFile}
                />
              )}

              {Array.isArray(message.images) && message.images.length === 1 && (
                <div className="my-4 max-w-md overflow-hidden rounded-xl border border-white/10 bg-surface shadow-lg">
                  <div className="relative group overflow-hidden bg-black/40">
                    <img
                      src={message.images[0].url}
                      alt={message.images[0].description || "Generated Image"}
                      className="max-h-[440px] w-full object-contain cursor-zoom-in transition duration-150 hover:opacity-95"
                      loading="lazy"
                      onClick={() => setZoomImage(message.images[0].url)}
                    />
                  </div>
                  <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 bg-surface-subtle text-xs">
                    <span className="truncate pr-2 text-ink-soft text-[11px]">
                      {message.images[0].description || "Visual Output"}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => setZoomImage(message.images[0].url)}
                        className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 px-2 py-1 text-[11px] text-ink-soft transition cursor-pointer"
                        title="Zoom preview"
                      >
                        <ZoomIn size={12} className="text-muted" />
                        <span>Zoom</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleDownloadImage(
                            message.images[0].url,
                            message.images[0].description
                          )
                        }
                        className="flex items-center gap-1 rounded-md bg-accent hover:bg-amber-300 px-2 py-1 text-[11px] font-semibold text-night transition active:scale-95 cursor-pointer"
                        title="Download image"
                      >
                        {downloadedUrl === message.images[0].url ? (
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
                </div>
              )}

              {Array.isArray(message.images) && message.images.length > 1 && (
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {message.images.map(({ url, description }, index) => (
                    <a
                      className="overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-white/20"
                      href={url}
                      key={`${url}-${index}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        className="aspect-video w-full object-cover"
                        src={url}
                        alt={description || `Search result ${index + 1}`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {!isUser && !message.isStreaming && message.content && (
            <button
              className="mt-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted-soft opacity-100 transition hover:bg-white/5 hover:text-ink sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 cursor-pointer"
              type="button"
              onClick={copyMessage}
              aria-label={copied ? "Message copied" : "Copy assistant response"}
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </button>
          )}
        </div>
      </article>

      {/* Lightbox Image Preview Modal */}
      {zoomImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setZoomImage(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl border border-white/15 bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={zoomImage}
              alt="Expanded preview"
              className="max-h-[85vh] max-w-full object-contain"
            />
            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleDownloadImage(zoomImage, "expanded-preview")}
                className="flex items-center gap-1.5 rounded-lg bg-black/75 hover:bg-black/90 px-2.5 py-1 text-xs text-white shadow-md backdrop-blur-md transition cursor-pointer"
                title="Download image"
              >
                {downloadedUrl === zoomImage ? (
                  <>
                    <FileCheck size={13} className="text-emerald-400" />
                    <span>Saved</span>
                  </>
                ) : (
                  <>
                    <Download size={13} />
                    <span>Download</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setZoomImage(null)}
                className="rounded-lg bg-black/75 p-1.5 text-white/90 hover:bg-black/95 hover:text-white transition cursor-pointer"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default memo(Message)
