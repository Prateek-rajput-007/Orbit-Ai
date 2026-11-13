import { useState, useEffect } from "react";
import {
  X,
  GitCompare,
  Plus,
  Minus,
  FileEdit,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { compareProjectVersionsRequest } from "../../features/conversations/projectVersionActions.js";

export default function ProjectVersionDiffModal({
  projectId,
  baseVersion,
  targetVersion,
  onClose,
}) {
  const [loading, setLoading] = useState(true);
  const [diffData, setDiffData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function loadDiff() {
      setLoading(true);
      setError(null);
      try {
        const data = await compareProjectVersionsRequest(projectId, baseVersion, targetVersion);
        if (mounted) {
          setDiffData(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err.response?.data?.error || err.message || "Failed to load version comparison");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    if (projectId && baseVersion && targetVersion) {
      loadDiff();
    }

    return () => {
      mounted = false;
    };
  }, [projectId, baseVersion, targetVersion]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl bg-night border border-white/10 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-2.5">
            <div className="grid size-8 place-items-center rounded-lg bg-accent/15 text-accent border border-accent/20">
              <GitCompare size={16} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-ink">Version Comparison</h2>
              <p className="text-xs text-muted">
                Comparing <span className="text-accent font-mono">v{baseVersion}</span> with{" "}
                <span className="text-accent font-mono">v{targetVersion}</span>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted gap-3">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-xs">Computing file differences...</p>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              <AlertCircle size={16} className="shrink-0" />
              <p>{error}</p>
            </div>
          ) : diffData ? (
            <div className="space-y-4">
              {/* Summary Stats Badges */}
              <div className="grid grid-cols-4 gap-2">
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <div className="text-lg font-bold text-emerald-400">
                    +{diffData.summary?.addedCount || 0}
                  </div>
                  <div className="text-[11px] text-emerald-300 font-medium">Added</div>
                </div>
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
                  <div className="text-lg font-bold text-amber-400">
                    ~{diffData.summary?.modifiedCount || 0}
                  </div>
                  <div className="text-[11px] text-amber-300 font-medium">Modified</div>
                </div>
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center">
                  <div className="text-lg font-bold text-red-400">
                    -{diffData.summary?.deletedCount || 0}
                  </div>
                  <div className="text-[11px] text-red-300 font-medium">Deleted</div>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center">
                  <div className="text-lg font-bold text-ink">
                    ={diffData.summary?.unchangedCount || 0}
                  </div>
                  <div className="text-[11px] text-muted font-medium">Unchanged</div>
                </div>
              </div>

              {/* File Change List */}
              <div className="space-y-2 mt-4">
                <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
                  Changed Files
                </h3>

                {diffData.summary?.addedCount === 0 &&
                diffData.summary?.modifiedCount === 0 &&
                diffData.summary?.deletedCount === 0 ? (
                  <div className="py-8 text-center text-xs text-muted bg-white/[0.02] rounded-xl border border-white/5">
                    No differences found. Both versions have identical files and contents.
                  </div>
                ) : (
                  <div className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/5 bg-black/20">
                    {/* Added Files */}
                    {diffData.changes?.added?.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between p-3 text-xs hover:bg-white/[0.03] transition"
                      >
                        <div className="flex items-center gap-2">
                          <Plus size={14} className="text-emerald-400 shrink-0" />
                          <span className="font-mono text-emerald-300">{f.path}</span>
                        </div>
                        <span className="text-[11px] text-muted">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                      </div>
                    ))}

                    {/* Modified Files */}
                    {diffData.changes?.modified?.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between p-3 text-xs hover:bg-white/[0.03] transition"
                      >
                        <div className="flex items-center gap-2">
                          <FileEdit size={14} className="text-amber-400 shrink-0" />
                          <span className="font-mono text-amber-300">{f.path}</span>
                        </div>
                        <span className="text-[11px] text-muted">
                          {(f.newSize / 1024).toFixed(1)} KB (
                          {f.deltaBytes >= 0 ? `+${f.deltaBytes}` : f.deltaBytes} bytes)
                        </span>
                      </div>
                    ))}

                    {/* Deleted Files */}
                    {diffData.changes?.deleted?.map((f) => (
                      <div
                        key={f.path}
                        className="flex items-center justify-between p-3 text-xs hover:bg-white/[0.03] transition"
                      >
                        <div className="flex items-center gap-2">
                          <Minus size={14} className="text-red-400 shrink-0" />
                          <span className="font-mono text-red-300 line-through opacity-80">
                            {f.path}
                          </span>
                        </div>
                        <span className="text-[11px] text-red-400/60">Removed</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-5 py-3 border-t border-white/10 bg-white/[0.02]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-white/10 hover:bg-white/15 text-ink transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
