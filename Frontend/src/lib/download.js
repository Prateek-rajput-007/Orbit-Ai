/**
 * Triggers a client-side file download for a URL, Data URL, or Blob.
 * Handles DOM element attachment and clean teardown.
 *
 * @param {string | Blob} source - Data URL, Blob URL, or remote file URL
 * @param {string} fileName - Suggested name for the downloaded file
 */
export function downloadFile(source, fileName = "download") {
  if (!source) return

  try {
    let url = source
    let isCreatedBlobUrl = false

    if (typeof Blob !== "undefined" && source instanceof Blob) {
      url = window.URL.createObjectURL(source)
      isCreatedBlobUrl = true
    }

    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.target = "_blank"
    link.rel = "noreferrer"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    if (isCreatedBlobUrl) {
      setTimeout(() => window.URL.revokeObjectURL(url), 10_000)
    }
  } catch (err) {
    console.error("Unable to trigger file download:", err)
  }
}

export default downloadFile

