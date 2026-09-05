import React from 'react'

interface MarkdownViewProps {
  content: string
  className?: string
  onImageClick?: (src: string, alt?: string) => void
}

function parseInline(text: string): React.ReactNode[] {
  // Regex to split on bold (**...**), italic (*...*), inline code (`...`), markdown links [text](url)
  const regex = /(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g
  const parts = text.split(regex)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="inline-code">{part.slice(1, -1)}</code>
    }
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const closingBracket = part.indexOf('](')
      const label = part.slice(1, closingBracket)
      const url = part.slice(closingBracket + 2, -1)
      return (
        <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="md-link">
          {label}
        </a>
      )
    }
    return part
  })
}

export function MarkdownView({ content, className = 'markdown-body', onImageClick }: MarkdownViewProps) {
  if (!content) return null

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let tableRows: string[][] = []
  let inTable = false

  function flushTable(key: number) {
    if (tableRows.length === 0) return
    const [headerRow, ...bodyRows] = tableRows
    // Filter out separator row (e.g. |---|---|)
    const filteredBody = bodyRows.filter(row => !row.every(cell => /^[-: ]+$/.test(cell)))

    elements.push(
      <div key={`table-${key}`} className="md-table-wrap">
        <table className="md-table">
          <thead>
            <tr>
              {headerRow.map((cell, cIdx) => (
                <th key={cIdx}>{parseInline(cell.trim())}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredBody.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx}>{parseInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableRows = []
    inTable = false
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Table detection
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      inTable = true
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim())
      tableRows.push(cells)
      continue
    } else if (inTable) {
      flushTable(i)
    }

    // Markdown Image detection: ![alt](url)
    const imgMatch = trimmed.match(/^!\[(.*?)\]\((.*?)\)$/)
    if (imgMatch) {
      const [, alt, src] = imgMatch
      elements.push(
        <div key={i} className="md-image-wrap">
          <img
            src={src}
            alt={alt}
            className="md-image clickable"
            onClick={() => onImageClick?.(src, alt)}
          />
          {alt && <span className="md-image-caption">{alt}</span>}
        </div>
      )
      continue
    }

    if (trimmed.startsWith('# ')) {
      elements.push(<h1 key={i} className="md-h1">{parseInline(trimmed.slice(2))}</h1>)
      continue
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h2 key={i} className="md-h2">{parseInline(trimmed.slice(3))}</h2>)
      continue
    }
    if (trimmed.startsWith('### ')) {
      elements.push(<h3 key={i} className="md-h3">{parseInline(trimmed.slice(4))}</h3>)
      continue
    }
    if (trimmed.startsWith('#### ')) {
      elements.push(<h4 key={i} className="md-h4">{parseInline(trimmed.slice(5))}</h4>)
      continue
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <li key={i} className="md-li">
          {parseInline(trimmed.slice(2))}
        </li>
      )
      continue
    }
    if (/^\d+\.\s/.test(trimmed)) {
      const textAfterNumber = trimmed.replace(/^\d+\.\s/, '')
      elements.push(
        <li key={i} className="md-li md-oli">
          {parseInline(textAfterNumber)}
        </li>
      )
      continue
    }
    if (trimmed === '---' || trimmed === '***') {
      elements.push(<hr key={i} className="md-hr" />)
      continue
    }
    if (trimmed === '') {
      elements.push(<div key={i} className="md-spacer" />)
      continue
    }

    elements.push(
      <p key={i} className="md-p">
        {parseInline(line)}
      </p>
    )
  }

  if (inTable) {
    flushTable(lines.length)
  }

  return <div className={className}>{elements}</div>
}
