/** Map raw Firebase auth error codes to user-friendly messages. */
const FIREBASE_AUTH_MESSAGES = {
  "auth/popup-closed-by-user": "Sign-in window closed. You can try again.",
  "auth/cancelled-popup-request": "Sign-in window closed. You can try again.",
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow popups and try again.",
  "auth/operation-not-supported-in-this-environment":
    "Your browser blocked the sign-in window. Allow popups and try again.",
  "auth/network-request-failed":
    "Unable to connect. Check your internet connection and try again.",
  "auth/too-many-requests": "Too many sign-in attempts. Please wait a moment and try again.",
  "auth/user-disabled": "This account has been disabled. Contact support if you need help.",
  "auth/account-exists-with-different-credential":
    "An account already exists with this email using a different sign-in method.",
  "auth/internal-error": "An unexpected error occurred. Please try again.",
  "auth/invalid-credential": "Sign-in failed. Please try again.",
  "auth/web-storage-unsupported":
    "Sign-in requires cookies to be enabled in your browser.",
}

/**
 * Extracts a friendly error message from any error shape.
 * Firebase auth errors are translated to human-readable copy.
 */
export const getErrorMessage = (error, fallback) => {
  // Translate Firebase auth error codes first
  if (error?.code && FIREBASE_AUTH_MESSAGES[error.code]) {
    return FIREBASE_AUTH_MESSAGES[error.code]
  }

  // Strip raw Firebase prefix from message strings as a safety net
  const rawMessage =
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    error?.message

  if (rawMessage) {
    // Suppress bare Firebase exception strings from leaking to the UI
    if (/^Firebase:\s*Error\s*\(auth\//i.test(rawMessage)) {
      // Try to extract the code from the message and map it
      const match = rawMessage.match(/\(([^)]+)\)/)
      const code = match?.[1]
      if (code && FIREBASE_AUTH_MESSAGES[code]) {
        return FIREBASE_AUTH_MESSAGES[code]
      }
      return "Sign-in failed. Please try again."
    }
    return rawMessage
  }

  return fallback
}
