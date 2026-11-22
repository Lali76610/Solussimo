import { useCallback, useEffect, useState } from 'react'
import type { EstablishmentRow, StaffEstablishmentRow, StaffMemberRow } from '../../lib/database.types'
import { supabase } from '../../lib/supabase'
import { useTenant } from '../../tenant/useTenant'

/**
 * Établissements, équipe et affectations VISIBLES par l'utilisateur dans l'entreprise active.
 * Le filtre company_id est un confort : la RLS (entreprise + établissement) fait foi.
 */
export function useCompanyData() {
  const { active } = useTenant()
  const companyId = active?.company.id ?? null
  const [establishments, setEstablishments] = useState<EstablishmentRow[]>([])
  const [staff, setStaff] = useState<StaffMemberRow[]>([])
  const [assignments, setAssignments] = useState<StaffEstablishmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !companyId) return
    setLoading(true)
    const [est, st, as] = await Promise.all([
      supabase.from('establishments').select('*').eq('company_id', companyId).order('created_at'),
      supabase.from('staff_members').select('*').eq('company_id', companyId).order('display_name'),
      supabase.from('staff_establishments').select('*').eq('company_id', companyId),
    ])
    setError(Boolean(est.error || st.error || as.error))
    setEstablishments(est.data ?? [])
    setStaff(st.data ?? [])
    setAssignments(as.data ?? [])
    setLoading(false)
  }, [companyId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  return { establishments, staff, assignments, loading, error, reload }
}
