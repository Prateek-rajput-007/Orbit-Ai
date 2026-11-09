import {
  BrainCircuit,
  Code2,
  Eye,
  FileText,
  Presentation,
  Search,
} from "lucide-react"

export const AGENT_SHOWCASE = [
  {
    id: "coding",
    name: "Coding Agent",
    badge: "Interactive Code Sandbox",
    icon: Code2,
    tagline: "Full-stack code generation, debugging, and live preview artifacts.",
    description: "Build full components, refactor architectures, and run live interactive sandboxes with syntax-highlighted artifacts right in your canvas.",
    metric: "Live Sandbox & Preview",
    promptPreview: "Build a responsive analytics dashboard with live trend charts",
    demo: {
      type: "code",
      fileName: "AnalyticsDashboard.jsx",
      stats: "Compiled in 38ms • 0 errors • Live Sandbox",
      codeSnippet: `export function TrendAnalytics({ data }) {
  const [metric, setMetric] = useState('throughput')
  return (
    <div className="rounded-2xl border border-white/10 bg-night p-6">
      <div className="flex items-center justify-between pb-4">
        <span className="text-xs font-mono text-accent">● LIVE PREVIEW</span>
        <Badge variant="glow">Active Agent</Badge>
      </div>
      <LatencyChart points={data[metric]} color="#eabd58" />
    </div>
  )
}`,
    },
  },
  {
    id: "ppt",
    name: "Presentation Agent",
    badge: "Dynamic Slide Decks",
    icon: Presentation,
    tagline: "Turn ideas, research, or documents into structured slide decks.",
    description: "Orbit structures topics into engaging presentation slides with bulleted takeaways, presenter notes, and interactive slideshow navigation.",
    metric: "Interactive Slide Viewer",
    promptPreview: "Create a 6-slide deck on AI Multi-Agent Architecture",
    demo: {
      type: "slide",
      slideNumber: "02 / 06",
      topic: "System Architecture & Intent Routing",
      bullets: [
        "Dynamic router analyzes user query and attachment context",
        "Dispatches to specialized agent (Coding, PPT, PDF, Vision, Search)",
        "Streams artifacts directly into conversational canvas",
      ],
      tag: "Presentation Ready",
    },
  },
  {
    id: "search",
    name: "AI Web Search",
    badge: "Real-Time Intelligence",
    icon: Search,
    tagline: "Live web fact-checking and research with cited external sources.",
    description: "Extract current information, explore breaking technical developments, and verify claims with direct clickable citations.",
    metric: "Live Web & Citations",
    promptPreview: "What are the latest breakthroughs in agentic AI orchestration?",
    demo: {
      type: "search",
      query: "Agentic AI Orchestration Benchmarks 2026",
      sources: ["arxiv.org/abs/2604.1029", "deepmind.google/research", "github.com/agent-benchmark"],
      takeaway: "Multi-agent graph topologies improve task completion rates by 68% over monolithic LLM prompts.",
    },
  },
  {
    id: "pdf",
    name: "PDF Intelligence",
    badge: "Document Analysis & Cheat Sheets",
    icon: FileText,
    tagline: "Summarize complex papers and generate formatted PDF guides.",
    description: "Upload long PDF documents for semantic analysis, deep Q&A, and generate downloadable cheat sheets and interview handouts.",
    metric: "PDF Artifacts & Export",
    promptPreview: "Analyze this 30-page architecture document and build an interview cheat sheet",
    demo: {
      type: "pdf",
      title: "System_Architecture_Specs_v2.pdf",
      pages: "28 pages analyzed",
      sections: ["Core Microservices", "Agent State Machine", "Event Bus Latency"],
      badge: "Cheat Sheet Artifact Ready",
    },
  },
  {
    id: "vision",
    name: "Vision & Visuals",
    badge: "Multimodal Studio",
    icon: Eye,
    tagline: "Inspect diagrams, process visual documents, and generate imagery.",
    description: "Upload screenshots, diagrams, and photos for instant OCR and structural analysis, or generate visual concept art with the generative vision engine.",
    metric: "Diagram & Visual OCR",
    promptPreview: "Analyze this cloud infrastructure diagram and produce a deployment matrix",
    demo: {
      type: "vision",
      label: "Architecture_Topology.png",
      resolution: "2400 × 1350 px",
      detected: "4 microservices • Gateway • Redis Pub/Sub • MongoDB Cluster",
      status: "Diagram parsed successfully",
    },
  },
  {
    id: "router",
    name: "Autonomous Router",
    badge: "Zero-Friction Orchestration",
    icon: BrainCircuit,
    tagline: "Never switch modes manually. Orbit routes your intent automatically.",
    description: "Ask naturally. Orbit's neural routing layer inspects prompts and attachments to deploy the ideal specialist agent without mode configuration.",
    metric: "Autonomous Intent Routing",
    promptPreview: "Create a cheat sheet, write the code, and give me a slide deck",
    demo: {
      type: "router",
      query: "Build a slide deck and write the React code for our launch",
      stages: [
        { label: "Intent Parsing", status: "Done", time: "12ms" },
        { label: "PPT Agent Active", status: "Active", time: "Slides 1-6" },
        { label: "Coding Agent Pipeline", status: "Queued", time: "Next" },
      ],
    },
  },
]

export const CAPABILITY_PILLARS = [
  {
    icon: Code2,
    title: "Interactive Full-Stack Code Studio",
    description: "Generate, test, and edit real React, Node, and web code with live sandbox preview artifacts and instant export.",
    tag: "Artifacts & Sandbox",
  },
  {
    icon: Presentation,
    title: "Instant Presentation & Slide Decks",
    description: "Turn outlines and documents into professional multi-slide presentations with an interactive slide viewer.",
    tag: "Slide Deck Engine",
  },
  {
    icon: Search,
    title: "Real-Time Web Intelligence",
    description: "Live search queries and fact-checked synthesis with real citations from verified internet sources.",
    tag: "Live Citations",
  },
  {
    icon: FileText,
    title: "Deep PDF & Document Intelligence",
    description: "Chat with long documents, extract structured summaries, and generate downloadable PDF interview cheat sheets.",
    tag: "PDF Artifacts",
  },
  {
    icon: Eye,
    title: "Multimodal Vision & Concept Studio",
    description: "Understand complex diagrams, extract handwritten notes, and generate creative visual assets on demand.",
    tag: "Visual Understanding",
  },
  {
    icon: BrainCircuit,
    title: "Autonomous Agent Orchestration",
    description: "Zero mode toggling. Orbit routes prompts and attachments to the perfect specialist agent automatically.",
    tag: "Neural Routing",
  },
]

export const HERO_SCREENS = {
  coding: {
    id: "coding",
    icon: Code2,
    sidebarId: "coding",
    label: "Coding",
    prompt: "Build a modern dashboard with analytics charts",
    assistantLabel: "Here's your live dashboard artifact:",
    cardTitle: "TrendAnalytics.jsx",
    cardBadge: "Interactive",
    type: "chart",
    metricValue: "+38.4%",
    metricLabel: "Throughput",
  },
  search: {
    id: "search",
    icon: Search,
    sidebarId: "search",
    label: "Research",
    prompt: "What are the latest breakthroughs in agentic AI in 2026?",
    assistantLabel: "Synthesized live research from 3 verified web citations:",
    cardTitle: "WebIntelligence_Synthesis",
    cardBadge: "Live Citations",
    type: "search",
    sources: ["arxiv.org/abs/2604.1029", "deepmind.google/research"],
    summary: "Multi-agent graph topologies improve complex task completion rates by +68% over single prompts.",
    metricValue: "99.4%",
    metricLabel: "Confidence",
  },
  pdf: {
    id: "pdf",
    icon: FileText,
    sidebarId: "pdf",
    label: "Documents",
    prompt: "Analyze this 30-page architecture document",
    assistantLabel: "Parsed PDF & generated interview cheat sheet:",
    cardTitle: "System_Architecture_Specs.pdf",
    cardBadge: "Artifact Ready",
    type: "pdf",
    sections: ["01. Microservices Topology", "02. Intent Routing Layer", "03. Event Bus Latency"],
    metricValue: "28 Pages",
    metricLabel: "Analyzed",
  },
  ppt: {
    id: "ppt",
    icon: Presentation,
    sidebarId: "ppt",
    label: "Presentations",
    prompt: "Create a 6-slide deck on Multi-Agent Architecture",
    assistantLabel: "Interactive SlideDeckViewer ready (Slide 02/06):",
    cardTitle: "Deck_Architecture_2026.deck",
    cardBadge: "Slide 02 / 06",
    type: "ppt",
    slideTitle: "Autonomous Intent Routing & Synthesis",
    bullets: [
      "Dynamic router evaluates queries & attachments automatically",
      "Parallel synthesis across 6 specialized agents",
    ],
    metricValue: "6 Slides",
    metricLabel: "Deck Ready",
  },
  vision: {
    id: "vision",
    icon: Eye,
    sidebarId: "vision",
    label: "Vision",
    prompt: "Analyze this cloud infrastructure topology diagram",
    assistantLabel: "Visual OCR parsed 4 microservices from diagram:",
    cardTitle: "Architecture_Topology.png",
    cardBadge: "Parsed 2400×1350",
    type: "vision",
    detected: "Gateway • Redis Pub/Sub • MongoDB • 4 Microservices",
    status: "Structural topology valid • Ready to scaffold",
    metricValue: "100%",
    metricLabel: "OCR Accuracy",
  },
}

