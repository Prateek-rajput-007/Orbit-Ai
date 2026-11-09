import { useState } from "react"
import { LogOut } from "lucide-react"
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

function WorkspaceProfile({ user, isSigningOut, onSignOut }) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  const confirmSignOut = async (event) => {
    event.preventDefault()
    const signedOut = await onSignOut()
    if (signedOut) setIsConfirmOpen(false)
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] transition-all hover:bg-white/[0.05] hover:border-white/[0.12]">
      <div className="relative shrink-0">
        <div className="grid size-8 place-items-center overflow-hidden rounded-full border border-amber-400/30 bg-surface-subtle text-xs font-semibold text-accent-ink shadow-[0_0_8px_rgba(234,189,88,0.15)]">
          {user?.avatar ? (
            <img className="size-full object-cover" src={user.avatar} alt="" />
          ) : (
            (user?.name?.trim()?.[0] ?? "O").toUpperCase()
          )}
        </div>
        <span className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-[#090a10] bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
      </div>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-xs font-medium text-ink">
          {user?.name ?? "Orbit Workspace"}
        </strong>
        <span className="block truncate text-[11px] text-muted">
          {user?.email ?? "Signed in"}
        </span>
      </div>
      <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
        <AlertDialogTrigger asChild>
          <button
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-white/5 hover:text-red-300 focus-visible:text-red-300 disabled:cursor-wait disabled:opacity-50 cursor-pointer"
            type="button"
            aria-label="Sign out"
            title="Sign out"
            disabled={isSigningOut}
          >
            <LogOut aria-hidden="true" size={13} />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out of {user?.name ? `${user.name}` : "your workspace"}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" disabled={isSigningOut}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isSigningOut}
              onClick={confirmSignOut}
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default WorkspaceProfile
