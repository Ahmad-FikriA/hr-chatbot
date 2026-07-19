import { useEffect, useRef, useState } from 'react'
import { askBot, getDocs, getDoc } from '../api/client'
import { ChatMessage, type Message } from '../components/ChatMessage'
import { useAuth } from '../auth/AuthContext'

const SUGGESTIONS = [
  'How many days of annual leave do I get?',
  'Berapa hari cuti tahunan saya?',
  'Apa itu THR dan kapan dibayarkan?',
  'What does BPJS Kesehatan cover?',
]

// Friendlier document names
function prettySource(file: string): string {
  return file
    .replace(/\.md$/, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function parseInlineMarkdown(text: string) {
  const parts = text.split('**')
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <strong key={index}>{part}</strong>
    }
    return part
  })
}

export function Chat() {
  const { user, logout } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Sidebar & Document Preview States
  const [docsList, setDocsList] = useState<string[]>([])
  const [sidebarOpen, setSidebarOpen] = useState(true) // Open by default on desktop
  const [activePreviewDoc, setActivePreviewDoc] = useState<string | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  // Load document list from backend on mount
  useEffect(() => {
    getDocs()
      .then(setDocsList)
      .catch((err) => console.error('Failed to load handbook documents list:', err))
  }, [])

  async function send(question: string) {
    const trimmed = question.trim()
    if (!trimmed || loading) return

    setError(null)
    setInput('')
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text: trimmed }])
    setLoading(true)

    try {
      const res = await askBot(trimmed)
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'bot',
          text: res.answer,
          sources: res.sources,
          status: res.status,
        },
      ])
      
      // Auto-preview first source chip if it is an answered message
      if (res.status === 'answered' && res.sources && res.sources.length > 0) {
        selectDoc(res.sources[0])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  // Fetch and display specific document content
  async function selectDoc(filename: string) {
    setActivePreviewDoc(filename)
    setPreviewLoading(true)
    setPreviewContent(null)
    try {
      const res = await getDoc(filename)
      setPreviewContent(res.content)
    } catch (err) {
      console.error(`Failed to load content for ${filename}:`, err)
      setPreviewContent(`Error: Failed to load document content for **${prettySource(filename)}**.`)
    } finally {
      setPreviewLoading(false)
    }
  }

  // Safe React element renderer for Markdown lines
  function renderMarkdown(text: string) {
    return text.split('\n').map((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('# ')) {
        return <h1 key={index} className="md-h1">{parseInlineMarkdown(trimmed.slice(2))}</h1>
      }
      if (trimmed.startsWith('## ')) {
        return <h2 key={index} className="md-h2">{parseInlineMarkdown(trimmed.slice(3))}</h2>
      }
      if (trimmed.startsWith('### ')) {
        return <h3 key={index} className="md-h3">{parseInlineMarkdown(trimmed.slice(4))}</h3>
      }
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        return <li key={index} className="md-li">{parseInlineMarkdown(trimmed.slice(2))}</li>
      }
      if (trimmed === '---') {
        return <hr key={index} className="md-hr" />
      }
      if (trimmed === '') {
        return <div key={index} className="md-spacer" />
      }
      return <p key={index} className="md-p">{parseInlineMarkdown(line)}</p>
    })
  }

  const empty = messages.length === 0

  return (
    <div className="layout-root">
      <header className="topbar">
        <div className="brand-section">
          <button 
            className={`sidebar-toggle ${sidebarOpen ? 'active' : ''}`} 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle Handbook Sidebar"
          >
            📚 Handbook
          </button>
          <div className="brand">
            <div className="brand-text">
              <span className="brand-name">ResBot</span>
              <span className="brand-sub">HR Resource Bot</span>
            </div>
          </div>
        </div>
        <div className="topbar-right">
          <span className="user-name">{user?.name || user?.email}</span>
          <button className="logout-btn" onClick={() => logout()}>Log out</button>
        </div>
      </header>

      <div className="layout-body">
        {/* Left Sidebar: List of files */}
        <aside className={`sidebar ${sidebarOpen ? 'open' : 'collapsed'}`}>
          <div className="sidebar-title">Handbook Files</div>
          <nav className="sidebar-nav">
            {docsList.map((filename) => (
              <button
                key={filename}
                className={`sidebar-item ${activePreviewDoc === filename ? 'active' : ''}`}
                onClick={() => selectDoc(filename)}
              >
                <span className="doc-icon">📄</span>
                <span className="doc-name">{prettySource(filename)}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Center Pane: Chat Area */}
        <div className="chat-container">
          <main className="scroll" ref={scrollRef}>
            <div className="thread">
              {empty && (
                <div className="welcome">
                  <p className="kicker">Hello there 👋</p>
                  <h1 className="welcome-title">
                    Ask me anything about <em>working here</em>.
                  </h1>
                  <p className="welcome-lede">
                    Leave, benefits, remote work, code of conduct — I answer from the official HR
                    handbook and always show my source. Sensitive matters go straight to a real person.
                  </p>
                  <div className="suggestions">
                    {SUGGESTIONS.map((s) => (
                      <button key={s} className="suggestion" onClick={() => send(s)}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) => (
                <ChatMessage 
                  key={m.id} 
                  message={m} 
                  onSelectSource={(sourceFile) => selectDoc(sourceFile)}
                />
              ))}

              {loading && (
                <div className="row row-bot">
                  <div className="avatar" aria-hidden="true">
                    <span>RB</span>
                  </div>
                  <div className="bubble bubble-bot typing" aria-label="Assistant is typing">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                  </div>
                </div>
              )}
            </div>
          </main>

          <footer className="composer-wrap">
            {error && <div className="error-banner">{error}</div>}
            <form
              className="composer"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <input
                className="composer-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about leave, benefits, policies…"
                aria-label="Your question"
                autoFocus
              />
              <button className="send" type="submit" disabled={loading || !input.trim()}>
                {loading ? 'Thinking…' : 'Ask'}
              </button>
            </form>
            <p className="disclaimer">
              Answers come from the company HR handbook and may be incomplete. For anything personal or
              urgent, contact HR directly.
            </p>
          </footer>
        </div>

        {/* Right Drawer: Document Preview Panel */}
        <aside className={`preview-drawer ${activePreviewDoc ? 'open' : 'collapsed'}`}>
          <div className="preview-header">
            <span className="preview-title">
              {activePreviewDoc ? prettySource(activePreviewDoc) : 'Document Preview'}
            </span>
            <button 
              className="preview-close" 
              onClick={() => setActivePreviewDoc(null)} 
              title="Close Preview"
            >
              ✕
            </button>
          </div>
          <div className="preview-content scroll">
            {previewLoading ? (
              <div className="preview-loading">
                <div className="spinner" />
                <span>Loading policy document...</span>
              </div>
            ) : previewContent ? (
              <article className="markdown-body">
                {renderMarkdown(previewContent)}
              </article>
            ) : (
              <div className="preview-empty">
                Select a document in the handbook list, or click a source chip in the chatbot thread to preview the policy.
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
