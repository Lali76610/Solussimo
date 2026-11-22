import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/useAuth'
import type { CompanyRole, CompanyRow, Permission } from '../lib/database.types'
import { supabase } from '../lib/supabase'

/**
 * Entreprise (tenant) active pour l'utilisateur connecté en mode réel.
 * L'isolation est garantie côté base par la RLS : ce contexte ne fait que
 * choisir laquelle des entreprises autorisées afficher.
 */

export interface CompanyMembership {
  role: CompanyRole
  company: CompanyRow
}

export interface TenantContextValue {
  loading: boolean
  error: boolean
  memberships: CompanyMembership[]
  active: CompanyMembership | null
  permissions: Permission[]
  can: (permission: Permission) => boolean
  setActiveCompany: (companyId: string) => void
  refresh: () => Promise<void>
}

const ACTIVE_KEY = 'solussimo.activeCompany'

// eslint-disable-next-line react-refresh/only-export-components
export const TenantContext = createContext<TenantContextValue | null>(null)

function readActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth()
  const userId = state.status === 'live' ? state.session.user.id : null
  const [fetching, setFetching] = useState(false)
  // Utilisateur pour lequel les adhésions ont réellement été chargées : évite de
  // conclure « aucune entreprise » avant la première requête (ex. rechargement de page).
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [memberships, setMemberships] = useState<CompanyMembership[]>([])
  const [activeId, setActiveId] = useState<string | null>(() => readActiveId())
  const [permissions, setPermissions] = useState<Permission[]>([])

  const refresh = useCallback(async () => {
    if (!supabase || !userId) {
      setMemberships([])
      setLoadedFor(null)
      return
    }
    setFetching(true)
    const { data, error: err } = await supabase
      .from('memberships')
      .select('role, company:companies(*)')
      .eq('user_id', userId)
      .order('created_at')
    setError(Boolean(err))
    const rows = ((data ?? []) as unknown as { role: CompanyRole; company: CompanyRow | null }[]).filter(
      (r): r is CompanyMembership => r.company !== null,
    )
    setMemberships(rows)
    setLoadedFor(userId)
    setFetching(false)
  }, [userId])

  const loading = fetching || (userId !== null && loadedFor !== userId)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  const active = useMemo(
    () => memberships.find((m) => m.company.id === activeId) ?? memberships[0] ?? null,
    [memberships, activeId],
  )

  useEffect(() => {
    if (!supabase || !active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPermissions([])
      return
    }
    let cancelled = false
    void supabase.rpc('my_permissions', { p_company_id: active.company.id }).then(({ data }) => {
      if (!cancelled) setPermissions((data as Permission[] | null) ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [active])

  const setActiveCompany = useCallback((companyId: string) => {
    setActiveId(companyId)
    try {
      localStorage.setItem(ACTIVE_KEY, companyId)
    } catch {
      /* préférence non persistée */
    }
  }, [])

  const value = useMemo<TenantContextValue>(
    () => ({
      loading,
      error,
      memberships,
      active,
      permissions,
      can: (p) => permissions.includes(p),
      setActiveCompany,
      refresh,
    }),
    [loading, error, memberships, active, permissions, setActiveCompany, refresh],
  )
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}
