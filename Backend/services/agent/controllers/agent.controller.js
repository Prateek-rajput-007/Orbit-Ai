import { graph } from "../graph/graph.js";
import { getMemory } from "../config/memory.js";
import { saveTurn, updateArtifactDeployment } from "../utils/getMessages.js";
import { deployArtifactProject } from "../utils/deployment/deploymentManager.js";
import { createTrace } from "../utils/telemetry.js";
import { classifyProjectIntent, PROJECT_INTENTS } from "../utils/projectIntent.js";
import {
    getActiveProjectForConversation,
    createInitialProjectVersion,
    createIncrementalProjectVersion,
    listConversationProjects,
    getProjectVersionDetails,
} from "../utils/projectVersionService.js";
import {
    acquireConcurrencyLease,
    renewConcurrencyLease,
    releaseConcurrencyLease,
} from "../../../shared/security/concurrencyManager.js";
import {
    checkAndReserveIdempotency,
    markIdempotencyCompleted,
    clearIdempotencyReservation,
} from "../../../shared/security/idempotencyManager.js";
import {
    checkAndConsumeDailyQuota,
    rollbackDailyQuota,
} from "../../../shared/security/usageManager.js";
import {
    validateAgentRequest,
} from "../../../shared/security/requestValidator.js";

const MAX_PROMPT_CHARS = parseInt(process.env.MAX_PROMPT_LENGTH || "16000", 10);
const DAILY_AI_TURNS_LIMIT = parseInt(process.env.DAILY_AI_TURNS_LIMIT || "100", 10);

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
    let leaseHeartbeatTimer = null;
    let leaseAcquired = false;
    let quotaConsumed = false;
    let clientRequestId = null;
    let userId = null;
    let hasCompletedSuccessfully = false;

    res.on?.("close", () => {
        if (!res.writableEnded) {
            isClientDisconnected = true;
        }
        if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
        }
        if (leaseHeartbeatTimer) {
            clearInterval(leaseHeartbeatTimer);
            leaseHeartbeatTimer = null;
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
        userId = req.headers["user-id"];
        clientRequestId =
            req.headers["idempotency-key"] ||
            req.headers["x-request-id"] ||
            req.body?.clientRequestId ||
            trace.traceId;

        // 1. Strict Authentication Barrier
        if (!userId) {
            const errPayload = { message: "Unauthorized", error: "Unauthorized", status: 401 };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(401).json(errPayload);
        }

        // 2. Request Schema & Input Length Validation
        const validation = validateAgentRequest(req.body, req.file, MAX_PROMPT_CHARS);
        if (!validation.isValid) {
            const errPayload = {
                message: validation.message,
                error: validation.error,
                status: validation.status,
            };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(validation.status).json(errPayload);
        }

        const {
            prompt: promptText,
            conversationId,
            agentMode,
            projectId: requestedProjectId,
            baseVersion: expectedBaseVersion,
        } = validation;
        const requestPayload = {
            prompt: promptText,
            conversationId,
            agentMode,
            projectId: requestedProjectId || null,
            baseVersion: expectedBaseVersion || null,
            model: req.body?.model || "",
            attachment: req.file ? {
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                buffer: req.file.buffer,
            } : (req.body?.attachment || null),
        };

        // 3. Backend Idempotency Check (prevents double-clicks & network retry duplicates)
        const idemp = await checkAndReserveIdempotency(userId, clientRequestId, requestPayload);
        if (!idemp.shouldProceed) {
            if (idemp.status === "payload_mismatch") {
                const errPayload = {
                    message: idemp.error,
                    error: "Unprocessable Entity",
                    status: 422,
                };
                if (isSse) {
                    sendEvent("error", errPayload);
                    return res.end();
                }
                return res.status(422).json(errPayload);
            }

            if (idemp.status === "completed" && idemp.cachedResult) {
                // Return cached result reference
                const cachedPayload = {
                    ...idemp.cachedResult,
                    isIdempotentReplay: true,
                };
                if (isSse) {
                    sendEvent("ready", cachedPayload);
                    sendEvent("done", { status: "complete", traceId: trace.traceId, isIdempotentReplay: true });
                    return res.end();
                }
                return res.status(200).json(cachedPayload);
            }

            // Already running
            const errPayload = {
                message: "An identical request is currently actively processing. Please wait for completion.",
                error: "Conflict",
                status: 409,
            };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(409).json(errPayload);
        }

        // 4. Server-Side Daily AI Usage Quota Check (UTC midnight reset)
        const quota = await checkAndConsumeDailyQuota(userId, DAILY_AI_TURNS_LIMIT);
        if (!quota.allowed) {
            res.setHeader("Retry-After", quota.retryAfterSec);
            const errPayload = {
                message: `Daily AI generation quota reached (${DAILY_AI_TURNS_LIMIT} prompts/day). Quota resets at midnight UTC.`,
                error: "Daily Quota Exceeded",
                status: 429,
                retryAfter: quota.retryAfterSec,
                dailyLimit: DAILY_AI_TURNS_LIMIT,
            };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(429).json(errPayload);
        }
        quotaConsumed = true;

        // 5. Distributed User Concurrency Lease Check (Max 1 active generation per user with 120s safety TTL)
        const lease = await acquireConcurrencyLease(userId, trace.traceId, 120_000);
        if (!lease.acquired) {
            // Roll back the consumed quota turn since we are rejecting
            await rollbackDailyQuota(userId);
            quotaConsumed = false;

            res.setHeader("Retry-After", lease.remainingSec);
            const errPayload = {
                message: "You already have an active generation in progress. Please wait for it to complete.",
                error: "Concurrency Limit Exceeded",
                status: 429,
                retryAfter: lease.remainingSec,
            };
            if (isSse) {
                sendEvent("error", errPayload);
                return res.end();
            }
            return res.status(429).json(errPayload);
        }
        leaseAcquired = true;

        // Auto-renew lease every 30s during long-running generations (e.g. Coding Agent)
        leaseHeartbeatTimer = setInterval(async () => {
            if (isClientDisconnected || !leaseAcquired) {
                if (leaseHeartbeatTimer) {
                    clearInterval(leaseHeartbeatTimer);
                    leaseHeartbeatTimer = null;
                }
                return;
            }
            const renewed = await renewConcurrencyLease(userId, trace.traceId, 60_000);
            if (!renewed) {
                console.warn(`[Agent] Concurrency lease lost for user ${userId}, request ${trace.traceId}`);
                leaseAcquired = false;
                if (leaseHeartbeatTimer) {
                    clearInterval(leaseHeartbeatTimer);
                    leaseHeartbeatTimer = null;
                }
            }
        }, 30_000);

        sendEvent("stage", { stage: "initializing", message: "Connecting to agent...", traceId: trace.traceId });

        const attachment = req.file;
        const isPdf = Boolean(
            attachment &&
            (attachment.mimetype === "application/pdf" || attachment.originalname?.toLowerCase().endsWith(".pdf"))
        );
        const isImage = ["image/jpeg", "image/png", "image/webp"].includes(attachment?.mimetype);

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

        // 1. Fetch all projects in this conversation
        let convProjects = [];
        try {
            convProjects = await listConversationProjects(conversationId, userId);
        } catch (listErr) {
            console.warn("[ProjectVersion] listConversationProjects warning:", listErr.message);
        }

        let existingCodeArtifact = null;

        if (requestedProjectId) {
            // Explicit project selection by client
            const matchedProject = convProjects.find((p) => p.projectId === requestedProjectId);
            if (!matchedProject) {
                const errPayload = {
                    message: `Project "${requestedProjectId}" not found in this conversation or unauthorized.`,
                    error: "Project Not Found",
                    status: 404,
                };
                if (isSse) {
                    sendEvent("error", errPayload);
                    return res.end();
                }
                return res.status(404).json(errPayload);
            }

            try {
                const projectDetails = await getProjectVersionDetails({
                    projectId: requestedProjectId,
                    versionNumber: expectedBaseVersion || null,
                    userId,
                });
                if (projectDetails?.snapshot) {
                    existingCodeArtifact = projectDetails.snapshot;
                }
            } catch (pDetailsErr) {
                console.warn("[ProjectVersion] getProjectVersionDetails warning:", pDetailsErr.message);
            }
        } else if (convProjects.length === 1) {
            // Case C: Single project in conversation - reasonable automatic selection
            try {
                const activeProjectData = await getActiveProjectForConversation(conversationId, userId, convProjects[0].projectId);
                if (activeProjectData?.currentArtifact) {
                    existingCodeArtifact = activeProjectData.currentArtifact;
                }
            } catch (pDetailsErr) {
                console.warn("[ProjectVersion] single project lookup warning:", pDetailsErr.message);
            }
        } else if (convProjects.length > 1) {
            // Multiple projects exist, but client did not provide an active projectId
            const tentativeIntent = classifyProjectIntent(promptText, null, history);

            if (tentativeIntent.intent === PROJECT_INTENTS.MODIFY_EXISTING_PROJECT || tentativeIntent.intent === PROJECT_INTENTS.AMBIGUOUS_INTENT) {
                // Check if prompt specifically mentions one of the project titles
                const matchedByTitle = convProjects.filter((p) =>
                    p.title && promptText.toLowerCase().includes(p.title.toLowerCase().trim())
                );

                if (matchedByTitle.length === 1) {
                    // Unique match by title!
                    try {
                        const projectDetails = await getProjectVersionDetails({
                            projectId: matchedByTitle[0].projectId,
                            versionNumber: null,
                            userId,
                        });
                        existingCodeArtifact = projectDetails?.snapshot || null;
                    } catch (pDetailsErr) {
                        console.warn("[ProjectVersion] matchedByTitle lookup warning:", pDetailsErr.message);
                    }
                } else {
                    // Case D: Multiple existing projects with no selected project and ambiguous/modify prompt -> CLARIFICATION REQUEST!
                    const projectListStr = convProjects
                        .map((p) => `• **${p.title}** (v${p.currentVersionNumber})`)
                        .join("\n");
                    const clarificationMessage = `You have multiple projects in this conversation:\n\n${projectListStr}\n\nPlease select which project you would like to modify, or specify its name in your message (e.g. "Update ${convProjects[0].title} to...").`;

                    sendEvent("stage", { stage: "clarification", message: "Multiple projects detected; requesting clarification..." });

                    const savedMessages = await saveTurn(
                        conversationId,
                        userId,
                        historyPrompt,
                        {
                            content: clarificationMessage,
                            codeArtifact: null,
                        },
                        userAttachment
                    );

                    const finalPayload = {
                        aiResponse: clarificationMessage,
                        codeArtifact: null,
                        userMessageId: savedMessages[0]._id,
                        assistantMessageId: savedMessages[1]._id,
                    };

                    await markIdempotencyCompleted(userId, clientRequestId, requestPayload, finalPayload);

                    if (isSse) {
                        sendEvent("ready", finalPayload);
                        sendEvent("done", { status: "complete", traceId: trace.traceId });
                        return res.end();
                    }
                    return res.status(200).json(finalPayload);
                }
            }
        } else {
            // convProjects.length === 0: Fallback to message history scan (backward compatibility for legacy unmigrated conversations)
            if (Array.isArray(history)) {
                for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];
                    if (
                        msg &&
                        msg.role === "assistant" &&
                        msg.codeArtifact &&
                        Array.isArray(msg.codeArtifact.files) &&
                        msg.codeArtifact.files.length > 0
                    ) {
                        existingCodeArtifact = msg.codeArtifact;
                        break;
                    }
                }
            }
        }

        // Classify project intent (modify, create new, general question, ambiguous)
        const projectIntent = classifyProjectIntent(promptText, existingCodeArtifact, history);
        const effectiveExistingArtifact = projectIntent.shouldUseExistingArtifact
            ? existingCodeArtifact
            : (projectIntent.intent === PROJECT_INTENTS.AMBIGUOUS_INTENT ? existingCodeArtifact : null);

        trace.mark("llmStart");
        const result = await graph.invoke({
            prompt: promptText,
            conversationId,
            history: history.map(({ role, content }) => ({ role, content })),
            agentMode,
            existingCodeArtifact: effectiveExistingArtifact,
            projectIntent,
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
            isAborted: () => isClientDisconnected || !leaseAcquired,
        });
        trace.mark("llmEnd");
        if (trace.marks.parseStart) trace.mark("parseEnd");

        if (isClientDisconnected) {
            console.log("Client disconnected; aborting turn persistence and terminating.");
            return;
        }

        const response = result.aiResponse || "I processed your request, but could not produce a response. Please try rephrasing.";

        // Versioning Lifecycle: Persist immutable project version snapshot on successful generation
        const isRolledBackToExisting = Boolean(
            existingCodeArtifact?.artifactId &&
            result.codeArtifact?.artifactId === existingCodeArtifact.artifactId
        );
        const isArtifactValid = result.codeArtifact?.integrity ? result.codeArtifact.integrity.valid : true;

        if (
            result.codeArtifact &&
            Array.isArray(result.codeArtifact.files) &&
            result.codeArtifact.files.length > 0 &&
            !isRolledBackToExisting &&
            isArtifactValid
        ) {
            try {
                if (projectIntent.intent === PROJECT_INTENTS.MODIFY_EXISTING_PROJECT && existingCodeArtifact?.projectId) {
                    const versionResult = await createIncrementalProjectVersion({
                        projectId: existingCodeArtifact.projectId,
                        userId,
                        conversationId,
                        artifact: result.codeArtifact,
                        promptText,
                        expectedBaseVersion,
                    });
                    result.codeArtifact = versionResult.artifact;
                } else if (
                    projectIntent.intent === PROJECT_INTENTS.NEW_PROJECT ||
                    !existingCodeArtifact?.projectId
                ) {
                    const versionResult = await createInitialProjectVersion({
                        userId,
                        conversationId,
                        artifact: result.codeArtifact,
                    });
                    result.codeArtifact = versionResult.artifact;
                }
            } catch (verErr) {
                console.warn("[ProjectVersion] Version snapshot persistence warning:", verErr.message);
                if (verErr.status === 409 || verErr.status === 503) {
                    const errPayload = {
                        message: verErr.message,
                        error: verErr.code || "Version Conflict",
                        status: verErr.status,
                    };
                    if (isSse) {
                        sendEvent("error", errPayload);
                        return res.end();
                    }
                    return res.status(verErr.status).json(errPayload);
                }
            }
        }

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

        hasCompletedSuccessfully = true;

        // Mark Idempotency as completed with response replay metadata
        await markIdempotencyCompleted(userId, clientRequestId, requestPayload, {
            userMessageId: savedMessages[0]._id,
            assistantMessageId: savedMessages[1]._id,
            aiResponse: result.aiResponse,
            artifacts: result.artifacts ?? [],
        });

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
        // 1. Clear lease renewal heartbeat timer
        if (leaseHeartbeatTimer) {
            clearInterval(leaseHeartbeatTimer);
            leaseHeartbeatTimer = null;
        }
        // 2. Safe Concurrency Release: only release lease if held by this request
        if (leaseAcquired && userId) {
            await releaseConcurrencyLease(userId, trace.traceId);
        }
        // 3. If request failed or client disconnected: clear reservation & rollback quota turn
        if (!hasCompletedSuccessfully && userId) {
            if (clientRequestId) {
                await clearIdempotencyReservation(userId, clientRequestId);
            }
            if (quotaConsumed) {
                await rollbackDailyQuota(userId);
            }
        }
        // 4. Clear keepalive interval
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
