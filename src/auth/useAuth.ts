import { useContext } from 'react'
import { AuthContext } from './AuthContext'

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  const { state } = ctx
  const displayName =
    state.status === 'demo'
      ? state.demo.displayName
      : state.status === 'live'
        ? (state.profile?.display_name ?? state.session.user.email?.split('@')[0] ?? '')
        : ''
  return {
    ...ctx,
    isDemo: state.status === 'demo',
    isLive: state.status === 'live',
    displayName,
  }
}
