import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { FullPageSpinner } from '../components/FullPageSpinner'
import { useTenant } from '../tenant/useTenant'
import { useAuth } from './useAuth'

/** Accès réservé à un utilisateur connecté (mode réel) ou en mode démo. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const location = useLocation()
  if (state.status === 'loading') return <FullPageSpinner />
  if (state.status === 'signedOut') return <Navigate to="/connexion" replace state={{ from: location.pathname }} />
  return <>{children}</>
}

/** Accès réservé au mode réel (Supabase). */
export function RequireLiveAuth({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  if (state.status === 'loading') return <FullPageSpinner />
  if (state.status !== 'live') return <Navigate to="/connexion" replace />
  return <>{children}</>
}

/** En mode réel, exige au moins une entreprise ; sinon redirige vers la création du salon. */
export function RequireCompany({ children }: { children: ReactNode }) {
  const { isLive } = useAuth()
  const { loading, memberships, error } = useTenant()
  if (!isLive) return <>{children}</>
  if (loading) return <FullPageSpinner />
  if (!error && memberships.length === 0) return <Navigate to="/creer-salon" replace />
  return <>{children}</>
}
