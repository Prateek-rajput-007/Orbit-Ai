import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from "firebase/auth"
import api from "../../api/api.js"
import { auth } from "../../config/firebase.js"

export const REDIRECT_PENDING_KEY = "orbit_auth_redirect_pending"

/**
 * Creates a server session via the Auth microservice using the Firebase ID token.
 * Only invoked during an explicit login action (popup or redirect completion).
 */
export const createBackendSession = async (firebaseUser) => {
  const idToken = await firebaseUser.getIdToken()
  const { data } = await api.post("/api/auth/login", { idToken })
  if (!data?.user) {
    throw new Error("The server did not return a user after Firebase sign-in.")
  }
  return data.user
}

/**
 * Fast session restoration using the existing Redis-backed session cookie via Gateway /api/me.
 * Avoids redundant Firebase token refresh and full backend session re-creation.
 */
export const restoreBackendSession = async () => {
  try {
    const { data } = await api.get("/api/me")
    if (!data?.user) {
      throw new Error("The server returned an empty user session.")
    }
    return data.user
  } catch (error) {
    const status = error?.response?.status

    // 401: Unauthenticated (missing, expired, or invalid cookie) -> not an error
    if (status === 401) {
      return null
    }

    // 403: Forbidden (CSRF / origin mismatch or security policy block)
    if (status === 403) {
      const message = error.response?.data?.message || "Forbidden: unauthorized access."
      const authError = new Error(message)
      authError.status = 403
      throw authError
    }

    // 404: Endpoint configuration error
    if (status === 404) {
      const notFoundError = new Error("Authentication endpoint /api/me was not found on the server.")
      notFoundError.status = 404
      throw notFoundError
    }

    // 5xx or Network/CORS connection errors: rethrow as recoverable errors
    throw error
  }
}

/**
 * Explicit Google Login action.
 * Tries popup first; safely falls back to redirect with a tracking flag if popup is blocked.
 */
export const loginWithGoogle = async () => {
  const provider = new GoogleAuthProvider()
  provider.setCustomParameters({ prompt: "select_account" })

  try {
    const credential = await signInWithPopup(auth, provider)
    return await createBackendSession(credential.user)
  } catch (error) {
    if (
      error?.code === "auth/popup-blocked" ||
      error?.code === "auth/operation-not-supported-in-this-environment"
    ) {
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.setItem(REDIRECT_PENDING_KEY, "true")
      }
      return signInWithRedirect(auth, provider)
    }
    throw error
  }
}

/**
 * Completes a pending redirect sign-in exactly once.
 */
export const completeRedirectSignIn = async () => {
  await auth.authStateReady()
  let credential
  try {
    credential = await getRedirectResult(auth)
  } catch (error) {
    if (!auth.currentUser) throw error
  }
  const firebaseUser = credential?.user ?? auth.currentUser
  if (!firebaseUser) return null

  return createBackendSession(firebaseUser)
}

/**
 * Unified session restoration:
 * 1. If returning from an explicit redirect sign-in, process the redirect result.
 * 2. Otherwise, restore session via the fast /api/me endpoint without touching Firebase getRedirectResult.
 */
export const restoreSession = async () => {
  const isRedirectPending =
    typeof window !== "undefined" &&
    window.sessionStorage &&
    window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === "true"

  if (isRedirectPending) {
    try {
      window.sessionStorage.removeItem(REDIRECT_PENDING_KEY)
      const redirectedUser = await completeRedirectSignIn()
      if (redirectedUser) {
        return redirectedUser
      }
    } catch (redirectError) {
      console.warn("Failed to complete redirect sign-in, falling back to /api/me check:", redirectError)
    }
  }

  return await restoreBackendSession()
}

/**
 * Backwards compatibility alias for completeGoogleSignIn.
 */
export const completeGoogleSignIn = restoreSession

export const logout = async () => {
  let backendError
  try {
    await api.post("/api/auth/logout")
  } catch (error) {
    backendError = error
  }

  await signOut(auth)

  return { backendError }
}
