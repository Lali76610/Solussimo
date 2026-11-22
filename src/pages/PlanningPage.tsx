import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../components/Avatar'
import { DemoNotice } from '../components/DemoNotice'
import { PageHeader } from '../components/PageHeader'
import { appointments, SALON, staff } from '../data/demo'
import { capitalizeFirst, formatDate } from '../lib/format'

const HOUR_HEIGHT = 64 // px par heure

function toMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function PlanningPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { start, end } = SALON.openingHours
  const hours = Array.from({ length: end - start }, (_, i) => start + i)
  const team = staff.filter((s) => s.present)

  return (
    <div>
      <PageHeader
        title={t('planning.title')}
        subtitle={t('planning.subtitle')}
        actions={
          <button type="button" className="btn-primary">
            <CalendarPlus className="size-4" aria-hidden="true" /> {t('planning.newAppointment')}
          </button>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex items-center gap-1">
          <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-slate-100" aria-label={t('planning.previous')}>
            <ChevronLeft className="size-5" />
          </button>
          <button type="button" className="rounded-lg px-3 py-2 text-sm font-semibold text-brand hover:bg-brand-50">
            {t('planning.today')}
          </button>
          <button type="button" className="grid size-10 place-items-center rounded-lg hover:bg-slate-100" aria-label={t('planning.next')}>
            <ChevronRight className="size-5" />
          </button>
          <span className="ml-2 text-sm font-medium text-slate-700">
            {capitalizeFirst(formatDate(new Date(), lang, { weekday: 'long', day: 'numeric', month: 'long' }))}
          </span>
        </div>
        <div className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
          <button type="button" className="rounded-md bg-white px-3 py-1.5 font-medium text-brand shadow-sm">{t('planning.day')}</button>
          <button type="button" className="rounded-md px-3 py-1.5 font-medium text-slate-500">{t('planning.week')}</button>
        </div>
      </div>

      {/* Grille horaire : défilement horizontal interne sur mobile */}
      <div className="card overflow-x-auto">
        <div className="min-w-[640px]">
          <div className="sticky top-0 z-10 grid border-b border-slate-100 bg-white" style={{ gridTemplateColumns: `56px repeat(${team.length}, 1fr)` }}>
            <div />
            {team.map((s) => (
              <div key={s.id} className="flex items-center gap-2 border-l border-slate-100 px-3 py-3">
                <Avatar name={s.name} color={s.color} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{s.name}</p>
                  <p className="truncate text-[11px] text-slate-500">{t(`roles.${s.role}`)}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${team.length}, 1fr)` }}>
            <div>
              {hours.map((h) => (
                <div key={h} className="pr-2 text-right text-[11px] text-slate-400" style={{ height: HOUR_HEIGHT }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
            {team.map((s) => (
              <div key={s.id} className="relative border-l border-slate-100">
                {hours.map((h) => (
                  <div key={h} className="border-b border-dashed border-slate-100" style={{ height: HOUR_HEIGHT }} />
                ))}
                {appointments
                  .filter((a) => a.staffId === s.id)
                  .map((a) => {
                    const top = ((toMinutes(a.start) - start * 60) / 60) * HOUR_HEIGHT
                    const height = Math.max(28, (a.duration / 60) * HOUR_HEIGHT - 4)
                    return (
                      <button
                        type="button"
                        key={a.id}
                        className={`absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-left text-xs shadow-sm transition hover:shadow-md ${
                          a.status === 'done' ? 'bg-slate-50 opacity-70' : a.status === 'pending' ? 'bg-gold-light/60' : 'bg-brand-50'
                        }`}
                        style={{ top, height, borderLeftColor: s.color }}
                      >
                        <p className="truncate font-semibold text-slate-900">
                          {a.start} · {a.client}
                        </p>
                        <p className="truncate text-slate-500">{t(`services.${a.service}`)}</p>
                      </button>
                    )
                  })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <DemoNotice />
    </div>
  )
}
