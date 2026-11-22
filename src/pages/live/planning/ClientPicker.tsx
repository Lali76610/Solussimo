import { Search, UserPlus, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientSearchRow, EstablishmentRow } from '../../../lib/database.types'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { clientName, debounce } from '../clients/clientFormat'
import { CreateClientSheet } from '../clients/CreateClientSheet'

export interface PickedClient {
  id: string | null // null = client de passage
  label: string
}

/** Sélecteur de client pour un rendez-vous : recherche, création rapide ou client de passage. */
export function ClientPicker({ value, onChange, establishment, disabled }: {
  value: PickedClient
  onChange: (v: PickedClient) => void
  establishment: EstablishmentRow | undefined
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const { active } = useTenant()
  const [q, setQ] = useState(value.id ? '' : value.label)
  const [results, setResults] = useState<ClientSearchRow[]>([])
  const [creating, setCreating] = useState(false)

  const search = useMemo(() => debounce((text: string) => {
    if (!supabase || !active || text.trim().length < 2) return setResults([])
    void supabase.rpc('search_clients', { p_company_id: active.company.id, p_query: text, p_limit: 6 }).then(({ data }) => setResults(data ?? []))
  }, 250), [active])
  useEffect(() => { if (!value.id) search(q) }, [q, value.id, search])

  if (value.id) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-brand bg-brand-50 px-3" data-testid="picked-client">
        <span className="truncate text-sm font-semibold text-brand-dark">{value.label}</span>
        {!disabled && (
          <button type="button" onClick={() => { onChange({ id: null, label: '' }); setQ('') }} className="grid size-9 place-items-center rounded-lg text-brand-dark" aria-label={t('planningLive.changeClient')}>
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input id="apClient" value={q} disabled={disabled} maxLength={80} autoComplete="off" placeholder={t('planningLive.clientSearch')}
          onChange={(e) => { setQ(e.target.value); onChange({ id: null, label: e.target.value }) }} className="input pl-10" />
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200" role="listbox" aria-label={t('clients.title')}>
          {results.map((c) => (
            <li key={c.id}>
              <button type="button" role="option" aria-selected={false} onClick={() => { onChange({ id: c.id, label: clientName(c) }); setResults([]) }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-left text-sm hover:bg-brand-50">
                <span className="truncate font-medium text-slate-800">{clientName(c)}</span>
                <span className="truncate text-xs text-slate-500">{c.phone_masked ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span>{q.trim() ? t('planningLive.walkInHint') : t('planningLive.clientHint')}</span>
          <button type="button" onClick={() => setCreating(true)} className="inline-flex min-h-9 shrink-0 items-center gap-1 font-semibold text-brand">
            <UserPlus className="size-4" aria-hidden="true" />{t('clientsLive.newClient')}
          </button>
        </div>
      )}
      {creating && establishment && (
        <CreateClientSheet establishments={[establishment]} defaultEstablishmentId={establishment.id} initialName={/\d/.test(q) ? '' : q}
          onClose={() => setCreating(false)} onCreated={(id, label) => { setCreating(false); onChange({ id, label }) }} />
      )}
    </div>
  )
}
