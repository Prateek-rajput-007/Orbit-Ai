import api from "../../api/api.js";

/**
 * Fetches the paginated list of version metadata for a project.
 */
export const fetchProjectVersions = async (projectId) => {
  if (!projectId) return { versions: [], total: 0 };
  const { data } = await api.get(`/api/agent/projects/${encodeURIComponent(projectId)}/versions`);
  return data;
};

/**
 * Fetches the full snapshot details for a specific version.
 */
export const fetchProjectVersionDetails = async (projectId, versionNumber) => {
  if (!projectId || !versionNumber) return null;
  const { data } = await api.get(
    `/api/agent/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionNumber)}`
  );
  return data?.version || null;
};

/**
 * Restores an older version, creating a new forward version with its snapshot.
 */
export const restoreProjectVersionRequest = async (projectId, versionNumber, conversationId) => {
  const { data } = await api.post(
    `/api/agent/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionNumber)}/restore`,
    { conversationId }
  );
  return data;
};

/**
 * Compares two versions reporting added, modified, deleted, and unchanged files.
 */
export const compareProjectVersionsRequest = async (projectId, baseVersion, targetVersion) => {
  const { data } = await api.get(
    `/api/agent/projects/${encodeURIComponent(projectId)}/compare?base=${encodeURIComponent(baseVersion)}&target=${encodeURIComponent(targetVersion)}`
  );
  return data;
};

/**
 * Fetches all projects recorded in a conversation.
 */
export const fetchConversationProjects = async (conversationId) => {
  if (!conversationId) return { projects: [] };
  const { data } = await api.get(`/api/agent/projects/conversation/${encodeURIComponent(conversationId)}`);
  return data;
};

/**
 * Fetches the current active snapshot details for a project.
 */
export const fetchProjectCurrentDetails = async (projectId) => {
  if (!projectId) return null;
  const { data } = await api.get(`/api/agent/projects/${encodeURIComponent(projectId)}`);
  return data?.version || null;
};

