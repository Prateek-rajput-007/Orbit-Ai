import { useCallback, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import api from "../../api/api.js"
import { getErrorMessage } from "../getErrorMessage.js"
import { queryKeys } from "../queryKeys.js"
import {
  deleteConversation as deleteConversationRequest,
  updateConversation as updateConversationRequest,
} from "./conversationActions.js"
import { createConversation } from "./createConversation.js"
import {
  fetchConversationMessages,
  getConversationSummaries,
} from "./getConversation.js"

export function useConversations(user) {
  const queryClient = useQueryClient()
  const [activeId, setActiveId] = useState(null)
  const [actionNotice, setActionNotice] = useState("")
  const [latestArtifact, setLatestArtifact] = useState(null)
  const [generatingStage, setGeneratingStage] = useState("")
  const [streamingText, setStreamingText] = useState("")
  const [streamingConversationId, setStreamingConversationId] = useState(null)
  const [activeTurnId, setActiveTurnId] = useState(null)
  const activeAbortController = useRef(null)
  const turnDiagnostics = useRef({
    t0: 0,
    tOptimistic: 0,
    tRequestStart: 0,
    tFirstStage: 0,
    tFirstToken: 0,
    tFinalReady: 0,
    errorCount: 0,
    retryCount: 0,
  })
  const userId = user?.userId ?? user?._id ?? user?.id
  const conversationsKey = queryKeys.conversations(userId)

  // 1. Fetch conversation summaries (sidebar list) - Single lightweight query
  const conversationsQuery = useQuery({
    queryKey: conversationsKey,
    queryFn: getConversationSummaries,
    enabled: Boolean(userId),
  })
  const conversations = useMemo(
    () => (userId ? conversationsQuery.data ?? [] : []),
    [conversationsQuery.data, userId],
  )
  const selectedId =
    conversations.some(({ id }) => id === activeId)
      ? activeId
      : conversations[0]?.id ?? null

  // 2. Fetch messages on-demand ONLY for the selected conversation
  const messagesKey = queryKeys.messages(selectedId)
  const messagesQuery = useQuery({
    queryKey: messagesKey,
    queryFn: () => fetchConversationMessages(selectedId),
    enabled: Boolean(selectedId),
  })

  // 3. Compose activeConversation with on-demand messages
  const activeConversation = useMemo(() => {
    const summary = conversations.find(({ id }) => id === selectedId)
    if (!summary) return null
    return {
      ...summary,
      messages: messagesQuery.data ?? [],
    }
  }, [conversations, selectedId, messagesQuery.data])

  const createMutation = useMutation({
    mutationFn: createConversation,
    onSuccess: (conversation) => {
      queryClient.setQueryData(conversationsKey, (current = []) => [
        {
          id: conversation.id,
          title: conversation.title,
          updatedAt: conversation.updatedAt,
        },
        ...current.filter(({ id }) => id !== conversation.id),
      ])
      queryClient.setQueryData(queryKeys.messages(conversation.id), [])
      setActiveId(conversation.id)
    },
    onError: (error) => console.error("Unable to create conversation:", error),
  })
  const createConversationAsync = createMutation.mutateAsync
  const resetCreateMutation = createMutation.reset

  const deleteMutation = useMutation({
    mutationFn: deleteConversationRequest,
    onSuccess: (_, deletedId) => {
      queryClient.setQueryData(conversationsKey, (current = []) =>
        current.filter(({ id }) => id !== deletedId),
      )
      queryClient.removeQueries({ queryKey: queryKeys.messages(deletedId) })
      if (selectedId === deletedId) {
        const remaining = conversations.filter(({ id }) => id !== deletedId)
        setActiveId(remaining[0]?.id ?? null)
      }
      setActionNotice("")
    },
    onError: (error) => console.error("Unable to delete conversation:", error),
  })
  const deleteConversationMutate = deleteMutation.mutate
  const resetDeleteMutation = deleteMutation.reset

  const sendMutation = useMutation({
    mutationFn: async ({ conversationId, prompt, title, agentMode, attachment, clientRequestId }) => {
      let data = null
      let accumulatedTokens = ""

      turnDiagnostics.current.tRequestStart = performance.now()
      turnDiagnostics.current.tFirstStage = 0
      turnDiagnostics.current.tFirstToken = 0
      turnDiagnostics.current.tFinalReady = 0

      activeAbortController.current?.abort()
      const abortController = new AbortController()
      activeAbortController.current = abortController

      setStreamingConversationId(conversationId)

      if (!attachment) {
        try {
          setGeneratingStage("Connecting to Orbit agent...")
          setStreamingText("")
          const serverUrl = api.defaults.baseURL || import.meta.env.VITE_SERVER_URL || import.meta.env.VITE_API_URL || ""
          const response = await fetch(`${serverUrl}/api/agent/chat`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Accept": "text/event-stream",
              ...(clientRequestId ? {
                "x-request-id": clientRequestId,
                "Idempotency-Key": clientRequestId,
              } : {}),
            },
            credentials: "include",
            signal: abortController.signal,
            body: JSON.stringify({ prompt, conversationId, agentMode, clientRequestId }),
          })

          if (!response.ok) {
            const errJson = await response.json().catch(() => null)
            const retryAfter = response.headers.get("retry-after")
            let errMsg = errJson?.message || errJson?.error || `Request failed with status ${response.status}`
            if ((response.status === 429 || response.status === 503) && retryAfter && !errMsg.toLowerCase().includes("wait")) {
              errMsg = `${errMsg} (Wait ${retryAfter}s)`
            }
            const err = new Error(errMsg)
            err.status = response.status
            err.retryAfter = retryAfter
            throw err
          }

          const contentType = response.headers.get("content-type") || ""
          if (contentType.includes("text/event-stream") && response.body) {
            const reader = response.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""
            let currentEvent = "message"

            const processLines = (lines) => {
              for (const rawLine of lines) {
                const line = rawLine.trimEnd()
                if (!line || line.startsWith(":")) {
                  // Ignore blank lines and SSE comment keepalives (e.g. ": keepalive")
                  continue
                }
                if (line.startsWith("event: ")) {
                  currentEvent = line.slice(7).trim()
                } else if (line.startsWith("data: ")) {
                  try {
                    const parsed = JSON.parse(line.slice(6))
                    if (currentEvent === "token" && typeof parsed.token === "string") {
                      if (!turnDiagnostics.current.tFirstToken) {
                        turnDiagnostics.current.tFirstToken = performance.now()
                      }
                      accumulatedTokens += parsed.token
                      setStreamingText(accumulatedTokens)
                    } else if (currentEvent === "stage" && parsed.message) {
                      if (!turnDiagnostics.current.tFirstStage) {
                        turnDiagnostics.current.tFirstStage = performance.now()
                      }
                      setGeneratingStage(parsed.message)
                    } else if (currentEvent === "ready") {
                      turnDiagnostics.current.tFinalReady = performance.now()
                      data = parsed
                    } else if (currentEvent === "error") {
                      throw new Error(parsed.message || parsed.error || "Agent request failed")
                    }
                  } catch (parseErr) {
                    if (currentEvent === "error") throw parseErr
                  }
                }
              }
            }

            while (true) {
              const { done, value } = await reader.read()
              if (done) {
                if (buffer.trim()) {
                  processLines(buffer.split("\n"))
                }
                break
              }
              buffer += decoder.decode(value, { stream: true })
              const lines = buffer.split("\n")
              buffer = lines.pop() || ""
              processLines(lines)
            }
          } else {
            turnDiagnostics.current.tFinalReady = performance.now()
            data = await response.json()
          }
        } catch (streamErr) {
          if (abortController.signal.aborted || streamErr.name === "AbortError") {
            throw new Error("Request was cancelled.", { cause: streamErr })
          }
          // Do NOT blindly repeat an expensive request when its status is unknown or connection drops
          throw streamErr
        } finally {
          activeAbortController.current = null
        }
      } else {
        const payload = new FormData()
        payload.append("prompt", prompt)
        payload.append("conversationId", conversationId)
        payload.append("agentMode", agentMode)
        payload.append("attachment", attachment)
        if (clientRequestId) payload.append("clientRequestId", clientRequestId)
        const res = await api.post("/api/agent/chat", payload, {
          headers: {
            "Content-Type": "multipart/form-data",
            ...(clientRequestId ? {
              "x-request-id": clientRequestId,
              "Idempotency-Key": clientRequestId,
            } : {}),
          },
          signal: abortController.signal,
        })
        turnDiagnostics.current.tFinalReady = performance.now()
        data = res.data
      }

      // Recovery check: if the stream closed without a ready payload, check if backend already persisted turn in DB
      if (!data && !abortController.signal.aborted) {
        try {
          const msgs = await fetchConversationMessages(conversationId)
          const lastMsg = msgs[msgs.length - 1]
          if (lastMsg && lastMsg.role === "assistant" && lastMsg.content) {
            data = {
              aiResponse: lastMsg.content,
              images: lastMsg.images || [],
              searchResults: lastMsg.searchResults || [],
              slides: lastMsg.slides || [],
              presentationFile: lastMsg.presentationFile || null,
              pdfDocument: lastMsg.pdfDocument || null,
              codeArtifact: lastMsg.codeArtifact || null,
              imageAttachment: lastMsg.imageAttachment || null,
              userAttachment: lastMsg.attachment || null,
              suggestedQuestions: lastMsg.suggestedQuestions || [],
              userMessageId: msgs[msgs.length - 2]?.id || "recovered-user-id",
              assistantMessageId: lastMsg.id,
            }
          }
        } catch {
          // ignore recovery error
        }
      }

      if (import.meta.env.DEV && turnDiagnostics.current.tRequestStart) {
        const tStart = turnDiagnostics.current.tRequestStart
        const tOpt = turnDiagnostics.current.tOptimistic && turnDiagnostics.current.t0
          ? Number((turnDiagnostics.current.tOptimistic - turnDiagnostics.current.t0).toFixed(1))
          : null
        const tStage = turnDiagnostics.current.tFirstStage
          ? Number((turnDiagnostics.current.tFirstStage - tStart).toFixed(1))
          : null
        const tToken = turnDiagnostics.current.tFirstToken
          ? Number((turnDiagnostics.current.tFirstToken - tStart).toFixed(1))
          : null
        const tFinal = turnDiagnostics.current.tFinalReady
          ? Number((turnDiagnostics.current.tFinalReady - tStart).toFixed(1))
          : Number((performance.now() - tStart).toFixed(1))

        console.info("[Orbit Chat Turn Diagnostics]", {
          conversationId,
          agentMode,
          clickToOptimisticMs: tOpt,
          requestToFirstStageMs: tStage,
          requestToFirstTokenMs: tToken,
          requestToFinalResponseMs: tFinal,
          errorCount: turnDiagnostics.current.errorCount,
        })
      }

      const answer =
        typeof data === "string"
          ? data
          : data?.aiResponse ?? data?.response ?? data?.message ?? (accumulatedTokens.trim() ? accumulatedTokens : null)
      if (typeof answer !== "string" || !answer.trim()) {
        throw new Error("The assistant returned an empty response.")
      }
      if (!data?.userMessageId || !data?.assistantMessageId) {
        throw new Error("The assistant response could not be confirmed as saved.")
      }

      const warnings = []
      if (title) {
        try {
          await updateConversationRequest(conversationId, title)
        } catch (error) {
          console.error("Unable to update conversation title:", error)
          warnings.push(getErrorMessage(
            error,
            "The conversation title could not be saved.",
          ))
        }
      }

      return {
        answer,
        images: Array.isArray(data?.images) ? data.images : [],
        searchResults: Array.isArray(data?.searchResults) ? data.searchResults : [],
        slides: Array.isArray(data?.slides) ? data.slides : [],
        presentationFile: data?.presentationFile ?? null,
        pdfDocument: data?.pdfDocument ?? null,
        codeArtifact: data?.codeArtifact ?? null,
        imageAttachment: data?.imageAttachment ?? null,
        userAttachment: data?.userAttachment ?? null,
        suggestedQuestions: Array.isArray(data?.suggestedQuestions) ? data.suggestedQuestions : [],
        userMessageId: data.userMessageId,
        assistantMessageId: data.assistantMessageId,
        title,
        warning: warnings.join(" "),
      }
    },
    onMutate: async ({ conversationId, prompt, title, userMessageId, turnId, attachment }) => {
      turnDiagnostics.current.tOptimistic = performance.now()
      const convMessagesKey = queryKeys.messages(conversationId)
      await queryClient.cancelQueries({ queryKey: convMessagesKey })
      await queryClient.cancelQueries({ queryKey: conversationsKey })

      const previousMessages = queryClient.getQueryData(convMessagesKey)
      const previousConversations = queryClient.getQueryData(conversationsKey)

      // Optimistically append user message to messages cache
      const isImageAttachment = Boolean(
        attachment &&
        (attachment.type?.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(attachment.name || ""))
      )
      const optimisticAttachment = attachment ? {
        name: attachment.name,
        mimeType: attachment.type || "application/octet-stream",
        dataUrl: isImageAttachment && typeof window !== "undefined" && window.URL?.createObjectURL
          ? window.URL.createObjectURL(attachment)
          : null,
      } : null

      const clientKey = turnId ? `${turnId}-user` : userMessageId

      queryClient.setQueryData(convMessagesKey, (current = []) => [
        ...current,
        {
          id: userMessageId,
          clientKey,
          role: "user",
          content: prompt,
          attachment: optimisticAttachment,
          status: "pending",
        },
      ])

      // Update sidebar conversation timestamp and title
      queryClient.setQueryData(conversationsKey, (current = []) => {
        const conversation = current.find(({ id }) => id === conversationId)
        if (!conversation) return current
        const updated = {
          ...conversation,
          title: title ?? conversation.title,
          updatedAt: Date.now(),
        }
        return [updated, ...current.filter(({ id }) => id !== conversationId)]
      })

      return { previousMessages, previousConversations, convMessagesKey }
    },
    onError: (error, variables, context) => {
      setGeneratingStage("")
      setStreamingText("")
      setStreamingConversationId(null)
      setActiveTurnId(null)

      const isAborted =
        error?.name === "AbortError" ||
        error?.message?.includes("aborted") ||
        error?.message?.includes("canceled") ||
        error?.message?.includes("cancelled")

      if (isAborted) {
        if (context?.convMessagesKey) {
          queryClient.setQueryData(context.convMessagesKey, (current = []) =>
            current.map((msg) =>
              msg.id === variables.userMessageId
                ? { ...msg, status: "sent" }
                : msg
            )
          )
        }
        return
      }

      turnDiagnostics.current.errorCount++
      console.error("Unable to send message:", error)
      if (context?.convMessagesKey) {
        queryClient.setQueryData(context.convMessagesKey, (current = []) =>
          current.map((msg) =>
            msg.id === variables.userMessageId
              ? {
                  ...msg,
                  status: "error",
                  error: getErrorMessage(error, "Failed to send message"),
                }
              : msg
          )
        )
      }
      if (context?.previousConversations) {
        queryClient.setQueryData(conversationsKey, context.previousConversations)
      }
    },
    onSuccess: (result, variables) => {
      setGeneratingStage("")
      setStreamingText("")
      setStreamingConversationId(null)
      setActiveTurnId(null)

      const convMessagesKey = queryKeys.messages(variables.conversationId)
      const userClientKey = variables.turnId ? `${variables.turnId}-user` : variables.userMessageId
      const assistantClientKey = variables.turnId ? `${variables.turnId}-assistant` : result.assistantMessageId

      queryClient.setQueryData(convMessagesKey, (current = []) => [
        ...current.map((message) =>
          message.id === variables.userMessageId && result.userMessageId
            ? {
                ...message,
                id: result.userMessageId,
                clientKey: message.clientKey || userClientKey,
                attachment: result.userAttachment ?? message.attachment,
                status: "sent",
              }
            : message,
        ),
        {
          id: result.assistantMessageId,
          clientKey: assistantClientKey,
          role: "assistant",
          content: result.answer,
          images: result.images,
          searchResults: result.searchResults,
          slides: result.slides,
          presentationFile: result.presentationFile,
          pdfDocument: result.pdfDocument,
          codeArtifact: result.codeArtifact,
          imageAttachment: result.imageAttachment,
          suggestedQuestions: result.suggestedQuestions,
        },
      ])

      if (result.codeArtifact) {
        setLatestArtifact({ type: "code", ...result.codeArtifact })
      } else if (result.pdfDocument) {
        setLatestArtifact({ type: "pdf", ...result.pdfDocument })
      }

      if (result.title) {
        queryClient.setQueryData(conversationsKey, (current = []) =>
          current.map((conv) =>
            conv.id === variables.conversationId ? { ...conv, title: result.title } : conv,
          ),
        )
      }
      setActionNotice(result.warning)
    },
  })
  const sendMessageMutate = sendMutation.mutate
  const resetSendMutation = sendMutation.reset
  const isSending = sendMutation.isPending

  const createNewConversation = useCallback(async () => {
    setActionNotice("")
    try {
      await createConversationAsync()
      return true
    } catch {
      return false
    }
  }, [createConversationAsync])

  const sendMessage = useCallback(async (text, attachment = null, agentMode = "auto") => {
    const prompt = text.trim()
    if (!prompt || isSending || conversationsQuery.isPending) return

    let conversation = conversations.find(({ id }) => id === selectedId)
    if (!conversation) {
      try {
        conversation = await createConversationAsync()
      } catch {
        return
      }
    }

    const currentMessages = queryClient.getQueryData(queryKeys.messages(conversation.id)) ?? []
    const title = currentMessages.length
      ? undefined
      : prompt.slice(0, 48)

    turnDiagnostics.current.t0 = performance.now()
    const clientRequestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    resetSendMutation()
    setActionNotice("")
    setActiveTurnId(turnId)
    sendMessageMutate({
      conversationId: conversation.id,
      prompt,
      attachment,
      agentMode,
      title,
      clientRequestId,
      turnId,
      userMessageId: `${turnId}-user`,
    })
  }, [
    conversations,
    conversationsQuery.isPending,
    createConversationAsync,
    isSending,
    queryClient,
    resetSendMutation,
    selectedId,
    sendMessageMutate,
  ])

  const clearError = useCallback(() => {
    resetCreateMutation()
    resetDeleteMutation()
    resetSendMutation()
    setActionNotice("")
  }, [resetCreateMutation, resetDeleteMutation, resetSendMutation])

  const error =
    sendMutation.error ??
    deleteMutation.error ??
    createMutation.error ??
    conversationsQuery.error ??
    messagesQuery.error
  const errorMessage =
    actionNotice ||
    (error ? getErrorMessage(error, "Unable to complete the request.") : "")
  const deleteConversation = useCallback((id) => {
    setActionNotice("")
    deleteConversationMutate(id)
  }, [deleteConversationMutate])

  const stopGenerating = useCallback(() => {
    if (activeAbortController.current) {
      activeAbortController.current.abort()
      activeAbortController.current = null
    }
    setGeneratingStage("")
    setStreamingText("")
    setStreamingConversationId(null)
    setActiveTurnId(null)
    resetSendMutation()
  }, [resetSendMutation])

  return {
    conversations,
    activeId: selectedId,
    activeConversation,
    isLoading: conversationsQuery.isPending || (Boolean(selectedId) && messagesQuery.isPending && !messagesQuery.data),
    isSending: sendMutation.isPending && (streamingConversationId ? streamingConversationId === selectedId : true),
    isAnySending: sendMutation.isPending,
    activeTurnId: sendMutation.isPending ? activeTurnId : null,
    error: errorMessage,
    setActiveId,
    createNewConversation,
    deleteConversation,
    sendMessage,
    stopGenerating,
    clearError,
    latestArtifact,
    setLatestArtifact,
    generatingStage: streamingConversationId === selectedId ? generatingStage : "",
    streamingText: streamingConversationId === selectedId ? streamingText : "",
    streamingConversationId,
  }
}
