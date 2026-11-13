import { useState } from "react";
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
  SandpackPreview,
  SandpackConsole,
  SandpackFileExplorer,
} from "@codesandbox/sandpack-react";
import {
  mapOrbitArtifactToSandpack,
  applyOperationsToSandpack,
} from "./orbitSandpackAdapter.js";

// Sample multi-file Todo application in Orbit CodeArtifact format
const initialOrbitArtifact = {
  artifactId: "art_sandpack_poc_001",
  title: "Orbit React Todo Studio",
  description: "A complete multi-file React application running inside Sandpack",
  entryFile: "/src/main.jsx",
  files: [
    {
      path: "/src/main.jsx",
      language: "jsx",
      content: `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles/index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
    },
    {
      path: "/src/App.jsx",
      language: "jsx",
      content: `import { useState } from "react";
import Header from "./components/Header.jsx";
import TodoList from "./components/TodoList.jsx";
import "./styles/index.css";

export default function App() {
  const [todos, setTodos] = useState([
    { id: 1, title: "Review Sandpack bundling architecture", completed: true },
    { id: 2, title: "Verify ES module imports and exports", completed: true },
    { id: 3, title: "Inspect live runtime updates", completed: false },
  ]);
  const [inputVal, setInputVal] = useState("");
  const [filter, setFilter] = useState("all");
  const [darkMode, setDarkMode] = useState(true);

  const handleAdd = (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    setTodos(prev => [...prev, { id: Date.now(), title: inputVal.trim(), completed: false }]);
    setInputVal("");
  };

  const handleToggle = (id) => {
    setTodos(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleDelete = (id) => {
    setTodos(prev => prev.filter(t => t.id !== id));
  };

  const filtered = todos.filter(t => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  return (
    <div className={darkMode ? "dark" : ""}>
      <div className="todo-app-container">
        <Header darkMode={darkMode} setDarkMode={setDarkMode} activeCount={todos.filter(t => !t.completed).length} />
        
        <form onSubmit={handleAdd} className="flex gap-2 mb-4">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Add new task..."
            className="todo-input flex-1"
          />
          <button type="submit" className="btn-primary">Add</button>
        </form>

        <div className="flex gap-2 mb-3 text-xs">
          {["all", "active", "completed"].map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={\`px-2 py-0.5 rounded capitalize \${filter === f ? "btn-primary" : "text-slate-400"}\`}
            >
              {f}
            </button>
          ))}
        </div>

        <TodoList todos={filtered} onToggle={handleToggle} onDelete={handleDelete} />
      </div>
    </div>
  );
}`,
    },
    {
      path: "/src/components/Header.jsx",
      language: "jsx",
      content: `import React from "react";

export default function Header({ darkMode, setDarkMode, activeCount }) {
  return (
    <header className="flex items-center justify-between pb-3 mb-4 border-b border-slate-700">
      <div>
        <h2 className="text-xl font-bold text-slate-100">Orbit Sandpack Demo</h2>
        <span className="text-xs text-slate-400">{activeCount} tasks remaining</span>
      </div>
      <button
        type="button"
        onClick={() => setDarkMode(prev => !prev)}
        className="px-2.5 py-1 text-xs rounded border border-slate-600 bg-slate-800 text-slate-200"
      >
        {darkMode ? "☀️ Light" : "🌙 Dark"}
      </button>
    </header>
  );
}`,
    },
    {
      path: "/src/components/TodoList.jsx",
      language: "jsx",
      content: `import React from "react";
import TodoItem from "./TodoItem.jsx";

export default function TodoList({ todos, onToggle, onDelete }) {
  if (todos.length === 0) {
    return <div className="text-center py-6 text-xs text-slate-500">No tasks in this view</div>;
  }
  return (
    <ul className="space-y-2 list-none p-0 m-0">
      {todos.map(todo => (
        <TodoItem key={todo.id} todo={todo} onToggle={onToggle} onDelete={onDelete} />
      ))}
    </ul>
  );
}`,
    },
    {
      path: "/src/components/TodoItem.jsx",
      language: "jsx",
      content: `import React from "react";

export default function TodoItem({ todo, onToggle, onDelete }) {
  return (
    <li className="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-slate-800">
      <label className="flex items-center gap-2.5 cursor-pointer flex-1">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={() => onToggle(todo.id)}
          className="size-4"
        />
        <span className={\`text-xs \${todo.completed ? "line-through text-slate-500" : "text-slate-200"}\`}>
          {todo.title}
        </span>
      </label>
      <button
        type="button"
        onClick={() => onDelete(todo.id)}
        className="text-xs text-rose-400 hover:text-rose-300"
      >
        ✕
      </button>
    </li>
  );
}`,
    },
    {
      path: "/src/styles/index.css",
      language: "css",
      content: `body {
  margin: 0;
  background-color: #0b0f19;
  color: #f1f5f9;
  font-family: system-ui, sans-serif;
}
.todo-app-container {
  max-width: 500px;
  margin: 1.5rem auto;
  padding: 1.25rem;
  background-color: #111827;
  border: 1px solid #1f2937;
  border-radius: 8px;
}
.btn-primary {
  background-color: #f59e0b;
  color: #000;
  border: none;
  border-radius: 4px;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
}
.todo-input {
  padding: 0.4rem 0.6rem;
  background-color: #1f2937;
  border: 1px solid #374151;
  color: #fff;
  border-radius: 4px;
  font-size: 0.75rem;
}`,
    },
  ],
};

export default function SandpackWorkspace() {
  const [artifact, setArtifact] = useState(initialOrbitArtifact);
  const [viewport, setViewport] = useState("desktop"); // "desktop" | "tablet" | "mobile"
  const [showConsole, setShowConsole] = useState(true);

  const { files, dependencies } = mapOrbitArtifactToSandpack(artifact, {
    dependencies: {
      "lucide-react": "^0.460.0",
    },
  });

  // Action handlers demonstrating Phase 1 incremental operations inside Sandpack
  const handleUpdateHeader = () => {
    const updatedFiles = applyOperationsToSandpack(files, [
      {
        type: "update",
        path: "/src/components/Header.jsx",
        content: `import React from "react";

export default function Header({ darkMode, setDarkMode, activeCount }) {
  return (
    <header className="flex items-center justify-between pb-3 mb-4 border-b border-amber-500/40 bg-amber-500/10 p-2 rounded">
      <div>
        <h2 className="text-xl font-bold text-amber-400">✨ Updated Header v2</h2>
        <span className="text-xs text-amber-300/80">Pending tasks: {activeCount} (Live Reloaded)</span>
      </div>
      <button
        type="button"
        onClick={() => setDarkMode(prev => !prev)}
        className="px-2.5 py-1 text-xs rounded font-bold bg-amber-500 text-black hover:bg-amber-400 transition"
      >
        {darkMode ? "☀️ Light" : "🌙 Dark"}
      </button>
    </header>
  );
}`,
      },
    ]);

    setArtifact((prev) => ({
      ...prev,
      files: Object.entries(updatedFiles).map(([path, data]) => ({
        path,
        content: data.code,
      })),
    }));
  };

  const handleAddNewComponent = () => {
    const updatedFiles = applyOperationsToSandpack(files, [
      {
        type: "create",
        path: "/src/components/TaskStats.jsx",
        content: `import React from "react";

export default function TaskStats({ total, active, completed }) {
  return (
    <div className="mt-4 p-2.5 rounded bg-slate-900/80 border border-slate-800 text-xs flex justify-around text-slate-300">
      <div>Total: <span className="font-bold text-white">{total}</span></div>
      <div>Active: <span className="font-bold text-amber-400">{active}</span></div>
      <div>Completed: <span className="font-bold text-emerald-400">{completed}</span></div>
    </div>
  );
}`,
      },
      {
        type: "update",
        path: "/src/App.jsx",
        content: files["/src/App.jsx"].code
          .replace(
            'import TodoList from "./components/TodoList.jsx";',
            'import TodoList from "./components/TodoList.jsx";\nimport TaskStats from "./components/TaskStats.jsx";'
          )
          .replace(
            "<TodoList todos={filtered} onToggle={handleToggle} onDelete={handleDelete} />",
            `<TodoList todos={filtered} onToggle={handleToggle} onDelete={handleDelete} />\n        <TaskStats total={todos.length} active={todos.filter(t => !t.completed).length} completed={todos.filter(t => t.completed).length} />`
          ),
      },
    ]);

    setArtifact((prev) => ({
      ...prev,
      files: Object.entries(updatedFiles).map(([path, data]) => ({
        path,
        content: data.code,
      })),
    }));
  };

  const handleTriggerCompilationError = () => {
    const updatedFiles = applyOperationsToSandpack(files, [
      {
        type: "update",
        path: "/src/components/Header.jsx",
        content: `import React from "react";
// Deliberate syntax error: unclosed tag and unclosed parenthesis
export default function Header() {
  return (
    <div>
      <h1>Syntax Error Test
  );
}`,
      },
    ]);

    setArtifact((prev) => ({
      ...prev,
      files: Object.entries(updatedFiles).map(([path, data]) => ({
        path,
        content: data.code,
      })),
    }));
  };

  const handleReset = () => {
    setArtifact(initialOrbitArtifact);
  };

  const getViewportWidthClass = () => {
    if (viewport === "mobile") return "max-w-[360px]";
    if (viewport === "tablet") return "max-w-[640px]";
    return "w-full";
  };

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-100">
      {/* Controls Bar */}
      <div className="h-11 border-b border-slate-800 bg-slate-900/60 px-4 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Incremental Update Simulation:</span>
          <button
            type="button"
            onClick={handleUpdateHeader}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            Update Header.jsx
          </button>
          <button
            type="button"
            onClick={handleAddNewComponent}
            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
          >
            Create TaskStats.jsx
          </button>
          <button
            type="button"
            onClick={handleTriggerCompilationError}
            className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 transition"
          >
            Inject Syntax Error
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="px-2 py-1 rounded text-slate-400 hover:text-slate-200 transition"
          >
            Reset
          </button>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-800/80 rounded p-0.5 border border-slate-700 text-[11px]">
            <button
              type="button"
              onClick={() => setViewport("desktop")}
              className={`px-2 py-0.5 rounded ${viewport === "desktop" ? "bg-amber-500 text-black font-semibold" : "text-slate-400"}`}
            >
              Desktop
            </button>
            <button
              type="button"
              onClick={() => setViewport("tablet")}
              className={`px-2 py-0.5 rounded ${viewport === "tablet" ? "bg-amber-500 text-black font-semibold" : "text-slate-400"}`}
            >
              Tablet
            </button>
            <button
              type="button"
              onClick={() => setViewport("mobile")}
              className={`px-2 py-0.5 rounded ${viewport === "mobile" ? "bg-amber-500 text-black font-semibold" : "text-slate-400"}`}
            >
              Mobile
            </button>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 hover:text-slate-200">
            <input
              type="checkbox"
              checked={showConsole}
              onChange={(e) => setShowConsole(e.target.checked)}
              className="size-3.5"
            />
            <span>Console</span>
          </label>
        </div>
      </div>

      {/* Sandpack Provider & Layout */}
      <div className="flex-1 overflow-hidden p-2">
        <SandpackProvider
          template="react"
          theme="dark"
          files={files}
          customSetup={{
            dependencies,
          }}
          options={{
            visibleFiles: ["/src/App.jsx", "/src/components/Header.jsx", "/src/styles/index.css"],
            activeFile: "/src/App.jsx",
          }}
        >
          <SandpackLayout className="h-full border border-slate-800 rounded-lg overflow-hidden">
            <SandpackFileExplorer />
            <SandpackCodeEditor
              showLineNumbers
              showInlineErrors
              wrapContent
              closableTabs
            />
            <div className={`h-full flex flex-col mx-auto transition-all duration-200 ${getViewportWidthClass()}`}>
              <SandpackPreview
                showRefreshButton
                showOpenInCodeSandbox={false}
                className="flex-1"
              />
              {showConsole && (
                <div className="h-44 border-t border-slate-800 shrink-0">
                  <SandpackConsole />
                </div>
              )}
            </div>
          </SandpackLayout>
        </SandpackProvider>
      </div>
    </div>
  );
}

