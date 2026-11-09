import { useState, useMemo } from "react"
import { motion } from "framer-motion"
import {
  X,
  Download,
  RotateCcw,
  ExternalLink,
  Code2,
  Play,
  FileCode,
  Laptop,
  Tablet,
  Smartphone,
  Copy,
  Check,
  ShieldCheck,
  Globe,
  Cloud,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { downloadCodeArtifactZip } from "../../lib/zipExporter.js"
import { bundleCodePreviewClient } from "../../lib/codePreviewBundler.js"
import { deployArtifactRequest } from "../../features/conversations/conversationActions.js"

export default function CodeArtifactPanel({ artifact, conversationId, onClose }) {
  const [activeTab, setActiveTab] = useState("preview") // "preview" | "code"
  const [viewport, setViewport] = useState("desktop") // "desktop" | "tablet" | "mobile"
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [copiedFile, setCopiedFile] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isDeploying, setIsDeploying] = useState(false)
  const [showDeployConfirm, setShowDeployConfirm] = useState(false)
  const [deploymentState, setDeploymentState] = useState(artifact?.deployment || null)
  const [deployNotice, setDeployNotice] = useState("")
  const [reloadKey, setReloadKey] = useState(0)

  const files = Array.isArray(artifact?.files) ? artifact.files : []
  const activeFile = files[activeFileIndex] || files[0]
  const title = artifact?.title || "Code Project"
  const isWebPreviewable = Boolean(
    artifact?.previewType === "html" || files.some((f) => f.path.endsWith(".html"))
  )
  const isDeployable = Boolean(
    isWebPreviewable ||
      files.some((f) => f.path.endsWith(".html") || f.path.endsWith(".js") || f.path.endsWith(".css"))
  )
  const totalKb = ((artifact?.totalSize || 0) / 1024).toFixed(1)
  const isDeployed = Boolean(
    (deploymentState?.status === "published" || deploymentState?.status === "deployed") &&
      deploymentState?.url
  )
  const isFailed = Boolean(deploymentState?.status === "failed")

  const effectiveHtml = useMemo(() => {
    if (!artifact) return ""
    if (artifact.bundledHtml && artifact.bundledHtml.includes("orbit-sandbox-shims")) {
      return artifact.bundledHtml
    }
    return bundleCodePreviewClient(artifact.files || [], artifact.entryFile || "index.html")
  }, [artifact])

  if (!artifact) return null

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
      await downloadCodeArtifactZip(artifact)
    } finally {
      setTimeout(() => setIsDownloading(false), 1200)
    }
  }

  const handleRefresh = () => {
    setReloadKey((prev) => prev + 1)
  }

  const handleOpenNewTab = () => {
    if (!effectiveHtml) return
    try {
      const blob = new Blob([effectiveHtml], { type: "text/html;charset=utf-8" })
      const blobUrl = window.URL.createObjectURL(blob)
      window.open(blobUrl, "_blank", "noopener,noreferrer")
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000)
    } catch (err) {
      console.error("Unable to open preview in new tab:", err)
    }
  }

  const handleTriggerDeploy = async () => {
    setShowDeployConfirm(false)
    setIsDeploying(true)
    setDeployNotice("")

    try {
      const result = await deployArtifactRequest({
        conversationId,
        messageId: artifact.messageId,
        artifact,
        provider: "netlify",
      })

      if (result.success && result.deploymentUrl) {
        setDeploymentState({
          status: "published",
          url: result.deploymentUrl,
          provider: result.provider || "Netlify",
          deployId: result.deployId,
          verified: result.verified,
          deployedAt: result.deployedAt,
        })
      } else if (result.status === "unconfigured") {
        setDeploymentState((prev) => ({ ...prev, status: "failed" }))
        setDeployNotice(result.error || "NETLIFY_AUTH_TOKEN is not configured in backend environment.")
      } else {
        setDeploymentState((prev) => ({ ...prev, status: "failed" }))
        setDeployNotice(result.error || "Deployment failed. Check server logs.")
      }
    } catch (err) {
      const msg =
        err.response?.data?.message || err.response?.data?.error || err.message || "Deployment failed."
      setDeploymentState((prev) => ({ ...prev, status: "failed" }))
      setDeployNotice(msg)
    } finally {
      setIsDeploying(false)
    }
  }

  const getViewportWidth = () => {
    switch (viewport) {
      case "mobile":
        return "max-w-[375px]"
      case "tablet":
        return "max-w-[768px]"
      default:
        return "w-full"
    }
  }

  return (
    <motion.aside
      initial={{ x: "100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 28, stiffness: 240 }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-sidebar shadow-2xl backdrop-blur-xl sm:w-[540px] md:relative md:inset-auto md:w-[500px] lg:w-[600px] xl:w-[700px] shrink-0"
      aria-label="Code Artifact Sandbox Panel"
    >
      {/* Top Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-surface-subtle">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Code2 size={15} />
          </div>
          <div className="min-w-0">
            <h3 className="truncate font-display text-xs sm:text-sm font-semibold text-ink" title={title}>
              {title}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
              <span>•</span>
              <span>{totalKb} KB</span>
              <span>•</span>
              {isDeployed ? (
                <span className="text-emerald-400 font-mono text-[10px]">Published</span>
              ) : isDeploying ? (
                <span className="text-accent font-mono text-[10px]">Deploying...</span>
              ) : isFailed ? (
                <span className="text-red-400 font-mono text-[10px]">Failed</span>
              ) : (
                <span className="text-muted font-mono text-[10px]">Sandbox Ready</span>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Tab Switcher */}
          <div className="flex items-center rounded-lg border border-white/10 bg-white/5 p-0.5 text-xs">
            {isWebPreviewable && (
              <button
                type="button"
                onClick={() => setActiveTab("preview")}
                className={`flex items-center gap-1 rounded px-2 py-1 transition cursor-pointer text-xs ${
                  activeTab === "preview"
                    ? "bg-white/15 text-ink font-medium"
                    : "text-muted hover:text-ink"
                }`}
              >
                <Play size={10} className={activeTab === "preview" ? "fill-current" : ""} />
                <span>Preview</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab("code")}
              className={`flex items-center gap-1 rounded px-2 py-1 transition cursor-pointer text-xs ${
                activeTab === "code" || !isWebPreviewable
                  ? "bg-white/15 text-ink font-medium"
                  : "text-muted hover:text-ink"
              }`}
            >
              <FileCode size={10} />
              <span>Code</span>
            </button>
          </div>

          {/* Cloud Deploy or Deployed Link */}
          {isDeployed ? (
            <a
              href={deploymentState.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-7 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-2 text-xs font-medium text-emerald-300 transition"
              title="Open deployed application"
            >
              <Globe size={11} />
              <span className="hidden sm:inline">Open</span>
              <ExternalLink size={9} />
            </a>
          ) : isDeploying ? (
            <button
              type="button"
              disabled
              className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-muted opacity-60 cursor-not-allowed"
            >
              <Loader2 size={11} className="animate-spin" />
              <span>Deploying</span>
            </button>
          ) : isDeployable ? (
            <button
              type="button"
              onClick={() => setShowDeployConfirm(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2 text-xs font-medium text-ink-soft transition cursor-pointer"
              title="Deploy project to Netlify"
            >
              <Cloud size={11} />
              <span>Deploy</span>
            </button>
          ) : null}

          {/* Download button */}
          <button
            type="button"
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex h-7 items-center gap-1 rounded-lg bg-accent hover:bg-amber-300 px-2 text-xs font-semibold text-night transition active:scale-95 cursor-pointer disabled:opacity-50"
            title="Download ZIP"
          >
            <Download size={11} />
            <span className="hidden sm:inline">{isDownloading ? "Zipping..." : "ZIP"}</span>
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

      {/* Deploy Confirmation Banner */}
      {showDeployConfirm && (
        <div className="border-b border-white/10 bg-white/[0.03] p-3 text-xs text-ink-soft flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud size={14} className="text-accent shrink-0" />
            <span>Deploy this project live to Netlify?</span>
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
              Confirm
            </button>
          </div>
        </div>
      )}

      {/* Deployment status/error notice */}
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

      {/* Viewport Sub-header (when preview mode is active) */}
      {activeTab === "preview" && isWebPreviewable && (
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-surface text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewport("desktop")}
              className={`p-1 rounded transition cursor-pointer ${
                viewport === "desktop" ? "bg-white/15 text-ink" : "text-muted hover:text-ink"
              }`}
              title="Desktop (100%)"
            >
              <Laptop size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewport("tablet")}
              className={`p-1 rounded transition cursor-pointer ${
                viewport === "tablet" ? "bg-white/15 text-ink" : "text-muted hover:text-ink"
              }`}
              title="Tablet (768px)"
            >
              <Tablet size={13} />
            </button>
            <button
              type="button"
              onClick={() => setViewport("mobile")}
              className={`p-1 rounded transition cursor-pointer ${
                viewport === "mobile" ? "bg-white/15 text-ink" : "text-muted hover:text-ink"
              }`}
              title="Mobile (375px)"
            >
              <Smartphone size={13} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRefresh}
              className="flex items-center gap-1 text-muted hover:text-ink transition cursor-pointer text-[11px]"
              title="Reload sandbox preview"
            >
              <RotateCcw size={11} />
              <span className="hidden sm:inline">Reload</span>
            </button>

            <button
              type="button"
              onClick={handleOpenNewTab}
              className="flex items-center gap-1 text-accent hover:underline transition text-[11px] cursor-pointer"
              title="Open preview in isolated browser tab"
            >
              <span>New Tab</span>
              <ExternalLink size={10} />
            </button>
          </div>
        </div>
      )}

      {/* Main Panel Body */}
      <div className="flex-1 overflow-auto bg-black/30 p-2 sm:p-3">
        {activeTab === "preview" && isWebPreviewable ? (
          <div className="flex h-full w-full items-center justify-center">
            <div
              className={`h-full w-full rounded-xl border border-white/10 bg-black shadow-lg overflow-hidden transition-all duration-150 flex flex-col ${getViewportWidth()}`}
            >
              {/* Address bar */}
              <div className="flex h-7 shrink-0 items-center gap-2 border-b border-white/10 bg-surface-subtle px-2.5 text-[10px] text-muted">
                <div className="flex gap-1.5">
                  <span className="size-2 rounded-full bg-white/20" />
                  <span className="size-2 rounded-full bg-white/20" />
                  <span className="size-2 rounded-full bg-white/20" />
                </div>
                <div className="flex-1 truncate rounded bg-black/40 px-2 py-0.5 text-center font-mono text-[9px] text-muted">
                  sandbox://orbit.local/{artifact.entryFile || "index.html"}
                </div>
                <ShieldCheck size={11} className="text-emerald-400" title="Isolated Sandbox" />
              </div>

              {/* Sandboxed Iframe */}
              <iframe
                key={reloadKey}
                srcDoc={effectiveHtml}
                title={title}
                sandbox="allow-scripts allow-modals allow-forms allow-popups"
                className="h-full w-full border-0 bg-white"
              />
            </div>
          </div>
        ) : (
          /* Source Code Inspector */
          <div className="flex h-full flex-col rounded-xl border border-white/10 bg-surface overflow-hidden shadow-lg">
            {/* File Tab Selector */}
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
              >
                {copiedFile ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                <span>{copiedFile ? "Copied" : "Copy"}</span>
              </button>
            </div>

            {/* Code Body */}
            <div className="flex-1 overflow-auto p-3 font-mono text-xs text-ink-soft bg-black/60 leading-relaxed selection:bg-accent/25">
              <pre className="m-0 whitespace-pre-wrap break-all">
                <code>{activeFile?.content || "// Empty file"}</code>
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Panel Status Footer */}
      <div className="flex h-9 shrink-0 items-center justify-between border-t border-white/10 px-4 bg-surface-subtle text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <Globe size={11} className="text-muted-soft" />
          <span className="truncate">Orbit Code Engine • Sandboxed Execution</span>
        </span>

        {isDeployed ? (
          <a
            href={deploymentState.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-accent hover:underline transition"
          >
            <span>Live on {deploymentState.provider}</span>
            <ExternalLink size={9} />
          </a>
        ) : (
          <span className="flex items-center gap-1.5 text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            <span>Local Sandbox Active</span>
          </span>
        )}
      </div>
    </motion.aside>
  )
}
