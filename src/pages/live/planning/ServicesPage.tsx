import { ArrowLeft, DoorOpen, Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { Sheet } from '../../../components/Sheet'
import { Toggle } from '../../../components/Toggle'
import type { ResourceKind, ResourceRow, ServiceRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { STAFF_COLORS } from '../staffConstants'
import { useCompanyData } from '../useCompanyData'

const DURATIONS = Array.from({ length: 48 }, (_, i) => (i + 1) * 5).filter((d) => d <= 60 || d % 15 === 0).concat([180, 240, 300, 360])

export function ServicesPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active, can } = useTenant()
  const { establishments } = useCompanyData()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [resources, setResources] = useState<ResourceRow[]>([])
  const [editing, setEditing] = useState<ServiceRow | 'new' | null>(null)
  const [resName, setResName] = useState('')
  const [resKind, setResKind] = useState<ResourceKind>('cabin')
  const [resEst, setResEst] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const companyId = active?.company.id

  const load = useCallback(async () => {
    if (!supabase || !companyId) return
    const [s, r] = await Promise.all([
      supabase.from('services').select('*').eq('company_id', companyId).order('name'),
      supabase.from('resources').select('*').eq('company_id', companyId).order('name'),
    ])
    setServices(s.data ?? [])
    setResources(r.data ?? [])
  }, [companyId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!active) return null
  const currency = active.company.currency
  const estId = resEst || establishments[0]?.id || ''

  async function addResource(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !resName.trim() || !estId) return
    const { error } = await supabase.from('resources').insert({ company_id: active!.company.id, establishment_id: estId, name: resName.trim(), kind: resKind })
    if (error) return setMsg(t(authErrorKey(error)))
    setResName('')
    await load()
  }

  async function toggleResource(r: ResourceRow) {
    if (!supabase) return
    await supabase.from('resources').update({ active: !r.active }).eq('id', r.id)
    await load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/planning" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" aria-hidden="true" />{t('planning.title')}</Link>
      <PageHeader title={t('catalog.title')} subtitle={t('catalog.subtitle')}
        actions={can('service.write') && <button type="button" className="btn-primary" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden="true" />{t('catalog.add')}</button>} />

      <ul className="card divide-y divide-slate-100">
        {services.length === 0 && <li className="p-5 text-sm text-slate-500">{t('catalog.empty')}</li>}
        {services.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => can('service.write') && setEditing(s)} className={`flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-brand-50/50 ${s.active ? '' : 'opacity-50'}`}>
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{s.name}</span>
                <span className="text-xs text-slate-500">{t('common.minutes', { count: s.duration_minutes })}{s.active ? '' : ` · ${t('staffLive.inactive')}`}</span>
              </span>
              <span className="text-sm font-semibold text-slate-900">{formatCurrency(s.price_cents / 100, lang, currency)}</span>
            </button>
          </li>
        ))}
      </ul>

      <section className="card space-y-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><DoorOpen className="size-5 text-brand" aria-hidden="true" />{t('catalog.resourcesTitle')}</h2>
          <p className="mt-1 text-sm text-slate-500">{t('catalog.resourcesText')}</p>
        </div>
        {resources.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
            {resources.map((r) => (
              <li key={r.id}>
                <Toggle checked={r.active} onChange={() => void toggleResource(r)} disabled={!can('resource.write')}
                  label={`${r.name} · ${t(`resourceKinds.${r.kind}`)}`} description={establishments.find((e) => e.id === r.establishment_id)?.name} />
              </li>
            ))}
          </ul>
        )}
        {can('resource.write') && (
          <form onSubmit={addResource} className="grid gap-3 sm:grid-cols-4 sm:items-end">
            <Field id="resName" label={t('catalog.resourceName')}>
              <input id="resName" maxLength={80} value={resName} onChange={(e) => setResName(e.target.value)} className="input" />
            </Field>
            <Field id="resKind" label={t('catalog.resourceKind')}>
              <select id="resKind" value={resKind} onChange={(e) => setResKind(e.target.value as ResourceKind)} className="input">
                {(['cabin', 'chair', 'equipment'] as const).map((k) => <option key={k} value={k}>{t(`resourceKinds.${k}`)}</option>)}
              </select>
            </Field>
            <Field id="resEst" label={t('staffLive.establishment')}>
              <select id="resEst" value={estId} onChange={(e) => setResEst(e.target.value)} className="input">
                {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <button type="submit" className="btn-secondary">{t('catalog.addResource')}</button>
          </form>
        )}
        {msg && <FormMessage kind="error">{msg}</FormMessage>}
      </section>

      {editing && <ServiceSheet service={editing === 'new' ? null : editing} companyId={active.company.id} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  )
}

function ServiceSheet({ service, companyId, onClose, onSaved }: { service: ServiceRow | null; companyId: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState(service?.name ?? '')
  const [duration, setDuration] = useState(service?.duration_minutes ?? 30)
  const [price, setPrice] = useState(service ? (service.price_cents / 100).toFixed(2) : '')
  const [color, setColor] = useState(service?.color ?? STAFF_COLORS[0]!)
  const [activeFlag, setActiveFlag] = useState(service?.active ?? true)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const cents = Math.round(Number(price.replace(',', '.')) * 100)
    if (name.trim().length < 2 || !Number.isFinite(cents) || cents < 0) return setError(t('errors.invalidInput'))
    const values = { name: name.trim(), duration_minutes: duration, price_cents: cents, color, active: activeFlag }
    const { error: err } = service
      ? await supabase.from('services').update(values).eq('id', service.id)
      : await supabase.from('services').insert({ company_id: companyId, ...values })
    if (err) return setError(t(authErrorKey(err)))
    await onSaved()
    onClose()
  }

  return (
    <Sheet title={service ? t('catalog.edit') : t('catalog.add')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="svcName" label={t('catalog.name')}>
          <input id="svcName" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="input" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="svcDuration" label={t('catalog.duration')}>
            <select id="svcDuration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="input">
              {DURATIONS.map((d) => <option key={d} value={d}>{t('common.minutes', { count: d })}</option>)}
            </select>
          </Field>
          <Field id="svcPrice" label={t('catalog.price')}>
            <input id="svcPrice" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="input" />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('staffLive.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {STAFF_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`size-9 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </fieldset>
        <div className="rounded-xl border border-slate-200 px-4">
          <Toggle checked={activeFlag} onChange={setActiveFlag} label={t('catalog.active')} description={t('catalog.activeHint')} />
        </div>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full">{t('common.save')}</button>
      </form>
    </Sheet>
  )
}
