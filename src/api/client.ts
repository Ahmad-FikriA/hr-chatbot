// Talks to the backend. Thanks to the Vite proxy, "/api/*" is forwarded to the
// Express server, so we never hard-code the backend URL. `credentials: 'include'`
// makes the browser send the auth cookie on every request.

export type ChatStatus = 'answered' | 'escalated' | 'no_answer'

export interface ChatResponse {
  answer: string
  sources: string[]
  status: ChatStatus
}

export interface User {
  id: number
  email: string
  name: string | null
  role: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

export const askBot = (question: string) =>
  request<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ question }) })

export const register = (data: { email: string; password: string; name?: string }) =>
  request<User>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) })

export const login = (data: { email: string; password: string }) =>
  request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) })

export const logout = () =>
  request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' })

// Returns the current user, or null if not logged in (a 401 is expected here).
export async function getMe(): Promise<User | null> {
  try {
    return await request<User>('/api/auth/me')
  } catch {
    return null
  }
}

export const getDocs = () =>
  request<string[]>('/api/docs')

export const getDoc = (filename: string) =>
  request<{ filename: string; content: string }>(`/api/docs/${encodeURIComponent(filename)}`)
