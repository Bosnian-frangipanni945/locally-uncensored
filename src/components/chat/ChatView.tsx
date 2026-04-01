import { useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useChat } from '../../hooks/useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { RAGPanel } from './RAGPanel'
import { PersonaPanel } from '../personas/PersonaPanel'
import { ModelRecommendation } from '../models/ModelRecommendation'
import { Cpu, FileText } from 'lucide-react'

export function ChatView() {
  const { sendMessage, stopGeneration, isGenerating } = useChat()
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const activeModel = useModelStore((s) => s.activeModel)
  const models = useModelStore((s) => s.models)
  const [ragPanelOpen, setRagPanelOpen] = useState(false)

  // Check if current conversation has user messages
  const conversation = useChatStore((s) => {
    if (!s.activeConversationId) return undefined
    return s.conversations.find((c) => c.id === s.activeConversationId)
  })
  const hasUserMessages = conversation?.messages.some((m) => m.role === 'user') ?? false

  // Show welcome + personas only when no conversation is selected (homepage)
  if (!activeConversationId) {
    const hasModels = models.length > 0

    return (
      <div className="h-full flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-y-auto scrollbar-thin">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 flex items-center justify-center mb-4">
            <Cpu size={32} className="text-gray-400" />
          </div>
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">Locally Uncensored</h1>
          <p className="text-gray-500 mb-6 text-center max-w-md text-sm">
            Private, local AI. Choose a persona and start chatting.
          </p>

          {!hasModels && <ModelRecommendation />}

          {hasModels && !activeModel && (
            <div className="text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 rounded-lg px-4 py-2 mb-6">
              Select a model from the dropdown above to start chatting.
            </div>
          )}

          <PersonaPanel />
        </div>
        <ChatInput onSend={sendMessage} onStop={stopGeneration} isGenerating={isGenerating} />
      </div>
    )
  }

  return (
    <div className="h-full flex">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-end px-3 pt-1">
          <button
            onClick={() => setRagPanelOpen(!ragPanelOpen)}
            className={
              'p-1.5 rounded-lg transition-colors ' +
              (ragPanelOpen
                ? 'bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-300'
                : 'hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400')
            }
            title="Document Chat (RAG)"
          >
            <FileText size={16} />
          </button>
        </div>
        <MessageList isGenerating={isGenerating} />
        <ChatInput onSend={sendMessage} onStop={stopGeneration} isGenerating={isGenerating} />
      </div>
      <AnimatePresence>
        {ragPanelOpen && <RAGPanel conversationId={activeConversationId} />}
      </AnimatePresence>
    </div>
  )
}
