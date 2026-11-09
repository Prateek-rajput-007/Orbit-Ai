/**
 * Extracts plain text from various LLM response shapes (AIMessage, string, content arrays).
 * Supports LangChain string content and multimodal/block content arrays.
 *
 * @param {unknown} response - The response object or content from an LLM invocation.
 * @returns {string} - Clean extracted text string.
 */
export const extractText = (response) => {
    if (!response) return "";
    if (typeof response === "string") return response;
    if (Array.isArray(response.content)) {
        return response.content
            .map((item) => (typeof item === "string" ? item : item?.text ?? ""))
            .join("");
    }
    if (typeof response.content === "string") return response.content;
    return String(response.content ?? "");
};

export default extractText;
