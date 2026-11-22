import { Link2, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Avatar } from '../../components/Avatar'
import { Field } from '../../components/Field'
import { FormMessage } from '../../components/FormMessage'
import { PageHeader } from '../../components/PageHeader'
import type { StaffJob } from '../../lib/database.types'
import { authErrorKey } from '../../lib/authErrors'
import { supabase } from '../../lib/supabase'
import { isValidDisplayName } from '../../lib/validation'
import { useTenant } from '../../tenant/useTenant'
import { useCompanyData } from './useCompanyData'

const JOBS: StaffJob[] = ['manager', 'stylist', 'colorist', 'beautician', 'barber', 'apprentice', 'receptionist']
const COLORS = ['#008B8B', '#C4A875', '#5FB3B3', '#9C7E4F', '#7FA7C9', '#B57FA3']

export function LiveStaffPage() {
  const { t } = useTranslation()
  const { active, can } = useTenant()
  const { establishments, staff, reload, error: loadError } = useCompanyData()
  const canWrite = can('staff.write')

  const [name, setName] = useState('')
  const [job, setJob] = useState<StaffJob>('stylist')
  const [establishmentId, setEstablishmentId] = useState('')
  const [color, setColor] = useState(COLORS[0]!)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!active) return null
  const estId = establishmentId || establishments[0]?.id || ''
  const estName = (id: string) => establishments.find((e) => e.id === id)?.name ?? ''

  async function addMember(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !active || busy) return
    setError(null)
    if (!isValidDisplayName(name) || !estId) return setError(t('errors.invalidInput'))
    setBusy(true)
    const { error: err } = await supabase.from('staff_members').insert({
      company_id: active.company.id,
      establishment_id: estId,
      display_name: name.trim(),
      job,
      color,
    })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    setName('')
    await reload()
  }

  async function toggleActive(id: string, next: boolean) {
    if (!supabase) return
    const { error: err } = await supabase.from('staff_members').update({ active: next }).eq('id', id)
    if (err) setError(t(authErrorKey(err)))
    await reload()
  }

  return (
    <div>
      <PageHeader title={t('staff.title')} subtitle={t('staff.subtitle')} />
      {loadError && <FormMessage kind="error">{t('live.loadError')}</FormMessage>}

      <div className="grid gap-6 xl:grid-cols-3">
        <ul className="grid gap-4 sm:grid-cols-2 xl:col-span-2" aria-label={t('staff.title')}>
          {staff.length === 0 && <li className="card p-6 text-sm text-slate-500">{t('staffLive.empty')}</li>}
          {staff.map((s) => (
            <li key={s.id} className={`card overflow-hidden ${s.active ? '' : 'opacity-60'}`}>
              <div className="h-1.5" style={{ backgroundColor: s.color }} />
              <div className="flex items-center gap-4 p-5">
                <Avatar name={s.display_name} color={s.color} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-900">{s.display_name}</p>
                  <p className="text-sm text-slate-500">{t(`roles.${s.job}`)}</p>
                  <p className="truncate text-xs text-slate-400">{estName(s.establishment_id)}</p>
                </div>
                <span className={`badge ${s.active ? 'bg-brand-light text-brand-dark' : 'bg-slate-100 text-slate-500'}`}>
                  {s.active ? t('staffLive.active') : t('staffLive.inactive')}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">{s.user_id && <><Link2 className="size-3" aria-hidden="true" />{t('staffLive.linkedAccount')}</>}</span>
                {canWrite && (
                  <button type="button" onClick={() => void toggleActive(s.id, !s.active)} className="min-h-9 font-medium text-brand hover:text-brand-dark">
                    {s.active ? t('staffLive.deactivate') : t('staffLive.reactivate')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        <section className="card p-5">
          {canWrite ? (
            <form onSubmit={addMember} noValidate className="space-y-4">
              <h2 className="font-semibold text-slate-900">{t('staffLive.addTitle')}</h2>
              <Field id="staffName" label={t('staffLive.name')} hint={t('staffLive.minimization')}>
                <input id="staffName" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="input" aria-describedby="staffName-hint" />
              </Field>
              <Field id="staffJob" label={t('staffLive.job')}>
                <select id="staffJob" value={job} onChange={(e) => setJob(e.target.value as StaffJob)} className="input">
                  {JOBS.map((j) => <option key={j} value={j}>{t(`roles.${j}`)}</option>)}
                </select>
              </Field>
              {establishments.length > 1 && (
                <Field id="staffEst" label={t('staffLive.establishment')}>
                  <select id="staffEst" value={estId} onChange={(e) => setEstablishmentId(e.target.value)} className="input">
                    {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </Field>
              )}
              <fieldset>
                <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('staffLive.color')}</legend>
                <div className="flex flex-wrap gap-2">
                  {COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                      className={`size-9 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`} style={{ backgroundColor: c }} />
                  ))}
                </div>
              </fieldset>
              <FormMessage kind="error">{error}</FormMessage>
              <button type="submit" className="btn-primary w-full" disabled={busy}>
                <UserPlus className="size-4" aria-hidden="true" />
                {busy ? t('staffLive.adding') : t('staffLive.add')}
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-500">{t('staffLive.readOnly')}</p>
          )}
        </section>
      </div>
    </div>
  )
}
