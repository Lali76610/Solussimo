import { ArrowLeft, Copy, Mail, Share2, Trash2, UserX } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { Avatar } from '../../components/Avatar'
import { Field } from '../../components/Field'
import { FormMessage } from '../../components/FormMessage'
import { Toggle } from '../../components/Toggle'
import type { CompanyRole, EstablishmentRow, InvitationRow, MembershipRow, StaffJob, StaffMemberRow, TimeOffKind, TimeOffRow, WorkingHoursRow } from '../../lib/database.types'
import { authErrorKey } from '../../lib/authErrors'
import { capitalizeFirst, formatDate } from '../../lib/format'
import { invitationLink } from '../../lib/invitations'
import { supabase } from '../../lib/supabase'
import { addDays, hhmmToMinutes, todayKey, zonedToUtc } from '../../lib/tz'
import { isValidDisplayName, isValidEmail } from '../../lib/validation'
import { useTenant } from '../../tenant/useTenant'
import { JOBS, STAFF_COLORS, TIME_OFF_KINDS } from './staffConstants'
import { useCompanyData } from './useCompanyData'

type Msg = { kind: 'error' | 'success'; text: string } | null

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card space-y-4 p-5">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  )
}

export function StaffDetailPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const { active, can } = useTenant()
  const { establishments, staff, assignments, reload, loading } = useCompanyData()
  const member = staff.find((s) => s.id === id)

  if (!active) return null
  if (!loading && !member) {
    return (
      <div>
        <BackLink />
        <p className="card p-6 text-sm text-slate-500">{t('staffLive.notFound')}</p>
      </div>
    )
  }
  if (!member) return null
  const canWrite = can('staff.write')
  const myAssignments = assignments.filter((a) => a.staff_id === member.id).map((a) => a.establishment_id)

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink />
      <div className="flex items-center gap-4">
        <Avatar name={member.display_name} color={member.color} />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold text-slate-900">{member.display_name}</h1>
          <p className="text-sm text-slate-500">{member.jobs.map((j) => t(`roles.${j}`)).join(', ')}</p>
        </div>
      </div>
      <ProfileSection member={member} canWrite={canWrite} onSaved={reload} />
      <EstablishmentsSection member={member} establishments={establishments} assigned={myAssignments} canWrite={canWrite} onSaved={reload} />
      <ScheduleSection member={member} establishments={establishments.filter((e) => myAssignments.includes(e.id))} canWrite={can('schedule.write')} />
      <TimeOffSection member={member} timezone={establishments.find((e) => e.id === member.establishment_id)?.timezone ?? 'Europe/Paris'} canWrite={can('schedule.write')} />
      {can('invitation.manage') && <AccessSection member={member} onChanged={reload} />}
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return (
    <Link to="/personnel" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand hover:text-brand-dark">
      <ArrowLeft className="size-4" aria-hidden="true" /> {t('staff.title')}
    </Link>
  )
}

// --- Profil ---------------------------------------------------------------------------
function ProfileSection({ member, canWrite, onSaved }: { member: StaffMemberRow; canWrite: boolean; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState(member.display_name)
  const [jobs, setJobs] = useState<StaffJob[]>(member.jobs)
  const [color, setColor] = useState(member.color)
  const [activeFlag, setActiveFlag] = useState(member.active)
  const [bookable, setBookable] = useState(member.bookable)
  const [practitioner, setPractitioner] = useState(member.health_practitioner)
  const { active } = useTenant()
  const isAdmin = active?.role === 'owner' || active?.role === 'admin'
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  function toggleJob(j: StaffJob) {
    setJobs((cur) => (cur.includes(j) ? cur.filter((x) => x !== j) : [...cur, j]))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!isValidDisplayName(name) || jobs.length === 0) return setMsg({ kind: 'error', text: t('errors.invalidInput') })
    setBusy(true)
    const mainJob = jobs.includes(member.job) ? member.job : jobs[0]!
    const { error } = await supabase.from('staff_members')
      .update({ display_name: name.trim(), jobs, job: mainJob, color, active: activeFlag, bookable,
        ...(isAdmin && practitioner !== member.health_practitioner ? { health_practitioner: practitioner } : {}) })
      .eq('id', member.id)
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await onSaved()
  }

  return (
    <Section title={t('staffLive.profile')}>
      <form onSubmit={save} className="space-y-4">
        <Field id="pName" label={t('staffLive.name')}>
          <input id="pName" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} className="input" />
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">{t('staffLive.jobs')}</legend>
          <div className="flex flex-wrap gap-2">
            {JOBS.map((j) => (
              <button key={j} type="button" disabled={!canWrite} aria-pressed={jobs.includes(j)} onClick={() => toggleJob(j)}
                className={`min-h-10 rounded-full px-3.5 text-sm font-medium transition ${jobs.includes(j) ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
                {t(`roles.${j}`)}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('staffLive.color')}</legend>
          <div className="flex flex-wrap gap-2">
            {STAFF_COLORS.map((c) => (
              <button key={c} type="button" disabled={!canWrite} onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`size-9 rounded-full ring-offset-2 ${color === c ? 'ring-2 ring-brand' : ''}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </fieldset>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
          <Toggle checked={bookable} onChange={setBookable} disabled={!canWrite} label={t('staffLive.bookable')} description={t('staffLive.bookableHint')} />
          <Toggle checked={activeFlag} onChange={setActiveFlag} disabled={!canWrite} label={t('staffLive.active')} description={t('staffLive.activeHint')} />
          {active?.company.health_data_enabled && (
            <Toggle checked={practitioner} onChange={setPractitioner} disabled={!isAdmin} label={t('staffLive.healthPractitioner')} description={t('staffLive.healthPractitionerHint')} />
          )}
        </div>
        <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
        {canWrite && <button type="submit" className="btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>}
      </form>
    </Section>
  )
}

// --- Établissements -----------------------------------------------------------------------
function EstablishmentsSection({ member, establishments, assigned, canWrite, onSaved }: {
  member: StaffMemberRow; establishments: EstablishmentRow[]; assigned: string[]; canWrite: boolean; onSaved: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [msg, setMsg] = useState<Msg>(null)

  async function toggle(estId: string, on: boolean) {
    if (!supabase) return
    setMsg(null)
    const { error } = on
      ? await supabase.from('staff_establishments').insert({ staff_id: member.id, establishment_id: estId, company_id: member.company_id })
      : await supabase.from('staff_establishments').delete().eq('staff_id', member.id).eq('establishment_id', estId)
    if (error) setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    await onSaved()
  }

  return (
    <Section title={t('staffLive.establishments')}>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
        {establishments.map((e) => {
          const isPrimary = e.id === member.establishment_id
          return (
            <Toggle key={e.id} checked={assigned.includes(e.id)} onChange={(v) => void toggle(e.id, v)}
              disabled={!canWrite || isPrimary} label={e.name} description={isPrimary ? t('staffLive.primary') : e.city ?? undefined} />
          )
        })}
      </div>
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
    </Section>
  )
}

// --- Horaires hebdomadaires ---------------------------------------------------------------
type DayPlan = { on: boolean; start: string; end: string; breakOn: boolean; breakStart: string; breakEnd: string }
const DEFAULT_DAY: DayPlan = { on: false, start: '09:00', end: '19:00', breakOn: true, breakStart: '12:30', breakEnd: '13:30' }

function toPlans(rows: WorkingHoursRow[]): DayPlan[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = rows.filter((r) => r.weekday === i + 1).sort((a, b) => a.start_time.localeCompare(b.start_time))
    if (day.length === 0) return { ...DEFAULT_DAY }
    const first = day[0]!, last = day[day.length - 1]!
    return {
      on: true,
      start: first.start_time.slice(0, 5),
      end: last.end_time.slice(0, 5),
      breakOn: day.length > 1,
      breakStart: day.length > 1 ? first.end_time.slice(0, 5) : DEFAULT_DAY.breakStart,
      breakEnd: day.length > 1 ? day[1]!.start_time.slice(0, 5) : DEFAULT_DAY.breakEnd,
    }
  })
}

function ScheduleSection({ member, establishments, canWrite }: { member: StaffMemberRow; establishments: EstablishmentRow[]; canWrite: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [estId, setEstId] = useState(member.establishment_id)
  const [plans, setPlans] = useState<DayPlan[]>(() => toPlans([]))
  const [openDay, setOpenDay] = useState<number | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('staff_working_hours').select('*').eq('staff_id', member.id).eq('establishment_id', estId)
    setPlans(toPlans(data ?? []))
  }, [member.id, estId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const dayNames = useMemo(
    () => Array.from({ length: 7 }, (_, i) => formatDate(new Date(Date.UTC(2026, 10, 30 + i, 12)), lang, { weekday: 'long' })),
    [lang],
  )
  const update = (i: number, patch: Partial<DayPlan>) => setPlans((p) => p.map((d, j) => (j === i ? { ...d, ...patch } : d)))

  async function save() {
    if (!supabase) return
    setMsg(null)
    const slots: { weekday: number; start: string; end: string }[] = []
    for (const [i, d] of plans.entries()) {
      if (!d.on) continue
      const s = hhmmToMinutes(d.start), e = hhmmToMinutes(d.end), bs = hhmmToMinutes(d.breakStart), be = hhmmToMinutes(d.breakEnd)
      if (s >= e || (d.breakOn && !(s < bs && bs < be && be < e))) return setMsg({ kind: 'error', text: t('staffLive.invalidHours', { day: dayNames[i] }) })
      if (d.breakOn) slots.push({ weekday: i + 1, start: d.start, end: d.breakStart }, { weekday: i + 1, start: d.breakEnd, end: d.end })
      else slots.push({ weekday: i + 1, start: d.start, end: d.end })
    }
    setBusy(true)
    const { error } = await supabase.rpc('set_staff_week_schedule', { p_staff_id: member.id, p_establishment_id: estId, p_slots: slots })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await load()
  }

  return (
    <Section title={t('staffLive.schedule')}>
      {establishments.length > 1 && (
        <Field id="schedEst" label={t('staffLive.establishment')}>
          <select id="schedEst" value={estId} onChange={(e) => setEstId(e.target.value)} className="input">
            {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </Field>
      )}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {plans.map((d, i) => (
          <li key={i} className="space-y-2 px-4 py-2">
            <Toggle checked={d.on} onChange={(v) => { update(i, { on: v }); if (v) setOpenDay(i) }} disabled={!canWrite} label={capitalizeFirst(dayNames[i]!)}
              description={d.on ? `${d.start}–${d.end}${d.breakOn ? ` · ${t('staffLive.break')} ${d.breakStart}–${d.breakEnd}` : ''}` : t('staffLive.dayOff')} />
            {d.on && canWrite && openDay !== i && (
              <button type="button" onClick={() => setOpenDay(i)} className="min-h-9 text-xs font-semibold text-brand">{t('staffLive.editDay')}</button>
            )}
            {d.on && canWrite && openDay === i && (
              <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-4">
                <TimeInput label={t('staffLive.start')} value={d.start} onChange={(v) => update(i, { start: v })} />
                <TimeInput label={t('staffLive.end')} value={d.end} onChange={(v) => update(i, { end: v })} />
                {d.breakOn ? (
                  <>
                    <TimeInput label={t('staffLive.breakStart')} value={d.breakStart} onChange={(v) => update(i, { breakStart: v })} />
                    <TimeInput label={t('staffLive.breakEnd')} value={d.breakEnd} onChange={(v) => update(i, { breakEnd: v })} />
                  </>
                ) : null}
                <button type="button" onClick={() => update(i, { breakOn: !d.breakOn })} className="col-span-2 min-h-10 text-left text-xs font-medium text-brand sm:col-span-4">
                  {d.breakOn ? t('staffLive.removeBreak') : t('staffLive.addBreak')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
      {canWrite && <button type="button" onClick={() => void save()} className="btn-primary" disabled={busy}>{busy ? t('common.saving') : t('staffLive.saveSchedule')}</button>}
    </Section>
  )
}

function TimeInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-xs text-slate-500">
      {label}
      <input type="time" step={300} value={value} onChange={(e) => onChange(e.target.value)} className="input mt-1 min-h-10 py-1.5" />
    </label>
  )
}

// --- Absences & congés -----------------------------------------------------------------
function TimeOffSection({ member, timezone, canWrite }: { member: StaffMemberRow; timezone: string; canWrite: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [rows, setRows] = useState<TimeOffRow[]>([])
  const [kind, setKind] = useState<TimeOffKind>('vacation')
  const [from, setFrom] = useState(() => todayKey(timezone))
  const [to, setTo] = useState(() => todayKey(timezone))
  const [msg, setMsg] = useState<Msg>(null)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('staff_time_off').select('*').eq('staff_id', member.id)
      .gte('ends_at', new Date().toISOString()).order('starts_at')
    setRows(data ?? [])
  }, [member.id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (to < from) return setMsg({ kind: 'error', text: t('errors.invalidInput') })
    // Journées entières, dans le fuseau de l'établissement principal.
    const { error } = await supabase.from('staff_time_off').insert({
      company_id: member.company_id, staff_id: member.id, kind,
      starts_at: zonedToUtc(from, 0, timezone).toISOString(),
      ends_at: zonedToUtc(addDays(to, 1), 0, timezone).toISOString(),
    })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await load()
  }

  async function remove(id: string) {
    if (!supabase) return
    const { error } = await supabase.from('staff_time_off').delete().eq('id', id)
    if (error) setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    await load()
  }

  const fmt = (iso: string, endExclusive = false) =>
    formatDate(new Date(Date.parse(iso) - (endExclusive ? 1 : 0)), lang, { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone })

  return (
    <Section title={t('staffLive.timeOff')}>
      {rows.length === 0 ? <p className="text-sm text-slate-500">{t('staffLive.noTimeOff')}</p> : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <span className="badge bg-gold-light text-gold-dark">{t(`timeOff.${r.kind}`)}</span>
              <span className="flex-1 text-sm text-slate-700">{fmt(r.starts_at)} → {fmt(r.ends_at, true)}</span>
              {canWrite && (
                <button type="button" onClick={() => void remove(r.id)} className="grid size-10 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={t('staffLive.deleteTimeOff')}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field id="toKind" label={t('staffLive.kind')}>
            <select id="toKind" value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)} className="input">
              {TIME_OFF_KINDS.map((k) => <option key={k} value={k}>{t(`timeOff.${k}`)}</option>)}
            </select>
          </Field>
          <Field id="toFrom" label={t('staffLive.from')}>
            <input id="toFrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
          </Field>
          <Field id="toTo" label={t('staffLive.to')}>
            <input id="toTo" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="input" />
          </Field>
          <button type="submit" className="btn-secondary">{t('staffLive.addTimeOff')}</button>
        </form>
      )}
      <p className="text-xs text-slate-500">{t('staffLive.timeOffPrivacy')}</p>
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
    </Section>
  )
}

// --- Accès & invitation ---------------------------------------------------------------
function AccessSection({ member, onChanged }: { member: StaffMemberRow; onChanged: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active, refresh } = useTenant()
  const isOwner = active?.role === 'owner'
  const [membership, setMembership] = useState<MembershipRow | null>(null)
  const [invites, setInvites] = useState<InvitationRow[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<CompanyRole>('staff')
  const [link, setLink] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState(false)
  const roleChoices: CompanyRole[] = isOwner ? ['staff', 'manager', 'admin'] : ['staff', 'manager']

  const load = useCallback(async () => {
    if (!supabase || !active) return
    if (member.user_id) {
      const { data } = await supabase.from('memberships').select('*').eq('company_id', active.company.id).eq('user_id', member.user_id).maybeSingle()
      setMembership(data ?? null)
    } else setMembership(null)
    const { data: inv } = await supabase.from('invitations')
      .select('id, company_id, staff_id, email, role, expires_at, created_by, created_at, accepted_at, accepted_by, revoked_at')
      .eq('staff_id', member.id).is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
    setInvites(inv ?? [])
  }, [active, member.id, member.user_id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !active || busy) return
    setMsg(null)
    if (!isValidEmail(email)) return setMsg({ kind: 'error', text: t('login.errors.invalidEmail') })
    setBusy(true)
    const { data, error } = await supabase.rpc('create_invitation', { p_company_id: active.company.id, p_email: email, p_role: role, p_staff_id: member.id })
    setBusy(false)
    const row = data?.[0]
    if (error || !row) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setLink(invitationLink(row.token))
    setEmail('')
    await load()
  }

  async function revoke(id: string) {
    if (!supabase) return
    const { error } = await supabase.rpc('revoke_invitation', { p_invitation_id: id })
    if (error) setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    await load()
  }

  async function changeRole(next: CompanyRole) {
    if (!supabase || !membership) return
    const { error } = await supabase.from('memberships').update({ role: next }).eq('id', membership.id)
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await load()
  }

  async function removeAccess() {
    if (!supabase || !membership || !window.confirm(t('staffLive.removeAccessConfirm'))) return
    const { error } = await supabase.from('memberships').delete().eq('id', membership.id)
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    await supabase.from('staff_members').update({ user_id: null }).eq('id', member.id)
    await Promise.all([onChanged(), refresh(), load()])
  }

  const mailto = link
    ? `mailto:?subject=${encodeURIComponent(t('invite.mailSubject', { company: active?.company.name }))}&body=${encodeURIComponent(t('invite.mailBody', { company: active?.company.name, link }))}`
    : ''

  return (
    <Section title={t('staffLive.access')}>
      {membership ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('staffLive.hasAccount')}</p>
          {membership.role === 'owner' || (!isOwner && membership.role === 'admin') ? (
            <p className="badge bg-brand-light text-brand-dark">{t(`companyRoles.${membership.role}`)}</p>
          ) : (
            <Field id="accRole" label={t('staffLive.role')}>
              <select id="accRole" value={membership.role} onChange={(e) => void changeRole(e.target.value as CompanyRole)} className="input">
                {roleChoices.map((r) => <option key={r} value={r}>{t(`companyRoles.${r}`)}</option>)}
              </select>
            </Field>
          )}
          <p className="text-xs text-slate-500">{t(`roleHelp.${membership.role}`)}</p>
          {membership.role !== 'owner' && (isOwner || membership.role !== 'admin') && (
            <button type="button" onClick={() => void removeAccess()} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-rose-600">
              <UserX className="size-4" aria-hidden="true" /> {t('staffLive.removeAccess')}
            </button>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">{t('invite.intro')}</p>
          <form onSubmit={invite} noValidate className="space-y-3">
            <Field id="invEmail" label={t('invite.email')}>
              <input id="invEmail" type="email" inputMode="email" autoCapitalize="none" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
            </Field>
            <Field id="invRole" label={t('staffLive.role')}>
              <select id="invRole" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)} className="input">
                {roleChoices.map((r) => <option key={r} value={r}>{t(`companyRoles.${r}`)}</option>)}
              </select>
            </Field>
            <p className="text-xs text-slate-500">{t(`roleHelp.${role}`)}</p>
            <button type="submit" className="btn-primary" disabled={busy}>{t('invite.create')}</button>
          </form>
          {link && (
            <div className="space-y-3 rounded-xl border border-brand-light bg-brand-50 p-4" data-testid="invitation-link">
              <p className="text-sm font-medium text-brand-dark">{t('invite.ready')}</p>
              <p className="text-xs text-slate-600">{t('invite.securityNote')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <a href={mailto} className="btn-primary"><Mail className="size-4" aria-hidden="true" />{t('invite.sendEmail')}</a>
                {typeof navigator.share === 'function' && (
                  <button type="button" className="btn-secondary" onClick={() => void navigator.share({ title: 'SOLUSSIMO', text: t('invite.mailSubject', { company: active?.company.name }), url: link }).catch(() => undefined)}>
                    <Share2 className="size-4" aria-hidden="true" />{t('invite.share')}
                  </button>
                )}
                <button type="button" className="btn-secondary" onClick={() => void navigator.clipboard?.writeText(link).then(() => setMsg({ kind: 'success', text: t('invite.copied') }))}>
                  <Copy className="size-4" aria-hidden="true" />{t('invite.copy')}
                </button>
              </div>
            </div>
          )}
          {invites.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {invites.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{i.email}</p>
                    <p className="text-xs text-slate-500">
                      {t(`companyRoles.${i.role}`)} · {t('invite.expires', { date: formatDate(new Date(i.expires_at), lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}
                    </p>
                  </div>
                  <button type="button" onClick={() => void revoke(i.id)} className="min-h-10 text-sm font-medium text-rose-600">{t('invite.revoke')}</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
    </Section>
  )
}
