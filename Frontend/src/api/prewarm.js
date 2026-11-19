/**
 * Silent backend pre-warming utility.
 * Initiates a single non-blocking, credential-less GET / request to wake up idle cloud instances.
 */
let prewarmTriggered = false

export function prewarmBackend() {
  if (prewarmTriggered) return
  prewarmTriggered = true

  const serverUrl =
    import.meta?.env?.VITE_SERVER_URL ?? import.meta?.env?.VITE_API_URL ?? ""

  if (!serverUrl) return

  try {
    fetch(`${serverUrl.replace(/\/$/, "")}/`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    }).catch(() => {
      // Silently ignore - strictly a background wakeup trigger
    })
  } catch {
    // Ignore any synchronous invocation errors
  }
}

