import "dotenv/config"
import { TavilySearch } from "@langchain/tavily"

let searchTool

export const searchWeb = async (query, { includeImages = false } = {}) => {
    if (!process.env.TAVILY_API_KEY) {
        throw new Error("TAVILY_API_KEY is not configured")
    }

    searchTool ??= new TavilySearch({
        maxResults: 5,
        topic: "general",
        searchDepth: "basic",
        includeAnswer: false,
        includeRawContent: false,
    })

    const results = await searchTool.invoke({ query, includeImages })
    if (results.error) {
        throw new Error(`Tavily search failed: ${results.error}`)
    }

    return results
}
