import { Cake, ChevronRight, Megaphone, Plus, Search, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '../../../components/Avatar'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import type { ClientSearchRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatDate } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { useCompanyData } from '../useCompanyData'
import { clientName, debounce } from './clientFormat'
import { CreateClientSheet } from './CreateClientSheet'

type VisitFilter = 'lt1m' | '1to6m' | 'gt6m' | 'never' | null
const PAGE = 50

export function ClientsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const navigate = useNavigate()
  const { active, can } = useTenant()
  const { establishments } = useCompanyData()
  const isStaffOnly = active?.role === 'staff'
  const [query, setQuery] = useState('')
  const [visit, setVisit] = useState<VisitFilter>(null)
  const [marketing, setMarketing] = useState<boolean | null>(null)
  const [birthday, setBirthday] = useState(false)
  const [est, setEst] = useState<string | null>(null)
  const [rows, setRows] = useState<ClientSearchRow[]>([])
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const companyId = active?.company.id

  const run = useCallback(async (q: string, offset: number) => {
    if (!supabase || !companyId) return
    if (isStaffOnly && q.trim().length < 2) {
      setRows([])
      setMore(false)
      return
    }
    setLoading(true)
    const { data, error: err } = await supabase.rpc('search_clients', {
      p_company_id: companyId, p_query: q, p_establishment_id: est, p_last_visit: visit,
      p_marketing: marketing, p_birthday_this_month: birthday, p_limit: PAGE, p_offset: offset,
    })
    setLoading(false)
    if (err) return setError(t(authErrorKey(err)))
    setError(null)
    setRows((cur) => (offset === 0 ? data ?? [] : [...cur, ...(data ?? [])]))
    setMore((data ?? []).length === PAGE)
  }, [companyId, est, visit, marketing, birthday, isStaffOnly, t])

  const debounced = useMemo(() => debounce((q: string) => void run(q, 0), 250), [run])
  useEffect(() => debounced(query), [query, debounced])

  if (!active) return null
  const chip = (on: boolean) => `min-h-10 shrink-0 rounded-full px-4 text-sm font-medium transition ${on ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`

  return (
    <div>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={can('settings.retention') && (
          <Link to="/clients/reglages" className="btn-secondary"><Settings2 className="size-4" aria-hidden="true" />{t('clientsLive.settings')}</Link>
        )}
      />

      {/* Recherche toujours visible */}
      <div className="sticky top-16 z-10 -mx-4 mb-3 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('clientsLive.searchPlaceholder')}
            aria-label={t('clients.search')} maxLength={80} autoCapitalize="none" autoCorrect="off" className="input pl-10" data-testid="client-search" />
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('clientsLive.filters')}>
          {(['lt1m', '1to6m', 'gt6m', 'never'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={visit === v} onClick={() => setVisit(visit === v ? null : v)} className={chip(visit === v)}>
              {t(`clientsLive.visit.${v}`)}
            </button>
          ))}
          <button type="button" aria-pressed={marketing === true} onClick={() => setMarketing(marketing === true ? null : true)} className={chip(marketing === true)}>
            <Megaphone className="mr-1 inline size-4" aria-hidden="true" />{t('clientsLive.marketingOk')}
          </button>
          <button type="button" aria-pressed={birthday} onClick={() => setBirthday(!birthday)} className={chip(birthday)}>
            <Cake className="mr-1 inline size-4" aria-hidden="true" />{t('clientsLive.birthdayMonth')}
          </button>
          {establishments.length > 1 && (
            <select value={est ?? ''} onChange={(e) => setEst(e.target.value || null)} aria-label={t('staffLive.establishment')} className="min-h-10 shrink-0 rounded-full border border-slate-200 bg-white px-3 text-sm">
              <option value="">{t('staffLive.allEstablishments')}</option>
              {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {error && <FormMessage kind="error">{error}</FormMessage>}
      {isStaffOnly && query.trim().length < 2 && <p className="card p-5 text-sm text-slate-500">{t('clientsLive.typeToSearch')}</p>}
      {!loading && rows.length === 0 && !(isStaffOnly && query.trim().length < 2) && (
        <p className="card p-5 text-sm text-slate-500">{query ? t('clients.noResult') : t('clientsLive.empty')}</p>
      )}

      <ul className="space-y-2" aria-label={t('clients.title')} data-testid="client-list">
        {rows.map((c) => (
          <li key={c.id}>
            <Link to={`/clients/${c.id}`} className="card flex min-h-16 items-center gap-3 px-4 py-3 transition hover:border-brand">
              <Avatar name={clientName(c)} color={c.tags.includes('VIP') ? '#C4A875' : '#008B8B'} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{clientName(c)}</p>
                <p className="truncate text-xs text-slate-500">
                  {c.phone_masked ?? c.email_masked ?? t('clientsLive.noContact')}
                  {' · '}
                  {c.last_visit_at ? t('clientsLive.lastVisit', { date: formatDate(new Date(c.last_visit_at), lang, { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('clientsLive.neverCame')}
                </p>
                {c.tags.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">{c.tags.map((tag) => <span key={tag} className="badge bg-gold-light text-gold-dark">{tag}</span>)}</div>
                )}
              </div>
              <span className={`size-2.5 shrink-0 rounded-full ${c.marketing_ok ? 'bg-brand' : 'bg-slate-300'}`} title={c.marketing_ok ? t('clientsLive.marketingOk') : t('clientsLive.noMarketing')} aria-hidden="true" />
              <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {more && (
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => void run(query, rows.length)} disabled={loading}>{t('clientsLive.loadMore')}</button>
      )}

      {can('client.write') && (
        <button type="button" onClick={() => setCreating(true)} aria-label={t('clientsLive.newClient')}
          className="fixed right-5 bottom-24 z-30 grid size-14 place-items-center rounded-full bg-brand text-white shadow-lg transition hover:bg-brand-dark lg:bottom-8"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }} data-testid="new-client">
          <Plus className="size-7" aria-hidden="true" />
        </button>
      )}
      {creating && (
        <CreateClientSheet establishments={establishments} initialName={query.trim() && !/\d/.test(query) ? query.trim() : ''}
          onClose={() => setCreating(false)} onCreated={(id) => navigate(`/clients/${id}`)} />
      )}
    </div>
  )
}
