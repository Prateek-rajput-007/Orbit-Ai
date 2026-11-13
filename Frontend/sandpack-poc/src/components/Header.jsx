
export default function Header({ darkMode, setDarkMode, activeCount }) {
  return (
    <header className="flex items-center justify-between pb-4 mb-4 border-b border-slate-200 dark:border-slate-700">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Orbit Task Studio
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {activeCount === 1 ? "1 task pending" : `${activeCount} tasks pending`}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setDarkMode((prev) => !prev)}
        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
      >
        {darkMode ? "☀️ Light Mode" : "🌙 Dark Mode"}
      </button>
    </header>
  );
}

