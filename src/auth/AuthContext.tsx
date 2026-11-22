import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppLocale, ProfileRow } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import { clearDemoSession, DEMO_USER, readDemoSession, SESSION_TTL_MS, writeDemoSession, type DemoUser } from './session'

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'demo'; demo: DemoUser }
  | { status: 'live'; session: Session; profile: ProfileRow | null }

export interface SignUpInput {
  email: string
  password: string
  displayName: string
  locale: AppLocale
}

export interface AuthContextValue {
  state: AuthState
  /** true après un clic sur le lien « mot de passe oublié » reçu par e-mail */
  passwordRecovery: boolean
  enterDemo: () => void
  signIn: (email: string, password: string) => Promise<void>
  signUp: (input: SignUpInput) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | null>(null)

function requireClient() {
  if (!supabase) throw new Error('supabase_not_configured')
  return supabase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(!supabase)
  const [profile, setProfile] = useState<ProfileRow | null>(null)
  const [demo, setDemo] = useState<DemoUser | null>(() => readDemoSession())
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  // --- Session Supabase -------------------------------------------------------
  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setSessionLoaded(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') setProfile(null)
    })
    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user.id ?? null

  const refreshProfile = useCallback(async () => {
    if (!supabase || !userId) return
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data ?? null)
  }, [userId])

  useEffect(() => {
    // Chargement asynchrone du profil (hors du callback onAuthStateChange).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProfile()
  }, [refreshProfile])

  // Une session réelle remplace toujours le mode démo.
  useEffect(() => {
    if (session && demo) {
      clearDemoSession()
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDemo(null)
    }
  }, [session, demo])

  // --- Mode démonstration : expiration après inactivité -----------------------
  const leaveDemo = useCallback(() => {
    clearDemoSession()
    setDemo(null)
  }, [])

  useEffect(() => {
    if (!demo) return
    let timer = window.setTimeout(leaveDemo, SESSION_TTL_MS)
    const refresh = () => {
      window.clearTimeout(timer)
      writeDemoSession(demo)
      timer = window.setTimeout(leaveDemo, SESSION_TTL_MS)
    }
    const events = ['pointerdown', 'keydown'] as const
    events.forEach((e) => window.addEventListener(e, refresh, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((e) => window.removeEventListener(e, refresh))
    }
  }, [demo, leaveDemo])

  // --- Actions ----------------------------------------------------------------
  const enterDemo = useCallback(() => {
    writeDemoSession(DEMO_USER)
    setDemo(DEMO_USER)
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await requireClient().auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async ({ email, password, displayName, locale }: SignUpInput) => {
    const { error } = await requireClient().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim(), locale },
        emailRedirectTo: `${window.location.origin}/creer-salon`,
      },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (demo) return leaveDemo()
    if (supabase) await supabase.auth.signOut()
    setPasswordRecovery(false)
  }, [demo, leaveDemo])

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await requireClient().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/nouveau-mot-de-passe`,
    })
    if (error) throw error
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await requireClient().auth.updateUser({ password })
    if (error) throw error
    setPasswordRecovery(false)
  }, [])

  const state: AuthState = useMemo(() => {
    if (!sessionLoaded) return { status: 'loading' }
    if (session) return { status: 'live', session, profile }
    if (demo) return { status: 'demo', demo }
    return { status: 'signedOut' }
  }, [sessionLoaded, session, profile, demo])

  const value = useMemo<AuthContextValue>(
    () => ({ state, passwordRecovery, enterDemo, signIn, signUp, signOut, requestPasswordReset, updatePassword, refreshProfile }),
    [state, passwordRecovery, enterDemo, signIn, signUp, signOut, requestPasswordReset, updatePassword, refreshProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
