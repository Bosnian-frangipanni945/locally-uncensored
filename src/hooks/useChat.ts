import { useRef, useState, useCallback } from "react"
import { v4 as uuid } from "uuid"
import { chatStream } from "../api/ollama"
import { parseNDJSONStream } from "../api/stream"
import { useChatStore } from "../stores/chatStore"
import { useModelStore } from "../stores/modelStore"
import { useSettingsStore } from "../stores/settingsStore"
import { useRAGStore } from "../stores/ragStore"
import { retrieveContext } from "../api/rag"

interface ChatChunk {
  message?: { content: string }
  done?: boolean
}

export function useChat() {
  const [isGenerating, setIsGenerating] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const contentRef = useRef("")
  const thinkingRef = useRef("")
  const isThinkingRef = useRef(false)

  const sendMessage = useCallback(async (content: string) => {
    const { activeModel } = useModelStore.getState()
    const { settings } = useSettingsStore.getState()
    const store = useChatStore.getState()
    const persona = useSettingsStore.getState().getActivePersona()

    if (!activeModel) return

    let convId = store.activeConversationId
    if (!convId) {
      convId = store.createConversation(activeModel, persona?.systemPrompt || "")
    }

    const userMessage = {
      id: uuid(),
      role: "user" as const,
      content,
      timestamp: Date.now(),
    }
    useChatStore.getState().addMessage(convId, userMessage)

    const assistantMessage = {
      id: uuid(),
      role: "assistant" as const,
      content: "",
      thinking: "",
      timestamp: Date.now(),
    }
    useChatStore.getState().addMessage(convId, assistantMessage)

    const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
    if (!conv) return

    // RAG context injection
    let systemPrompt = conv.systemPrompt
    const ragState = useRAGStore.getState()
    const ragEnabled = ragState.ragEnabled[convId] ?? false

    if (ragEnabled) {
      const chunks = ragState.getConversationChunks(convId)
      if (chunks.length > 0) {
        try {
          const { context: ragContext, scoredChunks } = await retrieveContext(
            content,
            chunks,
            ragState.embeddingModel
          )

          // Store scored chunks for display in RAGPanel
          ragState.setLastRetrievedChunks(scoredChunks)

          if (ragContext.chunks.length > 0) {
            const contextBlock = ragContext.chunks
              .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
              .join("\n\n")
            const ragPrefix = `Use the following document context to help answer the user's question. If the context is not relevant, ignore it and answer normally.\n\n---\n${contextBlock}\n---\n\n`
            systemPrompt = ragPrefix + (systemPrompt || "")
          }
        } catch (err) {
          console.error("RAG retrieval failed, continuing without context:", err)
        }
      }
    }

    const messages = [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      ...conv.messages
        .filter((m) => m.content.trim() !== '')
        .map((m) => ({ role: m.role, content: m.content })),
    ]

    const abort = new AbortController()
    abortRef.current = abort
    setIsGenerating(true)
    contentRef.current = ""
    thinkingRef.current = ""
    isThinkingRef.current = false

    try {
      const response = await chatStream(
        activeModel,
        messages,
        {
          temperature: settings.temperature,
          top_p: settings.topP,
          top_k: settings.topK,
          num_predict: settings.maxTokens || undefined,
        },
        abort.signal
      )

      let frameScheduled = false
      for await (const chunk of parseNDJSONStream<ChatChunk>(response)) {
        if (chunk.message?.content) {
          const text = chunk.message.content

          for (const char of text) {
            if (!isThinkingRef.current) {
              contentRef.current += char
              if (contentRef.current.endsWith("<think>")) {
                contentRef.current = contentRef.current.slice(0, -7)
                isThinkingRef.current = true
              }
            } else {
              thinkingRef.current += char
              if (thinkingRef.current.endsWith("</think>")) {
                thinkingRef.current = thinkingRef.current.slice(0, -8)
                isThinkingRef.current = false
              }
            }
          }

          if (!frameScheduled) {
            frameScheduled = true
            requestAnimationFrame(() => {
              const cId = convId!
              const mId = assistantMessage.id
              useChatStore.getState().updateMessageContent(cId, mId, contentRef.current)
              if (thinkingRef.current) {
                useChatStore.getState().updateMessageThinking(cId, mId, thinkingRef.current)
              }
              frameScheduled = false
            })
          }
        }
        if (chunk.done) {
          useChatStore
            .getState()
            .updateMessageContent(convId!, assistantMessage.id, contentRef.current)
          if (thinkingRef.current) {
            useChatStore
              .getState()
              .updateMessageThinking(convId!, assistantMessage.id, thinkingRef.current)
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        useChatStore.getState().updateMessageContent(
          convId!,
          assistantMessage.id,
          contentRef.current + "\n\n⚠️ Error: Connection failed"
        )
      }
    } finally {
      setIsGenerating(false)
      abortRef.current = null
    }
  }, [])

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { sendMessage, stopGeneration, isGenerating }
}
