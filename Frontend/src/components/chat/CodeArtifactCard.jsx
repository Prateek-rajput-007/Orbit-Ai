import { useState } from "react"
import {
  Code2,
  Play,
  Download,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileCode,
  Layers,
  ExternalLink,
  Cloud,
  Globe,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { downloadCodeArtifactZip } from "../../lib/zipExporter.js"
import useArtifactDeployment from "./useArtifactDeployment.jsx"

export default function CodeArtifactCard({
  codeArtifact,
  messageId,
  conversationId,
  onOpenArtifact,
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [copiedFile, setCopiedFile] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)

  const {
    isDeploying,
    showDeployConfirm,
    setShowDeployConfirm,
    deploymentState,
    deployNotice,
    setDeployNotice,
    triggerDeploy,
    isDeployed,
    isFailed,
  } = useArtifactDeployment(codeArtifact, conversationId, messageId)

  if (!codeArtifact || !Array.isArray(codeArtifact.files) || codeArtifact.files.length === 0) {
    return null
  }

  const files = codeArtifact.files
  const activeFile = files[activeFileIndex] || files[0]
  const isWebPreviewable = Boolean(
    codeArtifact.previewType === "html" || files.some((f) => f.path.endsWith(".html"))
  )
  const isDeployable = Boolean(
    isWebPreviewable ||
      files.some((f) => f.path.endsWith(".html") || f.path.endsWith(".js") || f.path.endsWith(".css"))
  )
  const totalKb = ((codeArtifact.totalSize || 0) / 1024).toFixed(1)

  const handleCopyCode = async () => {
    if (!activeFile?.content) return
    try {
      await navigator.clipboard.writeText(activeFile.content)
      setCopiedFile(true)
      setTimeout(() => setCopiedFile(false), 2000)
    } catch (err) {
      console.error("Unable to copy code:", err)
    }
  }

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      await downloadCodeArtifactZip(codeArtifact)
    } finally {
      setTimeout(() => setIsDownloading(false), 1200)
    }
  }

  const handleTriggerDeploy = () => triggerDeploy("netlify")

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-lg transition hover:border-white/20">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-surface-subtle p-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Code2 size={16} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate font-display text-xs sm:text-sm font-semibold text-ink">
                {codeArtifact.title || "Code Project"}
              </h3>
              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.2 font-mono text-[10px] text-muted">
                Artifact
              </span>
            </div>
            <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <Layers size={10} className="text-muted-soft" />
                {files.length} {files.length === 1 ? "file" : "files"}
              </span>
              <span>•</span>
              <span>{totalKb} KB</span>
              <span>•</span>
              {isDeployed ? (
                <span className="text-emerald-400 font-mono text-[10px] flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Published
                </span>
              ) : isDeploying ? (
                <span className="text-accent font-mono text-[10px] flex items-center gap-1">
                  <Loader2 size={10} className="animate-spin" />
                  Deploying...
                </span>
              ) : isFailed ? (
                <span className="text-red-400 font-mono text-[10px] flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-red-400" />
                  Failed
                </span>
              ) : (
                <span className="text-muted font-mono text-[10px]">
                  {isWebPreviewable ? "Preview Ready" : "Source Code"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Live Preview Button */}
          {isWebPreviewable && onOpenArtifact && (
            <button
              type="button"
              onClick={() => onOpenArtifact({ type: "code", ...codeArtifact, deployment: deploymentState })}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-accent hover:bg-amber-300 px-2.5 text-xs font-semibold text-night transition active:scale-95 cursor-pointer"
              title="Open sandbox preview"
            >
              <Play size={11} className="fill-current" />
              <span>Preview</span>
            </button>
          )}

          {/* Cloud Deploy or Deployed Link */}
          {isDeployed ? (
            <a
              href={deploymentState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 text-xs font-medium text-emerald-300 transition"
              title="Open deployed live application"
            >
              <Globe size={11} />
              <span>Open</span>
              <ExternalLink size={9} />
            </a>
          ) : isDeploying ? (
            <button
              type="button"
              disabled
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-xs font-medium text-muted opacity-60 cursor-not-allowed"
            >
              <Loader2 size={11} className="animate-spin" />
              <span>Deploying...</span>
            </button>
          ) : isDeployable ? (
            <button
              type="button"
              onClick={() => setShowDeployConfirm(true)}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2.5 text-xs font-medium text-ink-soft transition cursor-pointer"
              title="Deploy project to Netlify"
            >
              <Cloud size={11} />
              <span>{isFailed ? "Retry Deploy" : "Deploy"}</span>
            </button>
          ) : null}

          {/* Download ZIP */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2 text-xs font-medium text-ink-soft transition cursor-pointer disabled:opacity-50"
            title="Download ZIP"
          >
            <Download size={11} />
            <span className="hidden sm:inline">{isDownloading ? "Zipping..." : "ZIP"}</span>
          </button>

          {/* View Code Toggle */}
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2 text-xs font-medium text-muted transition cursor-pointer"
            title={isExpanded ? "Collapse code explorer" : "View source code"}
          >
            <FileCode size={11} />
            <span className="hidden sm:inline">{isExpanded ? "Hide" : "Code"}</span>
            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        </div>
      </div>

      {/* Description */}
      {codeArtifact.description && (
        <div className="px-3.5 py-2 text-xs text-muted border-b border-white/[0.06] bg-black/20">
          {codeArtifact.description}
        </div>
      )}

      {/* Deploy Confirmation Banner */}
      {showDeployConfirm && (
        <div className="border-b border-white/10 bg-white/[0.03] p-3 text-xs text-ink-soft flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Cloud size={14} className="text-accent shrink-0" />
            <span>Deploy this project live to Netlify public hosting?</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowDeployConfirm(false)}
              className="rounded px-2 py-0.5 text-muted hover:text-ink text-xs cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleTriggerDeploy}
              className="rounded bg-accent hover:bg-amber-300 px-2.5 py-0.5 text-xs font-semibold text-night transition active:scale-95 cursor-pointer"
            >
              Deploy Now
            </button>
          </div>
        </div>
      )}

      {/* Deployment status/notice message */}
      {deployNotice && (
        <div className="border-b border-white/10 bg-white/[0.02] px-3.5 py-2 text-xs text-muted flex items-start gap-2">
          <AlertCircle size={13} className="text-accent mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-ink">{deployNotice}</p>
          </div>
          <button
            type="button"
            onClick={() => setDeployNotice("")}
            className="text-muted hover:text-ink text-xs cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Expanded File Explorer and Code Inspector */}
      {isExpanded && (
        <div className="border-t border-white/10 bg-black/40">
          {/* File tabs */}
          <div className="flex items-center justify-between border-b border-white/10 bg-surface-subtle px-2 overflow-x-auto">
            <div className="flex items-center gap-1 py-1">
              {files.map((file, idx) => (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setActiveFileIndex(idx)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-mono transition cursor-pointer ${
                    activeFileIndex === idx
                      ? "bg-white/10 text-ink font-semibold"
                      : "text-muted hover:bg-white/5 hover:text-ink"
                  }`}
                >
                  <FileCode size={11} className={activeFileIndex === idx ? "text-accent" : "text-muted-soft"} />
                  <span>{file.path}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer shrink-0"
              title="Copy active file"
            >
              {copiedFile ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
              <span>{copiedFile ? "Copied" : "Copy"}</span>
            </button>
          </div>

          {/* Active file code view */}
          <div className="max-h-80 overflow-auto p-3 font-mono text-xs text-ink-soft bg-black/60 leading-relaxed selection:bg-accent/25">
            <pre className="m-0 whitespace-pre-wrap break-all">
              <code>{activeFile?.content || "// Empty file"}</code>
            </pre>
          </div>

          {/* Status footer */}
          <div className="flex items-center justify-between border-t border-white/10 px-3.5 py-1.5 bg-surface text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              <span>Sandbox ready</span>
            </span>
            {isDeployed ? (
              <a
                href={deploymentState.url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline flex items-center gap-1 transition"
              >
                <span>Live on {deploymentState.provider}</span>
                <ExternalLink size={10} />
              </a>
            ) : isWebPreviewable && onOpenArtifact && (
              <button
                type="button"
                onClick={() => onOpenArtifact({ type: "code", ...codeArtifact, deployment: deploymentState })}
                className="text-accent hover:underline flex items-center gap-1 transition cursor-pointer"
              >
                <span>Launch Side Preview</span>
                <ExternalLink size={10} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
