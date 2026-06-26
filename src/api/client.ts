// Talks to the backend RAG bot. Thanks to the Vite proxy, "/api/chat" is
// forwarded to the Express server, so we never hard-code the backend URL.

export type ChatStatus = 'answered' | 'escalated' | 'no_answer'

export interface ChatResponse {
  answer: string
  sources: string[]
  status: ChatStatus
}

export async function askBot(question: string): Promise<ChatResponse> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }

  return res.json() as Promise<ChatResponse>
}
