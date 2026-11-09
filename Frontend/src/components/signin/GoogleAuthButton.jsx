/**
 * Official Google Logo & Premium SaaS Google Authentication CTA Component
 */
export function GoogleIcon({ className = "size-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

import { ArrowRight, Loader2 } from "lucide-react"

export function GoogleAuthButton({
  onSignIn,
  isSigningIn = false,
  disabled = false,
  variant = "default",
  className = "",
}) {
  const isDisabled = disabled || isSigningIn

  const handleClick = (e) => {
    if (isDisabled) {
      e.preventDefault()
      return
    }
    onSignIn?.(e)
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-busy={isSigningIn}
        aria-label={isSigningIn ? "Connecting to Google…" : "Continue with Google"}
        className={`group relative inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/15 border-t-white/25 bg-white/[0.06] px-4 text-xs font-medium text-white/90 shadow-sm backdrop-blur-md transition-all duration-150 ease-out hover:border-amber-400/50 hover:bg-white/[0.10] hover:text-white hover:shadow-md hover:shadow-amber-500/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080a] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${className}`}
      >
        {isSigningIn ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-400" aria-hidden="true" />
            <span>Connecting…</span>
          </>
        ) : (
          <>
            <GoogleIcon className="size-3.5 shrink-0" />
            <span>Sign in</span>
            <ArrowRight
              className="size-3 shrink-0 text-amber-400/70 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-amber-400"
              aria-hidden="true"
            />
          </>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-busy={isSigningIn}
      aria-label={isSigningIn ? "Connecting to Google…" : "Continue with Google"}
      className={`group relative inline-flex h-11 sm:h-12 w-full items-center justify-center gap-3 rounded-full border border-white/[0.14] border-t-white/[0.28] bg-gradient-to-b from-white/[0.09] to-white/[0.04] px-6 text-[14.5px] sm:text-[15px] font-medium text-white shadow-[0_4px_20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-all duration-200 ease-out hover:border-amber-400/60 hover:bg-white/[0.11] hover:shadow-[0_0_32px_rgba(234,189,88,0.22),0_4px_24px_rgba(0,0,0,0.7)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985] active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080a] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:scale-100 disabled:shadow-none disabled:hover:bg-white/[0.06] disabled:hover:border-white/10 ${className}`}
    >
      {isSigningIn ? (
        <>
          <Loader2 className="size-4 sm:size-5 shrink-0 animate-spin text-amber-400" aria-hidden="true" />
          <span>Connecting to Google…</span>
        </>
      ) : (
        <>
          <GoogleIcon className="size-4 sm:size-5 shrink-0" />
          <span className="tracking-tight text-white/95">Continue with Google</span>
          <ArrowRight
            className="size-4 shrink-0 text-amber-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-amber-300"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  )
}

export default GoogleAuthButton

