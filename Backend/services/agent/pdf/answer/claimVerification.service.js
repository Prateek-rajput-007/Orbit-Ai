/**
 * @file claimVerification.service.js
 * @description Claim-level evidence extraction, verification, and reconciliation service.
 *
 * Guarantees:
 * 1. Identifies distinct factual claims and their cited source IDs in the generated response.
 * 2. Evaluates factual alignment (entities, metrics, numbers, predicates) between claims and chunk content.
 * 3. Does not rely on query keyword overlap alone or citation presence as proof of factual support.
 * 4. Supports lightweight structured LLM verification with strict timeout, schema validation,
 *    and conservative deterministic fallback.
 * 5. Accurately determines EVIDENCE_STATUS (SUPPORTED, PARTIALLY_SUPPORTED, INSUFFICIENT_EVIDENCE, CONFLICTING_EVIDENCE).
 * 6. Safely handles unsupported claims without inventing citations or leaking chain-of-thought.
 */

export const CLAIM_STATUS = {
    SUPPORTED: "SUPPORTED",
    PARTIALLY_SUPPORTED: "PARTIALLY_SUPPORTED",
    UNSUPPORTED: "UNSUPPORTED",
    CONFLICTING: "CONFLICTING",
};

const COMMON_STOPWORDS = new Set([
    "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "from",
    "by", "for", "with", "about", "against", "between", "into", "through", "during",
    "before", "after", "above", "below", "to", "of", "up", "down", "in", "out", "on",
    "off", "over", "under", "again", "further", "then", "once", "here", "there", "all",
    "any", "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "can", "will", "just",
    "should", "now", "is", "am", "are", "was", "were", "be", "been", "being", "have",
    "has", "had", "having", "do", "does", "did", "doing", "would", "could", "it", "its",
    "this", "that", "these", "those", "they", "them", "their", "we", "our", "you", "your",
    "he", "him", "his", "she", "her", "i", "me", "my", "also", "well", "stated", "reported",
    "according", "document", "pdf", "section", "page",
]);

const ACRONYM_MAP = {
    mfa: "multi-factor",
    arr: "annual recurring revenue",
    capex: "capital expenditure",
    ebitda: "earnings before interest",
    fcf: "free cash flow",
    roi: "return on investment",
    sla: "service level",
    kpi: "key performance",
};

/**
 * Extracts raw source IDs from text (matches [S1], [S2], [S1, S2], [S1][S2], [Source S1]).
 *
 * @param {string} text - Segment of text
 * @returns {Array<string>} Array of unique source IDs in uppercase (e.g. ["S1", "S2"])
 */
export const extractSourceIdsFromSegment = (text = "") => {
    if (!text || typeof text !== "string") return [];
    const sourceIds = [];
    const bracketRegex = /\[(?:Source:?\s*)?([S\d,\s]+)\]/gi;
    let match;
    while ((match = bracketRegex.exec(text)) !== null) {
        const inner = match[1];
        const ids = inner.match(/S\d+/gi) || [];
        for (const id of ids) {
            const upper = id.toUpperCase();
            if (!sourceIds.includes(upper)) {
                sourceIds.push(upper);
            }
        }
    }
    return sourceIds;
};

/**
 * Extracts numeric, percentage, and currency primitives from text.
 *
 * @param {string} text - Input text
 * @returns {Array<string>} Normalized entity values
 */
export const extractNumericPrimitives = (text = "") => {
    if (!text || typeof text !== "string") return [];
    const matches = text.match(/(?:\$\s*)?\b\d+(?:,\d{3})*(?:\.\d+)?%?(?:\s*(?:billion|million|trillion|B|M|k))?\b/gi) || [];
    return matches.map((m) => m.replace(/\s+/g, "").toLowerCase());
};

/**
 * Splits answer text into distinct claim statements with their associated source IDs.
 *
 * @param {string} rawText - Full response text from LLM
 * @returns {Array<{ claimIndex: number, text: string, rawSegment: string, sourceIds: string[], isFactual: boolean }>}
 */
export const extractClaimsWithSources = (rawText = "") => {
    if (!rawText || typeof rawText !== "string") return [];

    // Split on newlines or sentence boundaries, preserving structure
    const rawSegments = rawText
        .split(/(?<=[.?!])\s+(?=[A-Z0-9*-])|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 5);

    const claims = [];
    let claimIndex = 0;

    for (const segment of rawSegments) {
        const sourceIds = extractSourceIdsFromSegment(segment);
        const cleanText = segment
            .replace(/\[(?:Source:?\s*)?([S\d,\s]+)\]/gi, "")
            .replace(/^[-*•]\s+/, "")
            .replace(/\*\*/g, "")
            .trim();

        if (cleanText.length < 5) continue;

        // Determine if segment asserts factual claims (contains numbers, metrics, or substantive words)
        const words = cleanText.toLowerCase().replace(/[^\w\s]/g, "").split(/\s+/);
        const substantiveWords = words.filter((w) => w.length > 2 && !COMMON_STOPWORDS.has(w));
        const hasNumbers = /\d/.test(cleanText);
        const isFactual = substantiveWords.length >= 2 || hasNumbers;

        claims.push({
            claimIndex: claimIndex++,
            text: cleanText,
            rawSegment: segment,
            sourceIds,
            isFactual,
        });
    }

    return claims;
};

/**
 * Deterministically checks whether chunk content contains evidence for a specific claim.
 * Evaluates metric match, lexical entity overlap, and contradiction indicators.
 *
 * @param {string} claimText - The specific factual assertion
 * @param {string} chunkContent - The trusted chunk content
 * @returns {{ status: string, confidence: string, matchRatio: number, missingMetrics: string[], reason: string }}
 */
export const evaluateClaimAgainstChunk = (claimText = "", chunkContent = "") => {
    if (!chunkContent || typeof chunkContent !== "string") {
        return {
            status: CLAIM_STATUS.UNSUPPORTED,
            confidence: "LOW",
            matchRatio: 0,
            missingMetrics: [],
            reason: "Chunk content is empty or unavailable.",
        };
    }
    if (!claimText || typeof claimText !== "string") {
        return {
            status: CLAIM_STATUS.UNSUPPORTED,
            confidence: "LOW",
            matchRatio: 0,
            missingMetrics: [],
            reason: "Claim text is empty.",
        };
    }

    const lowerChunk = chunkContent.toLowerCase();
    const lowerClaim = claimText.toLowerCase();
    const chunkNoComma = lowerChunk.replace(/,/g, "");

    // 1. Contradiction / Conflict Check
    const hasClaimIncrease = /\b(increased|grew|growth|rise|rose|higher|exceeded|gain)\b/i.test(claimText);
    const hasClaimDecrease = /\b(decreased|declined|drop|dropped|lower|fell|loss|deficit)\b/i.test(claimText);
    const hasChunkIncrease = /\b(increased|grew|growth|rise|rose|higher|exceeded|gain)\b/i.test(chunkContent);
    const hasChunkDecrease = /\b(decreased|declined|drop|dropped|lower|fell|loss|deficit)\b/i.test(chunkContent);

    if ((hasClaimIncrease && hasChunkDecrease && !hasChunkIncrease) ||
        (hasClaimDecrease && hasChunkIncrease && !hasChunkDecrease)) {
        return {
            status: CLAIM_STATUS.CONFLICTING,
            confidence: "HIGH",
            matchRatio: 0,
            missingMetrics: [],
            reason: "Chunk asserts contradictory directional trend relative to the claim.",
        };
    }

    // 2. Metric / Number Verification (Comma-Agnostic)
    const claimMetrics = extractNumericPrimitives(claimText);
    const missingMetrics = [];

    for (const metric of claimMetrics) {
        const rawNum = metric.replace(/[^\d.]/g, "");
        const metricNoComma = metric.replace(/,/g, "");

        const inChunkExact = lowerChunk.includes(metric);
        const inChunkNoComma = chunkNoComma.includes(metricNoComma) || (rawNum && chunkNoComma.includes(rawNum));

        if (!inChunkExact && !inChunkNoComma) {
            missingMetrics.push(metric);
        }
    }

    // If claim asserts specific metrics (e.g. "$4.2B", "25%") and NONE appear in the chunk, it is unsupported
    if (claimMetrics.length > 0 && missingMetrics.length === claimMetrics.length) {
        return {
            status: CLAIM_STATUS.UNSUPPORTED,
            confidence: "HIGH",
            matchRatio: 0,
            missingMetrics,
            reason: `None of the claim's key metrics (${missingMetrics.join(", ")}) were found in the cited chunk.`,
        };
    }

    // 3. Substantive Lexical Term & Stem Overlap
    const claimTokens = lowerClaim
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !COMMON_STOPWORDS.has(t));

    if (claimTokens.length === 0) {
        return {
            status: CLAIM_STATUS.SUPPORTED,
            confidence: "MEDIUM",
            matchRatio: 1.0,
            missingMetrics,
            reason: "General claim without specific named entities.",
        };
    }

    let matchedCount = 0;
    for (const token of claimTokens) {
        if (lowerChunk.includes(token)) {
            matchedCount++;
            continue;
        }
        if (ACRONYM_MAP[token] && lowerChunk.includes(ACRONYM_MAP[token])) {
            matchedCount++;
            continue;
        }
        // Stem / root prefix matching (e.g. "admins" in "administrative")
        const stem = token.length > 4 ? token.slice(0, 4) : token;
        if (lowerChunk.includes(stem)) {
            matchedCount++;
            continue;
        }
    }

    const matchRatio = matchedCount / claimTokens.length;

    // Direct support criteria:
    // - If metrics exist, at least one key metric must match
    // - Substantive term overlap >= 0.35 (accounting for paraphrasing)
    if (matchRatio >= 0.35 && missingMetrics.length === 0) {
        return {
            status: CLAIM_STATUS.SUPPORTED,
            confidence: matchRatio >= 0.6 ? "HIGH" : "MEDIUM",
            matchRatio,
            missingMetrics,
            reason: "Key claim entities and metrics are substantiated by chunk content.",
        };
    }

    if (matchRatio >= 0.20 && missingMetrics.length <= 1) {
        return {
            status: CLAIM_STATUS.PARTIALLY_SUPPORTED,
            confidence: "MEDIUM",
            matchRatio,
            missingMetrics,
            reason: "Partial alignment between claim terminology and chunk content.",
        };
    }

    return {
        status: CLAIM_STATUS.UNSUPPORTED,
        confidence: "HIGH",
        matchRatio,
        missingMetrics,
        reason: `Insufficient factual overlap (overlap ratio: ${(matchRatio * 100).toFixed(0)}%).`,
    };
};

/**
 * Checks a claim against multiple cited sources combined.
 *
 * @param {object} claim - Claim object with text and sourceIds
 * @param {Map<string, object>} sourceMap - Trusted source map
 * @returns {{ status: string, confidence: string, verifiedSources: string[], unverifiedSources: string[], reason: string }}
 */
export const evaluateClaimAgainstSources = (claim, sourceMap) => {
    if (!claim.sourceIds || claim.sourceIds.length === 0) {
        return {
            status: claim.isFactual ? CLAIM_STATUS.UNSUPPORTED : CLAIM_STATUS.SUPPORTED,
            confidence: "LOW",
            verifiedSources: [],
            unverifiedSources: [],
            reason: claim.isFactual ? "Factual claim lacks source citations." : "Non-factual statement.",
        };
    }

    const verifiedSources = [];
    const unverifiedSources = [];
    let combinedContent = "";
    let hasConflict = false;

    for (const sid of claim.sourceIds) {
        const trusted = sourceMap.get(sid);
        if (!trusted) {
            unverifiedSources.push(sid);
            continue;
        }

        combinedContent += " " + (trusted.content || "");
        const evalResult = evaluateClaimAgainstChunk(claim.text, trusted.content);

        if (evalResult.status === CLAIM_STATUS.CONFLICTING) {
            hasConflict = true;
        }

        if (evalResult.status === CLAIM_STATUS.SUPPORTED || evalResult.status === CLAIM_STATUS.PARTIALLY_SUPPORTED) {
            verifiedSources.push(sid);
        } else {
            unverifiedSources.push(sid);
        }
    }

    if (hasConflict) {
        return {
            status: CLAIM_STATUS.CONFLICTING,
            confidence: "HIGH",
            verifiedSources,
            unverifiedSources,
            reason: "Contradictory evidence detected across cited sources.",
        };
    }

    // If individual chunks were partial, check if combined chunks support the claim
    if (verifiedSources.length === 0 && claim.sourceIds.length > 1 && combinedContent) {
        const combinedEval = evaluateClaimAgainstChunk(claim.text, combinedContent);
        if (combinedEval.status === CLAIM_STATUS.SUPPORTED) {
            return {
                status: CLAIM_STATUS.SUPPORTED,
                confidence: "HIGH",
                verifiedSources: claim.sourceIds.filter((sid) => sourceMap.has(sid)),
                unverifiedSources: claim.sourceIds.filter((sid) => !sourceMap.has(sid)),
                reason: "Claim is substantiated by the combined cited sources.",
            };
        }
    }

    if (verifiedSources.length === claim.sourceIds.length && unverifiedSources.length === 0) {
        return {
            status: CLAIM_STATUS.SUPPORTED,
            confidence: "HIGH",
            verifiedSources,
            unverifiedSources,
            reason: "All cited sources directly support the claim.",
        };
    }

    if (verifiedSources.length > 0) {
        return {
            status: CLAIM_STATUS.PARTIALLY_SUPPORTED,
            confidence: "MEDIUM",
            verifiedSources,
            unverifiedSources,
            reason: `Claim partially supported (${verifiedSources.length} of ${claim.sourceIds.length} sources verified).`,
        };
    }

    return {
        status: CLAIM_STATUS.UNSUPPORTED,
        confidence: "HIGH",
        verifiedSources: [],
        unverifiedSources,
        reason: "None of the cited sources contain evidence for this claim.",
    };
};

/**
 * Optional lightweight LLM-based verifier.
 * Executes structured claim-level verification with timeout and fallback to deterministic evaluation.
 *
 * @param {object} params
 * @param {Array<object>} params.claims - Extracted claims
 * @param {Map<string, object>} params.sourceMap - Trusted source map
 * @param {any} [params.verifierModel] - LangChain model instance
 * @param {number} [params.timeoutMs=3500] - Verifier timeout
 * @returns {Promise<Array<object>>} Array of evaluated claim assessments
 */
export const verifyClaimsWithLLM = async ({
    claims = [],
    sourceMap = new Map(),
    verifierModel = null,
    timeoutMs = 3500,
}) => {
    // 1. Run baseline deterministic evaluation first (always reliable)
    const baselineEvaluations = claims.map((claim) => {
        const res = evaluateClaimAgainstSources(claim, sourceMap);
        return {
            claimIndex: claim.claimIndex,
            text: claim.text,
            rawSegment: claim.rawSegment,
            sourceIds: claim.sourceIds,
            status: res.status,
            confidence: res.confidence,
            verifiedSources: res.verifiedSources,
            unverifiedSources: res.unverifiedSources,
            reason: res.reason,
        };
    });

    if (!verifierModel || claims.length === 0) {
        return baselineEvaluations;
    }

    // 2. Prepare lightweight payload with ONLY claims and cited chunk snippets
    const verificationItems = [];
    for (const claim of claims) {
        if (!claim.sourceIds || claim.sourceIds.length === 0) continue;
        for (const sid of claim.sourceIds) {
            const trusted = sourceMap.get(sid);
            if (trusted) {
                verificationItems.push({
                    claimIndex: claim.claimIndex,
                    claim: claim.text,
                    sourceId: sid,
                    evidence: (trusted.content || "").slice(0, 400),
                });
            }
        }
    }

    if (verificationItems.length === 0) {
        return baselineEvaluations;
    }

    const prompt = `You are a strict factual evidence verification engine.
Verify whether each claim is directly supported by its cited evidence snippet.

Evidence Pairs:
${JSON.stringify(verificationItems, null, 2)}

Respond ONLY with a STRICT JSON array of objects conforming to:
[
  {
    "claimIndex": number,
    "sourceId": string,
    "status": "SUPPORTED" | "UNSUPPORTED" | "CONFLICTING"
  }
]
No explanation, no chain-of-thought, no markdown formatting outside JSON.`;

    try {
        const invokePromise = verifierModel.invoke(prompt);
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Verifier timed out after ${timeoutMs}ms`)), timeoutMs)
        );

        const response = await Promise.race([invokePromise, timeoutPromise]);
        const textResponse = (typeof response?.content === "string" ? response.content : response?.text || "").trim();

        // Safe JSON parsing (strip ```json if present)
        const cleanJson = textResponse
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        const parsed = JSON.parse(cleanJson);
        if (!Array.isArray(parsed)) {
            return baselineEvaluations;
        }

        // Apply LLM assessments with conservative boundaries
        const finalEvaluations = [...baselineEvaluations];
        for (const item of parsed) {
            if (!item || typeof item !== "object") continue;
            // Validate sourceId against trusted sourceMap (reject LLM-invented source IDs)
            if (!sourceMap.has(item.sourceId)) continue;

            const targetIndex = finalEvaluations.findIndex((e) => e.claimIndex === item.claimIndex);
            if (targetIndex !== -1) {
                const evalItem = finalEvaluations[targetIndex];
                if (item.status === "CONFLICTING") {
                    evalItem.status = CLAIM_STATUS.CONFLICTING;
                } else if (item.status === "UNSUPPORTED" && evalItem.status === CLAIM_STATUS.SUPPORTED) {
                    evalItem.status = CLAIM_STATUS.UNSUPPORTED;
                    evalItem.verifiedSources = evalItem.verifiedSources.filter((s) => s !== item.sourceId);
                    if (!evalItem.unverifiedSources.includes(item.sourceId)) {
                        evalItem.unverifiedSources.push(item.sourceId);
                    }
                }
            }
        }

        return finalEvaluations;
    } catch {
        // Conservative fallback: On timeout, invalid JSON, or API error, return baseline evaluations
        return baselineEvaluations;
    }
};
