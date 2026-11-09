import { graph } from "../graph/graph.js";
import { getMemory } from "../config/memory.js";
import { saveTurn, updateArtifactDeployment } from "../utils/getMessages.js";
import { deployArtifactProject } from "../utils/deployment/deploymentManager.js";
import { createTrace } from "../utils/telemetry.js";

function sanitizeErrorMessage(msg) {
    if (typeof msg !== "string") return "An unexpected error occurred";
    let sanitized = msg
        .replace(/gsk_[a-zA-Z0-9_-]+/g, "[REDACTED_API_KEY]")
        .replace(/AIzaSy[a-zA-Z0-9_-]+/g, "[REDACTED_API_KEY]")
        .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED]")
        .replace(/https?:\/\/[^\s]+/g, "[URL]");
    if (sanitized.includes("rate_limit_exceeded") || sanitized.includes("Rate limit reached")) {
        return "The upstream model is currently experiencing high demand. Please retry shortly.";
    }
    return sanitized;
}

export const agent = async (req, res) => {
    const requestedAgent = req.body?.agentMode || "auto";
    const trace = createTrace(req, requestedAgent);
    const isSse = req.headers["accept"] === "text/event-stream" || req.query?.stream === "true";
    let isClientDisconnected = false;
    let keepAliveTimer = null;

    res.on?.("close", () => {
        if (!res.writableEnded) {
            isClientDisconnected = true;
        }
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
        }
    });

    if (isSse) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        if (typeof res.flushHeaders === "function") res.flushHeaders();

        keepAliveTimer = setInterval(() => {
            if (isClientDisconnected || res.writableEnded || res.destroyed) {
                if (keepAliveTimer) {
                    clearInterval(keepAliveTimer);
                    keepAliveTimer = null;
                }
                return;
            }
            try {
                res.write(": keepalive\n\n");
                if (typeof res.flush === "function") res.flush();
            } catch {
                if (keepAliveTimer) {
                    clearInterval(keepAliveTimer);
                    keepAliveTimer = null;
                }
            }
        }, 10_000);
    }

    const sendEvent = (event, data) => {
        if (!isSse || res.writableEnded || res.destroyed || isClientDisconnected) return;
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            if (typeof res.flush === "function") res.flush();
        } catch {}
    };

    try {
        const { prompt, conversationId, agentMode = "auto" } = req.body;
        const userId = req.headers["user-id"];
        if (typeof prompt !== "string" || !prompt.trim() || !conversationId) {
            const errPayload = { message: "prompt and conversationId are required", error: "prompt and conversationId are required" };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(400).json(errPayload);
        }
        if (!userId) {
            const errPayload = { message: "Unauthorized", error: "Unauthorized" };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(401).json(errPayload);
        }

        const supportedAgents = new Set(["auto", "chat", "search", "coding", "pdf", "ppt", "vision"]);
        if (!supportedAgents.has(agentMode)) {
            const errPayload = { message: "Unsupported agent selection", error: "Unsupported agent selection" };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(400).json(errPayload);
        }

        const attachment = req.file;
        const isPdf = Boolean(
            attachment &&
            (attachment.mimetype === "application/pdf" || attachment.originalname.toLowerCase().endsWith(".pdf")),
        );
        const isImage = ["image/jpeg", "image/png", "image/webp"].includes(attachment?.mimetype);
        if (attachment && !isPdf && !isImage) {
            const errPayload = { message: "Only PDF, JPEG, PNG, and WebP files are supported", error: "Unsupported file type" };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(400).json(errPayload);
        }
        if (attachment && isPdf && !attachment.buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
            const errPayload = { message: "The uploaded file is not a valid PDF", error: "Invalid PDF format" };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(400).json(errPayload);
        }
        if (attachment && agentMode !== "auto" && agentMode !== (isPdf ? "pdf" : "vision")) {
            const errPayload = {
                message: `This file type requires the ${isPdf ? "PDF" : "Vision"} agent or Auto`,
                error: `Mismatched agent mode for attachment`,
            };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(400).json(errPayload);
        }

        sendEvent("stage", { stage: "initializing", message: "Connecting to agent...", traceId: trace.traceId });

        const promptText = prompt.trim();
        const historyPrompt = attachment
            ? `${promptText}\n[Attached file: ${attachment.originalname}]`
            : promptText;

        const userAttachment = attachment ? {
            name: attachment.originalname,
            mimeType: isPdf ? "application/pdf" : attachment.mimetype,
            dataUrl: isImage ? `data:${attachment.mimetype};base64,${attachment.buffer.toString("base64")}` : null,
        } : null;

        trace.mark("memoryStart");
        const history = await getMemory(conversationId, userId);
        trace.mark("memoryEnd");

        if (isClientDisconnected) return;

        trace.mark("llmStart");
        const result = await graph.invoke({
            prompt: promptText,
            conversationId,
            history: history.map(({ role, content }) => ({ role, content })),
            agentMode,
            attachment: attachment ? {
                name: attachment.originalname,
                mimeType: isPdf ? "application/pdf" : attachment.mimetype,
                data: attachment.buffer.toString("base64"),
            } : undefined,
            onToken: (token) => {
                if (isClientDisconnected) return;
                if (!trace.marks.firstToken) trace.mark("firstToken");
                sendEvent("token", { token });
            },
            onStage: (stage, message) => {
                if (isClientDisconnected) return;
                if (stage === "parsing") trace.mark("parseStart");
                sendEvent("stage", { stage, message });
            },
            isAborted: () => isClientDisconnected,
        });
        trace.mark("llmEnd");
        if (trace.marks.parseStart) trace.mark("parseEnd");

        if (isClientDisconnected) {
            console.log("Client disconnected; aborting turn persistence and terminating.");
            return;
        }

        const response = result.aiResponse || "I processed your request, but could not produce a response. Please try rephrasing.";

        trace.mark("persistStart");
        sendEvent("stage", { stage: "saving", message: "Persisting conversation and artifact..." });
        const savedMessages = await saveTurn(
            conversationId,
            userId,
            historyPrompt,
            {
                content: response,
                images: result.images ?? [],
                searchResults: result.searchResults ?? [],
                slides: result.slides ?? [],
                presentationFile: result.presentationFile ?? null,
                pdfDocument: result.pdfDocument ?? null,
                codeArtifact: result.codeArtifact ?? null,
                imageAttachment: result.imageAttachment ?? null,
                suggestedQuestions: result.suggestedQuestions ?? [],
            },
            userAttachment,
        );
        trace.mark("persistEnd");

        if (result.agent) {
            trace.agent = result.agent;
        }

        const telemetryData = trace.record({
            status: "success",
            model: result.modelUsed || "codingModel",
            provider: result.providerUsed || "groq",
            tokenUsage: result.tokenUsage,
            retries: result.retries || 0,
        });

        const finalPayload = {
            aiResponse: response,
            searchResults: result.searchResults ?? [],
            images: result.images ?? [],
            slides: result.slides ?? [],
            presentationFile: result.presentationFile ?? null,
            pdfDocument: result.pdfDocument ?? null,
            codeArtifact: result.codeArtifact ?? null,
            imageAttachment: result.imageAttachment ?? null,
            userAttachment,
            suggestedQuestions: result.suggestedQuestions ?? [],
            userMessageId: savedMessages[0]._id,
            assistantMessageId: savedMessages[1]._id,
            telemetry: telemetryData,
        };

        if (isSse) {
            sendEvent("ready", finalPayload);
            sendEvent("done", { status: "complete", traceId: trace.traceId });
            return res.end();
        }

        return res.status(200).json(finalPayload);
    } catch (error) {
        const rawMessage = error.message || "Unknown error";
        const sanitizedMsg = sanitizeErrorMessage(rawMessage);
        console.error("Agent request failed:", sanitizedMsg);
        trace.record({
            status: "error",
            error: sanitizedMsg,
        });

        const errorPayload = {
            message: sanitizedMsg,
            error: sanitizedMsg,
            traceId: trace.traceId,
        };

        if (isSse) {
            sendEvent("error", errorPayload);
            return res.end();
        }

        return res.status(500).json(errorPayload);
    } finally {
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
        }
    }
};

export const deployArtifact = async (req, res) => {
    try {
        const userId = req.headers["user-id"];
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized", error: "Unauthorized" });
        }

        const { artifact, conversationId, messageId, provider } = req.body;
        if (!artifact || !Array.isArray(artifact.files) || artifact.files.length === 0) {
            return res.status(400).json({
                success: false,
                message: "A valid artifact with files is required for deployment",
                error: "Invalid artifact payload",
            });
        }

        const deployResult = await deployArtifactProject({
            files: artifact.files,
            title: artifact.title || "orbit-app",
            provider,
        });

        if (conversationId && messageId) {
            await updateArtifactDeployment(conversationId, messageId, userId, deployResult);
        }

        const status = deployResult.success ? 200 : (deployResult.status === "unconfigured" ? 200 : 400);
        return res.status(status).json(deployResult);
    } catch (error) {
        console.error("Artifact deployment failed:", error.message || error);
        const isClientValidation =
            error.message?.includes("requires at least one HTML") ||
            error.message?.includes("No files provided") ||
            error.message?.includes("No valid files") ||
            error.message?.includes("exceeds maximum deployment limit");
        const statusCode = isClientValidation ? 400 : 500;
        return res.status(statusCode).json({
            success: false,
            status: "failed",
            message: error.message || "Artifact deployment failed",
            error: error.message || "Deployment request failed",
        });
    }
};
