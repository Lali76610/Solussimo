import { Building2, CalendarDays, CheckCircle2, Clock3, MapPin, Package, Receipt, ShieldCheck, UserRound, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useAuth } from '../../auth/useAuth'
import { StatCard } from '../../components/StatCard'
import { capitalizeFirst, formatDate } from '../../lib/format'
import { countryName } from '../../lib/regional'
import { useTenant } from '../../tenant/useTenant'
import { useCompanyData } from './useCompanyData'

const MODULES = [
  { key: 'nav.staff', to: '/personnel', icon: UserRound, ready: true },
  { key: 'nav.planning', to: '/planning', icon: CalendarDays, ready: true },
  { key: 'nav.clients', to: '/clients', icon: Users, ready: true },
  { key: 'nav.checkout', to: '/caisse', icon: Receipt, ready: false },
  { key: 'nav.stock', to: '/stock', icon: Package, ready: false },
]

export function LiveDashboardPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { displayName } = useAuth()
  const { active } = useTenant()
  const { establishments, staff, error } = useCompanyData()
  if (!active) return null

  return (
    <div>
      <div className="mb-6">
        <p className="text-sm font-medium text-gold-dark">
          {capitalizeFirst(formatDate(new Date(), lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold text-slate-900 sm:text-3xl">{t('dashboard.greeting', { name: displayName })}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {active.company.name} · {t('live.yourRole', { role: t(`companyRoles.${active.role}`) })}
        </p>
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{t('live.loadError')}</p>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatCard label={t('live.establishments')} value={String(establishments.length)} icon={Building2} />
        <StatCard label={t('live.team')} value={String(staff.filter((s) => s.active).length)} icon={UserRound} accent="gold" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <section className="card xl:col-span-2">
          <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">{t('live.establishments')}</h2>
          <ul className="divide-y divide-slate-100">
            {establishments.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-5 py-4">
                <span className="grid size-10 place-items-center rounded-xl bg-brand-light text-brand-dark">
                  <Building2 className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{e.name}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                    <MapPin className="size-3" aria-hidden="true" />
                    {[e.city, countryName(e.country_code, lang)].filter(Boolean).join(', ')} · {t(`kinds.${e.kind}`)}
                  </p>
                </div>
                <span className="hidden text-xs text-slate-400 sm:inline">{e.timezone}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">{t('live.modulesTitle')}</h2>
          <ul className="divide-y divide-slate-100">
            {MODULES.map(({ key, to, icon: Icon, ready }) => (
              <li key={to}>
                <Link to={to} className="flex items-center gap-3 px-5 py-3 hover:bg-brand-50/50">
                  <Icon className="size-5 text-slate-400" aria-hidden="true" />
                  <span className="flex-1 text-sm font-medium text-slate-700">{t(key)}</span>
                  {ready ? (
                    <span className="badge gap-1 bg-brand-light text-brand-dark"><CheckCircle2 className="size-3" aria-hidden="true" />{t('live.connected')}</span>
                  ) : (
                    <span className="badge gap-1 bg-gold-light text-gold-dark"><Clock3 className="size-3" aria-hidden="true" />{t('live.soon')}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-6 flex items-center gap-1.5 text-xs text-slate-500">
        <ShieldCheck className="size-4 text-brand" aria-hidden="true" />
        {t('live.securityNote')}
      </p>
    </div>
  )
}
