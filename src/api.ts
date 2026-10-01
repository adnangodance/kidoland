const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4000'

export type Role = 'parent' | 'teacher' | 'director'

export type User = {
  id: string
  name: string
  email: string
  role: Role
}

export async function loginRequest(email: string, password: string) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'login_failed')
  return data as { token: string; user: User }
}

export async function meRequest(token: string) {
  const res = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'unauthorized')
  return data as { user: User }
}
