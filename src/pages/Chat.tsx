import { useEffect, useRef, useState } from 'react'
import { askBot } from '../api/client'
import { ChatMessage, type Message } from '../components/ChatMessage'
import { useAuth } from '../auth/AuthContext'

const SUGGESTIONS = [
  'How many days of annual leave do I get?',
  'Berapa hari cuti tahunan saya?',
  'Apa itu THR dan kapan dibayarkan?',
  'What does BPJS Kesehatan cover?',
]

export function Chat() {
  const { user, logout } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the latest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  const empty = messages.length === 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-text">
            <span className="brand-name">ResBot</span>
            <span className="brand-sub">HR Resource Bot</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="user-name">{user?.name || user?.email}</span>
          <button className="logout-btn" onClick={() => logout()}>Log out</button>
        </div>
      </header>

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
            <ChatMessage key={m.id} message={m} />
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
  )
}
