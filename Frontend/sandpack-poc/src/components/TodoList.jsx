import TodoItem from "./TodoItem.jsx";

export default function TodoList({ todos, onToggle, onDelete }) {
  if (todos.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-slate-400 dark:text-slate-500">
        No tasks found in this view.
      </div>
    );
  }

  return (
    <ul className="space-y-2 mt-4 list-none p-0">
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

