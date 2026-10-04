import { createContext, useContext } from 'react'
import type { User } from './api'

export type AuthCtx = {
  user: User | null
  token: string | null
  loading: boolean
  expired: boolean
  bootError: boolean
  retryBoot: () => void
  login: (email: string, password: string) => Promise<string | null>
  logout: () => void
}

// Lives outside the provider component module so Vite Fast Refresh keeps the
// same context identity when auth.tsx is edited.
export const AuthContext = createContext<AuthCtx | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
