/**
 * Request Validation Guards for Agent Generation
 */
const SUPPORTED_AGENT_MODES = new Set([
  "auto",
  "chat",
  "search",
  "coding",
  "pdf",
  "ppt",
  "vision",
]);

const ALLOWED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const validateAgentRequest = (body = {}, attachment = null, maxPromptChars = 16_000) => {
  const { prompt, conversationId, agentMode = "auto" } = body;

  // 1. Required fields
  if (typeof prompt !== "string" || !prompt.trim()) {
    return {
      isValid: false,
      status: 400,
      error: "Bad Request",
      message: "A non-empty text prompt is required.",
    };
  }

  if (!conversationId || typeof conversationId !== "string" || !conversationId.trim()) {
    return {
      isValid: false,
      status: 400,
      error: "Bad Request",
      message: "A valid conversationId is required.",
    };
  }

  // 2. Prompt length ceiling
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > maxPromptChars) {
    return {
      isValid: false,
      status: 413,
      error: "Payload Too Large",
      message: `Prompt exceeds the maximum allowed limit of ${maxPromptChars.toLocaleString()} characters.`,
    };
  }

  // 3. Agent Mode Whitelist
  if (!SUPPORTED_AGENT_MODES.has(agentMode)) {
    return {
      isValid: false,
      status: 400,
      error: "Bad Request",
      message: `Unsupported agent selection '${agentMode}'. Allowed agents: ${Array.from(SUPPORTED_AGENT_MODES).join(", ")}.`,
    };
  }

  // 4. File Attachment Validation
  if (attachment) {
    const isPdf =
      attachment.mimetype === "application/pdf" ||
      attachment.originalname?.toLowerCase().endsWith(".pdf");
    const isImage = ALLOWED_IMAGE_MIMES.has(attachment.mimetype);

    if (!isPdf && !isImage) {
      return {
        isValid: false,
        status: 400,
        error: "Unsupported File Type",
        message: "Only PDF documents and image files (JPEG, PNG, WebP) are supported.",
      };
    }

    // Inspect PDF Magic Bytes (%PDF-)
    if (isPdf && attachment.buffer) {
      const isMagicPdf = attachment.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"));
      if (!isMagicPdf) {
        return {
          isValid: false,
          status: 400,
          error: "Invalid File Format",
          message: "The uploaded file does not match a valid PDF binary signature.",
        };
      }
    }

    // Agent mode mismatch guard
    if (agentMode !== "auto" && agentMode !== (isPdf ? "pdf" : "vision")) {
      return {
        isValid: false,
        status: 400,
        error: "Mismatched Agent Mode",
        message: `This file type requires the ${isPdf ? "PDF" : "Vision"} agent or Auto.`,
      };
    }
  }

  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;

  const baseVersion =
    typeof body.baseVersion === "number"
      ? body.baseVersion
      : body.baseVersion && !Number.isNaN(parseInt(body.baseVersion, 10))
        ? parseInt(body.baseVersion, 10)
        : null;

  return {
    isValid: true,
    prompt: trimmedPrompt,
    conversationId: conversationId.trim(),
    agentMode,
    projectId,
    baseVersion,
  };
};

