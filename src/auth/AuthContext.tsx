import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authenticate, clearSession, readSession, SESSION_TTL_MS, writeSession, type SessionUser } from './session'

interface AuthContextValue {
  user: SessionUser | null
  login: (email: string, password: string) => Promise<boolean>
  logout: () => void
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => readSession())

  const logout = useCallback(() => {
    clearSession()
    setUser(null)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authenticate(email, password)
    if (result) {
      writeSession(result)
      setUser(result)
    }
    return result !== null
  }, [])

  // Déconnexion automatique après inactivité ; toute interaction prolonge la session.
  useEffect(() => {
    if (!user) return
    let timer = window.setTimeout(logout, SESSION_TTL_MS)
    const refresh = () => {
      window.clearTimeout(timer)
      writeSession(user)
      timer = window.setTimeout(logout, SESSION_TTL_MS)
    }
    const events = ['pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, refresh, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, refresh))
    }
  }, [user, logout])

  const value = useMemo(() => ({ user, login, logout }), [user, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
