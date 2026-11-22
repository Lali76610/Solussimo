import { useCallback, useEffect, useState } from 'react'
import type { EstablishmentRow, StaffMemberRow } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../tenant/useTenant'

/**
 * Établissements et équipe de l'entreprise active.
 * Le filtre company_id est un confort d'affichage : la RLS garantit de toute
 * façon qu'aucune ligne d'une autre entreprise ne peut être renvoyée.
 */
export function useCompanyData() {
  const { active } = useTenant()
  const companyId = active?.company.id ?? null
  const [establishments, setEstablishments] = useState<EstablishmentRow[]>([])
  const [staff, setStaff] = useState<StaffMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !companyId) return
    setLoading(true)
    const [est, st] = await Promise.all([
      supabase.from('establishments').select('*').eq('company_id', companyId).order('created_at'),
      supabase.from('staff_members').select('*').eq('company_id', companyId).order('created_at'),
    ])
    setError(Boolean(est.error || st.error))
    setEstablishments(est.data ?? [])
    setStaff(st.data ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  return { establishments, staff, loading, error, reload }
}
