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
  photoConsent: boolean
}

export type AttendanceStatus = 'present' | 'absent'
export type AttendanceEntry = {
  id: string
  childId: string
  childName: string
  groupName: string
  attendanceDate: string
  status: AttendanceStatus
  markedBy: string
  updatedAt: string
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


export type Invoice = {
  id: string
  childId: string
  childName: string
  groupName: string
  amountCents: number
  currency: string
  periodLabel: string
  status: 'pending' | 'paid'
  dueDate: string
  paidAt: string | null
  createdBy: string
  createdAt: string
  notes: string | null
  items: { id: string; description: string; amountCents: number }[]
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function api<T>(path: string, opts: RequestInit = {}, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string> | undefined),
  }
  if (opts.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const deadline = AbortSignal.timeout(15_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline
  const res = await fetch(`${API_URL}${path}`, { ...opts, headers, signal })
  const data = await res.json()
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new CustomEvent('kidoland-session-expired', { detail: token }))
    throw new ApiError(data.error || 'request_failed', res.status)
  }
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

export async function listAttendance(token: string, date: string, childId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ date })
  if (childId) query.set('childId', childId)
  return api<{ attendance: AttendanceEntry[] }>(`/api/attendance?${query}`, { signal }, token)
}

export async function saveAttendance(
  token: string,
  body: { childId: string; attendanceDate: string; status: AttendanceStatus },
) {
  return api<{ attendance: AttendanceEntry }>(
    '/api/attendance', { method: 'POST', body: JSON.stringify(body) }, token,
  )
}

export async function listReports(token: string, childId?: string, date?: string, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (childId) query.set('childId', childId)
  if (date) query.set('date', date)
  return api<{ reports: Report[] }>(`/api/reports?${query}`, { signal }, token)
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

export async function listInvoices(token: string) {
  return api<{ invoices: Invoice[] }>('/api/invoices', {}, token)
}

export async function createInvoice(
  token: string,
  body: {
    childId: string
    requestId?: string
    items: { description: string; amountCents: number }[]
    currency?: string
    periodLabel: string
    dueDate: string
    notes?: string
  },
) {
  return api<{ invoice: Invoice }>(
    '/api/invoices',
    { method: 'POST', body: JSON.stringify(body) },
    token,
  )
}

export async function markInvoicePaid(token: string, id: string) {
  return api<{ invoice: Invoice }>(
    `/api/invoices/${encodeURIComponent(id)}/paid`,
    { method: 'PATCH' },
    token,
  )
}

export type ChildInput = Pick<Child, 'name' | 'groupName' | 'parentUserId'>
export const listParents = (token: string) => api<{ parents: User[] }>('/api/parents', {}, token)
export const createParent = (token: string, body: { name: string; email: string; password: string }) => api<{ parent: User }>('/api/parents', { method: 'POST', body: JSON.stringify(body) }, token)
export const createChild = (token: string, body: ChildInput & { requestId?: string }) => api<{ child: Child }>('/api/children', { method: 'POST', body: JSON.stringify(body) }, token)
export const updateChild = (token: string, id: string, body: ChildInput) => api<{ child: Child }>(`/api/children/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, token)
export const saveConsent = (token: string, id: string, photoConsent: boolean) => api<{ child: Child }>(`/api/children/${encodeURIComponent(id)}/consent`, { method: 'PATCH', body: JSON.stringify({ photoConsent }) }, token)
export type DashboardSummary = { date: string; children: number; present: number; absent: number; unmarked: number; reports: number; unpaidInvoices: number; unpaidBalances: { currency: string; amountCents: string }[]; childSummaries: { id: string; name: string; groupName: string; photoConsent: boolean; attendanceStatus: AttendanceStatus | null; hasReport: boolean }[] }
export const getDashboard = (token: string, date: string) => api<{ summary: DashboardSummary }>(`/api/dashboard?date=${encodeURIComponent(date)}`, {}, token)
