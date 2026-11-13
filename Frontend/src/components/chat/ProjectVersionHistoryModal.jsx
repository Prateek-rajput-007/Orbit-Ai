import { useState, useEffect } from "react";
import {
  History,
  X,
  Play,
  RotateCcw,
  GitCompare,
  CheckCircle,
  Loader2,
  AlertCircle,
  Clock,
} from "lucide-react";
import {
  fetchProjectVersions,
  restoreProjectVersionRequest,
} from "../../features/conversations/projectVersionActions.js";
import ProjectVersionDiffModal from "./ProjectVersionDiffModal.jsx";

export default function ProjectVersionHistoryModal({
  projectId,
  currentVersionNumber,
  conversationId,
  onClose,
  onPreviewVersion,
  onVersionRestored,
}) {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState([]);
  const [error, setError] = useState(null);

  // Restore state
  const [confirmingRestoreVersion, setConfirmingRestoreVersion] = useState(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState(null);

  // Diff state
  const [comparingVersion, setComparingVersion] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function loadVersions() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchProjectVersions(projectId);
        if (mounted) {
          setVersions(data.versions || []);
        }
      } catch (err) {
        if (mounted) {
          setError(err.response?.data?.error || err.message || "Failed to load project versions");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (projectId) {
      loadVersions();
    }

    return () => {
      mounted = false;
    };
  }, [projectId]);

  const handleConfirmRestore = async (versionNum) => {
    setIsRestoring(true);
    setRestoreError(null);
    try {
      const result = await restoreProjectVersionRequest(projectId, versionNum, conversationId);
      const restored = result?.artifact || result?.restoredArtifact;
      if (result?.success && restored) {
        setConfirmingRestoreVersion(null);
        if (typeof onVersionRestored === "function") {
          onVersionRestored(restored);
        }
        onClose();
      } else {
        setRestoreError(result?.error || "Failed to restore version.");
      }
    } catch (err) {
      setRestoreError(err.response?.data?.error || err.message || "Error restoring version.");
    } finally {
      setIsRestoring(false);
    }
  };

  const getChangeTypeBadge = (type) => {
    switch (type) {
      case "INITIAL_GENERATION":
        return { label: "Initial", color: "bg-indigo-500/15 text-indigo-400 border-indigo-500/25" };
      case "RESTORE":
        return { label: "Restore", color: "bg-amber-500/15 text-amber-400 border-amber-500/25" };
      case "INCREMENTAL_UPDATE":
      default:
        return { label: "Update", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25" };
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
        <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl bg-night border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent border border-accent/20">
                <History size={16} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink">Project Version History</h2>
                <p className="text-xs text-muted">
                  View, compare, and restore previous snapshots of this project
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-white/10 hover:text-ink transition cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted gap-3">
                <Loader2 size={24} className="animate-spin text-accent" />
                <p className="text-xs">Loading version history...</p>
              </div>
            ) : error ? (
              <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                <AlertCircle size={16} className="shrink-0" />
                <p>{error}</p>
              </div>
            ) : versions.length === 0 ? (
              <div className="py-12 text-center text-xs text-muted bg-white/[0.02] rounded-xl border border-white/5">
                No previous versions recorded yet for this project.
              </div>
            ) : (
              <div className="space-y-3">
                {/* Restore Error Notice */}
                {restoreError && (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
                    <AlertCircle size={14} className="shrink-0" />
                    <p>{restoreError}</p>
                  </div>
                )}

                {/* Restore Confirmation Dialog */}
                {confirmingRestoreVersion !== null && (
                  <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
                    <div className="font-semibold flex items-center gap-1.5">
                      <RotateCcw size={14} />
                      Restore Version {confirmingRestoreVersion}?
                    </div>
                    <p className="text-muted leading-relaxed">
                      Restoring will create a new version containing the exact code from Version{" "}
                      {confirmingRestoreVersion}. Your current project and full history are preserved
                      without loss.
                    </p>
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setConfirmingRestoreVersion(null)}
                        disabled={isRestoring}
                        className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-ink transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleConfirmRestore(confirmingRestoreVersion)}
                        disabled={isRestoring}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-night text-xs font-semibold transition active:scale-95 cursor-pointer disabled:opacity-50"
                      >
                        {isRestoring ? (
                          <>
                            <Loader2 size={12} className="animate-spin" />
                            <span>Restoring...</span>
                          </>
                        ) : (
                          <span>Confirm & Restore</span>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {/* Version Cards */}
                {versions.map((ver) => {
                  const isCurrent = ver.isCurrent || ver.versionNumber === currentVersionNumber;
                  const badge = getChangeTypeBadge(ver.changeType);
                  const formattedDate = ver.createdAt
                    ? new Date(ver.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";

                  return (
                    <div
                      key={ver.versionId || ver.versionNumber}
                      className={`p-4 rounded-xl border transition ${
                        isCurrent
                          ? "bg-accent/[0.04] border-accent/30 shadow-sm"
                          : "bg-white/[0.02] border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-accent">
                            v{ver.versionNumber}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium border ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                          {isCurrent && (
                            <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle size={10} />
                              Active
                            </span>
                          )}
                        </div>

                        {formattedDate && (
                          <div className="flex items-center gap-1 text-[11px] text-muted">
                            <Clock size={11} />
                            <span>{formattedDate}</span>
                          </div>
                        )}
                      </div>

                      <p className="text-xs text-ink-soft mb-3 line-clamp-2">
                        {ver.changeSummary || "Snapshot updated"}
                      </p>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/5">
                        <div className="flex items-center gap-3 text-[11px] text-muted font-mono">
                          <span>{ver.totalFiles || 0} files</span>
                          <span>•</span>
                          <span>{((ver.totalSize || 0) / 1024).toFixed(1)} KB</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5">
                          {/* Preview Action */}
                          <button
                            type="button"
                            onClick={() => {
                              onPreviewVersion(ver.versionNumber);
                              onClose();
                            }}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-ink-soft hover:text-ink transition cursor-pointer"
                            title="Preview this historical version"
                          >
                            <Play size={10} />
                            <span>Preview</span>
                          </button>

                          {/* Compare Action (if not current) */}
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => setComparingVersion(ver.versionNumber)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-white/10 text-ink-soft hover:text-ink transition cursor-pointer"
                              title="Compare differences with active version"
                            >
                              <GitCompare size={11} />
                              <span className="hidden sm:inline">Compare</span>
                            </button>
                          )}

                          {/* Restore Action (if not current) */}
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => setConfirmingRestoreVersion(ver.versionNumber)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 transition cursor-pointer"
                              title="Restore this version"
                            >
                              <RotateCcw size={10} />
                              <span>Restore</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-white/[0.02] text-xs text-muted">
            <span>
              {versions.length} version{versions.length !== 1 ? "s" : ""} recorded
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-ink transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Compare Diff Modal */}
      {comparingVersion !== null && (
        <ProjectVersionDiffModal
          projectId={projectId}
          baseVersion={comparingVersion}
          targetVersion={currentVersionNumber}
          onClose={() => setComparingVersion(null)}
        />
      )}
    </>
  );
}
