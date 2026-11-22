import { CalendarPlus, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Avatar } from '../../../components/Avatar'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import type { AppointmentRow, StaffMemberRow, TimeOffRow, WorkingHoursRow } from '../../../lib/database.types'
import { capitalizeFirst, formatDate } from '../../../lib/format'
import { addDays, dateKeyOf, hhmmToMinutes, isoWeekday, keyToDisplayDate, minutesOf, minutesToHHMM, startOfWeek, todayKey, zonedToUtc, type DateKey } from '../../../lib/tz'
import { useTenant } from '../../../tenant/useTenant'
import { useCompanyData } from '../useCompanyData'
import { AppointmentSheet, type SheetTarget } from './AppointmentSheet'
import { usePlanningData } from './usePlanningData'

const HOUR = 64 // px par heure
const STEP = 15 // minutes : granularité du tap sur un créneau

interface Column {
  key: string
  staff: StaffMemberRow
  date: DateKey
  title: string
  subtitle: string
}

export function LivePlanningPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active, can } = useTenant()
  const { establishments } = useCompanyData()
  const [estId, setEstId] = useState<string | null>(null)
  const establishment = establishments.find((e) => e.id === estId) ?? establishments[0] ?? null
  const tz = establishment?.timezone ?? 'Europe/Paris'
  const [view, setView] = useState<'day' | 'week'>('day')
  const [day, setDay] = useState<DateKey>(() => todayKey(tz))
  const [weekStaffId, setWeekStaffId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)

  useEffect(() => {
    // Recalage sur « aujourd'hui » dans le fuseau de l'établissement choisi.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (establishment) setDay(todayKey(establishment.timezone))
  }, [establishment])

  const from = view === 'day' ? day : startOfWeek(day)
  const to = addDays(from, view === 'day' ? 1 : 7)
  const data = usePlanningData(active?.company.id ?? null, establishment?.id ?? null, from, to)
  const weekStaff = data.plannedStaff.find((s) => s.id === weekStaffId) ?? data.plannedStaff[0] ?? null

  const columns: Column[] = useMemo(() => {
    if (view === 'day') {
      return data.plannedStaff.map((s) => ({ key: s.id, staff: s, date: day, title: s.display_name, subtitle: s.jobs.map((j) => t(`roles.${j}`)).join(', ') }))
    }
    if (!weekStaff) return []
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(from, i)
      return {
        key: d,
        staff: weekStaff,
        date: d,
        title: capitalizeFirst(formatDate(keyToDisplayDate(d), lang, { weekday: 'short', timeZone: 'UTC' })),
        subtitle: formatDate(keyToDisplayDate(d), lang, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
      }
    })
  }, [view, data.plannedStaff, weekStaff, day, from, lang, t])

  // Plage horaire affichée : des premiers horaires d'ouverture aux derniers (par défaut 9 h – 19 h).
  const [startHour, endHour] = useMemo(() => {
    const relevant = data.hours.filter((h) => columns.some((c) => c.staff.id === h.staff_id && isoWeekday(c.date) === h.weekday))
    if (relevant.length === 0) return [9, 19]
    const min = Math.min(...relevant.map((h) => hhmmToMinutes(h.start_time)))
    const max = Math.max(...relevant.map((h) => hhmmToMinutes(h.end_time)))
    return [Math.floor(min / 60), Math.min(24, Math.ceil(max / 60))]
  }, [data.hours, columns])
  const hoursList = Array.from({ length: endHour - startHour }, (_, i) => startHour + i)
  const canWrite = can('appointment.write')

  if (!active) return null
  if (!establishment) return <p className="card p-6 text-sm text-slate-500">{t('planningLive.noEstablishment')}</p>

  const title = view === 'day'
    ? capitalizeFirst(formatDate(keyToDisplayDate(day), lang, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }))
    : `${formatDate(keyToDisplayDate(from), lang, { day: 'numeric', month: 'short', timeZone: 'UTC' })} – ${formatDate(keyToDisplayDate(addDays(to, -1)), lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`

  return (
    <div>
      <PageHeader
        title={t('planning.title')}
        subtitle={establishment.name}
        actions={
          <>
            {can('service.write') && (
              <Link to="/planning/prestations" className="btn-secondary"><Settings2 className="size-4" aria-hidden="true" />{t('planningLive.servicesLink')}</Link>
            )}
            {canWrite && data.bookableStaff.length > 0 && data.services.some((s) => s.active) && (
              <button type="button" className="btn-primary" onClick={() => setSheet({ date: day, minutes: Math.max(startHour * 60, 9 * 60), staffId: view === 'week' ? weekStaff?.id : undefined })}>
                <CalendarPlus className="size-4" aria-hidden="true" />{t('planning.newAppointment')}
              </button>
            )}
          </>
        }
      />

      <div className="card mb-4 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDay(addDays(day, view === 'day' ? -1 : -7))} className="grid size-10 place-items-center rounded-lg hover:bg-slate-100" aria-label={t('planning.previous')}>
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" onClick={() => setDay(todayKey(tz))} className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-50">{t('planning.today')}</button>
            <button type="button" onClick={() => setDay(addDays(day, view === 'day' ? 1 : 7))} className="grid size-10 place-items-center rounded-lg hover:bg-slate-100" aria-label={t('planning.next')}>
              <ChevronRight className="size-5" />
            </button>
            <span className="ml-1 text-sm font-medium text-slate-700">{title}</span>
          </div>
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm" role="tablist">
            {(['day', 'week'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`min-h-9 rounded-md px-3 font-medium ${view === v ? 'bg-white text-brand shadow-sm' : 'text-slate-500'}`}>
                {t(`planning.${v}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {establishments.length > 1 && (
            <select value={establishment.id} onChange={(e) => setEstId(e.target.value)} className="input min-h-10 w-auto py-1.5" aria-label={t('staffLive.establishment')}>
              {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
          {view === 'week' && data.plannedStaff.length > 0 && (
            <select value={weekStaff?.id} onChange={(e) => setWeekStaffId(e.target.value)} className="input min-h-10 w-auto py-1.5" aria-label={t('planningLive.staff')}>
              {data.plannedStaff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
            </select>
          )}
        </div>
      </div>

      {data.error && <FormMessage kind="error">{t('live.loadError')}</FormMessage>}
      {!data.loading && data.services.filter((s) => s.active).length === 0 && (
        <p className="card mb-4 p-4 text-sm text-slate-600">
          {t('planningLive.noServices')}{' '}
          {can('service.write') && <Link to="/planning/prestations" className="font-semibold text-brand">{t('planningLive.servicesLink')}</Link>}
        </p>
      )}
      {!data.loading && data.bookableStaff.length === 0 && (
        <p className="card mb-4 p-4 text-sm text-slate-600">{t('planningLive.noStaff')} <Link to="/personnel" className="font-semibold text-brand">{t('staff.title')}</Link></p>
      )}

      {columns.length > 0 && (
        <div className="card overflow-x-auto" data-testid="planning-grid">
          <div style={{ minWidth: 56 + columns.length * (view === 'day' ? 150 : 110) }}>
            <div className="sticky top-0 z-10 grid border-b border-slate-100 bg-white" style={{ gridTemplateColumns: `56px repeat(${columns.length}, 1fr)` }}>
              <div />
              {columns.map((c) => (
                <div key={c.key} className="flex items-center gap-2 border-l border-slate-100 px-2 py-2.5">
                  {view === 'day' && <Avatar name={c.staff.display_name} color={c.staff.color} size="sm" />}
                  {!c.staff.bookable && <span className="sr-only">{t('staffLive.notBookable')}</span>}
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-semibold ${view === 'week' && c.date === todayKey(tz) ? 'text-brand' : 'text-slate-900'}`}>{c.title}</p>
                    <p className="truncate text-[11px] text-slate-500">{c.staff.bookable ? c.subtitle : t('staffLive.notBookable')}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid" style={{ gridTemplateColumns: `56px repeat(${columns.length}, 1fr)` }}>
              <div>
                {hoursList.map((h) => (
                  <div key={h} className="pr-2 text-right text-[11px] text-slate-400" style={{ height: HOUR }}>{minutesToHHMM(h * 60)}</div>
                ))}
              </div>
              {columns.map((c) => (
                <DayColumn
                  key={c.key}
                  column={c}
                  tz={tz}
                  startHour={startHour}
                  endHour={endHour}
                  hours={data.hours}
                  timeOff={data.timeOff}
                  appointments={data.appointments}
                  serviceColor={(id) => data.services.find((s) => s.id === id)?.color ?? '#008B8B'}
                  serviceName={(id) => data.services.find((s) => s.id === id)?.name ?? ''}
                  onEmpty={(minutes) => canWrite && c.staff.bookable && data.services.some((s) => s.active) && setSheet({ date: c.date, minutes, staffId: c.staff.id })}
                  onOpen={(a) => setSheet({ appointment: a, date: c.date, minutes: 0 })}
                  freeLabel={t('planningLive.freeSlot')}
                  offLabel={t('planningLive.unavailable')}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{t('planningLive.timezoneNote', { tz })}</p>

      {sheet && (
        <AppointmentSheet
          target={sheet}
          establishmentId={establishment.id}
          timezone={tz}
          currency={active.company.currency}
          staff={data.bookableStaff}
          services={data.services}
          resources={data.resources}
          canWrite={canWrite}
          onClose={() => setSheet(null)}
          onSaved={data.reload}
        />
      )}
    </div>
  )
}

interface DayColumnProps {
  column: Column
  tz: string
  startHour: number
  endHour: number
  hours: WorkingHoursRow[]
  timeOff: TimeOffRow[]
  appointments: AppointmentRow[]
  serviceColor: (id: string) => string
  serviceName: (id: string) => string
  onEmpty: (minutes: number) => void
  onOpen: (a: AppointmentRow) => void
  freeLabel: string
  offLabel: string
}

function DayColumn({ column, tz, startHour, endHour, hours, timeOff, appointments, serviceColor, serviceName, onEmpty, onOpen, freeLabel, offLabel }: DayColumnProps) {
  const base = startHour * 60
  const toPx = (min: number) => ((min - base) / 60) * HOUR
  const height = (endHour - startHour) * HOUR
  const weekday = isoWeekday(column.date)
  const working = hours.filter((h) => h.staff_id === column.staff.id && h.weekday === weekday)
    .map((h) => [hhmmToMinutes(h.start_time), hhmmToMinutes(h.end_time)] as const)

  // Absences : intersection avec la journée locale.
  const dayStart = zonedToUtc(column.date, 0, tz).getTime()
  const dayEnd = zonedToUtc(addDays(column.date, 1), 0, tz).getTime()
  const offBlocks = timeOff.filter((o) => o.staff_id === column.staff.id && Date.parse(o.starts_at) < dayEnd && Date.parse(o.ends_at) > dayStart)
    .map((o) => {
      const s = Math.max(Date.parse(o.starts_at), dayStart), e = Math.min(Date.parse(o.ends_at), dayEnd)
      return [s === dayStart ? 0 : minutesOf(new Date(s), tz), e === dayEnd ? 24 * 60 : minutesOf(new Date(e), tz)] as const
    })
  const appts = appointments.filter((a) => a.staff_id === column.staff.id && dateKeyOf(new Date(a.starts_at), tz) === column.date)

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.slot) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const minutes = base + Math.floor(((y / HOUR) * 60) / STEP) * STEP
    onEmpty(minutes)
  }

  return (
    <div className="relative border-l border-slate-100 bg-slate-100/70" style={{ height }} onClick={handleClick} role="presentation" aria-label={freeLabel}>
      {working.map(([s, e]) => (
        <div key={s} data-slot="1" className="absolute inset-x-0 bg-white" style={{ top: toPx(s), height: toPx(e) - toPx(s) }} />
      ))}
      {Array.from({ length: endHour - startHour }, (_, i) => (
        <div key={i} data-slot="1" className="pointer-events-none absolute inset-x-0 border-b border-dashed border-slate-200" style={{ top: (i + 1) * HOUR - 1 }} />
      ))}
      {offBlocks.map(([s, e], i) => (
        <div key={i} className="absolute inset-x-0 flex items-start justify-center bg-[repeating-linear-gradient(135deg,#efe6d3_0,#efe6d3_6px,#fff_6px,#fff_12px)] pt-1 text-[10px] font-semibold text-gold-dark"
          style={{ top: Math.max(0, toPx(s)), height: Math.min(toPx(e), (endHour - startHour) * HOUR) - Math.max(0, toPx(s)) }}>
          {offLabel}
        </div>
      ))}
      {appts.map((a) => {
        const s = minutesOf(new Date(a.starts_at), tz)
        const dur = (Date.parse(a.ends_at) - Date.parse(a.starts_at)) / 60000
        const color = serviceColor(a.service_id)
        return (
          <button key={a.id} type="button" onClick={() => onOpen(a)}
            className="absolute inset-x-1 overflow-hidden rounded-lg border-l-4 bg-brand-50 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md"
            style={{ top: toPx(s) + 1, height: Math.max(26, (dur / 60) * HOUR - 3), borderLeftColor: color }}>
            <p className="truncate font-semibold text-slate-900">{minutesToHHMM(s)} · {a.client_label}</p>
            <p className="truncate text-slate-500">{serviceName(a.service_id)}</p>
          </button>
        )
      })}
    </div>
  )
}
