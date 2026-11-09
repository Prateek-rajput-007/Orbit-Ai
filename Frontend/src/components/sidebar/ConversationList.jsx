import { useMemo } from "react"
import { MessageSquare, Trash2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../ui/alert-dialog.jsx"

const dateGroup = (timestamp) => {
  const today = new Date()
  const date = new Date(timestamp)
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const daysAgo = Math.floor((todayStart - dateStart) / 86_400_000)

  if (daysAgo <= 0) return "Today"
  if (daysAgo === 1) return "Yesterday"
  if (daysAgo < 7) return "Previous 7 days"
  return "Earlier"
}

function ConversationList({ conversations, activeId, query, isLoading, onSelectChat, onDeleteChat }) {
  const grouped = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const filtered = conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalizedQuery),
    )
    return filtered.reduce((groups, conversation) => {
      const label = dateGroup(conversation.updatedAt)
      groups[label] ??= []
      groups[label].push(conversation)
      return groups
    }, {})
  }, [conversations, query])

  return (
    <div className="relative z-10 min-h-0 flex-1 overflow-y-auto pr-0.5">
      {Object.entries(grouped).map(([label, chats]) => (
        <section className="mb-3.5" key={label}>
          <h2 className="mb-1 px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-soft">{label}</h2>
          {chats.map((conversation) => {
            const isActive = conversation.id === activeId
            return (
              <div
                className={`group relative mb-0.5 flex h-8 items-center gap-2 rounded-lg px-2 text-xs transition-all duration-150 ${
                  isActive
                    ? "bg-gradient-to-r from-white/[0.09] to-white/[0.03] border border-white/[0.08] text-ink font-medium shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08),0_2px_4px_rgba(0,0,0,0.25)]"
                    : "border border-transparent text-ink-soft hover:bg-white/[0.04] hover:text-ink hover:border-white/[0.05]"
                }`}
                key={conversation.id}
              >
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-gradient-to-b from-amber-300 via-accent to-amber-500 shadow-[0_0_10px_rgba(234,189,88,0.6)]" />
                )}
                <MessageSquare
                  aria-hidden="true"
                  size={13}
                  className={`shrink-0 transition-colors ${isActive ? "text-accent" : "text-muted-soft group-hover:text-muted"}`}
                />
                <button
                  className="min-w-0 flex-1 overflow-hidden bg-transparent p-0 text-left cursor-pointer"
                  type="button"
                  onClick={() => onSelectChat(conversation.id)}
                  title={conversation.title}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span className="block truncate">{conversation.title}</span>
                </button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="grid size-6 shrink-0 place-items-center rounded text-muted-soft opacity-100 transition-all duration-150 hover:bg-red-500/15 hover:text-red-300 hover:scale-110 active:scale-95 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 cursor-pointer"
                      type="button"
                      aria-label={`Delete ${conversation.title}`}
                    >
                      <Trash2 aria-hidden="true" size={12} />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete conversation</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete “{conversation.title}” and its message history.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel variant="outline">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => onDeleteChat(conversation.id)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            )
          })}
        </section>
      ))}
      {isLoading ? (
        <div className="mx-1 my-2 flex items-center gap-2 rounded-lg bg-white/[0.02] px-2.5 py-2 text-xs text-muted" role="status">
          <span className="size-1.5 animate-pulse rounded-full bg-accent/70" />
          <span>Loading...</span>
        </div>
      ) : !Object.keys(grouped).length && (
        <div className="mx-1 my-2 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-3 py-3 text-xs leading-relaxed text-muted">
          {query ? "No matching conversations found." : "No conversations yet."}
        </div>
      )}
    </div>
  )
}

export default ConversationList
