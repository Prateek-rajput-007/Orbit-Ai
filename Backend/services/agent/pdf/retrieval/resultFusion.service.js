export const DEFAULT_RRF_K = 60;
export const DEFAULT_FUSED_TOP_K = 6;

/**
 * Merges and ranks search results from multiple retrieval branches using Reciprocal Rank Fusion (RRF).
 *
 * Formula:
 *   RRF_Score(d) = Σ [ 1 / (k + rank_m(d)) ]
 *
 * Guarantees:
 * 1. Merges duplicate chunks using stable chunkId.
 * 2. Preserves raw vectorScore, keywordScore, vectorRank, and keywordRank for diagnostics.
 * 3. Enforces deterministic tie-breaking on equal RRF scores (pageStart ASC, chunkIndex ASC, chunkId ASC).
 * 4. Preserves full chunk metadata (pages, section, content, hashes).
 *
 * @param {Array<object>} vectorResults - Results from semantic vector search
 * @param {Array<object>} keywordResults - Results from keyword search ($text / textScore)
 * @param {object} [options] - Fusion options
 * @param {number} [options.k=60] - RRF constant factor (standard default: 60)
 * @param {number} [options.limit=6] - Max fused chunks to return
 * @returns {{ fusedResults: Array<object>, durationMs: number }}
 */
export const reciprocalRankFusion = (vectorResults = [], keywordResults = [], options = {}) => {
    const startTime = Date.now();
    const k = Math.max(1, options.k || DEFAULT_RRF_K);
    const limit = Math.max(1, options.limit || DEFAULT_FUSED_TOP_K);

    const chunkMap = new Map();

    // 1. Process Semantic Vector Results
    if (Array.isArray(vectorResults)) {
        vectorResults.forEach((item, index) => {
            if (!item || !item.chunkId) return;
            const rank = typeof item.vectorRank === "number" ? item.vectorRank : index + 1;
            const contribution = 1 / (k + rank);

            if (!chunkMap.has(item.chunkId)) {
                chunkMap.set(item.chunkId, {
                    ...item,
                    vectorScore: typeof item.score === "number" ? item.score : 0,
                    vectorRank: rank,
                    keywordScore: 0,
                    keywordRank: null,
                    rrfScore: contribution,
                    sources: ["vector"],
                });
            } else {
                const existing = chunkMap.get(item.chunkId);
                existing.vectorScore = typeof item.score === "number" ? item.score : existing.vectorScore;
                existing.vectorRank = rank;
                existing.rrfScore += contribution;
                if (!existing.sources.includes("vector")) existing.sources.push("vector");
            }
        });
    }

    // 2. Process Keyword Results ($text / textScore)
    if (Array.isArray(keywordResults)) {
        keywordResults.forEach((item, index) => {
            if (!item || !item.chunkId) return;
            const rank = typeof item.keywordRank === "number" ? item.keywordRank : index + 1;
            const contribution = 1 / (k + rank);

            if (!chunkMap.has(item.chunkId)) {
                chunkMap.set(item.chunkId, {
                    ...item,
                    vectorScore: 0,
                    vectorRank: null,
                    keywordScore: typeof item.score === "number" ? item.score : 0,
                    keywordRank: rank,
                    rrfScore: contribution,
                    sources: ["keyword"],
                });
            } else {
                const existing = chunkMap.get(item.chunkId);
                existing.keywordScore = typeof item.score === "number" ? item.score : existing.keywordScore;
                existing.keywordRank = rank;
                existing.rrfScore += contribution;
                if (!existing.sources.includes("keyword")) existing.sources.push("keyword");
            }
        });
    }

    // 3. Sort deterministically by RRF score (DESC), then pageStart (ASC), chunkIndex (ASC), chunkId (ASC)
    const fusedList = Array.from(chunkMap.values());
    fusedList.sort((a, b) => {
        // High score first (precision 6 decimals to avoid float jitter)
        const diff = Math.round(b.rrfScore * 1e6) - Math.round(a.rrfScore * 1e6);
        if (diff !== 0) return diff;

        // Deterministic tie-breaking
        if (a.pageStart !== b.pageStart) return a.pageStart - b.pageStart;
        if (a.chunkIndex !== b.chunkIndex) return a.chunkIndex - b.chunkIndex;
        return String(a.chunkId).localeCompare(String(b.chunkId));
    });

    // 4. Assign 1-based final hybrid rank
    const fusedResults = fusedList.slice(0, limit).map((chunk, idx) => ({
        ...chunk,
        hybridRank: idx + 1,
        rrfScore: Number(chunk.rrfScore.toFixed(6)),
    }));

    return {
        fusedResults,
        durationMs: Date.now() - startTime,
    };
};

