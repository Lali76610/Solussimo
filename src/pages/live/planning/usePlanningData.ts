import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppointmentRow, ResourceRow, ServiceRow, StaffMemberRow, TimeOffRow, WorkingHoursRow } from '../../../lib/database.types'
import { supabase } from '../../../lib/supabase'
import { utcWindow, type DateKey } from '../../../lib/tz'

/** Données du planning d'un établissement sur une plage de jours locaux [from, to). */
export function usePlanningData(companyId: string | null, establishmentId: string | null, from: DateKey, to: DateKey) {
  const [staff, setStaff] = useState<StaffMemberRow[]>([])
  const [hours, setHours] = useState<WorkingHoursRow[]>([])
  const [timeOff, setTimeOff] = useState<TimeOffRow[]>([])
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [services, setServices] = useState<ServiceRow[]>([])
  const [resources, setResources] = useState<ResourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    if (!supabase || !companyId || !establishmentId) return
    setLoading(true)
    const w = utcWindow(from, to)
    const [assign, wh, svc, res, appts] = await Promise.all([
      supabase.from('staff_establishments').select('staff_id').eq('establishment_id', establishmentId),
      supabase.from('staff_working_hours').select('*').eq('establishment_id', establishmentId),
      supabase.from('services').select('*').eq('company_id', companyId).order('name'),
      supabase.from('resources').select('*').eq('establishment_id', establishmentId).order('name'),
      supabase.from('appointments').select('*').eq('establishment_id', establishmentId).neq('status', 'cancelled')
        .lt('starts_at', w.to).gt('ends_at', w.from).order('starts_at'),
    ])
    const ids = (assign.data ?? []).map((a) => a.staff_id)
    const [st, off] = ids.length
      ? await Promise.all([
          supabase.from('staff_members').select('*').in('id', ids).eq('active', true).order('display_name'),
          supabase.from('staff_time_off').select('*').in('staff_id', ids).lt('starts_at', w.to).gt('ends_at', w.from),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    setError(Boolean(assign.error || wh.error || svc.error || res.error || appts.error || st.error || off.error))
    setStaff(st.data ?? [])
    setHours(wh.data ?? [])
    setTimeOff(off.data ?? [])
    setServices(svc.data ?? [])
    setResources(res.data ?? [])
    setAppointments(appts.data ?? [])
    setLoading(false)
  }, [companyId, establishmentId, from, to])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload])

  const bookableStaff = useMemo(() => staff.filter((s) => s.bookable), [staff])
  // Affichés : réservables + ceux qui ont encore des rendez-vous sur la période (ils ne disparaissent pas).
  const plannedStaff = useMemo(
    () => staff.filter((s) => s.bookable || appointments.some((a) => a.staff_id === s.id)),
    [staff, appointments],
  )
  return { staff, bookableStaff, plannedStaff, hours, timeOff, appointments, services, resources, loading, error, reload }
}
