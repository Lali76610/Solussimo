import { Navigate, useLocation } from 'react-router'
import type { ReactNode } from 'react'
import { useAuth } from './useAuth'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />
  return <>{children}</>
}
