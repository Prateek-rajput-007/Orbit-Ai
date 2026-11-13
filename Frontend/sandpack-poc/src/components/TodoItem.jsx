
export default function TodoItem({ todo, onToggle, onDelete }) {
  return (
    <li className="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 transition hover:border-slate-300 dark:hover:border-slate-700">
      <label className="flex items-center gap-3 cursor-pointer flex-1">
        <input
          type="checkbox"
          checked={todo.completed}
          onChange={() => onToggle(todo.id)}
          className="size-4 rounded text-blue-600 focus:ring-blue-500 cursor-pointer"
        />
        <span
          className={`text-sm ${
            todo.completed
              ? "line-through text-slate-400 dark:text-slate-500"
              : "text-slate-800 dark:text-slate-200"
          }`}
        >
          {todo.title}
        </span>
      </label>

      <button
        type="button"
        onClick={() => onDelete(todo.id)}
        className="px-2 py-1 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition"
        title="Delete task"
      >
        ✕
      </button>
    </li>
  );
}

