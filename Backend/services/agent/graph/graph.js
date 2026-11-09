import {StateGraph} from "@langchain/langgraph"
import {agentState} from  "./state.js"
import { router } from "./router.js"
import { chatAgent } from "../agents/chat-agent.js"
import { pptAgent } from "../agents/ppt-agent.js"
import { searchAgent } from "../agents/search-agent.js"
import { pdfAgent } from "../agents/pdf-agent.js"
import { codingAgent } from "../agents/coding-agent.js"
import { visionAgent } from "../agents/vision-agent.js"

const workflow = new StateGraph(agentState)

workflow.addNode("router",router)
workflow.addNode("chat",chatAgent)
workflow.addNode("search",searchAgent)
workflow.addNode("coding",codingAgent)
workflow.addNode("ppt",pptAgent)
workflow.addNode("vision", visionAgent)
workflow.addNode("pdf",pdfAgent)

workflow.addEdge("__start__","router")
workflow.addConditionalEdges("router",(state)=>{
    switch (state.agent){
        case "chat":
            return "chat";
        case "search":
            return "search";
        case "coding":
            return "coding";
        case "ppt":
            return "ppt";
        case "pdf":
            return "pdf";
        case "vision":
            return "vision"

        default:
            return "chat"
    }
},{
    chat:"chat",
    search:"search",
    coding:"coding",
    ppt:"ppt",
    vision:"vision",
    pdf:"pdf"
})

workflow.addEdge("chat","__end__")
workflow.addEdge("search","__end__")
workflow.addEdge("coding","__end__")
workflow.addEdge("pdf","__end__")
workflow.addEdge("ppt","__end__")
workflow.addEdge("vision","__end__")

export const graph = workflow.compile()
