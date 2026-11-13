import { useCallback, useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import ChatArea from "../components/chat/ChatArea.jsx"
import PdfArtifactPanel from "../components/chat/PdfArtifactPanel.jsx"
import CodeArtifactPanel from "../components/chat/CodeArtifactPanel.jsx"
import Sidebar from "../components/Sidebar.jsx"
import SignIn from "../components/SignIn.jsx"
import ChatHeader from "../components/layout/ChatHeader.jsx"
import NoticeBanner from "../components/layout/NoticeBanner.jsx"
import { useAuthSession } from "../features/auth/useAuthSession.js"
import { useConversations } from "../features/conversations/useConversations.js"

function Home() {
  const reduceMotion = useReducedMotion()
  const auth = useAuthSession()
  const workspace = useConversations(auth.user)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true)
  const notice = workspace.error || auth.error
  const clearAuthError = auth.clearError
  const clearWorkspaceError = workspace.clearError
  const createWorkspaceConversation = workspace.createNewConversation
  const setLatestArtifact = workspace.setLatestArtifact

  const createNewConversation = useCallback(async () => {
    clearAuthError()
    setLatestArtifact(null)
    const created = await createWorkspaceConversation()
    if (created) setSidebarOpen(false)
  }, [clearAuthError, createWorkspaceConversation, setLatestArtifact])

  useEffect(() => {
    const handleShortcuts = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        createNewConversation()
      }
    }

    window.addEventListener("keydown", handleShortcuts)
    return () => window.removeEventListener("keydown", handleShortcuts)
  }, [createNewConversation])

  const selectConversation = (id) => {
    workspace.setActiveId(id)
    clearWorkspaceError()
    clearAuthError()
    workspace.setLatestArtifact(null)
    setSidebarOpen(false)
  }

  const dismissNotice = () => {
    clearWorkspaceError()
    clearAuthError()
  }

  if (auth.isLoadingUser) {
    return (
      <main className="grid min-h-dvh place-items-center bg-paper text-caption text-muted">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-accent/70 animate-pulse" />
          <span>Loading workspace...</span>
        </div>
      </main>
    )
  }

  if (!auth.user) {
    return (
      <SignIn
        error={auth.error}
        isSigningIn={auth.isSigningIn}
        onSignIn={auth.signIn}
      />
    )
  }

  return (
    <main className="relative flex h-dvh min-h-screen w-full overflow-hidden bg-paper text-ink">
      <Sidebar
        conversations={workspace.conversations}
        user={auth.user}
        activeId={workspace.activeId}
        isOpen={sidebarOpen}
        isDesktopOpen={desktopSidebarOpen}
        isLoading={workspace.isLoading}
        isSigningOut={auth.isSigningOut}
        onNewChat={createNewConversation}
        onSelectChat={selectConversation}
        onDeleteChat={workspace.deleteConversation}
        onClose={() => setSidebarOpen(false)}
        onSignOut={auth.signOut}
      />

      <section className="relative z-0 flex min-w-0 flex-1 flex-row overflow-hidden">
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader
            title={workspace.activeConversation?.title ?? "New conversation"}
            isDisabled={workspace.isLoading}
            isMobileSidebarOpen={sidebarOpen}
            onOpenSidebar={() => setSidebarOpen(true)}
            isDesktopSidebarOpen={desktopSidebarOpen}
            onToggleDesktopSidebar={() => setDesktopSidebarOpen((isOpen) => !isOpen)}
            onNewChat={createNewConversation}
          />
          <NoticeBanner message={notice} onDismiss={dismissNotice} />
          <ChatArea
            messages={workspace.activeConversation?.messages ?? []}
            isLoading={workspace.isLoading}
            isSending={workspace.isSending}
            activeTurnId={workspace.activeTurnId}
            generatingStage={workspace.generatingStage}
            streamingText={workspace.streamingText}
            onSend={workspace.sendMessage}
            onStop={workspace.stopGenerating}
            onOpenArtifact={workspace.setLatestArtifact}
            activeProject={
              workspace.latestArtifact?.projectId
                ? {
                    projectId: workspace.latestArtifact.projectId,
                    title: workspace.latestArtifact.title || "Project",
                    version: workspace.latestArtifact.version || workspace.latestArtifact.versionNumber || 1,
                  }
                : null
            }
            onClearActiveProject={() => workspace.setLatestArtifact(null)}
          />
        </div>

        <AnimatePresence>
          {workspace.latestArtifact && (
            <>
              {/* Overlay Backdrop for Mobile & Tablet viewports below xl */}
              <motion.button
                className="fixed inset-0 z-30 border-0 bg-black/60 p-0 backdrop-blur-sm xl:hidden cursor-pointer"
                type="button"
                aria-label="Close artifact preview"
                onClick={() => workspace.setLatestArtifact(null)}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              />
              {workspace.latestArtifact.type === "code" || workspace.latestArtifact.files ? (
                <CodeArtifactPanel
                  artifact={workspace.latestArtifact}
                  conversationId={workspace.activeId}
                  onClose={() => workspace.setLatestArtifact(null)}
                  onArtifactChange={workspace.setLatestArtifact}
                />
              ) : (
                <PdfArtifactPanel
                  document={workspace.latestArtifact}
                  onClose={() => workspace.setLatestArtifact(null)}
                />
              )}
            </>
          )}
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {sidebarOpen && (
          <motion.button
            className="fixed inset-0 z-10 border-0 bg-black/60 p-0 backdrop-blur-sm md:hidden"
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          />
        )}
      </AnimatePresence>
    </main>
  )
}

export default Home
