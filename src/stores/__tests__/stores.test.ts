import { describe, it, expect, beforeEach } from 'vitest'
import { useChatStore } from '../chatStore'
import { useModelStore } from '../modelStore'
import { useAgentModeStore } from '../agentModeStore'
import { useMemoryStore } from '../memoryStore'
import type { Message } from '../../types/chat'
import type { AIModel } from '../../types/models'
import type { AgentBlock } from '../../types/agent-mode'

// ── Helpers ─────────────────────────────────────────────────────

const makeMessage = (role: 'user' | 'assistant', content: string, id?: string): Message => ({
  id: id || `msg-${Date.now()}-${Math.random()}`,
  role,
  content,
  timestamp: Date.now(),
})

const makeModel = (name: string, type: 'text' | 'image' = 'text'): AIModel => ({
  name,
  model: name,
  size: 1000000,
  type,
  ...(type === 'text'
    ? {
        digest: 'abc123',
        modified_at: new Date().toISOString(),
        details: {
          parent_model: '',
          format: 'gguf',
          family: 'llama',
          families: ['llama'],
          parameter_size: '7B',
          quantization_level: 'Q4_0',
        },
      }
    : {
        format: 'safetensors',
        architecture: 'sdxl',
      }),
} as AIModel)

// ═══════════════════════════════════════════════════════════════
//  chatStore
// ═══════════════════════════════════════════════════════════════

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({ conversations: [], activeConversationId: null })
  })

  describe('createConversation', () => {
    it('returns an id and sets it as active', () => {
      const id = useChatStore.getState().createConversation('llama3', 'You are helpful')
      expect(id).toBeTruthy()
      expect(typeof id).toBe('string')
      expect(useChatStore.getState().activeConversationId).toBe(id)
    })

    it('adds the conversation to the list', () => {
      const id = useChatStore.getState().createConversation('llama3', 'sys')
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)
      expect(conv).toBeDefined()
      expect(conv!.title).toBe('New Chat')
      expect(conv!.model).toBe('llama3')
      expect(conv!.messages).toEqual([])
    })

    it('prepends new conversations (most recent first)', () => {
      const id1 = useChatStore.getState().createConversation('a', '')
      const id2 = useChatStore.getState().createConversation('b', '')
      expect(useChatStore.getState().conversations[0].id).toBe(id2)
      expect(useChatStore.getState().conversations[1].id).toBe(id1)
    })
  })

  describe('addMessage', () => {
    it('appends a message to the conversation', () => {
      const id = useChatStore.getState().createConversation('m', '')
      const msg = makeMessage('user', 'hello')
      useChatStore.getState().addMessage(id, msg)
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.messages).toHaveLength(1)
      expect(conv.messages[0].content).toBe('hello')
    })

    it('auto-titles from first user message', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('user', 'What is the weather today?'))
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.title).toBe('What is the weather today?')
    })

    it('truncates auto-title at 50 characters', () => {
      const id = useChatStore.getState().createConversation('m', '')
      const longContent = 'A'.repeat(100)
      useChatStore.getState().addMessage(id, makeMessage('user', longContent))
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.title).toHaveLength(50)
    })

    it('does not auto-title from assistant messages', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('assistant', 'Hello user'))
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.title).toBe('New Chat')
    })

    it('does not re-title after first user message', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('user', 'First question'))
      useChatStore.getState().addMessage(id, makeMessage('user', 'Second question'))
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.title).toBe('First question')
    })
  })

  describe('updateMessageContent', () => {
    it('updates the content of a specific message', () => {
      const id = useChatStore.getState().createConversation('m', '')
      const msg = makeMessage('assistant', 'initial', 'msg-1')
      useChatStore.getState().addMessage(id, msg)
      useChatStore.getState().updateMessageContent(id, 'msg-1', 'updated')
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.messages[0].content).toBe('updated')
    })
  })

  describe('updateMessageThinking', () => {
    it('updates the thinking field of a message', () => {
      const id = useChatStore.getState().createConversation('m', '')
      const msg = makeMessage('assistant', 'response', 'msg-2')
      useChatStore.getState().addMessage(id, msg)
      useChatStore.getState().updateMessageThinking(id, 'msg-2', 'I need to think...')
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.messages[0].thinking).toBe('I need to think...')
    })
  })

  describe('updateMessageAgentBlocks', () => {
    it('updates the agentBlocks field of a message', () => {
      const id = useChatStore.getState().createConversation('m', '')
      const msg = makeMessage('assistant', 'response', 'msg-3')
      useChatStore.getState().addMessage(id, msg)

      const blocks: AgentBlock[] = [
        { id: 'b1', phase: 'thinking', content: 'Analyzing...', timestamp: Date.now() },
      ]
      useChatStore.getState().updateMessageAgentBlocks(id, 'msg-3', blocks)
      const conv = useChatStore.getState().conversations.find((c) => c.id === id)!
      expect(conv.messages[0].agentBlocks).toHaveLength(1)
      expect(conv.messages[0].agentBlocks![0].phase).toBe('thinking')
    })
  })

  describe('deleteConversation', () => {
    it('removes the conversation from the list', () => {
      const id = useChatStore.getState().createConversation('m', '')
      expect(useChatStore.getState().conversations).toHaveLength(1)
      useChatStore.getState().deleteConversation(id)
      expect(useChatStore.getState().conversations).toHaveLength(0)
    })

    it('clears activeConversationId when deleting the active one', () => {
      const id = useChatStore.getState().createConversation('m', '')
      expect(useChatStore.getState().activeConversationId).toBe(id)
      useChatStore.getState().deleteConversation(id)
      expect(useChatStore.getState().activeConversationId).toBeNull()
    })

    it('does not clear activeConversationId when deleting a different one', () => {
      const id1 = useChatStore.getState().createConversation('a', '')
      const id2 = useChatStore.getState().createConversation('b', '')
      // id2 is now active
      useChatStore.getState().deleteConversation(id1)
      expect(useChatStore.getState().activeConversationId).toBe(id2)
    })
  })

  describe('searchConversations', () => {
    it('matches by title', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('user', 'Weather forecast'))
      // Title is now "Weather forecast"
      const results = useChatStore.getState().searchConversations('weather')
      expect(results).toHaveLength(1)
    })

    it('matches by message content', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('user', 'First'))
      useChatStore.getState().addMessage(id, makeMessage('assistant', 'The quantum physics explanation'))
      const results = useChatStore.getState().searchConversations('quantum')
      expect(results).toHaveLength(1)
    })

    it('is case-insensitive', () => {
      const id = useChatStore.getState().createConversation('m', '')
      useChatStore.getState().addMessage(id, makeMessage('user', 'Hello World'))
      expect(useChatStore.getState().searchConversations('HELLO')).toHaveLength(1)
      expect(useChatStore.getState().searchConversations('hello')).toHaveLength(1)
    })

    it('returns empty when nothing matches', () => {
      useChatStore.getState().createConversation('m', '')
      expect(useChatStore.getState().searchConversations('xyznonexistent')).toHaveLength(0)
    })
  })

  describe('getActiveConversation', () => {
    it('returns the active conversation', () => {
      const id = useChatStore.getState().createConversation('m', 'sys')
      const active = useChatStore.getState().getActiveConversation()
      expect(active).toBeDefined()
      expect(active!.id).toBe(id)
    })

    it('returns undefined when no conversation is active', () => {
      expect(useChatStore.getState().getActiveConversation()).toBeUndefined()
    })
  })
})

// ═══════════════════════════════════════════════════════════════
//  modelStore
// ═══════════════════════════════════════════════════════════════

describe('modelStore', () => {
  beforeEach(() => {
    useModelStore.setState({
      models: [],
      activeModel: null,
      pullProgress: null,
      isPulling: false,
      categoryFilter: 'all',
    })
  })

  describe('setModels', () => {
    it('auto-selects first model if none is active', () => {
      useModelStore.getState().setModels([makeModel('llama3'), makeModel('mistral')])
      expect(useModelStore.getState().activeModel).toBe('llama3')
    })

    it('keeps existing active model if already set', () => {
      useModelStore.setState({ activeModel: 'mistral' })
      useModelStore.getState().setModels([makeModel('llama3'), makeModel('mistral')])
      expect(useModelStore.getState().activeModel).toBe('mistral')
    })

    it('handles empty array (no auto-select)', () => {
      useModelStore.getState().setModels([])
      expect(useModelStore.getState().activeModel).toBeNull()
      expect(useModelStore.getState().models).toEqual([])
    })
  })

  describe('setActiveModel', () => {
    it('sets the active model name', () => {
      useModelStore.getState().setActiveModel('phi3')
      expect(useModelStore.getState().activeModel).toBe('phi3')
    })
  })

  describe('setCategoryFilter', () => {
    it('updates the category filter', () => {
      useModelStore.getState().setCategoryFilter('image')
      expect(useModelStore.getState().categoryFilter).toBe('image')
    })

    it('defaults to "all"', () => {
      expect(useModelStore.getState().categoryFilter).toBe('all')
    })
  })
})

// ═══════════════════════════════════════════════════════════════
//  agentModeStore
// ═══════════════════════════════════════════════════════════════

describe('agentModeStore', () => {
  beforeEach(() => {
    useAgentModeStore.setState({
      agentModeActive: {},
      sandboxLevel: 'restricted',
      tutorialCompleted: false,
    })
  })

  describe('toggleAgentMode', () => {
    it('enables agent mode for a conversation', () => {
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      expect(useAgentModeStore.getState().agentModeActive['conv-1']).toBe(true)
    })

    it('toggles off when called again', () => {
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      expect(useAgentModeStore.getState().agentModeActive['conv-1']).toBe(false)
    })

    it('toggles independently per conversation', () => {
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      useAgentModeStore.getState().toggleAgentMode('conv-2')
      expect(useAgentModeStore.getState().agentModeActive['conv-1']).toBe(true)
      expect(useAgentModeStore.getState().agentModeActive['conv-2']).toBe(true)
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      expect(useAgentModeStore.getState().agentModeActive['conv-1']).toBe(false)
      expect(useAgentModeStore.getState().agentModeActive['conv-2']).toBe(true)
    })
  })

  describe('isActive', () => {
    it('returns false for unknown conversation', () => {
      expect(useAgentModeStore.getState().isActive('unknown-id')).toBe(false)
    })

    it('returns true after toggling on', () => {
      useAgentModeStore.getState().toggleAgentMode('conv-1')
      expect(useAgentModeStore.getState().isActive('conv-1')).toBe(true)
    })
  })

  describe('setTutorialCompleted', () => {
    it('sets tutorialCompleted to true', () => {
      expect(useAgentModeStore.getState().tutorialCompleted).toBe(false)
      useAgentModeStore.getState().setTutorialCompleted()
      expect(useAgentModeStore.getState().tutorialCompleted).toBe(true)
    })
  })
})

// ═══════════════════════════════════════════════════════════════
//  memoryStore
// ═══════════════════════════════════════════════════════════════

describe('memoryStore', () => {
  beforeEach(() => {
    useMemoryStore.setState({ entries: [], lastSynced: 0 })
  })

  describe('addEntry', () => {
    it('adds an entry to the store', () => {
      useMemoryStore.getState().addEntry('fact', 'The sky is blue')
      expect(useMemoryStore.getState().entries).toHaveLength(1)
      expect(useMemoryStore.getState().entries[0].content).toBe('The sky is blue')
      expect(useMemoryStore.getState().entries[0].category).toBe('fact')
    })

    it('deduplicates entries with same content and category', () => {
      useMemoryStore.getState().addEntry('fact', 'Duplicate')
      useMemoryStore.getState().addEntry('fact', 'Duplicate')
      expect(useMemoryStore.getState().entries).toHaveLength(1)
    })

    it('allows same content in different categories', () => {
      useMemoryStore.getState().addEntry('fact', 'Same text')
      useMemoryStore.getState().addEntry('decision', 'Same text')
      expect(useMemoryStore.getState().entries).toHaveLength(2)
    })

    it('skips empty content', () => {
      useMemoryStore.getState().addEntry('fact', '')
      useMemoryStore.getState().addEntry('fact', '   ')
      expect(useMemoryStore.getState().entries).toHaveLength(0)
    })

    it('trims whitespace from content', () => {
      useMemoryStore.getState().addEntry('fact', '  trimmed  ')
      expect(useMemoryStore.getState().entries[0].content).toBe('trimmed')
    })

    it('stores optional source', () => {
      useMemoryStore.getState().addEntry('tool_result', 'data', 'agent:web_search')
      expect(useMemoryStore.getState().entries[0].source).toBe('agent:web_search')
    })
  })

  describe('searchMemory', () => {
    beforeEach(() => {
      useMemoryStore.getState().addEntry('fact', 'TypeScript is a superset of JavaScript')
      useMemoryStore.getState().addEntry('fact', 'React uses virtual DOM')
      useMemoryStore.getState().addEntry('decision', 'We decided to use Zustand for state')
      useMemoryStore.getState().addEntry('context', 'The project uses Vite as bundler')
    })

    it('finds entries matching query words', () => {
      const results = useMemoryStore.getState().searchMemory('TypeScript JavaScript')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('TypeScript')
    })

    it('filters out words shorter than 3 characters', () => {
      // "is a" are both < 3 chars, "superset" is the only word that qualifies
      const results = useMemoryStore.getState().searchMemory('is a superset')
      expect(results.length).toBeGreaterThan(0)
      // Should match on "superset", not on "is" or "a"
      expect(results[0].content).toContain('superset')
    })

    it('returns recent entries when all query words are too short', () => {
      const results = useMemoryStore.getState().searchMemory('is a')
      // All words < 3 chars, so it returns last 20 entries
      expect(results).toHaveLength(4)
    })

    it('ranks results by number of matching words', () => {
      const results = useMemoryStore.getState().searchMemory('Zustand state')
      expect(results[0].content).toContain('Zustand')
    })

    it('returns empty for query that matches nothing', () => {
      const results = useMemoryStore.getState().searchMemory('xylophone')
      expect(results).toHaveLength(0)
    })
  })

  describe('getMemoryForPrompt', () => {
    it('returns formatted string with category labels', () => {
      useMemoryStore.getState().addEntry('fact', 'Earth orbits the Sun')
      const prompt = useMemoryStore.getState().getMemoryForPrompt('Earth Sun')
      expect(prompt).toContain('[Known fact]')
      expect(prompt).toContain('Earth orbits the Sun')
    })

    it('returns empty string when no relevant entries', () => {
      const prompt = useMemoryStore.getState().getMemoryForPrompt('xylophone')
      expect(prompt).toBe('')
    })

    it('respects maxChars limit', () => {
      for (let i = 0; i < 50; i++) {
        useMemoryStore.getState().addEntry('fact', `Fact number ${i} about testing memory store limits`)
      }
      const prompt = useMemoryStore.getState().getMemoryForPrompt('fact testing memory', 100)
      expect(prompt.length).toBeLessThanOrEqual(100 + 100) // some tolerance for the last line
    })

    it('uses correct category labels', () => {
      useMemoryStore.getState().addEntry('decision', 'Use Vitest for testing')
      useMemoryStore.getState().addEntry('tool_result', 'Search returned 5 results')
      useMemoryStore.getState().addEntry('context', 'Running on Windows')

      const prompt = useMemoryStore.getState().getMemoryForPrompt('Vitest search Windows testing results')
      expect(prompt).toContain('[Decision]')
      expect(prompt).toContain('[Previous result]')
      expect(prompt).toContain('[Context]')
    })
  })

  describe('exportAsMarkdown', () => {
    it('returns placeholder when no entries exist', () => {
      const md = useMemoryStore.getState().exportAsMarkdown()
      expect(md).toContain('# Agent Memory')
      expect(md).toContain('No entries yet')
    })

    it('groups entries by category with headers', () => {
      useMemoryStore.getState().addEntry('fact', 'Fact one')
      useMemoryStore.getState().addEntry('decision', 'Decision one')
      const md = useMemoryStore.getState().exportAsMarkdown()
      expect(md).toContain('## Facts')
      expect(md).toContain('## Decisions')
      expect(md).toContain('- Fact one')
      expect(md).toContain('- Decision one')
    })

    it('includes source when present', () => {
      useMemoryStore.getState().addEntry('fact', 'Some fact', 'agent:search')
      const md = useMemoryStore.getState().exportAsMarkdown()
      expect(md).toContain('*(agent:search)*')
    })
  })

  describe('importFromMarkdown', () => {
    it('parses categories and list items', () => {
      const md = `# Agent Memory

## Facts

- First fact
- Second fact

## Decisions

- Important decision
`
      useMemoryStore.getState().importFromMarkdown(md)
      const entries = useMemoryStore.getState().entries
      expect(entries).toHaveLength(3)
      expect(entries.filter((e) => e.category === 'fact')).toHaveLength(2)
      expect(entries.filter((e) => e.category === 'decision')).toHaveLength(1)
    })

    it('parses source from markdown format', () => {
      const md = `## Facts

- A fact *(user:manual)* — 4/1/2026
`
      useMemoryStore.getState().importFromMarkdown(md)
      const entries = useMemoryStore.getState().entries
      expect(entries).toHaveLength(1)
      expect(entries[0].source).toBe('user:manual')
    })

    it('defaults source to "import" when not present', () => {
      const md = `## Facts

- A plain fact
`
      useMemoryStore.getState().importFromMarkdown(md)
      expect(useMemoryStore.getState().entries[0].source).toBe('import')
    })

    it('appends to existing entries', () => {
      useMemoryStore.getState().addEntry('fact', 'Existing')
      useMemoryStore.getState().importFromMarkdown('## Decisions\n\n- Imported decision\n')
      expect(useMemoryStore.getState().entries).toHaveLength(2)
    })

    it('handles empty markdown gracefully', () => {
      useMemoryStore.getState().importFromMarkdown('')
      expect(useMemoryStore.getState().entries).toHaveLength(0)
    })
  })

  describe('clearAll', () => {
    it('removes all entries', () => {
      useMemoryStore.getState().addEntry('fact', 'one')
      useMemoryStore.getState().addEntry('decision', 'two')
      expect(useMemoryStore.getState().entries).toHaveLength(2)
      useMemoryStore.getState().clearAll()
      expect(useMemoryStore.getState().entries).toHaveLength(0)
    })

    it('updates lastSynced', () => {
      const before = useMemoryStore.getState().lastSynced
      useMemoryStore.getState().clearAll()
      expect(useMemoryStore.getState().lastSynced).toBeGreaterThanOrEqual(before)
    })
  })
})
