import { useState, useMemo, useCallback, useRef } from "react"
import {
  SandpackProvider,
  SandpackLayout,
  SandpackFileExplorer,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackConsole,
  useSandpack,
} from "@codesandbox/sandpack-react"
import {
  RotateCcw,
  Laptop,
  Tablet,
  Smartphone,
  Terminal,
  FileCode,
  Download,
  Maximize2,
  Minimize2,
  ZoomIn,
  ZoomOut,
  PanelLeftClose,
  PanelLeftOpen,
  Columns,
  Eye,
  Code2,
  ChevronDown,
  AlertCircle,
} from "lucide-react"
import {
  mapOrbitArtifactToSandpack,
  reconstructOrbitArtifactFromSandpack,
} from "../../lib/orbitSandpackAdapter.js"
import { downloadCodeArtifactZip } from "../../lib/zipExporter.js"

/**
 * Custom dark theme aligned with Orbit's obsidian and gold/amber styling.
 */
const orbitDarkTheme = {
  colors: {
    surface1: "#0b0f19",
    surface2: "#111827",
    surface3: "#1f2937",
    disabled: "#4b5563",
    base: "#f8fafc",
    clickable: "#94a3b8",
    hover: "#f8fafc",
    accent: "#f59e0b",
    error: "#f87171",
    errorSurface: "#450a0a",
  },
  syntax: {
    plain: "#f8fafc",
    comment: { color: "#64748b", fontStyle: "italic" },
    keyword: "#f59e0b",
    tag: "#60a5fa",
    punctuation: "#94a3b8",
    definition: "#38bdf8",
    property: "#a78bfa",
    static: "#fbbf24",
    string: "#34d399",
  },
  font: {
    body: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    mono: '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
    size: "12px",
    lineHeight: "1.5",
  },
}

const ZOOM_LEVELS = [0.5, 0.75, 0.9, 1.0, 1.25]

/**
 * Inner component tracking local edits, resizable splitters, modes, and viewport scaling.
 */
function SandpackWorkspaceInner({
  artifact,
  viewport,
  setViewport,
  showConsole,
  setShowConsole,
  workspaceMode,
  setWorkspaceMode,
  onResetOriginal,
  isFullScreen,
  onToggleFullScreen,
}) {
  const { sandpack } = useSandpack()
  const { files, activeFile } = sandpack
  const [isExporting, setIsExporting] = useState(false)

  // Resizable panel state (percentages)
  const [explorerWidth, setExplorerWidth] = useState(16) // ~16% default
  const [editorWidth, setEditorWidth] = useState(26) // ~26% default
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [activeResizer, setActiveResizer] = useState(null)
  const [consoleHeight, setConsoleHeight] = useState(180)
  const [zoom, setZoom] = useState(1.0)

  const containerRef = useRef(null)

  // Detect whether the user has modified any code locally
  const hasLocalEdits = useMemo(() => {
    if (!artifact?.files) return false
    for (const original of artifact.files) {
      const normalized = original.path.startsWith("/") ? original.path : `/${original.path}`
      const currentCode = files[normalized]?.code
      if (currentCode !== undefined && currentCode !== original.content) {
        return true
      }
    }
    return false
  }, [artifact, files])

  const hasRuntimeError = Boolean(sandpack.error)

  const handleExportCurrent = async () => {
    setIsExporting(true)
    try {
      const currentArtifact = reconstructOrbitArtifactFromSandpack(files, artifact)
      await downloadCodeArtifactZip(currentArtifact)
    } finally {
      setTimeout(() => setIsExporting(false), 800)
    }
  }

  // Zoom controls
  const handleZoomIn = () => {
    setZoom((prev) => {
      const next = ZOOM_LEVELS.find((z) => z > prev + 0.01)
      return next !== undefined ? next : 1.25
    })
  }

  const handleZoomOut = () => {
    setZoom((prev) => {
      const next = [...ZOOM_LEVELS].reverse().find((z) => z < prev - 0.01)
      return next !== undefined ? next : 0.5
    })
  }

  const handleResetZoom = () => {
    setZoom(1.0)
  }

  // Viewport sizing
  const getViewportWidth = () => {
    if (viewport === "mobile") return "w-[375px] max-w-full"
    if (viewport === "tablet") return "w-[768px] max-w-full"
    return "w-full"
  }

  // Draggable splitter handler
  const handleStartResize = (resizerType, e) => {
    e.preventDefault()
    setActiveResizer(resizerType)

    const startX = e.clientX
    const startY = e.clientY
    const startExplorer = explorerWidth
    const startEditor = editorWidth
    const startConsole = consoleHeight
    const containerRect = containerRef.current?.getBoundingClientRect()
    const containerWidth = containerRect?.width || 1000

    const handlePointerMove = (moveEvent) => {
      if (resizerType === "explorer") {
        const delta = moveEvent.clientX - startX
        const deltaPercent = (delta / containerWidth) * 100
        const newWidth = Math.min(Math.max(startExplorer + deltaPercent, 12), 25)
        setExplorerWidth(newWidth)
        if (explorerCollapsed) setExplorerCollapsed(false)
      } else if (resizerType === "editor") {
        const delta = moveEvent.clientX - startX
        const deltaPercent = (delta / containerWidth) * 100
        const currentExp = explorerCollapsed ? 0 : explorerWidth
        const maxEditor = Math.max(100 - currentExp - 35, 20) // Ensure preview retains at least 35%
        const newWidth = Math.min(Math.max(startEditor + deltaPercent, 18), maxEditor)
        setEditorWidth(newWidth)
      } else if (resizerType === "console") {
        const delta = startY - moveEvent.clientY // dragging up increases drawer height
        const newHeight = Math.min(Math.max(startConsole + delta, 90), 380)
        setConsoleHeight(newHeight)
      }
    }

    const handlePointerUp = () => {
      setActiveResizer(null)
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp)
  }

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-slate-100 select-none overflow-hidden">
      {/* Global override styles to guarantee Sandpack preview fills 100% height to bottom */}
      <style>{`
        .sp-wrapper,
        .sp-layout,
        .sp-stack,
        .sp-preview,
        .sp-preview-container,
        .sp-preview-iframe {
          height: 100% !important;
          min-height: 100% !important;
          max-height: 100% !important;
          flex: 1 1 100% !important;
          display: flex !important;
          flex-direction: column !important;
        }
        .sp-preview-iframe {
          border: 0 !important;
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
      {/* Pointer capture overlay to prevent iframes from eating resize events */}
      {activeResizer && (
        <div
          className={`fixed inset-0 z-50 select-none bg-transparent ${
            activeResizer === "console" ? "cursor-row-resize" : "cursor-col-resize"
          }`}
          style={{ pointerEvents: "all" }}
        />
      )}

      {/* Workspace Sub-Toolbar */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-slate-900/90 px-3 text-xs gap-2">
        {/* Left Section: Modes & Explorer Toggle */}
        <div className="flex items-center gap-2 overflow-hidden shrink-0">
          {/* Workspace Mode Switcher */}
          <div className="flex items-center bg-slate-800/90 rounded-lg p-0.5 border border-white/10">
            <button
              type="button"
              onClick={() => setWorkspaceMode("preview")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                workspaceMode === "preview"
                  ? "bg-amber-500 text-black font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
              title="Preview mode: Maximized application preview"
            >
              <Eye size={12} />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode("split")}
              className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                workspaceMode === "split"
                  ? "bg-amber-500 text-black font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
              title="Split mode: Side-by-side resizable editor & preview"
            >
              <Columns size={12} />
              <span>Split</span>
            </button>
            <button
              type="button"
              onClick={() => setWorkspaceMode("code")}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition cursor-pointer ${
                workspaceMode === "code"
                  ? "bg-amber-500 text-black font-semibold shadow-sm"
                  : "text-slate-400 hover:text-white"
              }`}
              title="Code mode: Prominent file explorer and editor"
            >
              <Code2 size={12} />
              <span>Code</span>
            </button>
          </div>

          {/* Quick Explorer Toggle (visible in Split & Code modes) */}
          {workspaceMode !== "preview" && (
            <button
              type="button"
              onClick={() => setExplorerCollapsed((prev) => !prev)}
              className="hidden md:flex items-center gap-1 rounded-md p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              title={explorerCollapsed ? "Show File Explorer" : "Hide File Explorer"}
            >
              {explorerCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
          )}

          {/* Active File Label & Local Edit Badge */}
          <div className="hidden lg:flex items-center gap-2 overflow-hidden max-w-[220px]">
            <span className="font-mono text-slate-300 truncate font-semibold text-[11px]">
              {activeFile}
            </span>
            {hasLocalEdits && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium text-amber-300 border border-amber-500/30 shrink-0">
                <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>Edited</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Section: Viewport, Zoom, Console, Actions & Fullscreen */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Viewport Selection (available in Preview & Split modes) */}
          {workspaceMode !== "code" && (
            <div className="flex items-center bg-slate-800/90 rounded-md p-0.5 border border-white/10">
              <button
                type="button"
                onClick={() => setViewport("desktop")}
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === "desktop" ? "bg-amber-500 text-black" : "text-slate-400 hover:text-white"
                }`}
                title="Desktop viewport (100%)"
              >
                <Laptop size={12} />
              </button>
              <button
                type="button"
                onClick={() => setViewport("tablet")}
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === "tablet" ? "bg-amber-500 text-black" : "text-slate-400 hover:text-white"
                }`}
                title="Tablet viewport (768px)"
              >
                <Tablet size={12} />
              </button>
              <button
                type="button"
                onClick={() => setViewport("mobile")}
                className={`p-1 rounded transition cursor-pointer ${
                  viewport === "mobile" ? "bg-amber-500 text-black" : "text-slate-400 hover:text-white"
                }`}
                title="Mobile viewport (375px)"
              >
                <Smartphone size={12} />
              </button>
            </div>
          )}

          {/* Zoom Controls (available in Preview & Split modes) */}
          {workspaceMode !== "code" && (
            <div className="hidden sm:flex items-center bg-slate-800/90 rounded-md p-0.5 border border-white/10 text-[11px]">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= 0.5}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Zoom Out"
              >
                <ZoomOut size={12} />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-1.5 py-0.5 font-mono text-[10px] text-slate-300 hover:text-amber-400 transition cursor-pointer"
                title="Reset Zoom to 100%"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= 1.25}
                className="p-1 text-slate-400 hover:text-white disabled:opacity-30 cursor-pointer"
                title="Zoom In"
              >
                <ZoomIn size={12} />
              </button>
            </div>
          )}

          {/* Console Drawer Toggle Button */}
          <button
            type="button"
            onClick={() => setShowConsole((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] border transition cursor-pointer ${
              showConsole
                ? "bg-slate-800 text-amber-300 border-amber-500/40"
                : "text-slate-400 border-white/10 hover:bg-slate-800 hover:text-white"
            }`}
            title="Toggle Runtime Console Drawer"
          >
            <Terminal size={12} />
            <span className="hidden sm:inline">Console</span>
            {hasRuntimeError ? (
              <span className="size-1.5 rounded-full bg-red-400 animate-pulse" title="Runtime error" />
            ) : (
              <span className="size-1 rounded-full bg-emerald-400/80" />
            )}
          </button>

          {/* Reset Local Edits Button */}
          {hasLocalEdits && (
            <button
              type="button"
              onClick={onResetOriginal}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700 border border-white/10 transition cursor-pointer"
              title="Reset to generated artifact version"
            >
              <RotateCcw size={11} />
              <span className="hidden md:inline">Reset</span>
            </button>
          )}

          {/* Export Edited ZIP Button */}
          <button
            type="button"
            onClick={handleExportCurrent}
            disabled={isExporting}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium bg-amber-500 hover:bg-amber-400 text-black transition cursor-pointer disabled:opacity-50"
            title="Download ZIP with latest edits"
          >
            <Download size={11} />
            <span className="hidden sm:inline">{isExporting ? "Zipping..." : "Export"}</span>
          </button>

          {/* Fullscreen Expansion Toggle */}
          {onToggleFullScreen && (
            <button
              type="button"
              onClick={onToggleFullScreen}
              className={`p-1.5 rounded-md border transition cursor-pointer ${
                isFullScreen
                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                  : "text-slate-400 border-white/10 hover:bg-slate-800 hover:text-white"
              }`}
              title={isFullScreen ? "Exit Fullscreen" : "Fullscreen Preview"}
            >
              {isFullScreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Main Responsive Resizable Workspace */}
      <div ref={containerRef} className="flex-1 overflow-hidden p-1.5 sm:p-2 flex flex-col">
        <SandpackLayout className="h-full border border-white/10 rounded-xl overflow-hidden bg-slate-900/60 shadow-2xl flex flex-row !p-0">
          {/* Panel 1: File Explorer */}
          {workspaceMode !== "preview" && !explorerCollapsed && (
            <div
              style={{
                width: workspaceMode === "code" ? "22%" : `${explorerWidth}%`,
                minWidth: "140px",
                maxWidth: "280px",
              }}
              className="h-full border-r border-white/10 shrink-0 flex flex-col bg-slate-900/80 overflow-hidden"
            >
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-slate-900 text-[11px] font-semibold text-slate-400">
                <div className="flex items-center gap-1.5">
                  <FileCode size={12} className="text-amber-400" />
                  <span>Files</span>
                </div>
                <button
                  type="button"
                  onClick={() => setExplorerCollapsed(true)}
                  className="text-slate-500 hover:text-white transition cursor-pointer p-0.5"
                  title="Collapse explorer"
                >
                  <PanelLeftClose size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-auto text-xs">
                <SandpackFileExplorer autoHiddenFiles />
              </div>
            </div>
          )}

          {/* Draggable Splitter 1: Explorer <-> Editor */}
          {workspaceMode === "split" && !explorerCollapsed && (
            <div
              onPointerDown={(e) => handleStartResize("explorer", e)}
              className="w-1.5 shrink-0 bg-white/5 hover:bg-amber-500/50 active:bg-amber-500 transition-colors cursor-col-resize relative group flex items-center justify-center z-10"
              title="Drag to resize Explorer (double click to collapse)"
              onDoubleClick={() => setExplorerCollapsed(true)}
            >
              <div className="w-0.5 h-6 rounded-full bg-white/20 group-hover:bg-amber-300 transition-colors" />
            </div>
          )}

          {/* Panel 2: Code Editor */}
          {workspaceMode !== "preview" && (
            <div
              style={{
                width: workspaceMode === "code" ? "auto" : `${editorWidth}%`,
                minWidth: workspaceMode === "code" ? "0" : "180px",
              }}
              className={`h-full min-w-0 border-r border-white/10 ${
                workspaceMode === "code" ? "flex-1" : ""
              } flex flex-col overflow-hidden bg-slate-950/60`}
            >
              <SandpackCodeEditor
                showLineNumbers
                showInlineErrors
                wrapContent
                closableTabs
                className="h-full"
              />
            </div>
          )}

          {/* Draggable Splitter 2: Editor <-> Preview */}
          {workspaceMode === "split" && (
            <div
              onPointerDown={(e) => handleStartResize("editor", e)}
              className="w-1.5 shrink-0 bg-white/5 hover:bg-amber-500/50 active:bg-amber-500 transition-colors cursor-col-resize relative group flex items-center justify-center z-10"
              title="Drag to resize Editor and Preview"
            >
              <div className="w-0.5 h-6 rounded-full bg-white/20 group-hover:bg-amber-300 transition-colors" />
            </div>
          )}

          {/* Panel 3: Application Preview & Bottom Console Drawer */}
          {workspaceMode !== "code" && (
            <div className="flex-1 h-full min-w-0 flex flex-col bg-black/50 overflow-hidden relative">
              {/* Compilation / Runtime Error Notification Banner */}
              {hasRuntimeError && (
                <div className="absolute top-3 left-3 right-3 z-30 p-3 bg-red-950/95 border border-red-500/50 rounded-lg shadow-2xl text-xs text-red-200 flex flex-col gap-2 backdrop-blur-md animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold text-red-300">
                      <AlertCircle size={15} className="text-red-400 shrink-0" />
                      <span>Preview Compilation Issue</span>
                    </div>
                    {sandpack.error?.path && (
                      <span className="font-mono bg-red-900/60 px-2 py-0.5 rounded text-[11px] text-red-200 border border-red-500/30">
                        {sandpack.error.path}
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[11px] text-red-100/90 whitespace-pre-wrap break-words bg-black/40 p-2 rounded max-h-24 overflow-auto">
                    {(() => {
                      const raw = sandpack.error?.message || String(sandpack.error);
                      // Strip internal Sandpack TypeError wrapper: Cannot assign to read only property 'message' of object '...'
                      const matchWrapper = raw.match(/Cannot assign to read only property 'message' of object '([^']+)'/);
                      if (matchWrapper && matchWrapper[1]) return matchWrapper[1];
                      const innerSyntax = raw.match(/object '(SyntaxError:[^']+)'/);
                      if (innerSyntax && innerSyntax[1]) return innerSyntax[1];
                      return raw;
                    })()}
                  </p>
                  <div className="flex items-center gap-2 pt-1 border-t border-red-800/40">
                    <button
                      type="button"
                      onClick={() => {
                        if (sandpack.error?.path && sandpack.openFile) {
                          sandpack.openFile(sandpack.error.path)
                        }
                        setWorkspaceMode("split")
                      }}
                      className="px-2.5 py-1 rounded bg-red-900/80 hover:bg-red-800 text-red-100 font-medium text-[11px] transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Code2 size={12} />
                      <span>Inspect in Code Editor</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowConsole(true)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] transition cursor-pointer flex items-center gap-1.5"
                    >
                      <Terminal size={12} />
                      <span>Open Console</span>
                    </button>
                    {hasLocalEdits && (
                      <button
                        type="button"
                        onClick={onResetOriginal}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] transition cursor-pointer ml-auto flex items-center gap-1.5"
                      >
                        <RotateCcw size={12} />
                        <span>Reset to Generated Project</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Scaled Preview Viewport Canvas */}
              <div className={`flex-1 h-full min-h-0 overflow-hidden bg-slate-950/70 ${viewport === "desktop" ? "p-0" : "p-2 sm:p-3"} flex flex-col items-center justify-center`}>
                <div
                  className={`h-full min-h-0 w-full flex-1 flex flex-col transition-all duration-150 ${viewport === "desktop" ? "rounded-none border-0" : "rounded-lg overflow-hidden shadow-2xl border border-white/5"} ${getViewportWidth()}`}
                  style={{
                    transform: zoom !== 1 ? `scale(${zoom})` : undefined,
                    transformOrigin: "top center",
                    width: getViewportWidth() === "w-full" ? (zoom !== 1 ? `${100 / zoom}%` : "100%") : undefined,
                    height: zoom !== 1 ? `${100 / zoom}%` : "100%",
                  }}
                >
                  <SandpackPreview
                    showRefreshButton
                    showOpenInCodeSandbox={false}
                    className="flex-1 h-full w-full border-0 !min-h-full"
                  />
                </div>
              </div>

              {/* Collapsible Bottom Console Drawer */}
              {showConsole && (
                <div
                  style={{ height: `${consoleHeight}px` }}
                  className="shrink-0 border-t border-white/10 bg-slate-950/98 flex flex-col relative z-20 shadow-2xl"
                >
                  {/* Draggable Console Top Resize Handle */}
                  <div
                    onPointerDown={(e) => handleStartResize("console", e)}
                    className="h-1.5 w-full bg-white/5 hover:bg-amber-500/60 active:bg-amber-500 transition-colors cursor-row-resize flex items-center justify-center group"
                    title="Drag to resize Console drawer"
                  >
                    <div className="h-0.5 w-8 rounded-full bg-white/20 group-hover:bg-amber-300 transition-colors" />
                  </div>

                  {/* Console Header */}
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 text-[10px] text-slate-400 bg-slate-900/90">
                    <div className="flex items-center gap-2">
                      <Terminal size={12} className="text-amber-400" />
                      <span className="font-mono font-medium text-slate-200">Orbit Runtime Console</span>
                      {hasRuntimeError ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-medium text-red-300 border border-red-500/30">
                          <span className="size-1 rounded-full bg-red-400 animate-pulse" />
                          Runtime Error
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-300 border border-emerald-500/30">
                          <span className="size-1 rounded-full bg-emerald-400" />
                          Ready
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowConsole(false)}
                      className="p-1 text-slate-400 hover:text-white transition cursor-pointer"
                      title="Collapse Console"
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>

                  {/* Console Output */}
                  <div className="flex-1 overflow-auto text-xs font-mono">
                    <SandpackConsole resetOnPreviewRestart={false} />
                  </div>
                </div>
              )}
            </div>
          )}
        </SandpackLayout>
      </div>
    </div>
  )
}

/**
 * SandpackArtifactWorkspace Component.
 *
 * Renders an interactive, modern React development environment for Orbit CodeArtifacts.
 */
export default function SandpackArtifactWorkspace({
  artifact,
  isFullScreen,
  onToggleFullScreen,
}) {
  const [viewport, setViewport] = useState("desktop")
  const [showConsole, setShowConsole] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState("split") // "preview" | "split" | "code"
  const [resetNonce, setResetNonce] = useState(0)

  // Map Orbit's CodeArtifact into Sandpack's required structure
  const { files, dependencies, bundlerEntry, userEntryFile } = useMemo(() => {
    return mapOrbitArtifactToSandpack(artifact)
  }, [artifact])

  const handleResetOriginal = useCallback(() => {
    setResetNonce((prev) => prev + 1)
  }, [])

  if (!artifact) return null

  return (
    <SandpackProvider
      key={`${artifact.artifactId}_${resetNonce}`}
      template="react"
      theme={orbitDarkTheme}
      files={files}
      customSetup={{
        dependencies,
        entry: bundlerEntry || "/index.js",
      }}
      options={{
        externalResources: ["https://cdn.tailwindcss.com"],
        activeFile: userEntryFile || (files["/src/App.jsx"] ? "/src/App.jsx" : undefined),
      }}
      className="h-full w-full"
    >
      <SandpackWorkspaceInner
        artifact={artifact}
        viewport={viewport}
        setViewport={setViewport}
        showConsole={showConsole}
        setShowConsole={setShowConsole}
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        onResetOriginal={handleResetOriginal}
        isFullScreen={isFullScreen}
        onToggleFullScreen={onToggleFullScreen}
      />
    </SandpackProvider>
  )
}
