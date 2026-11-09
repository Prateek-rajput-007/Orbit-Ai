import { useEffect, useRef, useState } from "react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  FileText,
  Globe2,
  Home,
  Layers,
  Loader2,
  MessageSquare,
  Monitor,
  Orbit,
  Presentation,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react"
import AssistantOrb from "./chat/AssistantOrb.jsx"

// Official Google "G" Logo
function GoogleIcon({ className = "size-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}

// Premium SaaS Google Authentication CTA Component
function GoogleAuthButton({
  onSignIn,
  isSigningIn = false,
  disabled = false,
  variant = "default",
  className = "",
}) {
  const isDisabled = disabled || isSigningIn

  const handleClick = (e) => {
    if (isDisabled) {
      e.preventDefault()
      return
    }
    onSignIn?.(e)
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={isDisabled}
        aria-busy={isSigningIn}
        aria-label={isSigningIn ? "Connecting to Google…" : "Continue with Google"}
        className={`group relative inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/15 border-t-white/25 bg-white/[0.06] px-4 text-xs font-medium text-white/90 shadow-sm backdrop-blur-md transition-all duration-150 ease-out hover:border-amber-400/50 hover:bg-white/[0.10] hover:text-white hover:shadow-md hover:shadow-amber-500/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080a] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none ${className}`}
      >
        {isSigningIn ? (
          <>
            <Loader2 className="size-3.5 shrink-0 animate-spin text-amber-400" aria-hidden="true" />
            <span>Connecting…</span>
          </>
        ) : (
          <>
            <GoogleIcon className="size-3.5 shrink-0" />
            <span>Sign in</span>
            <ArrowRight
              className="size-3 shrink-0 text-amber-400/70 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-amber-400"
              aria-hidden="true"
            />
          </>
        )}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isDisabled}
      aria-busy={isSigningIn}
      aria-label={isSigningIn ? "Connecting to Google…" : "Continue with Google"}
      className={`group relative inline-flex h-11 sm:h-12 w-full items-center justify-center gap-3 rounded-full border border-white/[0.14] border-t-white/[0.28] bg-gradient-to-b from-white/[0.09] to-white/[0.04] px-6 text-[14.5px] sm:text-[15px] font-medium text-white shadow-[0_4px_20px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md transition-all duration-200 ease-out hover:border-amber-400/60 hover:bg-white/[0.11] hover:shadow-[0_0_32px_rgba(234,189,88,0.22),0_4px_24px_rgba(0,0,0,0.7)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.985] active:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#07080a] disabled:cursor-not-allowed disabled:opacity-50 disabled:translate-y-0 disabled:scale-100 disabled:shadow-none disabled:hover:bg-white/[0.06] disabled:hover:border-white/10 ${className}`}
    >
      {isSigningIn ? (
        <>
          <Loader2 className="size-4 sm:size-5 shrink-0 animate-spin text-amber-400" aria-hidden="true" />
          <span>Connecting to Google…</span>
        </>
      ) : (
        <>
          <GoogleIcon className="size-4 sm:size-5 shrink-0" />
          <span className="tracking-tight text-white/95">Continue with Google</span>
          <ArrowRight
            className="size-4 shrink-0 text-amber-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-amber-300"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  )
}

// 6 Core Agents directly implemented in Orbit's backend router
const AGENT_SHOWCASE = [
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

const CAPABILITY_PILLARS = [
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

// 5 Interactive Experience Screens for the 3D Hero Tablet Mockup
const HERO_SCREENS = {
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

function SignIn({ error, isSigningIn, onSignIn }) {
  const reduceMotion = useReducedMotion()
  const [activeTabId, setActiveTabId] = useState("coding")
  const [autoRotate, setAutoRotate] = useState(true)

  // Interactive 3D Hero Tablet state with auto-cycle & 10s pause on click
  const [heroTabId, setHeroTabId] = useState("coding")
  const [heroAutoPlay, setHeroAutoPlay] = useState(true)
  const [isHeroHovered, setIsHeroHovered] = useState(false)
  const [timerKey, setTimerKey] = useState(0)
  const resumeTimeoutRef = useRef(null)

  // Handle user manual click: pause for 10 seconds, then resume auto-cycling
  const handleHeroSelect = (id) => {
    setHeroTabId(id)
    setHeroAutoPlay(false)
    setTimerKey((k) => k + 1)

    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current)
    }

    resumeTimeoutRef.current = setTimeout(() => {
      setHeroAutoPlay(true)
      setTimerKey((k) => k + 1)
      resumeTimeoutRef.current = null
    }, 10000)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current)
      }
    }
  }, [])

  // Auto-cycle through the 5 capabilities every 10s (6s typing/thinking + last 4s full output)
  useEffect(() => {
    if (!heroAutoPlay || isHeroHovered) return
    const keys = ["coding", "search", "pdf", "ppt", "vision"]
    const timer = setInterval(() => {
      setHeroTabId((curr) => {
        const nextIdx = (keys.indexOf(curr) + 1) % keys.length
        return keys[nextIdx]
      })
      setTimerKey((k) => k + 1)
    }, 10000)
    return () => clearInterval(timer)
  }, [heroAutoPlay, isHeroHovered])

  // Live Typing & Cascading Simulation: 10s total cycle (0-5.4s typing, 5.4-7s thinking, last 3s full output show)
  const [typedPrompt, setTypedPrompt] = useState("")
  const [tabletPhase, setTabletPhase] = useState("typing") // "typing" | "thinking" | "ready"

  useEffect(() => {
    const fullText = HERO_SCREENS[heroTabId]?.prompt || ""
    setTypedPrompt("")
    setTabletPhase("typing")

    let currentLength = 0
    let thinkTimer = null
    // Prompt types out naturally across ~5.4 seconds
    const charInterval = Math.max(30, Math.floor(5400 / (fullText.length || 1)))

    const typingTimer = setInterval(() => {
      currentLength++
      setTypedPrompt(fullText.slice(0, currentLength))

      if (currentLength >= fullText.length) {
        clearInterval(typingTimer)
        setTabletPhase("thinking")

        // Agent neural routing takes 1.6 seconds, reaching full output show at exactly 7.0s (last 3s)
        thinkTimer = setTimeout(() => {
          setTabletPhase("ready")
        }, 1600)
      }
    }, charInterval)

    return () => {
      clearInterval(typingTimer)
      if (thinkTimer) clearTimeout(thinkTimer)
    }
  }, [heroTabId])

  // Subtle auto-rotation of showcase tabs every 6 seconds to give instant comprehension
  useEffect(() => {
    if (!autoRotate) return
    const timer = setInterval(() => {
      setActiveTabId((current) => {
        const currentIndex = AGENT_SHOWCASE.findIndex((item) => item.id === current)
        const nextIndex = (currentIndex + 1) % AGENT_SHOWCASE.length
        return AGENT_SHOWCASE[nextIndex].id
      })
    }, 6000)
    return () => clearInterval(timer)
  }, [autoRotate])

  const activeAgent = AGENT_SHOWCASE.find((a) => a.id === activeTabId) || AGENT_SHOWCASE[0]

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[#07080a] text-ink selection:bg-amber-400/25 selection:text-amber-100">
      {/* Ambient background lighting and subtle starfield/radial glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 overflow-hidden"
      >
        {/* Top amber atmospheric spotlight */}
        <div className="absolute -top-32 left-1/2 h-[550px] w-[880px] -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-500/12 via-amber-600/5 to-transparent blur-[140px]" />
        {/* Subtle secondary ambient glows */}
        <div className="absolute top-[40%] -left-48 h-[500px] w-[500px] rounded-full bg-amber-600/5 blur-[160px]" />
        <div className="absolute top-[65%] -right-48 h-[600px] w-[600px] rounded-full bg-amber-400/5 blur-[180px]" />
        {/* Ultra-subtle grid texture */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)]" />
      </div>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#07080a]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
          {/* Logo & Brand Identity */}
          <div className="flex items-center gap-3">
            <div className="relative grid size-9 place-items-center rounded-xl border border-accent-border bg-accent-soft text-accent shadow-sm shadow-accent/20">
              <Orbit size={18} strokeWidth={2} />
              <span className="absolute -inset-1 -z-10 rounded-xl bg-accent/20 blur-md" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-display text-xl font-bold tracking-tight text-ink">
                Orbit
              </span>
              <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted sm:inline-block">
                Autonomous AI Platform
              </span>
            </div>
          </div>

          {/* Quick System Status & Sign-in CTA */}
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-muted-soft md:flex">
              <span className="size-2 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/80 animate-pulse" />
              <span className="text-[11px] text-muted">All 6 Agents Operational</span>
            </div>

            <GoogleAuthButton
              variant="compact"
              onSignIn={onSignIn}
              isSigningIn={isSigningIn}
            />
          </div>
        </div>
      </header>

      {/* Error Notice Banner if authentication failed */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="border-b border-red-500/20 bg-red-950/60 px-5 py-3 text-center text-xs text-red-200 backdrop-blur-md"
            role="alert"
          >
            <div className="mx-auto flex max-w-3xl items-center justify-center gap-2">
              <ShieldCheck className="size-4 text-red-400" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="relative z-10 mx-auto max-w-7xl px-5 py-12 sm:px-8 sm:py-20">
        {/* =========================================================================
            1. HERO SECTION: Positioning, Value Proposition & Immediate Auth CTA
            ========================================================================= */}
        <section className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-12 lg:gap-12 xl:gap-16">
          {/* Left Column: Positioning, Value Proposition & Google Sign-In */}
          <div className="flex flex-col items-center text-center lg:col-span-6 lg:items-start lg:text-left justify-center max-w-xl">
            {/* Eyebrow Pill */}
            <div className="inline-flex items-center gap-2 rounded-full border border-accent-border/60 bg-accent-soft px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent backdrop-blur-md shadow-sm shadow-accent/10">
              <span className="size-1.5 rounded-full bg-accent shadow-sm shadow-accent" />
              Autonomous Multi-Agent Workspace
            </div>

            {/* Core Positioning Headline - Refined editorial scale */}
            <h1 className="mt-5 font-display text-[2.35rem] font-semibold leading-[1.14] tracking-tight sm:text-4xl lg:text-[2.65rem] xl:text-[2.85rem] lg:leading-[1.12]">
              <span className="block text-ink">One workspace.</span>
              <span className="block font-normal text-ink/55">Multiple AI capabilities.</span>
              <span className="mt-1 block text-[#eabd58]">Built to create more.</span>
            </h1>

            {/* Subtitle */}
            <p className="mt-4 max-w-[440px] text-sm leading-relaxed text-muted sm:text-[14.5px] sm:leading-[1.6]">
              Everything you need to explore ideas, build projects, and get things done in one place.
            </p>

            {/* Capability Pills (Compact, well-spaced within left column + 10s Progress Bar) */}
            <div className="mt-6 flex flex-wrap items-center justify-center lg:justify-start gap-2 max-w-[430px]">
              {[
                { id: "coding", icon: Code2, label: "Coding" },
                { id: "search", icon: Search, label: "Research" },
                { id: "pdf", icon: FileText, label: "Documents" },
                { id: "ppt", icon: Presentation, label: "Presentations" },
                { id: "vision", icon: Eye, label: "Vision" },
              ].map(({ id, icon: Icon, label }) => {
                const isActive = heroTabId === id
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => handleHeroSelect(id)}
                    className={`group relative overflow-hidden inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11.5px] font-medium shadow-sm backdrop-blur-sm transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "border border-amber-400/90 bg-amber-400/15 text-white shadow-md shadow-amber-500/20 ring-1 ring-amber-400/40"
                        : "border border-white/10 bg-white/[0.04] text-white/70 hover:border-amber-400/40 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    <Icon size={13} className={isActive ? "text-[#eabd58]" : "text-[#eabd58]/80"} aria-hidden="true" />
                    <span>{label}</span>

                    {/* Active Pill 10s Golden Progress Bar */}
                    {isActive && (
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden rounded-b-full bg-amber-400/25">
                        <span
                          key={`${id}-${timerKey}-${heroAutoPlay ? "auto" : "paused"}`}
                          className="block h-full bg-gradient-to-r from-amber-400 via-amber-300 to-amber-200 origin-left"
                          style={{
                            animation: "heroPillProgress 10s linear forwards",
                          }}
                        />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Primary Authentication Action Area */}
            <div className="mt-7 flex w-full max-w-md flex-col items-center lg:items-start gap-3">
              <div className="w-full max-w-[340px] sm:max-w-[360px]">
                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.98 }}
                      transition={{ duration: 0.18 }}
                      role="alert"
                      aria-live="polite"
                      className="mb-3 flex w-full items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-950/35 px-3.5 py-2.5 text-xs text-red-200 backdrop-blur-md"
                    >
                      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden="true" />
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <GoogleAuthButton onSignIn={onSignIn} isSigningIn={isSigningIn} />
              </div>
            </div>
          </div>

          {/* Right Column: 3D Product Showcase Tablet (Interactive Multi-Experience Mode) */}
          <div className="relative mx-auto w-full max-w-lg lg:col-span-6 lg:max-w-none flex flex-col items-center justify-center lg:items-end">
            {/* Ambient Warm Golden Haze in background */}
            <div className="absolute -inset-10 -z-10 rounded-full bg-amber-500/15 blur-[130px]" />
            <div className="absolute -right-8 top-1/4 -z-10 h-72 w-72 rounded-full bg-amber-600/10 blur-[100px]" />

            {/* 3D Scene Wrapper with Perspective & Auto-Cycle Pause on Hover */}
            <div
              onMouseEnter={() => setIsHeroHovered(true)}
              onMouseLeave={() => setIsHeroHovered(false)}
              className="relative w-full max-w-[490px] py-6 sm:py-10 [perspective:1400px]"
            >
              {/* Realistic Tablet Hardware Shell */}
              <div
                className="relative z-10 overflow-hidden rounded-[2.4rem] border border-amber-500/30 bg-gradient-to-b from-[#22242e] via-[#12131a] to-[#090a0f] p-[8px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_10px_40px_rgba(234,189,88,0.12)] transition-all duration-500 ease-out hover:[transform:rotateY(-3deg)_rotateX(2deg)_translateY(-6px)] hover:shadow-[0_30px_70px_-10px_rgba(0,0,0,0.98),0_15px_50px_rgba(234,189,88,0.2)]"
                style={{
                  transform: "rotateY(-7deg) rotateX(4deg)",
                  transformStyle: "preserve-3d",
                }}
              >
                {/* Specular Metallic Bezel Highlight */}
                <div className="absolute inset-0 pointer-events-none rounded-[2.4rem] ring-1 ring-inset ring-white/[0.12]" />

                {/* Inner Screen Surface */}
                <div className="relative overflow-hidden rounded-[1.9rem] bg-[#07080c] text-white">
                  {/* Top Bar with Orbit Logo + Live Workspace Indicator */}
                  <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0c0d12] px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="grid size-6 place-items-center rounded-lg border border-amber-400/30 bg-amber-400/10 text-accent">
                        <Orbit size={13} strokeWidth={2.5} />
                      </div>
                      <span className="font-display text-xs font-semibold text-white tracking-wide">Orbit</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="hidden sm:flex items-center gap-1 rounded-full bg-white/[0.04] border border-white/10 px-2 py-0.5 text-[9px] text-white/50">
                        <span className="capitalize text-accent font-medium">{heroTabId}</span>
                        <span>mode</span>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-0.5 text-[9px] font-semibold text-emerald-400 tracking-wider">
                        <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        LIVE WORKSPACE
                      </div>
                    </div>
                  </div>

                  {/* Tablet Body: Left Clickable Icon Rail + Dynamic Multi-Experience Canvas */}
                  <div className="flex min-h-[350px]">
                    {/* Minimalist Interactive Icon Sidebar */}
                    <div className="flex flex-col items-center gap-3.5 border-r border-white/[0.06] bg-[#06070a] px-3.5 py-4">
                      {[
                        { id: "home", icon: Home, label: "Home / Overview" },
                        { id: "coding", icon: MessageSquare, label: "Code & Build" },
                        { id: "search", icon: Search, label: "Research" },
                        { id: "pdf", icon: FileText, label: "Documents" },
                        { id: "ppt", icon: Monitor, label: "Presentations" },
                        { id: "vision", icon: Eye, label: "Vision Studio" },
                      ].map(({ id, icon: Icon, label }) => {
                        const isTabActive = heroTabId === id || (id === "home" && heroTabId === "coding")
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => handleHeroSelect(id === "home" ? "coding" : id)}
                            title={label}
                            aria-label={label}
                            className={`grid size-7 place-items-center rounded-lg transition-all duration-200 cursor-pointer ${
                              isTabActive
                                ? "border border-amber-400/50 bg-amber-400/20 text-accent shadow-sm shadow-amber-400/30 ring-1 ring-amber-400/40"
                                : "text-white/30 hover:text-white/70 hover:bg-white/5"
                            }`}
                          >
                            <Icon size={13} />
                          </button>
                        )
                      })}
                    </div>

                    {/* Dynamic Main Showcase Canvas with Live Typing & Cascading AI Reveal */}
                    <div className="flex flex-1 flex-col justify-between p-4 sm:p-5 gap-3.5">
                      {(() => {
                        const currentScreen = HERO_SCREENS[heroTabId] || HERO_SCREENS.coding
                        return (
                          <div className="flex flex-1 flex-col justify-between gap-3.5">
                            {/* Top: User Prompt Bubble with Live Typing Cursor */}
                            <div className="flex items-center justify-end gap-2.5 min-h-[32px]">
                              <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[11px] text-white/90 shadow-sm font-medium line-clamp-1 max-w-[85%] flex items-center">
                                <span>{typedPrompt || "\u00A0"}</span>
                                {tabletPhase === "typing" && (
                                  <span className="ml-1 inline-block h-3 w-1 rounded-sm bg-amber-400 animate-pulse" />
                                )}
                              </div>
                              <div className="grid size-6 shrink-0 place-items-center rounded-full border border-amber-400/40 bg-amber-400/20 text-[10px] font-bold text-[#eabd58]">
                                U
                              </div>
                            </div>

                            {/* Middle: AI Response Indicator with 3-Phase State */}
                            <div className="flex items-center gap-2 pt-0.5 text-[11px] min-h-[24px]">
                              {tabletPhase === "typing" ? (
                                <div className="flex items-center gap-2 text-white/40">
                                  <div className="grid size-5 shrink-0 place-items-center rounded-full border border-white/10 bg-white/5 text-white/30">
                                    <Orbit size={11} />
                                  </div>
                                  <span className="font-mono text-[10px] text-white/40">Listening for user prompt...</span>
                                </div>
                              ) : tabletPhase === "thinking" ? (
                                <div className="flex items-center gap-2 text-amber-300">
                                  <div className="grid size-5 shrink-0 place-items-center rounded-full border border-amber-400/40 bg-amber-400/20 text-accent shadow-sm shadow-amber-400/30">
                                    <Sparkles size={11} className="animate-spin" style={{ animationDuration: "2s" }} />
                                  </div>
                                  <span className="font-mono text-[10.5px] text-amber-300 flex items-center gap-1.5">
                                    <span>Routing to {currentScreen.label} Agent</span>
                                    <span className="inline-flex gap-0.5">
                                      <span className="size-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
                                      <span className="size-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
                                      <span className="size-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
                                    </span>
                                  </span>
                                </div>
                              ) : (
                                <motion.div
                                  initial={{ opacity: 0, y: 3 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="flex items-center gap-2 text-white/70"
                                >
                                  <div className="grid size-5 shrink-0 place-items-center rounded-full border border-amber-400/30 bg-amber-400/15 text-accent shadow-sm shadow-amber-400/20">
                                    <Orbit size={11} />
                                  </div>
                                  <span className="font-medium text-white/85 line-clamp-1">
                                    {currentScreen.assistantLabel}
                                  </span>
                                </motion.div>
                              )}
                            </div>

                            {/* Hero Artifact Card with Staggered Cascading Bloom on Ready */}
                            <AnimatePresence mode="wait">
                              {tabletPhase === "ready" ? (
                                <motion.div
                                  key={`card-${currentScreen.id}`}
                                  initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
                                  animate={{ opacity: 1, y: 0, scale: 1 }}
                                  exit={reduceMotion ? false : { opacity: 0, y: -6 }}
                                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                                  className="rounded-2xl border border-white/[0.09] bg-[#0c0d12]/95 p-4 shadow-xl flex flex-col justify-between min-h-[160px]"
                                >
                                  {/* Artifact Card Header */}
                                  <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.05]">
                                    <div className="flex items-center gap-2">
                                      <span className="size-2 rounded-full bg-[#eabd58] shadow-sm shadow-amber-400/80" />
                                      <span className="font-mono text-xs font-semibold text-white/90 tracking-wide line-clamp-1">
                                        {currentScreen.cardTitle}
                                      </span>
                                    </div>
                                    <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                      {currentScreen.cardBadge}
                                    </div>
                                  </div>

                                  {/* Dynamic Center Content per Capability */}
                                  <div className="py-2.5 flex-1 flex flex-col justify-center">
                                    {/* 1. Coding: Golden Wave Chart */}
                                    {currentScreen.type === "chart" && (
                                      <svg
                                        className="w-full overflow-visible"
                                        height="52"
                                        viewBox="0 0 260 52"
                                        preserveAspectRatio="none"
                                        aria-hidden="true"
                                      >
                                        <defs>
                                          <linearGradient id="heroTrendWaveGrad" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#eabd58" stopOpacity="0.45" />
                                            <stop offset="60%" stopColor="#eabd58" stopOpacity="0.12" />
                                            <stop offset="100%" stopColor="#eabd58" stopOpacity="0.0" />
                                          </linearGradient>
                                        </defs>
                                        <path
                                          d="M 0 38 C 40 36 70 28 110 30 C 145 32 165 40 190 20 C 215 4 235 8 260 12 L 260 52 L 0 52 Z"
                                          fill="url(#heroTrendWaveGrad)"
                                        />
                                        <path
                                          d="M 0 38 C 40 36 70 28 110 30 C 145 32 165 40 190 20 C 215 4 235 8 260 12"
                                          fill="none"
                                          stroke="#eabd58"
                                          strokeWidth="2.4"
                                          strokeLinecap="round"
                                        />
                                      </svg>
                                    )}

                                    {/* 2. Research: Citations + Synthesis */}
                                    {currentScreen.type === "search" && (
                                      <div className="space-y-2">
                                        <div className="flex flex-wrap gap-1.5">
                                          {currentScreen.sources.map((src, i) => (
                                            <span
                                              key={i}
                                              className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[9.5px] font-mono text-accent"
                                            >
                                              <ExternalLink size={9} />
                                              {src}
                                            </span>
                                          ))}
                                        </div>
                                        <p className="text-[10.5px] text-white/80 leading-snug rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                                          &ldquo;{currentScreen.summary}&rdquo;
                                        </p>
                                      </div>
                                    )}

                                    {/* 3. Documents: PDF Cheat Sheet */}
                                    {currentScreen.type === "pdf" && (
                                      <div className="space-y-1.5">
                                        <div className="grid grid-cols-3 gap-1.5">
                                          {currentScreen.sections.map((sec, i) => (
                                            <div
                                              key={i}
                                              className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-center"
                                            >
                                              <span className="block text-[8px] font-mono text-accent">SEC 0{i + 1}</span>
                                              <span className="block text-[9.5px] font-medium text-white/90 truncate">
                                                {sec.replace(/^\d+\.\s*/, "")}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                        <div className="text-[9.5px] text-amber-200/90 flex items-center justify-between pt-1">
                                          <span className="flex items-center gap-1">
                                            <CheckCircle2 size={10} className="text-accent" />
                                            Cheat sheet generated
                                          </span>
                                          <span className="text-[9px] text-white/40">Ready to export</span>
                                        </div>
                                      </div>
                                    )}

                                    {/* 4. Presentations: Slide Viewer */}
                                    {currentScreen.type === "ppt" && (
                                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-2.5">
                                        <div className="flex items-center justify-between pb-1">
                                          <span className="text-[10px] font-semibold text-white/90">
                                            {currentScreen.slideTitle}
                                          </span>
                                          <span className="text-[8.5px] font-mono text-accent">SLIDE 02</span>
                                        </div>
                                        <ul className="space-y-1 text-[9.5px] text-white/70">
                                          {currentScreen.bullets.map((b, i) => (
                                            <li key={i} className="truncate">
                                              {b}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    )}

                                    {/* 5. Vision: OCR Topology Terminal */}
                                    {currentScreen.type === "vision" && (
                                      <div className="rounded-xl border border-white/10 bg-[#06070a] p-2.5 font-mono text-[9.5px] space-y-1">
                                        <p className="text-accent truncate">&gt; {currentScreen.detected}</p>
                                        <p className="text-emerald-400 truncate">&gt; {currentScreen.status}</p>
                                      </div>
                                    )}
                                  </div>

                                  {/* Artifact Card Footer: Equalizer or Tool Indicator + Metric */}
                                  <div className="flex items-end justify-between pt-2 border-t border-white/[0.06]">
                                    {currentScreen.type === "chart" ? (
                                      <div className="flex items-end gap-1 h-5">
                                        {[25, 45, 38, 62, 50, 95, 80].map((h, i) => (
                                          <div
                                            key={i}
                                            className="w-1.5 rounded-t-sm"
                                            style={{
                                              height: `${h}%`,
                                              background: i >= 5 ? "#eabd58" : "rgba(234, 189, 88, 0.4)",
                                            }}
                                          />
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-[10px] font-mono text-white/40 flex items-center gap-1.5">
                                        <span className="size-1 rounded-full bg-accent" />
                                        Live Orchestrated Artifact
                                      </span>
                                    )}
                                    <div className="text-right">
                                      <div className="font-mono text-xs font-bold text-[#eabd58] leading-none">
                                        {currentScreen.metricValue}
                                      </div>
                                      <div className="text-[8.5px] text-white/40 pt-0.5 tracking-wider uppercase font-medium">
                                        {currentScreen.metricLabel}
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              ) : (
                                <motion.div
                                  key="card-skeleton"
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.15 }}
                                  className="rounded-2xl border border-white/[0.05] bg-[#0c0d12]/60 p-4 shadow-xl flex flex-col justify-between min-h-[160px] relative overflow-hidden backdrop-blur-sm"
                                >
                                  <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.04]">
                                    <div className="flex items-center gap-2">
                                      <span className="size-2 rounded-full bg-white/20 animate-pulse" />
                                      <div className="h-3 w-28 rounded bg-white/[0.07] animate-pulse" />
                                    </div>
                                    <div className="h-4 w-20 rounded-full bg-white/[0.05] animate-pulse" />
                                  </div>
                                  <div className="space-y-2 py-4">
                                    <div className="h-2.5 w-3/4 rounded bg-white/[0.05] animate-pulse" />
                                    <div className="h-2.5 w-1/2 rounded bg-white/[0.04] animate-pulse" />
                                  </div>
                                  <div className="flex items-center justify-between pt-1">
                                    <div className="h-2 w-24 rounded bg-white/[0.04]" />
                                    <div className="h-2 w-14 rounded bg-white/[0.04]" />
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </div>
              </div>

              {/* Apple-Style Stage Pedestal Floor Glow */}
              <div
                aria-hidden="true"
                className="pointer-events-none h-4 w-3/4 mx-auto bg-gradient-to-b from-amber-400/10 via-amber-500/5 to-transparent blur-md -mt-1 opacity-70 rounded-full"
              />
            </div>
          </div>
        </section>

        {/* Subtle Horizontal Divider Bridge */}
        <div className="my-10 sm:my-14 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden="true" />

        {/* =========================================================================
            2. INTERACTIVE 5-SECOND SHOWCASE: Experience the Agents in Action
            ========================================================================= */}
        <section
          className="mt-0"
          onMouseEnter={() => setAutoRotate(false)}
          onMouseLeave={() => setAutoRotate(true)}
          aria-label="Orbit Capabilities Showcase"
        >
          <div className="mx-auto max-w-7xl">
            {/* Header for Showcase */}
            <div className="mb-5 flex flex-col items-center justify-between gap-3 text-center sm:flex-row sm:text-left">
              <div>
                <p className="text-micro font-semibold uppercase tracking-widest text-accent">
                  Interactive Platform Preview
                </p>
                <h2 className="font-display text-2xl font-medium tracking-tight text-ink sm:text-3xl">
                  Inspect Orbit&apos;s specialized agents
                </h2>
              </div>
              <p className="text-xs text-muted-soft">
                Hover to explore • Click to inspect each agent&apos;s output
              </p>
            </div>

            {/* Agent Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-2 backdrop-blur-md sm:grid-cols-3 lg:grid-cols-6">
              {AGENT_SHOWCASE.map((agent) => {
                const Icon = agent.icon
                const isActive = agent.id === activeTabId
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => {
                      setActiveTabId(agent.id)
                      setAutoRotate(false)
                    }}
                    className={`relative flex flex-col items-start rounded-xl p-3 text-left transition-all ${isActive
                      ? "bg-white/[0.08] border border-accent-border/60 shadow-lg shadow-black/40"
                      : "hover:bg-white/[0.04] border border-transparent text-muted"
                      }`}
                  >
                    <div className="flex w-full items-center justify-between pb-2">
                      <div
                        className={`grid size-8 place-items-center rounded-lg border ${isActive
                          ? "border-accent-border bg-accent-soft text-accent"
                          : "border-white/10 bg-white/5 text-muted-soft"
                          }`}
                      >
                        <Icon size={16} />
                      </div>
                      {isActive && (
                        <span className="size-1.5 rounded-full bg-accent shadow-sm shadow-accent" />
                      )}
                    </div>
                    <span
                      className={`text-xs font-semibold ${isActive ? "text-ink" : "text-muted"
                        }`}
                    >
                      {agent.name}
                    </span>
                    <span className="mt-0.5 line-clamp-1 text-[10px] text-muted-soft">
                      {agent.metric}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Interactive Preview Canvas */}
            <div className="relative mt-4 overflow-hidden rounded-3xl border border-white/10 bg-[#0c0d12]/90 p-5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:p-8">
              {/* Top Bar for active agent preview */}
              <div className="flex flex-col items-start justify-between gap-4 border-b border-white/[0.08] pb-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 place-items-center rounded-xl border border-accent-border bg-accent-soft text-accent">
                    <activeAgent.icon size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display text-lg font-semibold text-ink">
                        {activeAgent.name}
                      </h3>
                      <span className="rounded-full border border-accent-border/50 bg-accent-soft px-2.5 py-0.5 text-[10px] font-semibold text-accent">
                        {activeAgent.badge}
                      </span>
                    </div>
                    <p className="text-xs text-muted">{activeAgent.tagline}</p>
                  </div>
                </div>

                {/* Prompt badge preview */}
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted">
                  <span className="text-[10px] font-mono uppercase text-accent font-semibold">User:</span>
                  <span className="italic text-ink-soft line-clamp-1">&ldquo;{activeAgent.promptPreview}&rdquo;</span>
                </div>
              </div>

              {/* Dynamic Preview Content Mockups */}
              <div className="mt-6">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeAgent.id}
                    initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? false : { opacity: 0, y: -12 }}
                    transition={{ duration: 0.22 }}
                    className="min-h-[340px] sm:min-h-[320px] rounded-2xl border border-white/[0.08] bg-[#08090d] p-4 sm:p-6"
                  >
                    {/* 1. Coding Agent View */}
                    {activeAgent.demo.type === "code" && (
                      <div className="flex flex-col gap-4 font-mono">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2">
                            <FileCode2 size={15} className="text-accent" />
                            <span className="text-ink font-sans font-medium">
                              {activeAgent.demo.fileName}
                            </span>
                            <span className="rounded bg-accent/15 px-2 py-0.5 text-[10px] text-accent">
                              Artifact
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-soft">
                            {activeAgent.demo.stats}
                          </span>
                        </div>
                        <pre className="overflow-x-auto text-[11px] leading-relaxed text-amber-100/90 sm:text-xs">
                          <code>{activeAgent.demo.codeSnippet}</code>
                        </pre>
                        <div className="mt-2 flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-3.5 py-2 text-[11px] text-emerald-300">
                          <div className="flex items-center gap-2 font-sans">
                            <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                            <span>Live sandbox renderer mounted • Interactive Preview ready</span>
                          </div>
                          <span className="font-mono text-[10px] text-emerald-400">React 19</span>
                        </div>
                      </div>
                    )}

                    {/* 2. Slide Deck / PPT View */}
                    {activeAgent.demo.type === "slide" && (
                      <div className="flex flex-col justify-between gap-6">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2 text-muted">
                            <Presentation size={15} className="text-accent" />
                            <span>Interactive SlideDeckViewer</span>
                          </div>
                          <span className="rounded-full border border-accent-border/40 bg-accent-soft px-2.5 py-0.5 text-[11px] font-semibold text-accent">
                            Slide {activeAgent.demo.slideNumber}
                          </span>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-transparent p-6 sm:p-8">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-accent">
                            Module 02
                          </p>
                          <h4 className="mt-2 font-display text-xl font-medium text-ink sm:text-2xl">
                            {activeAgent.demo.topic}
                          </h4>
                          <ul className="mt-4 space-y-2.5">
                            {activeAgent.demo.bullets.map((bullet, i) => (
                              <li key={i} className="flex items-start gap-2.5 text-xs text-ink-soft sm:text-sm">
                                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                                <span>{bullet}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="flex items-center justify-between text-xs text-muted">
                          <span className="flex items-center gap-1.5">
                            <CheckCircle2 size={13} className="text-accent" />
                            Ready to present or export
                          </span>
                          <div className="flex gap-2">
                            <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]">‹ Prev</span>
                            <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px]">Next ›</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 3. Real-Time Search View */}
                    {activeAgent.demo.type === "search" && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2 text-muted">
                            <Globe2 size={15} className="text-accent" />
                            <span>Live Internet Synthesis</span>
                          </div>
                          <span className="text-[11px] text-emerald-400">Verified Sources</span>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                          <span className="text-[11px] font-mono text-muted">Web Search Query:</span>
                          <p className="mt-1 text-sm font-medium text-ink">
                            &ldquo;{activeAgent.demo.query}&rdquo;
                          </p>
                        </div>

                        <div>
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-soft">
                            Referenced Citations:
                          </span>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {activeAgent.demo.sources.map((src, i) => (
                              <span
                                key={i}
                                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-accent"
                              >
                                <ExternalLink size={10} />
                                {src}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-xl border border-accent-border/30 bg-accent-soft p-4 text-xs leading-relaxed text-ink-soft">
                          <span className="font-semibold text-accent">Synthesized Conclusion: </span>
                          {activeAgent.demo.takeaway}
                        </div>
                      </div>
                    )}

                    {/* 4. PDF Intelligence View */}
                    {activeAgent.demo.type === "pdf" && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2 text-muted">
                            <FileText size={15} className="text-accent" />
                            <span>PDF Artifact Engine</span>
                          </div>
                          <span className="text-[11px] text-muted-soft">{activeAgent.demo.pages}</span>
                        </div>

                        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                          <div className="grid size-12 place-items-center rounded-xl border border-red-500/30 bg-red-950/40 text-red-300">
                            <FileText size={22} />
                          </div>
                          <div>
                            <p className="font-display text-sm font-semibold text-ink">
                              {activeAgent.demo.title}
                            </p>
                            <p className="text-xs text-muted">
                              Semantic embeddings computed • Ready for contextual querying
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                          {activeAgent.demo.sections.map((sec, i) => (
                            <div key={i} className="rounded-xl border border-white/10 bg-white/5 p-3 text-left">
                              <span className="text-[10px] font-mono text-accent">0{i + 1}</span>
                              <p className="mt-1 text-xs font-medium text-ink">{sec}</p>
                            </div>
                          ))}
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-accent-border/40 bg-accent-soft px-4 py-2.5 text-xs">
                          <span className="font-medium text-accent">
                            ✨ Generated: Printable Interview Cheat Sheet
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-muted-soft">
                            <Download size={13} /> PDF Viewer Panel
                          </span>
                        </div>
                      </div>
                    )}

                    {/* 5. Vision Studio View */}
                    {activeAgent.demo.type === "vision" && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2 text-muted">
                            <Eye size={15} className="text-accent" />
                            <span>Visual Model & Optical Parsing</span>
                          </div>
                          <span className="text-[11px] text-accent font-mono">{activeAgent.demo.resolution}</span>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <span className="size-2 rounded-full bg-accent" />
                            <span>Input Attachment: {activeAgent.demo.label}</span>
                          </div>
                          <div className="mt-4 rounded-xl border border-white/10 bg-night p-4 text-xs font-mono text-ink-soft">
                            <p className="text-accent">{">"} Analyzing topology components...</p>
                            <p className="mt-1 text-ink">{activeAgent.demo.detected}</p>
                            <p className="mt-2 text-muted-soft">{activeAgent.demo.status}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-muted">
                          <CheckCircle2 size={14} className="text-accent" />
                          <span>Supports architecture breakdown, wireframe parsing, and generative concept creation.</span>
                        </div>
                      </div>
                    )}

                    {/* 6. Autonomous Router View */}
                    {activeAgent.demo.type === "router" && (
                      <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between border-b border-white/10 pb-3 text-xs">
                          <div className="flex items-center gap-2 text-muted">
                            <BrainCircuit size={15} className="text-accent" />
                            <span>Autonomous Intent Classifier</span>
                          </div>
                          <span className="text-[11px] text-emerald-400">Zero Mode Toggles</span>
                        </div>

                        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs">
                          <span className="font-mono text-muted">Natural User Prompt:</span>
                          <p className="mt-1 font-medium text-ink">&ldquo;{activeAgent.demo.query}&rdquo;</p>
                        </div>

                        <div className="space-y-2">
                          {activeAgent.demo.stages.map((stage, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="font-mono text-[10px] text-accent">0{i + 1}</span>
                                <span className="font-medium text-ink">{stage.label}</span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-[11px] text-muted-soft">{stage.time}</span>
                                <span className="rounded bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">
                                  {stage.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Bottom detail pill */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-soft">
                <p className="text-ink-soft">{activeAgent.description}</p>
                <button
                  type="button"
                  onClick={onSignIn}
                  className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline"
                >
                  Experience {activeAgent.name} in Orbit <ArrowRight size={13} />
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Subtle Horizontal Divider Bridge */}
        <div className="my-10 sm:my-14 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden="true" />

        {/* =========================================================================
            3. HOW ORBIT WORKS: The 3-Step Orchestration Journey
            ========================================================================= */}
        <section className="mt-0">
          <div className="text-center">
            <p className="text-micro font-semibold uppercase tracking-widest text-accent">
              Architecture
            </p>
            <h2 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
              How the multi-agent system works
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
              You never have to guess which AI tool to open. Orbit handles the complexity behind the scenes.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-[#0c0d12]/60 p-7 backdrop-blur-md">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-accent-border bg-accent-soft text-accent">
                <Bot size={20} />
              </div>
              <span className="mt-5 block font-mono text-xs uppercase tracking-wider text-accent font-semibold">
                Step 01
              </span>
              <h3 className="mt-1 font-display text-lg font-medium text-ink">
                Prompt or Attach Naturally
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Ask a technical question, upload a PDF document, request a full slide deck, or attach an image. No specialized prompts required.
              </p>
            </div>

            <div className="rounded-3xl border border-accent-border/50 bg-[#0c0d12]/90 p-7 shadow-xl shadow-accent/5 backdrop-blur-md">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-accent bg-accent text-night">
                <BrainCircuit size={20} />
              </div>
              <span className="mt-5 block font-mono text-xs uppercase tracking-wider text-accent font-semibold">
                Step 02
              </span>
              <h3 className="mt-1 font-display text-lg font-medium text-ink">
                Autonomous Intent Routing
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Orbit evaluates your request context in real time and routes it directly to the optimal specialist: Coding, PPT, PDF, Vision, or Live Search.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#0c0d12]/60 p-7 backdrop-blur-md">
              <div className="flex size-11 items-center justify-center rounded-2xl border border-accent-border bg-accent-soft text-accent">
                <Layers size={20} />
              </div>
              <span className="mt-5 block font-mono text-xs uppercase tracking-wider text-accent font-semibold">
                Step 03
              </span>
              <h3 className="mt-1 font-display text-lg font-medium text-ink">
                Interactive Canvas Artifacts
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                Instead of plain walls of text, get live sandboxed React code, interactive presentations, downloadable PDF guides, and verified citations.
              </p>
            </div>
          </div>
        </section>

        {/* Subtle Horizontal Divider Bridge */}
        <div className="my-10 sm:my-14 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden="true" />

        {/* =========================================================================
            4. CAPABILITY PILLARS GRID: Confirmed Real Capabilities
            ========================================================================= */}
        <section className="mt-0">
          <div className="text-center">
            <p className="text-micro font-semibold uppercase tracking-widest text-accent">
              Core Capabilities
            </p>
            <h2 className="mt-2 font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
              Engineered for creative and technical workflows
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
              Built on verified backend agents to give you real power across every medium.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITY_PILLARS.map((item) => {
              const Icon = item.icon
              return (
                <div
                  key={item.title}
                  className="group relative flex flex-col justify-between rounded-3xl border border-white/10 bg-white/[0.02] p-7 transition-all hover:border-accent-border/60 hover:bg-white/[0.04]"
                >
                  <div>
                    <div className="flex items-center justify-between pb-5">
                      <div className="grid size-11 place-items-center rounded-2xl border border-accent-border bg-accent-soft text-accent transition group-hover:scale-105">
                        <Icon size={20} />
                      </div>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[10px] font-medium text-muted">
                        {item.tag}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-ink group-hover:text-accent transition-colors">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-xs leading-relaxed text-muted">
                      {item.description}
                    </p>
                  </div>
                  <div className="mt-6 flex items-center gap-1 text-[11px] font-medium text-accent opacity-0 transition group-hover:opacity-100">
                    <span>Explore in workspace</span>
                    <ChevronRight size={13} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* Subtle Horizontal Divider Bridge */}
        <div className="my-10 sm:my-14 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" aria-hidden="true" />

        {/* =========================================================================
            5. FINAL CALL TO ACTION: High-Impact Sign-In Card
            ========================================================================= */}
        <section className="relative mt-0 overflow-hidden rounded-3xl border border-amber-400/30 border-t-white/30 bg-gradient-to-b from-[#141624] via-[#0d0e16] to-[#07080c] p-8 text-center shadow-[0_20px_80px_rgba(0,0,0,0.85),0_0_60px_rgba(234,189,88,0.12)] backdrop-blur-2xl sm:p-14 sm:py-16">
          {/* Ambient Lighting & Futuristic Grid Texture */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute -top-32 left-1/2 size-80 -translate-x-1/2 rounded-full bg-gradient-to-b from-amber-400/25 via-amber-500/10 to-transparent blur-[100px]" />
            <div className="absolute -bottom-24 -right-24 size-64 rounded-full bg-amber-600/10 blur-[90px]" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,#000_65%,transparent_100%)]" />
          </div>

          <div className="relative mx-auto flex max-w-2xl flex-col items-center">
            {/* Official Orbit App Monogram Tile (Linear / macOS style) */}
            <div className="relative mb-6 flex items-center justify-center">
              <div className="absolute size-16 rounded-2xl bg-amber-400/20 blur-xl pointer-events-none" />
              <div className="relative grid size-14 place-items-center rounded-2xl border border-white/20 border-t-white/40 bg-gradient-to-b from-white/[0.12] via-white/[0.05] to-[#0a0b12] text-accent shadow-[0_10px_32px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-xl">
                <Orbit size={26} strokeWidth={2.2} className="text-[#eabd58] drop-shadow-[0_2px_8px_rgba(234,189,88,0.4)]" />
              </div>
            </div>

            {/* Shimmer Metallic Headline */}
            <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight sm:text-5xl lg:text-[3.1rem] lg:leading-[1.12]">
              <span className="block bg-gradient-to-b from-white via-white to-white/70 bg-clip-text text-transparent">
                Enter the Orbit workspace
              </span>
            </h2>

            {/* Subtitle */}
            <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-muted sm:text-[15px] sm:leading-[1.6]">
              Sign in with your Google account to start chatting, generating code, building slide decks, and analyzing documents in one unified system.
            </p>

            {/* Elevated Primary Sign-In Action */}
            <div className="mt-8 w-full max-w-sm relative">
              <div className="absolute -inset-1 rounded-full bg-amber-400/20 blur-xl pointer-events-none" />
              <GoogleAuthButton
                onSignIn={onSignIn}
                isSigningIn={isSigningIn}
              />
            </div>

            {/* Trust & Verification Micro-Chips */}
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-[11.5px] text-white/75">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 shadow-sm backdrop-blur-sm">
                <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                <span>Google OAuth Verified</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 shadow-sm backdrop-blur-sm">
                <Zap size={13} className="text-amber-400 shrink-0" />
                <span>6 Autonomous Agents Ready</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 shadow-sm backdrop-blur-sm">
                <CheckCircle2 size={13} className="text-amber-400 shrink-0" />
                <span>No Credit Card Required</span>
              </span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-20 border-t border-white/[0.07] bg-[#07080a] py-8 text-xs text-muted-soft">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 text-center sm:flex-row sm:px-8 sm:text-left">
          <div className="flex items-center gap-2">
            <Orbit size={14} className="text-accent" />
            <span className="font-semibold text-ink">Orbit</span>
            <span>— The Autonomous Multi-Agent AI Workspace</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Code Sandbox</span>
            <span>•</span>
            <span>Presentation Decks</span>
            <span>•</span>
            <span>PDF Intelligence</span>
            <span>•</span>
            <span>Live Search</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default SignIn
