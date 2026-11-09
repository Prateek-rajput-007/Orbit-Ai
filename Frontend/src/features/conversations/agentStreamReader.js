/**
 * Reads and parses an HTTP response stream encoded as Server-Sent Events (SSE).
 * Handles chunk boundary buffering, event dispatch, and keep-alive filtering.
 *
 * @param {Response} response - Fetch API Response with response.body ReadableStream
 * @param {object} handlers
 * @param {(token: string) => void} [handlers.onToken] - Called when a text token arrives
 * @param {(stageMessage: string, stageData: object) => void} [handlers.onStage] - Called on agent stage update
 * @param {(readyData: object) => void} [handlers.onReady] - Called when final payload is received
 * @returns {Promise<object>} Resolves with the final ready payload or parsed JSON
 */
export async function readAgentEventStream(response, handlers = {}) {
  const contentType = response.headers.get("content-type") || ""

  if (!contentType.includes("text/event-stream") || !response.body) {
    return response.json()
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let currentEvent = "message"
  let finalReadyData = null

  const processLines = (lines) => {
    for (const rawLine of lines) {
      const line = rawLine.trimEnd()
      // Ignore blank lines and SSE comment keepalives (e.g. ": keepalive")
      if (!line || line.startsWith(":")) {
        continue
      }
      if (line.startsWith("event: ")) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith("data: ")) {
        try {
          const parsed = JSON.parse(line.slice(6))
          if (currentEvent === "token" && typeof parsed.token === "string") {
            handlers.onToken?.(parsed.token)
          } else if (currentEvent === "stage" && parsed.message) {
            handlers.onStage?.(parsed.message, parsed)
          } else if (currentEvent === "ready") {
            finalReadyData = parsed
            handlers.onReady?.(parsed)
          } else if (currentEvent === "error") {
            throw new Error(parsed.message || parsed.error || "Agent request failed")
          }
        } catch (parseErr) {
          if (currentEvent === "error") throw parseErr
        }
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      if (buffer.trim()) {
        processLines(buffer.split("\n"))
      }
      break
    }
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    processLines(lines)
  }

  return finalReadyData
}

export default readAgentEventStream

