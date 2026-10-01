import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  useRef,
} from 'react'
import { ApiError, loginRequest, meRequest, type User } from './api'

type AuthCtx = {
  user: User | null
  token: string | null
  loading: boolean
  expired: boolean
  bootError: boolean
  retryBoot: () => void
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
  const [expired, setExpired] = useState(false)
  const [bootError, setBootError] = useState(false)
  const [bootRetry, setBootRetry] = useState(0)
  const currentToken = useRef(token)
  const loginGeneration = useRef(0)
  useEffect(() => () => { loginGeneration.current++ }, [])
  useEffect(() => { currentToken.current = token }, [token])
  useEffect(() => {
    function expire(event: Event) {
      if ((event as CustomEvent<string>).detail !== currentToken.current) return
      loginGeneration.current++
      currentToken.current = null
      localStorage.removeItem(TOKEN_KEY)
      setToken(null); setUser(null); setExpired(true)
    }
    window.addEventListener('kidoland-session-expired', expire)
    return () => window.removeEventListener('kidoland-session-expired', expire)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function boot() {
      setBootError(false)
      if (!token) {
        setLoading(false)
        return
      }
      try {
        const { user } = await meRequest(token)
        if (!cancelled && token === currentToken.current) setUser(user)
      } catch (error) {
        if (!cancelled && token === currentToken.current) {
          if (error instanceof ApiError && error.status === 401) {
            localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); setExpired(true)
          } else setBootError(true)
        }
      } finally {
        if (!cancelled && token === currentToken.current) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [token, bootRetry])

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      token,
      loading,
      expired,
      bootError,
      retryBoot: () => { setLoading(true); setBootRetry((v) => v + 1) },
      login: async (email, password) => {
        const attempt = ++loginGeneration.current
        try {
          const { token: next, user } = await loginRequest(email, password)
          if (attempt !== loginGeneration.current) return 'cancelled'
          localStorage.setItem(TOKEN_KEY, next)
          setExpired(false)
          currentToken.current = next
          setBootError(false)
          setToken(next)
          setUser(user)
          return null
        } catch {
          return attempt === loginGeneration.current ? 'invalid' : 'cancelled'
        }
      },
      logout: () => {
        loginGeneration.current++
        currentToken.current = null
        setBootError(false)
        localStorage.removeItem(TOKEN_KEY)
        setExpired(false)
        setToken(null)
        setUser(null)
      },
    }),
    [user, token, loading, expired, bootError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside provider')
  return ctx
}
