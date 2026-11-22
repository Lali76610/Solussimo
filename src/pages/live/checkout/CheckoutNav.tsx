import { AlertTriangle, BarChart3, Lock, Receipt, Settings2, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import type { EstablishmentRow } from '../../../lib/database.types'
import { useTenant } from '../../../tenant/useTenant'

/** Onglets de la caisse + choix de l'établissement + bandeau « non certifié » (D1). */
export function CheckoutNav({ establishments, establishment, onChoose }: {
  establishments: EstablishmentRow[]
  establishment: EstablishmentRow | undefined
  onChoose: (id: string) => void
}) {
  const { t } = useTranslation()
  const { can } = useTenant()
  const tabs = [
    { to: '/caisse', end: true, icon: ShoppingBag, label: t('checkoutLive.tabs.sell'), show: true },
    { to: '/caisse/tickets', icon: Receipt, label: t('checkoutLive.tabs.tickets'), show: true },
    { to: '/caisse/cloture', icon: Lock, label: t('checkoutLive.tabs.closing'), show: true },
    { to: '/caisse/rapports', icon: BarChart3, label: t('checkoutLive.tabs.reports'), show: true },
    { to: '/caisse/reglages', icon: Settings2, label: t('checkoutLive.tabs.settings'), show: can('settings.fiscal') || can('catalog.write') },
  ].filter((x) => x.show)
  return (
    <div className="mb-4 space-y-3">
      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800" role="note" data-testid="uncertified-banner">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{t('checkoutLive.uncertifiedBanner')}</span>
      </p>
      {establishments.length > 1 && (
        <select value={establishment?.id ?? ''} onChange={(e) => onChoose(e.target.value)} aria-label={t('staffLive.establishment')} className="input">
          {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label={t('nav.checkout')}>
        {tabs.map(({ to, end, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition ${isActive ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            <Icon className="size-4" aria-hidden="true" />{label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
