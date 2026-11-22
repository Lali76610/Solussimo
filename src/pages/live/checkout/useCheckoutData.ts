import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  CashRegisterRow, EstablishmentRow, FiscalProfileRow, PaymentMethodRow, ProductRow, RegisterSessionRow, ServiceRow, StaffMemberRow,
} from '../../../lib/database.types'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { useCompanyData } from '../useCompanyData'

const EST_KEY = 'solussimo.checkoutEstablishment'

function readEst(): string | null {
  try {
    return localStorage.getItem(EST_KEY)
  } catch {
    return null
  }
}

/** Établissement de caisse choisi (mémorisé sur l'appareil, confort uniquement). */
export function useCheckoutEstablishment() {
  const { establishments, staff, assignments, loading } = useCompanyData()
  const [chosen, setChosen] = useState<string | null>(() => readEst())
  const establishment: EstablishmentRow | undefined = establishments.find((e) => e.id === chosen) ?? establishments[0]
  const choose = useCallback((id: string) => {
    setChosen(id)
    try {
      localStorage.setItem(EST_KEY, id)
    } catch {
      /* stockage indisponible : choix non mémorisé */
    }
  }, [])
  return { establishments, establishment, choose, staff, assignments, loading }
}

/** Données de caisse d'un établissement : profil fiscal, caisse, session ouverte, catalogue, moyens de paiement. */
export function useCheckoutData(establishmentId: string | undefined) {
  const { active } = useTenant()
  const companyId = active?.company.id
  const [profile, setProfile] = useState<FiscalProfileRow | null>(null)
  const [register, setRegister] = useState<CashRegisterRow | null>(null)
  const [session, setSession] = useState<RegisterSessionRow | null>(null)
  const [methods, setMethods] = useState<PaymentMethodRow[]>([])
  const [services, setServices] = useState<ServiceRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [staff, setStaff] = useState<StaffMemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !companyId || !establishmentId) return
    setLoading(true)
    const [fp, reg, ses, pm, svc, prod, assign] = await Promise.all([
      supabase.from('fiscal_profiles').select('*').eq('establishment_id', establishmentId).maybeSingle(),
      supabase.from('cash_registers').select('*').eq('establishment_id', establishmentId).eq('active', true).order('created_at').limit(1).maybeSingle(),
      supabase.from('register_sessions').select('*').eq('establishment_id', establishmentId).eq('status', 'open').order('opened_at').limit(1).maybeSingle(),
      supabase.from('payment_methods').select('*').eq('company_id', companyId).eq('active', true).order('sort'),
      supabase.from('services').select('*').eq('company_id', companyId).eq('active', true).order('name'),
      supabase.from('products').select('*').eq('company_id', companyId).eq('active', true).order('name'),
      supabase.from('staff_establishments').select('staff_id').eq('establishment_id', establishmentId),
    ])
    const ids = (assign.data ?? []).map((a) => a.staff_id)
    const st = ids.length
      ? await supabase.from('staff_members').select('*').in('id', ids).eq('active', true).order('display_name')
      : { data: [] as StaffMemberRow[], error: null }
    setError(Boolean(fp.error || reg.error || ses.error || pm.error || svc.error || prod.error || st.error))
    setProfile(fp.data)
    setRegister(reg.data)
    setSession(ses.data)
    setMethods(pm.data ?? [])
    setServices(svc.data ?? [])
    setProducts(prod.data ?? [])
    setStaff(st.data ?? [])
    setLoading(false)
  }, [companyId, establishmentId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const currency = profile?.currency ?? active?.company.currency ?? 'EUR'
  return useMemo(
    () => ({ profile, register, session, methods, services, products, staff, currency, loading, error, reload }),
    [profile, register, session, methods, services, products, staff, currency, loading, error, reload],
  )
}
