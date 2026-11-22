import { Search, ShieldCheck, UserPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../components/Avatar'
import { DemoNotice } from '../components/DemoNotice'
import { PageHeader } from '../components/PageHeader'
import { clients, type Client } from '../data/demo'
import { formatCurrency } from '../lib/format'

const segmentStyle: Record<Client['segment'], string> = {
  vip: 'bg-gold-light text-gold-dark',
  regular: 'bg-brand-light text-brand-dark',
  new: 'bg-slate-100 text-slate-600',
}

export function ClientsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return q ? clients.filter((c) => c.name.toLocaleLowerCase().includes(q)) : clients
  }, [query])

  const lastVisit = (days: number) => (days === 0 ? t('clients.today') : t('clients.daysAgo', { count: days }))

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={
          <button type="button" className="btn-primary">
            <UserPlus className="size-4" aria-hidden="true" /> {t('clients.newClient')}
          </button>
        }
      />

      <div className="relative mb-4">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('clients.search')}
          aria-label={t('clients.search')}
          maxLength={80}
          className="input pl-10"
        />
      </div>

      <div className="card overflow-hidden">
        {filtered.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-500">{t('clients.noResult')}</p>}

        {/* Mobile : cartes */}
        <ul className="divide-y divide-slate-100 md:hidden">
          {filtered.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={c.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{c.name}</p>
                <p className="text-xs text-slate-500">
                  {c.visits} {t('clients.visits').toLowerCase()} · {lastVisit(c.lastVisitDaysAgo)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(c.totalSpent, lang)}</p>
                <span className={`badge mt-1 ${segmentStyle[c.segment]}`}>{t(`segments.${c.segment}`)}</span>
              </div>
            </li>
          ))}
        </ul>

        {/* Ordinateur / tablette : tableau */}
        {filtered.length > 0 && (
          <table className="hidden w-full text-sm md:table">
            <thead className="bg-slate-50 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase">
              <tr>
                <th className="px-5 py-3">{t('nav.clients')}</th>
                <th className="px-5 py-3">{t('clients.visits')}</th>
                <th className="px-5 py-3">{t('clients.lastVisit')}</th>
                <th className="px-5 py-3 text-right">{t('clients.totalSpent')}</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-brand-50/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={c.name} size="sm" />
                      <span className="font-medium text-slate-900">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-slate-600">{c.visits}</td>
                  <td className="px-5 py-3 text-slate-600">{lastVisit(c.lastVisitDaysAgo)}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-900">{formatCurrency(c.totalSpent, lang)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className={`badge ${segmentStyle[c.segment]}`}>{t(`segments.${c.segment}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
        {t('clients.privacyNote')}
      </p>
      <DemoNotice />
    </div>
  )
}
