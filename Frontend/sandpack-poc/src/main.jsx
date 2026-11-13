/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SandpackWorkspace from "./SandpackWorkspace.jsx";
import "./styles/index.css";

function RootDemo() {
  const [view, setView] = useState("sandpack"); // "sandpack" | "standalone"

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Banner Navigation */}
      <header className="h-14 border-b border-slate-800 bg-slate-900/90 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-amber-400 font-bold tracking-tight text-sm">
            Orbit Coding Agent
          </span>
          <span className="text-xs text-slate-400 border-l border-slate-700 pl-3">
            Phase 2: Sandpack React Runtime POC
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setView("sandpack")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              view === "sandpack"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Sandpack Workspace
          </button>
          <button
            type="button"
            onClick={() => setView("standalone")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              view === "standalone"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Standalone Component View
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden">
        {view === "sandpack" ? <SandpackWorkspace /> : <App />}
      </main>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <StrictMode>
      <RootDemo />
    </StrictMode>
  );
}

