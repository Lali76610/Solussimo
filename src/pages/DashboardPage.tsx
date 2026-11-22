import { AlertTriangle, CalendarCheck, CalendarPlus, Clock, Euro, Gauge, Receipt, UserPlus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Avatar } from '../components/Avatar'
import { DemoNotice } from '../components/DemoNotice'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { appointments, clients, SALON, staff, stock, transactions, weeklyRevenue } from '../data/demo'
import { capitalizeFirst, formatCurrency, formatDate } from '../lib/format'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const lang = i18n.resolvedLanguage ?? 'fr'

  const revenue = transactions.reduce((s, tr) => s + tr.amount, 0)
  const upcoming = appointments.filter((a) => a.status !== 'done')
  const lowStock = stock.filter((p) => p.quantity < p.minimum)
  const newClients = clients.filter((c) => c.segment === 'new').length
  const bookedMinutes = appointments.reduce((s, a) => s + a.duration, 0)
  const openMinutes = (SALON.openingHours.end - SALON.openingHours.start) * 60 * staff.filter((s) => s.present).length
  const occupancy = Math.round((bookedMinutes / openMinutes) * 100)
  const maxRevenue = Math.max(...weeklyRevenue)
  const today = new Date()

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-medium text-gold-dark">
          {capitalizeFirst(formatDate(today, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900 sm:text-3xl">
          {t('dashboard.greeting', { name: user?.displayName })}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('dashboard.summary', { salon: SALON.name })}</p>
      </div>

      {/* Actions rapides */}
      <div className="mb-6 grid grid-cols-3 gap-2 sm:flex sm:gap-3">
        <Link to="/planning" className="btn-primary px-2 text-xs sm:px-4 sm:text-sm">
          <CalendarPlus className="size-4" aria-hidden="true" /> {t('dashboard.newAppointment')}
        </Link>
        <Link to="/caisse" className="btn-secondary px-2 text-xs sm:px-4 sm:text-sm">
          <Receipt className="size-4" aria-hidden="true" /> {t('dashboard.newSale')}
        </Link>
        <Link to="/clients" className="btn-secondary px-2 text-xs sm:px-4 sm:text-sm">
          <UserPlus className="size-4" aria-hidden="true" /> {t('dashboard.newClient')}
        </Link>
      </div>

      {/* Indicateurs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('dashboard.kpi.revenue')} value={formatCurrency(revenue, lang)} icon={Euro} trend={{ value: 8, label: t('dashboard.vsLastWeek') }} />
        <StatCard label={t('dashboard.kpi.appointments')} value={String(appointments.length)} icon={CalendarCheck} accent="gold" trend={{ value: 12, label: t('dashboard.vsLastWeek') }} />
        <StatCard label={t('dashboard.kpi.newClients')} value={String(newClients)} icon={UserPlus} trend={{ value: -3, label: t('dashboard.vsLastWeek') }} />
        <StatCard label={t('dashboard.kpi.occupancy')} value={`${occupancy} %`} icon={Gauge} accent="gold" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Prochains rendez-vous */}
        <section className="card xl:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-semibold text-slate-900">{t('dashboard.upcoming')}</h2>
              <p className="text-xs text-slate-500">{t('dashboard.remaining', { count: upcoming.length })}</p>
            </div>
            <Link to="/planning" className="text-sm font-medium text-brand hover:text-brand-dark">
              {t('dashboard.seeAll')}
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">{t('dashboard.noUpcoming')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.slice(0, 6).map((a) => {
                const member = staff.find((s) => s.id === a.staffId)
                return (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="w-12 shrink-0 text-center">
                      <p className="text-sm font-semibold text-brand-dark">{a.start}</p>
                      <p className="text-[11px] text-slate-400">{t('common.minutes', { count: a.duration })}</p>
                    </div>
                    <span className="h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: member?.color }} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{a.client}</p>
                      <p className="truncate text-xs text-slate-500">
                        {t(`services.${a.service}`)} · {member?.name}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Équipe du jour */}
        <section className="card">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">{t('dashboard.teamToday')}</h2>
          </div>
          <ul className="divide-y divide-slate-100">
            {staff.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={s.name} color={s.color} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{s.name}</p>
                  <p className="text-xs text-slate-500">{t(`roles.${s.role}`)}</p>
                </div>
                <span className={`badge ${s.present ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-500'}`}>
                  {s.present ? t('dashboard.present') : t('dashboard.absent')}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* CA hebdomadaire */}
        <section className="card p-5 xl:col-span-2">
          <h2 className="font-semibold text-slate-900">{t('dashboard.weekRevenue')}</h2>
          <div className="mt-6 flex h-44 items-end gap-2 sm:gap-4" role="img" aria-label={t('dashboard.weekRevenue')}>
            {weeklyRevenue.map((value, i) => {
              const day = new Date(today)
              day.setDate(today.getDate() - (weeklyRevenue.length - 1 - i))
              const isToday = i === weeklyRevenue.length - 1
              return (
                <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-[10px] font-medium text-slate-500 sm:text-xs">{formatCurrency(value, lang).replace(/[,.]00/, '')}</span>
                  <div
                    className={`w-full max-w-12 rounded-t-lg ${isToday ? 'bg-gold' : 'bg-brand'}`}
                    style={{ height: `${Math.max(6, (value / maxRevenue) * 100)}%` }}
                  />
                  <span className="text-[11px] text-slate-500 capitalize">{formatDate(day, lang, { weekday: 'short' })}</span>
                </div>
              )
            })}
          </div>
        </section>

        {/* Alertes de stock */}
        <section className="card">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">{t('dashboard.stockAlerts')}</h2>
            <Link to="/stock" className="text-sm font-medium text-brand hover:text-brand-dark">
              {t('dashboard.seeAll')}
            </Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">{t('dashboard.noAlerts')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <AlertTriangle className="size-4 shrink-0 text-gold-dark" aria-hidden="true" />
                  <p className="min-w-0 flex-1 truncate text-sm text-slate-700">{t(`products.${p.product}`)}</p>
                  <span className="text-sm font-semibold text-rose-600">
                    {p.quantity}
                    <span className="font-normal text-slate-400"> / {p.minimum}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-400">
        <Clock className="size-3.5" aria-hidden="true" />
        {SALON.name} · {SALON.city} · {String(SALON.openingHours.start).padStart(2, '0')}:00 – {SALON.openingHours.end}:00
      </p>
      <DemoNotice />
    </div>
  )
}
