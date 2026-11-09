import crypto from "crypto";

/**
 * Lightweight, production-grade telemetry utility for measuring and logging
 * request lifecycle latency across agent orchestration phases.
 */
export function createTrace(req, agent = "coding") {
    const traceId = req?.headers?.["x-request-id"] ||
                    req?.body?.clientRequestId ||
                    req?.headers?.["x-trace-id"] ||
                    `trace-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const startTime = Date.now();
    const marks = { start: startTime };

    return {
        traceId,
        agent,
        startTime,
        marks,
        mark(phase) {
            this.marks[phase] = Date.now();
        },
        durationSince(phase) {
            const from = this.marks[phase] || this.startTime;
            return Date.now() - from;
        },
        totalDuration() {
            return Date.now() - this.startTime;
        },
        record(meta = {}) {
            const now = Date.now();
            const totalDurationMs = now - this.startTime;

            const structuredLog = {
                type: "agent_telemetry",
                timestamp: new Date().toISOString(),
                traceId: this.traceId,
                agent: this.agent,
                status: meta.status || "success",
                totalDurationMs,
                phases: {
                    beforeLlmMs: (this.marks.llmStart && this.marks.start) ? this.marks.llmStart - this.marks.start : null,
                    ttftMs: (this.marks.firstToken && this.marks.llmStart) ? this.marks.firstToken - this.marks.llmStart : null,
                    llmGenerationMs: (this.marks.llmEnd && this.marks.llmStart) ? this.marks.llmEnd - this.marks.llmStart : null,
                    artifactParsingMs: (this.marks.parseEnd && this.marks.parseStart) ? this.marks.parseEnd - this.marks.parseStart : null,
                    persistenceMs: (this.marks.persistEnd && this.marks.persistStart) ? this.marks.persistEnd - this.marks.persistStart : null,
                },
                model: meta.model || "unknown",
                provider: meta.provider || "unknown",
                retries: meta.retries || 0,
                tokenUsage: meta.tokenUsage || null,
            };

            // Log sanitized JSON in single line for CloudWatch / Datadog / Docker stdout
            console.log(JSON.stringify(structuredLog));

            return structuredLog;
        }
    };
}
