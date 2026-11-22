import { CalendarX } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import type { AppointmentRow, ResourceRow, ServiceRow, StaffMemberRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { dateKeyOf, hhmmToMinutes, localTimestamp, minutesOf, minutesToHHMM, type DateKey } from '../../../lib/tz'

export interface SheetTarget {
  appointment?: AppointmentRow
  staffId?: string
  date: DateKey
  minutes: number
}

interface Props {
  target: SheetTarget
  establishmentId: string
  timezone: string
  currency: string
  staff: StaffMemberRow[]
  services: ServiceRow[]
  resources: ResourceRow[]
  canWrite: boolean
  onClose: () => void
  onSaved: () => Promise<void>
}

export function AppointmentSheet({ target, establishmentId, timezone, currency, staff, services, resources, canWrite, onClose, onSaved }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const appt = target.appointment
  const activeServices = services.filter((s) => s.active || s.id === appt?.service_id)
  const [clientLabel, setClientLabel] = useState(appt?.client_label ?? '')
  const [serviceId, setServiceId] = useState(appt?.service_id ?? activeServices[0]?.id ?? '')
  const [staffId, setStaffId] = useState(appt?.staff_id ?? target.staffId ?? staff[0]?.id ?? '')
  const [date, setDate] = useState<DateKey>(appt ? dateKeyOf(new Date(appt.starts_at), timezone) : target.date)
  const [time, setTime] = useState(minutesToHHMM(appt ? minutesOf(new Date(appt.starts_at), timezone) : target.minutes))
  const [resourceId, setResourceId] = useState(appt?.resource_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const service = services.find((s) => s.id === serviceId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || busy) return
    setError(null)
    if (!clientLabel.trim() || !serviceId || !staffId) return setError(t('errors.invalidInput'))
    const start = localTimestamp(date, hhmmToMinutes(time))
    setBusy(true)
    const { error: err } = appt
      ? await supabase.rpc('reschedule_appointment', {
          p_appointment_id: appt.id, p_start_local: start, p_expected_version: appt.version,
          p_staff_id: staffId, p_service_id: serviceId, p_resource_id: resourceId || null, p_client_label: clientLabel.trim(),
        })
      : await supabase.rpc('book_appointment', {
          p_establishment_id: establishmentId, p_staff_id: staffId, p_service_id: serviceId,
          p_start_local: start, p_client_label: clientLabel.trim(), p_resource_id: resourceId || null,
        })
    setBusy(false)
    if (err) {
      const key = authErrorKey(err)
      if (key === 'errors.versionConflict') await onSaved()
      return setError(t(key))
    }
    await onSaved()
    onClose()
  }

  async function cancelAppointment() {
    if (!supabase || !appt || !window.confirm(t('planningLive.cancelConfirm'))) return
    setBusy(true)
    const { error: err } = await supabase.rpc('cancel_appointment', { p_appointment_id: appt.id, p_expected_version: appt.version })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    await onSaved()
    onClose()
  }

  return (
    <Sheet title={appt ? t('planningLive.editTitle') : t('planning.newAppointment')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="apClient" label={t('planningLive.client')} hint={t('planningLive.clientHint')}>
          <input id="apClient" maxLength={80} value={clientLabel} onChange={(e) => setClientLabel(e.target.value)} disabled={!canWrite}
            className="input" aria-describedby="apClient-hint" autoFocus={!appt} />
        </Field>
        <Field id="apService" label={t('planningLive.service')}>
          <select id="apService" value={serviceId} onChange={(e) => setServiceId(e.target.value)} disabled={!canWrite} className="input">
            {activeServices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {t('common.minutes', { count: s.duration_minutes })} · {formatCurrency(s.price_cents / 100, lang, currency)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="apStaff" label={t('planningLive.staff')}>
          <select id="apStaff" value={staffId} onChange={(e) => setStaffId(e.target.value)} disabled={!canWrite} className="input">
            {staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            {appt && !staff.some((s) => s.id === appt.staff_id) && <option value={appt.staff_id} disabled>—</option>}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="apDate" label={t('planningLive.date')}>
            <input id="apDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={!canWrite} className="input" />
          </Field>
          <Field id="apTime" label={t('planningLive.time')}>
            <input id="apTime" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} disabled={!canWrite} className="input" />
          </Field>
        </div>
        {resources.length > 0 && (
          <Field id="apResource" label={`${t('planningLive.resource')} (${t('common.optional')})`}>
            <select id="apResource" value={resourceId} onChange={(e) => setResourceId(e.target.value)} disabled={!canWrite} className="input">
              <option value="">—</option>
              {resources.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        )}
        {service && (
          <p className="text-xs text-slate-500">
            {t('planningLive.endsAt', { time: minutesToHHMM(hhmmToMinutes(time) + service.duration_minutes) })} · {t('planningLive.timezoneNote', { tz: timezone })}
          </p>
        )}
        <FormMessage kind="error">{error}</FormMessage>
        {canWrite && (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <button type="submit" className="btn-primary flex-1" disabled={busy}>{busy ? t('common.saving') : appt ? t('planningLive.saveChanges') : t('planningLive.book')}</button>
            {appt && (
              <button type="button" onClick={() => void cancelAppointment()} disabled={busy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-rose-600 hover:bg-rose-50">
                <CalendarX className="size-4" aria-hidden="true" />{t('planningLive.cancelAppointment')}
              </button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
