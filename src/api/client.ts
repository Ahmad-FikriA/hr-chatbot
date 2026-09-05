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

export interface DocItem {
  filename: string
  name: string
  file_type: string
  equipment: string
}

export interface DocContent {
  filename: string
  name: string
  file_type: string
  content: string
  equipment: string
  total_pages?: number
}

export const getDocs = () =>
  request<DocItem[]>('/api/docs')

export const getDoc = (filepath: string) =>
  request<DocContent>(`/api/docs/${filepath.split('/').map(encodeURIComponent).join('/')}`)

export const getFileUrl = (filepath: string) =>
  `/api/files/${filepath.split('/').map(encodeURIComponent).join('/')}`

export const getPdfPageUrl = (filepath: string, page: number = 1, dpi: number = 150) =>
  `/api/pdf-page/${filepath.split('/').map(encodeURIComponent).join('/')}?page=${page}&dpi=${dpi}`

export interface UploadedDoc {
  filename: string
  name: string
  file_type: string
  equipment: string
  size_bytes?: number
  chunk_count?: number
}

/** Upload a single file to the user's personal knowledge store. */
export async function uploadFile(file: File): Promise<UploadedDoc> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/upload', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? `Upload failed (${res.status})`)
  }
  const data = await res.json() as { filename: string; file_type: string; chunk_count: number; size_bytes: number }
  return {
    filename: data.filename,
    name: data.filename,
    file_type: data.file_type,
    equipment: 'My Uploads',
    size_bytes: data.size_bytes,
    chunk_count: data.chunk_count,
  }
}

/** List all files the current user has uploaded in this session. */
export const getUploadedDocs = () =>
  request<UploadedDoc[]>('/api/upload')

/** Delete a previously uploaded document by filename. */
export async function deleteUploadedDoc(filename: string): Promise<void> {
  await request<{ ok: boolean }>(`/api/upload/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}
