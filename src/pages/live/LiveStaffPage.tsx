import { CalendarCheck, CalendarOff, ChevronRight, Link2, UserPlus } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '../../components/Avatar'
import { Field } from '../../components/Field'
import { FormMessage } from '../../components/FormMessage'
import { PageHeader } from '../../components/PageHeader'
import { Sheet } from '../../components/Sheet'
import type { StaffJob } from '../../lib/database.types'
import { authErrorKey } from '../../lib/authErrors'
import { supabase } from '../../lib/supabase'
import { isValidDisplayName } from '../../lib/validation'
import { useTenant } from '../../tenant/useTenant'
import { JOBS, STAFF_COLORS } from './staffConstants'
import { useCompanyData } from './useCompanyData'

export function LiveStaffPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { active, can } = useTenant()
  const { establishments, staff, assignments, error: loadError } = useCompanyData()
  const [filter, setFilter] = useState('all')
  const [creating, setCreating] = useState(false)

  const visible = useMemo(
    () => (filter === 'all' ? staff : staff.filter((s) => assignments.some((a) => a.staff_id === s.id && a.establishment_id === filter))),
    [staff, assignments, filter],
  )
  if (!active) return null
  const estNames = (staffId: string) =>
    assignments.filter((a) => a.staff_id === staffId).map((a) => establishments.find((e) => e.id === a.establishment_id)?.name).filter(Boolean).join(' · ')

  return (
    <div>
      <PageHeader
        title={t('staff.title')}
        subtitle={t('staff.subtitle')}
        actions={can('staff.write') && (
          <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" aria-hidden="true" /> {t('staff.addMember')}
          </button>
        )}
      />
      {loadError && <FormMessage kind="error">{t('live.loadError')}</FormMessage>}

      {establishments.length > 1 && (
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t('staffLive.establishment')}>
          {[{ id: 'all', name: t('staffLive.allEstablishments') }, ...establishments].map((e) => (
            <button key={e.id} type="button" role="tab" aria-selected={filter === e.id} onClick={() => setFilter(e.id)}
              className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ${filter === e.id ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
              {e.name}
            </button>
          ))}
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={t('staff.title')}>
        {visible.length === 0 && <li className="card p-6 text-sm text-slate-500">{t('staffLive.empty')}</li>}
        {visible.map((s) => (
          <li key={s.id}>
            <Link to={`/personnel/${s.id}`} className={`card flex items-center gap-4 p-4 transition hover:border-brand ${s.active ? '' : 'opacity-60'}`}>
              <Avatar name={s.display_name} color={s.color} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{s.display_name}</p>
                <p className="truncate text-sm text-slate-500">{s.jobs.map((j) => t(`roles.${j}`)).join(', ')}</p>
                <p className="truncate text-xs text-slate-400">{estNames(s.id)}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {!s.active && <span className="badge bg-slate-100 text-slate-500">{t('staffLive.inactive')}</span>}
                  {s.active && (s.bookable
                    ? <span className="badge gap-1 bg-brand-light text-brand-dark"><CalendarCheck className="size-3" aria-hidden="true" />{t('staffLive.bookable')}</span>
                    : <span className="badge gap-1 bg-gold-light text-gold-dark"><CalendarOff className="size-3" aria-hidden="true" />{t('staffLive.notBookable')}</span>)}
                  {s.user_id && <span className="badge gap-1 bg-slate-100 text-slate-600"><Link2 className="size-3" aria-hidden="true" />{t('staffLive.linkedAccount')}</span>}
                </div>
              </div>
              <ChevronRight className="size-5 shrink-0 text-slate-300" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
      {!can('staff.write') && <p className="mt-4 text-sm text-slate-500">{t('staffLive.readOnly')}</p>}

      {creating && (
        <CreateStaffSheet
          establishments={establishments}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/personnel/${id}`)}
        />
      )}
    </div>
  )
}

function CreateStaffSheet({ establishments, onClose, onCreated }: {
  establishments: { id: string; name: string }[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const { active } = useTenant()
  const [name, setName] = useState('')
  const [job, setJob] = useState<StaffJob>('stylist')
  const [estId, setEstId] = useState(establishments[0]?.id ?? '')
  const [color, setColor] = useState(STAFF_COLORS[0]!)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Établissement effectif : la feuille peut s'ouvrir avant la fin du chargement de la liste.
  const effEstId = estId || establishments[0]?.id || ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !active || busy || !effEstId) return
    setError(null)
    if (!isValidDisplayName(name)) return setError(t('errors.invalidInput'))
    setBusy(true)
    const { data, error: err } = await supabase.from('staff_members')
      .insert({ company_id: active.company.id, establishment_id: effEstId, display_name: name.trim(), job, jobs: [job], color })
      .select('id').single()
    setBusy(false)
    if (err || !data) return setError(t(authErrorKey(err)))
    onCreated(data.id)
  }

  return (
    <Sheet title={t('staffLive.addTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="staffName" label={t('staffLive.name')} hint={t('staffLive.minimization')}>
          <input id="staffName" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="input" aria-describedby="staffName-hint" autoFocus />
        </Field>
        <Field id="staffJob" label={t('staffLive.mainJob')}>
          <select id="staffJob" value={job} onChange={(e) => setJob(e.target.value as StaffJob)} className="input">
            {JOBS.map((j) => <option key={j} value={j}>{t(`roles.${j}`)}</option>)}
          </select>
        </Field>
        <Field id="staffEst" label={t('staffLive.primaryEstablishment')}>
          <select id="staffEst" value={effEstId} onChange={(e) => setEstId(e.target.value)} className="input">
            {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('staffLive.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {STAFF_COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`size-9 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </fieldset>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full" disabled={busy || !effEstId}>{!effEstId ? t('common.loading') : busy ? t('staffLive.adding') : t('staffLive.add')}</button>
      </form>
    </Sheet>
  )
}
