import type { ChatStatus } from '../api/client'

export interface Message {
  id: string
  role: 'user' | 'bot'
  text: string
  sources?: string[]
  status?: ChatStatus
}

const STATUS_META: Record<ChatStatus, { label: string; className: string } | null> = {
  answered: null,
  escalated: { label: 'Routed to a human', className: 'tag tag-amber' },
  no_answer: { label: 'No match in the handbook', className: 'tag tag-muted' },
}

// Turn "leave-policy.md" into "Leave Policy" for a friendlier source chip.
function prettySource(file: string): string {
  return file
    .replace(/\.md$/, '')
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function ChatMessage({ message }: { message: Message }) {
  const { role, text, sources, status } = message

  if (role === 'user') {
    return (
      <div className="row row-user">
        <div className="bubble bubble-user">{text}</div>
      </div>
    )
  }

  const tag = status ? STATUS_META[status] : null
  const bubbleClass =
    status === 'escalated'
      ? 'bubble bubble-bot bubble-escalated'
      : status === 'no_answer'
        ? 'bubble bubble-bot bubble-muted'
        : 'bubble bubble-bot'

  return (
    <div className="row row-bot">
      <div className="avatar" aria-hidden="true">
        <span>RB</span>
      </div>
      <div className="bot-stack">
        <div className={bubbleClass}>{text}</div>
        {tag && <span className={tag.className}>{tag.label}</span>}
        {status === 'answered' && sources && sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">Source</span>
            {sources.map((s) => (
              <span key={s} className="chip">
                {prettySource(s)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
