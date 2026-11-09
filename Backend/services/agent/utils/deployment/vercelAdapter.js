import axios from "axios";

/**
 * Vercel Deployment Adapter.
 * Uses Vercel's REST API (/v13/deployments) to deploy static projects.
 */
export async function deployToVercel({ files = [], title = "orbit-project" }) {
    const token = process.env.VERCEL_TOKEN;
    if (!token) {
        return {
            success: false,
            status: "unconfigured",
            provider: "Vercel",
            error: "VERCEL_TOKEN is not configured in agent service environment.",
            instructions: "Create an access token at https://vercel.com/account/tokens and set VERCEL_TOKEN in Backend/services/agent/.env.",
        };
    }

    try {
        const safeName = `orbit-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30)}`;
        const vercelFiles = files.map((f) => ({
            file: f.path,
            data: Buffer.from(f.content, "utf8").toString("base64"),
            encoding: "base64",
        }));

        const teamId = process.env.VERCEL_TEAM_ID;
        const url = teamId
            ? `https://api.vercel.com/v13/deployments?teamId=${encodeURIComponent(teamId)}`
            : "https://api.vercel.com/v13/deployments";

        const response = await axios.post(
            url,
            {
                name: safeName,
                files: vercelFiles,
                projectSettings: {
                    framework: null,
                },
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                timeout: 30000,
            }
        );

        const data = response.data;
        const deploymentUrl = data.url ? `https://${data.url}` : null;

        return {
            success: true,
            status: "deployed",
            provider: "Vercel",
            deploymentUrl,
            deployId: data.id,
            verified: false,
            deployedAt: new Date().toISOString(),
        };
    } catch (error) {
        const status = error.response?.status;
        const errMsg = error.response?.data?.error?.message || error.message || "Vercel deployment failed";

        return {
            success: false,
            status: "failed",
            provider: "Vercel",
            statusCode: status,
            error: `Vercel API error (${status || "Network"}): ${errMsg}`,
        };
    }
}
