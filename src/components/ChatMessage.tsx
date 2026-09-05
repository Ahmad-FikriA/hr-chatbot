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

// Turn file paths into a clean friendly source label
function prettySource(file: string): string {
  const parts = file.split(/[\\/]/)
  const basename = parts[parts.length - 1]
  const cleanName = basename.replace(/\.(md|pdf|xlsx|xls|pptx|png|jpg|jpeg)$/i, '')
  
  // Clean up underscores and dashes
  return cleanName
    .replace(/^OPL-/, 'OPL: ')
    .replace(/[-_]+/g, ' ')
    .trim()
}

function getSourceIcon(file: string): string {
  const ext = file.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return '📄'
    case 'png':
    case 'jpg':
    case 'jpeg':
      return '🖼️'
    case 'xlsx':
    case 'xls':
      return '📊'
    case 'pptx':
      return '📑'
    case 'md':
    default:
      return '📝'
  }
}

import { MarkdownView } from './MarkdownView'

export function ChatMessage({
  message,
  onSelectSource,
  onImageClick,
}: {
  message: Message
  onSelectSource?: (source: string) => void
  onImageClick?: (src: string, alt?: string) => void
}) {
  const { role, text, sources, status } = message

  if (role === 'user') {
    return (
      <div className="row row-user">
        <div className="bubble bubble-user">
          <MarkdownView content={text} className="chat-markdown" onImageClick={onImageClick} />
        </div>
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
        <span>KB</span>
      </div>
      <div className="bot-stack">
        <div className={bubbleClass}>
          <MarkdownView content={text} className="chat-markdown" onImageClick={onImageClick} />
        </div>
        {tag && <span className={tag.className}>{tag.label}</span>}
        {status === 'answered' && sources && sources.length > 0 && (
          <div className="sources">
            <span className="sources-label">Sources:</span>
            {sources.map((s) => (
              <button
                key={s}
                className="chip chip-btn"
                onClick={() => onSelectSource?.(s)}
                title={`Preview ${s}`}
                type="button"
              >
                <span className="chip-icon">{getSourceIcon(s)}</span>
                <span className="chip-text">{prettySource(s)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


