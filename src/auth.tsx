import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { loginRequest, meRequest, type User } from './api'

type AuthCtx = {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<string | null>
  logout: () => void
}

const AuthContext = createContext<AuthCtx | null>(null)
const TOKEN_KEY = 'kidoland.token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_KEY),
  )
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const { user } = await meRequest(token)
        if (!cancelled) setUser(user)
      } catch {
        localStorage.removeItem(TOKEN_KEY)
        if (!cancelled) {
          setToken(null)
          setUser(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [token])

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      token,
      loading,
      login: async (email, password) => {
        try {
          const { token: next, user } = await loginRequest(email, password)
          localStorage.setItem(TOKEN_KEY, next)
          setToken(next)
          setUser(user)
          return null
        } catch {
          return 'invalid'
        }
      },
      logout: () => {
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setUser(null)
      },
    }),
    [user, token, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
