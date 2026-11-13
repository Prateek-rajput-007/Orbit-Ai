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
  Atom,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  History,
  ChevronDown,
} from "lucide-react"
import { downloadCodeArtifactZip } from "../../lib/zipExporter.js"
import { bundleCodePreviewClient } from "../../lib/codePreviewBundler.js"
import { detectArtifactRuntime, ARTIFACT_RUNTIMES } from "../../lib/detectArtifactRuntime.js"
import SandpackArtifactWorkspace from "./SandpackArtifactWorkspace.jsx"
import useArtifactDeployment from "./useArtifactDeployment.jsx"
import ProjectVersionHistoryModal from "./ProjectVersionHistoryModal.jsx"
import {
  fetchProjectVersionDetails,
  restoreProjectVersionRequest,
  fetchConversationProjects,
  fetchProjectCurrentDetails,
} from "../../features/conversations/projectVersionActions.js"

export default function CodeArtifactPanel({ artifact, conversationId, onClose, onArtifactChange }) {
  const [historicalArtifact, setHistoricalArtifact] = useState(null)
  const [previewingVersion, setPreviewingVersion] = useState(null)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [isRestoringHistorical, setIsRestoringHistorical] = useState(false)
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false)
  const [availableProjects, setAvailableProjects] = useState([])
  const [isLoadingProjects, setIsLoadingProjects] = useState(false)

  const [activeTab, setActiveTab] = useState("preview") // "preview" | "code"
  const [viewport, setViewport] = useState("desktop") // "desktop" | "tablet" | "mobile"
  const [activeFileIndex, setActiveFileIndex] = useState(0)
  const [copiedFile, setCopiedFile] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [zoom, setZoom] = useState(1.0)

  // Derived active artifact: renders historical snapshot when in preview mode, otherwise latest active artifact
  const currentArtifact = previewingVersion && historicalArtifact ? historicalArtifact : artifact

  const runtimeInfo = useMemo(() => detectArtifactRuntime(currentArtifact), [currentArtifact])
  const isReactProject = runtimeInfo.runtime === ARTIFACT_RUNTIMES.REACT

  const {
    isDeploying,
    showDeployConfirm,
    setShowDeployConfirm,
    deploymentState,
    deployNotice,
    setDeployNotice,
    triggerDeploy,
    isDeployed,
  } = useArtifactDeployment(currentArtifact, conversationId, currentArtifact?.messageId || artifact?.messageId)

  const files = Array.isArray(currentArtifact?.files) ? currentArtifact.files : []
  const activeFile = files[activeFileIndex] || files[0]
  const title = currentArtifact?.title || artifact?.title || "Code Project"
  const projectId = currentArtifact?.projectId || artifact?.projectId
  const currentVersionNumber = artifact?.version || artifact?.versionNumber || 1
  const displayVersion = previewingVersion ?? currentArtifact?.version ?? currentArtifact?.versionNumber ?? artifact?.version ?? 1

  const isWebPreviewable = Boolean(
    isReactProject ||
      currentArtifact?.previewType === "html" ||
      files.some((f) => f.path.endsWith(".html"))
  )
  const isDeployable = Boolean(
    isWebPreviewable ||
      files.some((f) => f.path.endsWith(".html") || f.path.endsWith(".js") || f.path.endsWith(".css"))
  )
  const totalKb = ((currentArtifact?.totalSize || 0) / 1024).toFixed(1)

  const effectiveHtml = useMemo(() => {
    if (!currentArtifact || isReactProject) return ""
    // When files array is present, client-side bundler ensures JSX/Babel and CDN dependencies are always resolved
    if (Array.isArray(currentArtifact.files) && currentArtifact.files.length > 0) {
      return bundleCodePreviewClient(currentArtifact.files, currentArtifact.entryFile || "index.html")
    }
    if (currentArtifact.bundledHtml) {
      return currentArtifact.bundledHtml
    }
    return ""
  }, [currentArtifact, isReactProject])

  if (!currentArtifact && !artifact) return null

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
      await downloadCodeArtifactZip(currentArtifact || artifact)
    } finally {
      setTimeout(() => setIsDownloading(false), 1200)
    }
  }

  const handlePreviewHistoricalVersion = async (verNum) => {
    try {
      const pId = currentArtifact?.projectId || artifact?.projectId
      if (!pId) return
      const details = await fetchProjectVersionDetails(pId, verNum)
      if (details?.snapshot) {
        const snapshotArtifact = {
          ...details.snapshot,
          projectId: pId,
          version: verNum,
          versionNumber: verNum,
          changeSummary: details.changeSummary,
        }
        setHistoricalArtifact(snapshotArtifact)
        setPreviewingVersion(verNum)
      }
    } catch (err) {
      console.error("Failed to load historical snapshot:", err)
    }
  }

  const handleRestorePreviewedVersion = async () => {
    const pId = currentArtifact?.projectId || artifact?.projectId
    if (!pId || !previewingVersion) return
    setIsRestoringHistorical(true)
    try {
      const result = await restoreProjectVersionRequest(pId, previewingVersion, conversationId)
      const restored = result?.artifact || result?.restoredArtifact
      if (result?.success && restored) {
        setHistoricalArtifact(null)
        setPreviewingVersion(null)
        if (typeof onArtifactChange === "function") {
          onArtifactChange(restored)
        }
      }
    } catch (err) {
      console.error("Failed to restore historical version:", err)
    } finally {
      setIsRestoringHistorical(false)
    }
  }

  const handleVersionRestored = (restoredArtifact) => {
    setHistoricalArtifact(null)
    setPreviewingVersion(null)
    if (typeof onArtifactChange === "function") {
      onArtifactChange(restoredArtifact)
    }
  }

  const handleToggleProjectSwitcher = async () => {
    if (showProjectSwitcher) {
      setShowProjectSwitcher(false)
      return
    }
    setShowProjectSwitcher(true)
    if (conversationId) {
      setIsLoadingProjects(true)
      try {
        const res = await fetchConversationProjects(conversationId)
        setAvailableProjects(res?.projects || [])
      } catch (err) {
        console.warn("Failed to list projects for conversation:", err)
      } finally {
        setIsLoadingProjects(false)
      }
    }
  }

  const handleSelectDifferentProject = async (targetProjId) => {
    if (!targetProjId || targetProjId === projectId) {
      setShowProjectSwitcher(false)
      return
    }
    try {
      const details = await fetchProjectCurrentDetails(targetProjId)
      if (details?.snapshot && typeof onArtifactChange === "function") {
        onArtifactChange(details.snapshot)
      }
    } catch (err) {
      console.warn("Failed to switch project:", err)
    } finally {
      setShowProjectSwitcher(false)
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

  const handleTriggerDeploy = () => triggerDeploy("netlify")

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
      className={
        isFullScreen
          ? "fixed inset-0 z-50 flex w-screen h-screen flex-col bg-slate-950 shadow-none border-0"
          : "fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-white/10 bg-sidebar shadow-2xl backdrop-blur-xl sm:w-[540px] md:w-[600px] lg:w-[680px] xl:relative xl:inset-auto xl:w-[62vw] 2xl:w-[68vw] shrink-0"
      }
      aria-label="Code Artifact Sandbox Panel"
    >
      {/* Top Header */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-surface-subtle">
        <div className="flex items-center gap-2.5 min-w-0 pr-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-accent">
            <Code2 size={15} />
          </div>
          <div className="min-w-0 relative">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate font-display text-xs sm:text-sm font-semibold text-ink" title={title}>
                {title}
              </h3>
              {conversationId && (
                <button
                  type="button"
                  onClick={handleToggleProjectSwitcher}
                  className="p-0.5 rounded hover:bg-white/10 text-muted hover:text-ink transition cursor-pointer"
                  title="Switch between projects in this conversation"
                >
                  <ChevronDown size={12} className={showProjectSwitcher ? "rotate-180 transition-transform" : "transition-transform"} />
                </button>
              )}
            </div>

            {/* Conversation Projects Switcher Dropdown */}
            {showProjectSwitcher && (
              <div className="absolute top-full left-0 mt-2 z-50 w-64 rounded-xl bg-[#0e1017] border border-white/15 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95">
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted border-b border-white/5 mb-1 flex items-center justify-between">
                  <span>Conversation Projects</span>
                  <button type="button" onClick={() => setShowProjectSwitcher(false)} className="hover:text-ink text-xs">✕</button>
                </div>
                {isLoadingProjects ? (
                  <div className="px-3 py-2 text-xs text-muted flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-accent" />
                    <span>Loading projects...</span>
                  </div>
                ) : availableProjects.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted">No other projects in this chat</div>
                ) : (
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {availableProjects.map((p) => {
                      const isActive = p.projectId === projectId
                      return (
                        <button
                          key={p.projectId}
                          type="button"
                          onClick={() => handleSelectDifferentProject(p.projectId)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition cursor-pointer ${
                            isActive ? "bg-accent/15 text-accent font-semibold" : "text-ink-soft hover:bg-white/5 hover:text-ink"
                          }`}
                        >
                          <span className="truncate">{p.title || "Orbit Project"}</span>
                          <span className="text-[10px] font-mono text-muted shrink-0 ml-2">v{p.currentVersionNumber}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span>{files.length} {files.length === 1 ? "file" : "files"}</span>
              <span>•</span>
              <span>{totalKb} KB</span>
              <span>•</span>
              {isReactProject ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 border border-amber-500/30">
                  <Atom size={9} />
                  <span>React (Sandpack)</span>
                </span>
              ) : runtimeInfo.runtime === ARTIFACT_RUNTIMES.LEGACY_HTML ? (
                <span className="inline-flex items-center gap-1 rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] font-medium text-blue-300 border border-blue-500/30">
                  <span>HTML (Iframe)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] font-medium text-slate-300 border border-slate-500/30">
                  <span>Script</span>
                </span>
              )}
              {projectId && (
                <>
                  <span>•</span>
                  <button
                    type="button"
                    onClick={() => setShowHistoryModal(true)}
                    className="inline-flex items-center gap-1 rounded bg-white/10 hover:bg-white/15 px-1.5 py-0.5 text-[9px] font-mono font-medium text-ink border border-white/10 transition cursor-pointer"
                    title="View project version history & snapshots"
                  >
                    <History size={9} className="text-accent" />
                    <span>v{displayVersion}</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Version History Button */}
          {projectId && (
            <button
              type="button"
              onClick={() => setShowHistoryModal(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2 text-xs font-mono font-medium text-ink-soft transition cursor-pointer"
              title="Project Version History & Snapshots"
            >
              <History size={11} className="text-accent" />
              <span>v{displayVersion}</span>
            </button>
          )}
          {/* Tab Switcher (for legacy HTML projects) */}
          {!isReactProject && (
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
          )}

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
              <span>{isReactProject ? "Building..." : "Deploying"}</span>
            </button>
          ) : isDeployable ? (
            <button
              type="button"
              onClick={() => setShowDeployConfirm(true)}
              className="flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] px-2 text-xs font-medium text-ink-soft transition cursor-pointer"
              title={isReactProject ? "Build production bundle and deploy live to Netlify" : "Deploy project to Netlify"}
            >
              <Cloud size={11} />
              <span>{isReactProject ? "Build & Deploy" : "Deploy"}</span>
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

          {/* Fullscreen Expansion button */}
          <button
            type="button"
            onClick={() => setIsFullScreen((prev) => !prev)}
            className="grid size-7 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer"
            title={isFullScreen ? "Exit Fullscreen" : "Fullscreen Preview"}
          >
            {isFullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
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

      {/* Historical Snapshot Banner */}
      {previewingVersion && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 p-2.5 px-4 text-xs text-amber-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <History size={14} className="text-amber-400 shrink-0" />
            <span>
              Viewing <strong>v{previewingVersion}</strong> (Historical snapshot)
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setHistoricalArtifact(null)
                setPreviewingVersion(null)
              }}
              className="rounded px-2.5 py-1 text-xs text-muted hover:text-white bg-white/10 border border-white/10 transition cursor-pointer"
            >
              Exit Preview
            </button>
            <button
              type="button"
              onClick={handleRestorePreviewedVersion}
              disabled={isRestoringHistorical}
              className="flex items-center gap-1 rounded bg-amber-500 hover:bg-amber-400 text-night px-2.5 py-1 text-xs font-semibold transition active:scale-95 cursor-pointer disabled:opacity-50"
            >
              {isRestoringHistorical ? (
                <>
                  <Loader2 size={11} className="animate-spin" />
                  <span>Restoring...</span>
                </>
              ) : (
                <>
                  <RotateCcw size={11} />
                  <span>Restore v{previewingVersion}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Deploy Confirmation Banner */}
      {showDeployConfirm && (
        <div className="border-b border-white/10 bg-white/[0.03] p-3 text-xs text-ink-soft flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Cloud size={14} className="text-accent shrink-0" />
            <span>{isReactProject ? "Build production bundle and deploy live to Netlify?" : "Deploy this project live to Netlify?"}</span>
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

      {/* Main Panel Body: Dual-Runtime Architecture */}
      <div className="flex-1 overflow-hidden bg-black/30">
        {isReactProject ? (
          /* Modern React Projects: Execute via Sandpack with File Explorer, Code Editor, Preview & Console */
          <SandpackArtifactWorkspace
            artifact={currentArtifact}
            conversationId={conversationId}
            onClose={onClose}
            isFullScreen={isFullScreen}
            onToggleFullScreen={() => setIsFullScreen((prev) => !prev)}
          />
        ) : (
          /* Legacy HTML / Vanilla Projects / Scripts: Execute via Sandboxed Iframe */
          <div className="h-full flex flex-col overflow-hidden">
            {/* Viewport Sub-header (when preview mode is active) */}
            {activeTab === "preview" && isWebPreviewable && (
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 px-4 bg-surface text-xs gap-2">
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center rounded-md bg-white/5 p-0.5 border border-white/10">
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

                  {/* Zoom controls for legacy preview */}
                  <div className="hidden sm:flex items-center rounded-md bg-white/5 p-0.5 border border-white/10 text-[11px] ml-1">
                    <button
                      type="button"
                      onClick={() => setZoom((prev) => Math.max(prev - 0.15, 0.5))}
                      disabled={zoom <= 0.5}
                      className="p-1 text-muted hover:text-ink disabled:opacity-30 cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom(1.0)}
                      className="px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-ink transition cursor-pointer"
                      title="Reset Zoom to 100%"
                    >
                      {Math.round(zoom * 100)}%
                    </button>
                    <button
                      type="button"
                      onClick={() => setZoom((prev) => Math.min(prev + 0.15, 1.25))}
                      disabled={zoom >= 1.25}
                      className="p-1 text-muted hover:text-ink disabled:opacity-30 cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn size={12} />
                    </button>
                  </div>
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

            {/* Main Legacy Body */}
            <div className="flex-1 overflow-auto p-2 sm:p-3 flex flex-col items-center justify-start bg-slate-950/70">
              {activeTab === "preview" && isWebPreviewable ? (
                <div
                  className={`flex-1 flex flex-col items-center transition-all duration-150 ${getViewportWidth()}`}
                  style={{
                    transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                    transformOrigin: "top center",
                    width: getViewportWidth() === "w-full" ? (zoom !== 1 ? `${100 / zoom}%` : "100%") : undefined,
                    height: zoom !== 1 ? `${100 / zoom}%` : "100%",
                  }}
                >
                  <div className="h-full w-full rounded-xl border border-white/10 bg-black shadow-lg overflow-hidden flex flex-col">
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
                  {/* Non-web script notice if applicable */}
                  {runtimeInfo.runtime === ARTIFACT_RUNTIMES.UNSUPPORTED && (
                    <div className="border-b border-white/10 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-200 flex items-center gap-2">
                      <AlertCircle size={13} className="text-amber-400 shrink-0" />
                      <span>Non-web code project (backend or utility script). Inspect files below or click ZIP to run locally.</span>
                    </div>
                  )}

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
      {/* Version History Modal */}
      {showHistoryModal && (
        <ProjectVersionHistoryModal
          projectId={projectId}
          currentVersionNumber={currentVersionNumber}
          conversationId={conversationId}
          onClose={() => setShowHistoryModal(false)}
          onPreviewVersion={handlePreviewHistoricalVersion}
          onVersionRestored={handleVersionRestored}
        />
      )}
    </motion.aside>
  )
}
