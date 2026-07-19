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

function parseInlineMarkdown(text: string) {
  const parts = text.split('**')
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      return <strong key={index}>{part}</strong>
    }
    return part
  })
}

export function ChatMessage({ message, onSelectSource }: { message: Message; onSelectSource?: (source: string) => void }) {
  const { role, text, sources, status } = message

  if (role === 'user') {
    return (
      <div className="row row-user">
        <div className="bubble bubble-user">{parseInlineMarkdown(text)}</div>
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
        <div className={bubbleClass}>{parseInlineMarkdown(text)}</div>
        {tag && <span className={tag.className}>{tag.label}</span>}
        {status === 'answered' && sources && sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">Source</span>
            {sources.map((s) => (
              <button
                key={s}
                className="chip chip-btn"
                onClick={() => onSelectSource?.(s)}
                title={`Preview ${prettySource(s)}`}
                type="button"
              >
                {prettySource(s)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
