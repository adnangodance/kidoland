const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000'

export type Role = 'parent' | 'teacher' | 'director'

export type User = {
  id: string
  name: string
  email: string
  role: Role
}

export type Child = {
  id: string
  name: string
  groupName: string
  parentUserId: string
}

export type Report = {
  id: string
  childId: string
  childName: string
  groupName: string
  teacherUserId: string
  teacherName: string
  reportDate: string
  mood: string
  meals: string
  nap: string
  activities: string
  note: string
  createdAt: string
}

async function api<T>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (opts.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'request_failed')
  return data as T
}

export async function loginRequest(email: string, password: string) {
  return api<{ token: string; user: User }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function meRequest(token: string) {
  return api<{ user: User }>('/api/auth/me', {}, token)
}

export async function listChildren(token: string) {
  return api<{ children: Child[] }>('/api/children', {}, token)
}

export async function listReports(token: string, childId?: string) {
  const q = childId ? `?childId=${encodeURIComponent(childId)}` : ''
  return api<{ reports: Report[] }>(`/api/reports${q}`, {}, token)
}

export async function saveReport(
  token: string,
  body: {
    childId: string
    reportDate: string
    mood: string
    meals: string
    nap: string
    activities: string
    note: string
  },
) {
  return api<{ report: Report }>(
    '/api/reports',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  )
}
