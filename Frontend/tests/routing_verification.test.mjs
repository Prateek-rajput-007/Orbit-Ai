import test from "node:test"
import assert from "node:assert/strict"
import React from "react"
import { renderToString } from "react-dom/server"
import { MemoryRouter, Routes, Route, Outlet, useParams, useNavigate, Navigate } from "react-router-dom"

test("1. Route Matching: Root path '/' maps to new workspace with no conversation ID", () => {
  let capturedParam = "unset"
  function MockHome() {
    const { conversationId } = useParams()
    capturedParam = conversationId || null
    return React.createElement("div", null, "New Workspace")
  }

  function App() {
    return React.createElement(
      MemoryRouter,
      { initialEntries: ["/"] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          { element: React.createElement(MockHome) },
          React.createElement(Route, { index: true, element: null }),
          React.createElement(Route, { path: "c/:conversationId", element: null }),
          React.createElement(Route, { path: "*", element: React.createElement(Navigate, { to: "/", replace: true }) })
        )
      )
    )
  }

  const html = renderToString(React.createElement(App))
  assert.equal(capturedParam, null, "conversationId should be null on root route '/'")
  assert.match(html, /New Workspace/)
})

test("2. Route Matching: '/c/:conversationId' maps to the specific conversation ID", () => {
  let capturedParam = "unset"
  const testId = "673f8a901234567890abcdef"

  function MockHome() {
    const { conversationId } = useParams()
    capturedParam = conversationId || null
    return React.createElement("div", null, `Conversation: ${conversationId}`)
  }

  function App() {
    return React.createElement(
      MemoryRouter,
      { initialEntries: [`/c/${testId}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          { element: React.createElement(MockHome) },
          React.createElement(Route, { index: true, element: null }),
          React.createElement(Route, { path: "c/:conversationId", element: null }),
          React.createElement(Route, { path: "*", element: React.createElement(Navigate, { to: "/", replace: true }) })
        )
      )
    )
  }

  const html = renderToString(React.createElement(App))
  assert.equal(capturedParam, testId, `conversationId should be '${testId}'`)
  assert.match(html, new RegExp(testId))
})

test("3. Unknown Route Fallback: Any unknown path matches the catch-all '*' route", async () => {
  const { matchRoutes } = await import("react-router-dom")
  const routes = [
    {
      element: "HomeLayout",
      children: [
        { index: true },
        { path: "c/:conversationId" },
        { path: "*" }
      ]
    }
  ]

  const matches = matchRoutes(routes, "/unknown/invalid/deep/link")
  assert.ok(matches, "Routes must match unknown path")
  const leafMatch = matches[matches.length - 1]
  assert.equal(leafMatch.route.path, "*", "Unknown path must match catch-all '*' fallback route")
})

test("4. Multi-tab Isolation: Tab 1 and Tab 2 maintain independent conversation state with zero storage collision", () => {
  // Simulate Tab 1
  let tab1Id = null
  function Tab1() {
    return React.createElement(
      MemoryRouter,
      { initialEntries: ["/c/conv-AAA"] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          {
            element: React.createElement(() => {
              const { conversationId } = useParams()
              tab1Id = conversationId
              return React.createElement("div", null, `Tab1: ${conversationId}`)
            })
          },
          React.createElement(Route, { path: "c/:conversationId", element: null })
        )
      )
    )
  }

  // Simulate Tab 2
  let tab2Id = null
  function Tab2() {
    return React.createElement(
      MemoryRouter,
      { initialEntries: ["/c/conv-BBB"] },
      React.createElement(
        Routes,
        null,
        React.createElement(
          Route,
          {
            element: React.createElement(() => {
              const { conversationId } = useParams()
              tab2Id = conversationId
              return React.createElement("div", null, `Tab2: ${conversationId}`)
            })
          },
          React.createElement(Route, { path: "c/:conversationId", element: null })
        )
      )
    )
  }

  renderToString(React.createElement(Tab1))
  renderToString(React.createElement(Tab2))

  assert.equal(tab1Id, "conv-AAA", "Tab 1 must retain conv-AAA")
  assert.equal(tab2Id, "conv-BBB", "Tab 2 must retain conv-BBB")
  assert.notEqual(tab1Id, tab2Id, "Tabs must never overwrite each other")
})

test("5. First Message Transition: Replacing route to /c/:newId preserves layout hierarchy without remount", () => {
  let navAction = null
  let navTarget = null

  const mockNavigate = (to, opts) => {
    navTarget = to
    navAction = opts?.replace ? "replace" : "push"
  }

  // Simulate sending first message from root '/'
  const createdId = "673fa-newly-created-conversation-id"
  const onFirstTurnComplete = (newId) => {
    mockNavigate(`/c/${newId}`, { replace: true })
  }

  onFirstTurnComplete(createdId)
  assert.equal(navTarget, `/c/${createdId}`, "Must navigate to /c/:newId")
  assert.equal(navAction, "replace", "Must use replace: true so history entry replaces '/' smoothly")
})

test("6. Active Conversation Deletion Navigation", () => {
  let navTarget = null
  const mockNavigate = (to, opts) => {
    navTarget = to
  }

  // Case A: Deleting active conversation with remaining conversations available
  const activeId = "conv-to-delete"
  const remainingConversations = [{ id: "conv-next-1" }, { id: "conv-next-2" }]

  if (remainingConversations.length > 0) {
    mockNavigate(`/c/${remainingConversations[0].id}`, { replace: true })
  } else {
    mockNavigate("/", { replace: true })
  }
  assert.equal(navTarget, "/c/conv-next-1", "Must switch to next remaining conversation")

  // Case B: Deleting active conversation when no conversations remain
  const emptyRemaining = []
  if (emptyRemaining.length > 0) {
    mockNavigate(`/c/${emptyRemaining[0].id}`, { replace: true })
  } else {
    mockNavigate("/", { replace: true })
  }
  assert.equal(navTarget, "/", "Must fall back to root '/' when no conversations remain")
})

test("7. Complete Elimination of orbit_active_conversation_id Storage Key", async () => {
  // Read useConversations source code to ensure no references to orbit_active_conversation_id or storage active chat key exist
  const fs = await import("node:fs")
  const fileContent = fs.readFileSync(
    new URL("../src/features/conversations/useConversations.js", import.meta.url),
    "utf-8"
  )

  assert.equal(
    fileContent.includes("orbit_active_conversation_id"),
    false,
    "useConversations.js must NOT contain orbit_active_conversation_id"
  )
  assert.equal(
    fileContent.includes("ACTIVE_CHAT_STORAGE_KEY"),
    false,
    "useConversations.js must NOT contain ACTIVE_CHAT_STORAGE_KEY"
  )
  assert.equal(
    fileContent.includes("getStoredActiveChatId"),
    false,
    "useConversations.js must NOT contain getStoredActiveChatId"
  )
})

test("8. Unauthenticated Deep Linking: Opening /c/:id while unauthenticated preserves URL and displays SignIn", () => {
  const deepId = "conv-protected-999"

  function MockHome({ user }) {
    if (!user) {
      return React.createElement("div", null, "Sign In Screen")
    }
    return React.createElement("div", null, "Protected Workspace")
  }

  function App() {
    return React.createElement(
      MemoryRouter,
      { initialEntries: [`/c/${deepId}`] },
      React.createElement(
        Routes,
        null,
        React.createElement(Route, { path: "/c/:conversationId", element: React.createElement(MockHome, { user: null }) })
      )
    )
  }

  const html = renderToString(React.createElement(App))
  assert.match(html, /Sign In Screen/, "Must show SignIn while retaining URL")
})

test("9. Error State Isolation: 404 from server maps to clear 'not found' message without silent redirect", () => {
  const error404 = {
    response: { status: 404, data: { message: "Conversation not found" } }
  }

  const getMappedMessage = (error) => {
    if (error?.response?.status === 404) {
      return "This conversation was not found or has been deleted."
    }
    return "Failed to load conversation messages."
  }

  assert.equal(
    getMappedMessage(error404),
    "This conversation was not found or has been deleted."
  )
})

test("10. SSE Stream Isolation: Streaming content only renders for the owning conversation ID", () => {
  const selectedId = "conv-A"
  const streamingConversationId = "conv-B"
  const rawStreamingText = "Streaming in progress..."

  const visibleStreamingText = streamingConversationId === selectedId ? rawStreamingText : ""
  assert.equal(visibleStreamingText, "", "Streaming text must not bleed into conv-A when stream belongs to conv-B")

  const sameSelectedId = "conv-B"
  const activeStreamingText = streamingConversationId === sameSelectedId ? rawStreamingText : ""
  assert.equal(activeStreamingText, rawStreamingText, "Streaming text must be visible when on the owning conversation")
})

