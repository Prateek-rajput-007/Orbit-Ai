import { useState, useEffect } from "react";
import Header from "./components/Header.jsx";
import TodoList from "./components/TodoList.jsx";
import "./styles/index.css";

const INITIAL_TODOS = [
  { id: 1, title: "Review Orbit Sandpack architecture", completed: true },
  { id: 2, title: "Validate ES module imports and exports", completed: true },
  { id: 3, title: "Evaluate multi-file incremental updates", completed: false },
];

export default function App() {
  const [todos, setTodos] = useState(() => {
    try {
      const saved = localStorage.getItem("orbit_sandpack_todos");
      return saved ? JSON.parse(saved) : INITIAL_TODOS;
    } catch {
      return INITIAL_TODOS;
    }
  });

  const [inputVal, setInputVal] = useState("");
  const [filter, setFilter] = useState("all"); // "all" | "active" | "completed"
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    try {
      localStorage.setItem("orbit_sandpack_todos", JSON.stringify(todos));
    } catch (e) {
      console.warn("Storage quota exceeded", e);
    }
  }, [todos]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [darkMode]);

  const handleAddTodo = (e) => {
    e.preventDefault();
    const clean = inputVal.trim();
    if (!clean) return;
    setTodos((prev) => [
      ...prev,
      { id: Date.now(), title: clean, completed: false },
    ]);
    setInputVal("");
  };

  const handleToggle = (id) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  const handleDelete = (id) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const filteredTodos = todos.filter((t) => {
    if (filter === "active") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;

  return (
    <div className={`min-h-screen p-4 sm:p-8 ${darkMode ? "dark" : ""}`}>
      <main className="todo-app-container">
        <Header
          darkMode={darkMode}
          setDarkMode={setDarkMode}
          activeCount={activeCount}
        />

        <form onSubmit={handleAddTodo} className="flex gap-2 mb-4">
          <input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            placeholder="Add a new task..."
            className="todo-input flex-1"
          />
          <button type="submit" className="btn-primary shrink-0">
            Add
          </button>
        </form>

        <div className="flex items-center gap-1.5 py-1 border-b border-slate-200 dark:border-slate-800 text-xs">
          {["all", "active", "completed"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded capitalize transition font-medium ${
                filter === f
                  ? "bg-blue-600 text-white"
                  : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <TodoList
          todos={filteredTodos}
          onToggle={handleToggle}
          onDelete={handleDelete}
        />
      </main>
    </div>
  );
}

