import { useState } from "react"
import { deployArtifactRequest } from "../../features/conversations/conversationActions.js"

/**
 * Shared hook managing Netlify / cloud artifact deployments.
 * Eliminates duplicate state and API execution between CodeArtifactCard and CodeArtifactPanel.
 */
export function useArtifactDeployment(artifact, conversationId, messageId) {
  const [isDeploying, setIsDeploying] = useState(false)
  const [showDeployConfirm, setShowDeployConfirm] = useState(false)
  const [deploymentState, setDeploymentState] = useState(artifact?.deployment || null)
  const [deployNotice, setDeployNotice] = useState("")

  const triggerDeploy = async (provider = "netlify") => {
    setShowDeployConfirm(false)
    setIsDeploying(true)
    setDeployNotice("")

    try {
      const result = await deployArtifactRequest({
        conversationId,
        messageId,
        artifact,
        provider,
      })

      if (result.success && result.deploymentUrl) {
        setDeploymentState({
          status: "published",
          url: result.deploymentUrl,
          provider: result.provider || "Netlify",
          deployId: result.deployId,
          verified: result.verified,
          deployedAt: result.deployedAt,
        })
      } else if (result.status === "unconfigured") {
        setDeploymentState((prev) => ({ ...prev, status: "failed" }))
        setDeployNotice(result.error || "NETLIFY_AUTH_TOKEN is not configured in backend environment.")
      } else {
        setDeploymentState((prev) => ({ ...prev, status: "failed" }))
        setDeployNotice(result.error || "Deployment failed. Check server logs.")
      }
    } catch (err) {
      console.error("Deploy trigger failed:", err)
      const serverError =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "An error occurred while connecting to deployment service."
      setDeploymentState((prev) => ({ ...prev, status: "failed" }))
      setDeployNotice(serverError)
    } finally {
      setIsDeploying(false)
    }
  }

  const isDeployed = Boolean(
    (deploymentState?.status === "published" || deploymentState?.status === "deployed") &&
      deploymentState?.url
  )
  const isFailed = Boolean(deploymentState?.status === "failed")

  return {
    isDeploying,
    showDeployConfirm,
    setShowDeployConfirm,
    deploymentState,
    deployNotice,
    setDeployNotice,
    triggerDeploy,
    isDeployed,
    isFailed,
  }
}

export default useArtifactDeployment

