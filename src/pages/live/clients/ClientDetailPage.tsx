import { ArrowLeft, CalendarPlus, Download, Eye, Lock, Mail, MessageSquare, Pencil, Phone, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { Avatar } from '../../../components/Avatar'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import { Toggle } from '../../../components/Toggle'
import type {
  AppointmentRow, ClientConsentRow, ClientRow, ClientWritable, ConsentChannel, ConsentPurpose, HealthNotes, ServiceRow,
  StaffMemberRow, TechnicalNoteKind, TechnicalNoteRow, TimeOfDay,
} from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency, formatDate } from '../../../lib/format'
import { formatPhone, toE164 } from '../../../lib/phone'
import { supabase } from '../../../lib/supabase'
import { isValidEmail } from '../../../lib/validation'
import { useTenant } from '../../../tenant/useTenant'
import { useCompanyData } from '../useCompanyData'
import { birthdayLabel, clientName } from './clientFormat'

type Tab = 'overview' | 'history' | 'preferences' | 'technical' | 'health' | 'consents' | 'data'
type Msg = { kind: 'error' | 'success'; text: string } | null

function Card({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="card space-y-3 p-5">
      {(title || action) && <div className="flex items-center justify-between gap-2">{title && <h2 className="font-semibold text-slate-900">{title}</h2>}{action}</div>}
      {children}
    </section>
  )
}

export function ClientDetailPage() {
  const { id = '' } = useParams()
  const { t } = useTranslation()
  const { active, can } = useTenant()
  const { establishments, staff } = useCompanyData()
  const [client, setClient] = useState<ClientRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [healthAllowed, setHealthAllowed] = useState(false)

  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('clients')
      .select('id, company_id, home_establishment_id, first_name, last_name, email_masked, phone_masked, birthday_month, birthday_day, preferred_locale, preferred_staff_id, preferred_days, preferred_time, general_note, tags, status, merged_into, created_by, created_at, updated_at')
      .eq('id', id).maybeSingle()
    setClient(data ?? null)
    setLoaded(true)
    const { data: h } = await supabase.rpc('can_access_health', { p_client_id: id })
    setHealthAllowed(Boolean(h))
  }, [id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  if (!active) return null
  if (loaded && (!client || client.status !== 'active')) {
    return <div><BackLink /><p className="card p-6 text-sm text-slate-500">{t('clientsLive.notFound')}</p></div>
  }
  if (!client) return null

  const tabs: Tab[] = ['overview', 'history', 'preferences', 'technical', ...(healthAllowed ? ['health' as const] : []), 'consents', 'data']
  const est = establishments.find((e) => e.id === client.home_establishment_id)

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink />
      <div className="flex items-center gap-4">
        <Avatar name={clientName(client)} color={client.tags.includes('VIP') ? '#C4A875' : '#008B8B'} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-semibold text-slate-900">{clientName(client)}</h1>
          <p className="truncate text-sm text-slate-500">{est?.name}</p>
        </div>
        <Link to={`/planning?client=${client.id}`} className="btn-primary shrink-0 px-3" aria-label={t('clientsLive.book')}>
          <CalendarPlus className="size-4" aria-hidden="true" /><span className="hidden sm:inline">{t('clientsLive.book')}</span>
        </Link>
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" role="tablist" aria-label={t('clientsLive.sections')}>
        {tabs.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-medium ${tab === k ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            {k === 'health' && <Lock className="mr-1 inline size-3.5" aria-hidden="true" />}{t(`clientsLive.tabs.${k}`)}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview client={client} canReveal={can('client.contact.read')} canWrite={can('client.write')} onSaved={load} />}
      {tab === 'history' && <History client={client} staff={staff} />}
      {tab === 'preferences' && <Preferences client={client} staff={staff} canWrite={can('client.write')} onSaved={load} />}
      {tab === 'technical' && <Technical client={client} canWrite={can('client.write')} />}
      {tab === 'health' && healthAllowed && <Health client={client} />}
      {tab === 'consents' && <Consents client={client} canWrite={can('consent.write')} healthEnabled={active.company.health_data_enabled} />}
      {tab === 'data' && <DataRights client={client} />}
    </div>
  )
}

function BackLink() {
  const { t } = useTranslation()
  return <Link to="/clients" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" aria-hidden="true" />{t('clients.title')}</Link>
}

// --- Aperçu -----------------------------------------------------------------------------
function Overview({ client, canReveal, canWrite, onSaved }: { client: ClientRow; canReveal: boolean; canWrite: boolean; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [full, setFull] = useState<{ email: string | null; phone_e164: string | null } | null>(null)
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function reveal() {
    if (!supabase) return
    const { data, error } = await supabase.rpc('reveal_client_contact', { p_client_id: client.id })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setFull(data?.[0] ?? null)
  }
  const phone = full?.phone_e164
  const email = full?.email

  return (
    <>
      <Card title={t('clientsLive.contact')} action={canWrite && (
        <button type="button" onClick={() => setEditing(true)} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand"><Pencil className="size-4" aria-hidden="true" />{t('clientsLive.edit')}</button>
      )}>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{t('clientsLive.phone')}</dt><dd className="font-medium text-slate-800" data-testid="client-phone">{phone ? formatPhone(phone) : client.phone_masked ?? '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{t('login.email')}</dt><dd className="truncate font-medium text-slate-800">{email ?? client.email_masked ?? '—'}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-slate-500">{t('clientsLive.birthday')}</dt><dd className="font-medium text-slate-800">{birthdayLabel(client.birthday_day, client.birthday_month, lang) ?? '—'}</dd></div>
        </dl>
        {!full && (client.phone_masked || client.email_masked) && (canReveal ? (
          <button type="button" onClick={() => void reveal()} className="btn-secondary w-full" data-testid="reveal-contact">
            <Eye className="size-4" aria-hidden="true" />{t('clientsLive.reveal')}
          </button>
        ) : <p className="text-xs text-slate-500">{t('clientsLive.maskedForRole')}</p>)}
        {full && <p className="text-xs text-slate-500">{t('clientsLive.revealLogged')}</p>}
        {full && (
          <div className="grid grid-cols-3 gap-2">
            {phone && <a href={`tel:${phone}`} className="btn-secondary px-2"><Phone className="size-4" aria-hidden="true" />{t('clientsLive.call')}</a>}
            {phone && <a href={`sms:${phone}`} className="btn-secondary px-2"><MessageSquare className="size-4" aria-hidden="true" />SMS</a>}
            {email && <a href={`mailto:${email}`} className="btn-secondary px-2"><Mail className="size-4" aria-hidden="true" />{t('clientsLive.mail')}</a>}
          </div>
        )}
        <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
      </Card>
      {client.general_note && <Card title={t('clientsLive.note')}><p className="text-sm whitespace-pre-line text-slate-700">{client.general_note}</p></Card>}
      {client.tags.length > 0 && <Card title={t('clientsLive.tags')}><div className="flex flex-wrap gap-1.5">{client.tags.map((g) => <span key={g} className="badge bg-gold-light text-gold-dark">{g}</span>)}</div></Card>}
      {editing && <EditClientSheet client={client} onClose={() => setEditing(false)} onSaved={async () => { setFull(null); await onSaved() }} />}
    </>
  )
}

function EditClientSheet({ client, onClose, onSaved }: { client: ClientRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const { active } = useTenant()
  const { establishments } = useCompanyData()
  const [first, setFirst] = useState(client.first_name ?? '')
  const [last, setLast] = useState(client.last_name ?? '')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState(client.general_note ?? '')
  const [tags, setTags] = useState(client.tags.join(', '))
  const [bDay, setBDay] = useState(client.birthday_day ? String(client.birthday_day) : '')
  const [bMonth, setBMonth] = useState(client.birthday_month ? String(client.birthday_month) : '')
  const [error, setError] = useState<string | null>(null)
  const country = establishments.find((e) => e.id === client.home_establishment_id)?.country_code ?? active?.company.country_code ?? 'FR'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!first.trim() && !last.trim()) return setError(t('clientsLive.errors.nameRequired'))
    if ((bDay && !bMonth) || (!bDay && bMonth)) return setError(t('clientsLive.errors.birthday'))
    // Rectification : coordonnées remplacées uniquement si une nouvelle valeur est saisie.
    const patch: Partial<Omit<ClientWritable, 'company_id'>> = {
      first_name: first.trim() || null, last_name: last.trim() || null, general_note: note.trim() || null,
      tags: tags.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10),
      birthday_day: bDay ? Number(bDay) : null, birthday_month: bMonth ? Number(bMonth) : null,
    }
    if (phone.trim()) {
      const e164 = toE164(phone, country)
      if (!e164) return setError(t('clientsLive.errors.phoneInvalid'))
      patch.phone_e164 = e164
    }
    if (email.trim()) {
      if (!isValidEmail(email)) return setError(t('login.errors.invalidEmail'))
      patch.email = email.trim()
    }
    const { error: err } = await supabase.from('clients').update(patch).eq('id', client.id)
    if (err) return setError(t(authErrorKey(err)))
    await onSaved()
    onClose()
  }

  return (
    <Sheet title={t('clientsLive.edit')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="eFirst" label={t('clientsLive.firstName')}><input id="eFirst" maxLength={60} value={first} onChange={(e) => setFirst(e.target.value)} className="input" /></Field>
          <Field id="eLast" label={t('clientsLive.lastName')}><input id="eLast" maxLength={80} value={last} onChange={(e) => setLast(e.target.value)} className="input" /></Field>
        </div>
        <Field id="ePhone" label={t('clientsLive.newPhone')} hint={client.phone_masked ? t('clientsLive.current', { value: client.phone_masked }) : undefined}>
          <input id="ePhone" type="tel" inputMode="tel" maxLength={25} value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
        </Field>
        <Field id="eEmail" label={t('clientsLive.newEmail')} hint={client.email_masked ? t('clientsLive.current', { value: client.email_masked }) : undefined}>
          <input id="eEmail" type="email" inputMode="email" autoCapitalize="none" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="eDay" label={t('clientsLive.day')}>
            <select id="eDay" value={bDay} onChange={(e) => setBDay(e.target.value)} className="input"><option value="">—</option>{Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          </Field>
          <Field id="eMonth" label={t('clientsLive.month')}>
            <select id="eMonth" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="input"><option value="">—</option>{Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select>
          </Field>
        </div>
        <Field id="eNote" label={t('clientsLive.note')} hint={t('clientsLive.noteHint')}>
          <textarea id="eNote" maxLength={500} rows={3} value={note} onChange={(e) => setNote(e.target.value)} className="input" />
        </Field>
        <Field id="eTags" label={t('clientsLive.tags')} hint={t('clientsLive.tagsHint')}>
          <input id="eTags" maxLength={200} value={tags} onChange={(e) => setTags(e.target.value)} className="input" />
        </Field>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full">{t('common.save')}</button>
      </form>
    </Sheet>
  )
}

// --- Historique ---------------------------------------------------------------------------
function History({ client, staff }: { client: ClientRow; staff: StaffMemberRow[] }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active } = useTenant()
  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [services, setServices] = useState<ServiceRow[]>([])
  const [now] = useState(() => Date.now())
  useEffect(() => {
    if (!supabase) return
    void Promise.all([
      supabase.from('appointments').select('*').eq('client_id', client.id).order('starts_at', { ascending: false }).limit(100),
      supabase.from('services').select('*').eq('company_id', client.company_id),
    ]).then(([a, s]) => { setRows(a.data ?? []); setServices(s.data ?? []) })
  }, [client.id, client.company_id])
  const past = rows.filter((r) => Date.parse(r.starts_at) <= now && r.status !== 'cancelled')
  const total = past.reduce((s, r) => s + r.price_cents, 0)
  const noShows = rows.filter((r) => r.status === 'no_show').length
  const currency = active?.company.currency ?? 'EUR'

  return (
    <>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[[t('clientsLive.visits'), String(past.length)], [t('clientsLive.spent'), formatCurrency(total / 100, lang, currency)], [t('clientsLive.noShows'), String(noShows)]].map(([l, v]) => (
          <div key={l} className="card p-3"><p className="text-lg font-semibold text-slate-900">{v}</p><p className="text-xs text-slate-500">{l}</p></div>
        ))}
      </div>
      <Card title={t('clientsLive.tabs.history')}>
        {rows.length === 0 ? <p className="text-sm text-slate-500">{t('clientsLive.noHistory')}</p> : (
          <ul className="divide-y divide-slate-100" data-testid="client-history">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{services.find((s) => s.id === r.service_id)?.name}</p>
                  <p className="text-xs text-slate-500">{formatDate(new Date(r.starts_at), lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {staff.find((s) => s.id === r.staff_id)?.display_name ?? ''}</p>
                </div>
                <span className={`badge ${r.status === 'cancelled' ? 'bg-slate-100 text-slate-500' : r.status === 'no_show' ? 'bg-rose-50 text-rose-700' : Date.parse(r.starts_at) > now ? 'bg-brand-light text-brand-dark' : 'bg-gold-light text-gold-dark'}`}>
                  {t(`apptStatus.${Date.parse(r.starts_at) > now && r.status === 'booked' ? 'upcoming' : r.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

// --- Préférences ---------------------------------------------------------------------------
function Preferences({ client, staff, canWrite, onSaved }: { client: ClientRow; staff: StaffMemberRow[]; canWrite: boolean; onSaved: () => Promise<void> }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [prefStaff, setPrefStaff] = useState(client.preferred_staff_id ?? '')
  const [days, setDays] = useState<number[]>(client.preferred_days)
  const [time, setTime] = useState<TimeOfDay | ''>(client.preferred_time ?? '')
  const [services, setServices] = useState<ServiceRow[]>([])
  const [favs, setFavs] = useState<string[]>([])
  const [msg, setMsg] = useState<Msg>(null)

  const loadFavs = useCallback(async () => {
    if (!supabase) return
    const [s, f] = await Promise.all([
      supabase.from('services').select('*').eq('company_id', client.company_id).eq('active', true).order('name'),
      supabase.from('client_favorite_services').select('service_id').eq('client_id', client.id),
    ])
    setServices(s.data ?? [])
    setFavs((f.data ?? []).map((x) => x.service_id))
  }, [client.id, client.company_id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFavs()
  }, [loadFavs])

  async function save() {
    if (!supabase) return
    const { error } = await supabase.from('clients').update({ preferred_staff_id: prefStaff || null, preferred_days: days, preferred_time: time || null }).eq('id', client.id)
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await onSaved()
  }
  async function toggleFav(serviceId: string, on: boolean) {
    if (!supabase) return
    const { error } = on
      ? await supabase.from('client_favorite_services').insert({ client_id: client.id, service_id: serviceId, company_id: client.company_id })
      : await supabase.from('client_favorite_services').delete().eq('client_id', client.id).eq('service_id', serviceId)
    if (error) setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    await loadFavs()
  }
  const dayName = (d: number) => new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 29 + d)))

  return (
    <>
      <Card title={t('clientsLive.habits')}>
        <Field id="pStaff" label={t('clientsLive.preferredStaff')}>
          <select id="pStaff" value={prefStaff} onChange={(e) => setPrefStaff(e.target.value)} disabled={!canWrite} className="input">
            <option value="">—</option>
            {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
          </select>
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('clientsLive.preferredDays')}</legend>
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button key={d} type="button" disabled={!canWrite} aria-pressed={days.includes(d)} onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))}
                className={`min-h-10 min-w-12 rounded-full px-3 text-sm font-medium capitalize ${days.includes(d) ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{dayName(d)}</button>
            ))}
          </div>
        </fieldset>
        <Field id="pTime" label={t('clientsLive.preferredTime')}>
          <select id="pTime" value={time} onChange={(e) => setTime(e.target.value as TimeOfDay | '')} disabled={!canWrite} className="input">
            <option value="">—</option>
            {(['morning', 'afternoon', 'evening'] as const).map((x) => <option key={x} value={x}>{t(`clientsLive.time.${x}`)}</option>)}
          </select>
        </Field>
        {canWrite && <button type="button" onClick={() => void save()} className="btn-primary">{t('common.save')}</button>}
      </Card>
      <Card title={t('clientsLive.favoriteServices')}>
        {services.length === 0 ? <p className="text-sm text-slate-500">{t('catalog.empty')}</p> : (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4">
            {services.map((s) => <Toggle key={s.id} checked={favs.includes(s.id)} disabled={!canWrite} onChange={(v) => void toggleFav(s.id, v)} label={s.name} />)}
          </div>
        )}
      </Card>
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
    </>
  )
}

// --- Fiche technique -------------------------------------------------------------------------
function Technical({ client, canWrite }: { client: ClientRow; canWrite: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [notes, setNotes] = useState<TechnicalNoteRow[]>([])
  const [kind, setKind] = useState<TechnicalNoteKind>('color_formula')
  const [content, setContent] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('client_technical_notes').select('*').eq('client_id', client.id).order('created_at', { ascending: false })
    setNotes(data ?? [])
  }, [client.id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  async function add(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !content.trim()) return
    const { error } = await supabase.from('client_technical_notes').insert({ client_id: client.id, company_id: client.company_id, kind, content: content.trim() })
    if (error) return setMsg(t(authErrorKey(error)))
    setContent('')
    await load()
  }
  async function remove(id: string) {
    if (!supabase) return
    await supabase.from('client_technical_notes').delete().eq('id', id)
    await load()
  }
  return (
    <Card title={t('clientsLive.tabs.technical')}>
      <p className="text-xs text-slate-500">{t('clientsLive.technicalHint')}</p>
      {canWrite && (
        <form onSubmit={add} className="space-y-2">
          <select aria-label={t('staffLive.kind')} value={kind} onChange={(e) => setKind(e.target.value as TechnicalNoteKind)} className="input">
            {(['color_formula', 'hair', 'skin_type', 'nails', 'other'] as const).map((k) => <option key={k} value={k}>{t(`clientsLive.noteKind.${k}`)}</option>)}
          </select>
          <textarea aria-label={t('clientsLive.note')} maxLength={1000} rows={2} value={content} onChange={(e) => setContent(e.target.value)} className="input" />
          <button type="submit" className="btn-secondary w-full">{t('clientsLive.addNote')}</button>
        </form>
      )}
      <ul className="divide-y divide-slate-100">
        {notes.map((n) => (
          <li key={n.id} className="flex items-start gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-gold-dark">{t(`clientsLive.noteKind.${n.kind}`)} · {formatDate(new Date(n.created_at), lang, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              <p className="text-sm whitespace-pre-line text-slate-800">{n.content}</p>
            </div>
            {canWrite && <button type="button" onClick={() => void remove(n.id)} className="grid size-10 place-items-center rounded-lg text-slate-400 hover:text-rose-600" aria-label={t('clientsLive.deleteNote')}><Trash2 className="size-4" aria-hidden="true" /></button>}
          </li>
        ))}
      </ul>
      {msg && <FormMessage kind="error">{msg}</FormMessage>}
    </Card>
  )
}

// --- Santé (protection renforcée) ------------------------------------------------------------
function Health({ client }: { client: ClientRow }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  const [notes, setNotes] = useState<HealthNotes>({})
  const [msg, setMsg] = useState<Msg>(null)
  const [consentMissing, setConsentMissing] = useState(false)

  async function show() {
    if (!supabase) return
    const { data, error } = await supabase.rpc('get_client_health_notes', { p_client_id: client.id })
    if (error) {
      const key = authErrorKey(error)
      if (key === 'errors.healthConsentRequired') setConsentMissing(true)
      return setMsg({ kind: 'error', text: t(key) })
    }
    setNotes(data ?? {})
    setShown(true)
  }
  async function save(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    const clean: HealthNotes = {}
    for (const k of ['allergies', 'contraindications', 'treatments', 'other'] as const) if (notes[k]?.trim()) clean[k] = notes[k]!.trim()
    if (notes.pregnancy !== undefined) clean.pregnancy = notes.pregnancy
    const { error } = await supabase.rpc('set_client_health_notes', { p_client_id: client.id, p_notes: clean })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
  }

  return (
    <Card title={t('health.title')}>
      <p className="flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-dark"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{t('health.notice')}</p>
      {!shown ? (
        <>
          <button type="button" onClick={() => void show()} className="btn-secondary w-full" data-testid="show-health"><Eye className="size-4" aria-hidden="true" />{t('health.show')}</button>
          {consentMissing && <p className="text-sm text-slate-600">{t('health.consentFirst')}</p>}
        </>
      ) : (
        <form onSubmit={save} className="space-y-3">
          {(['allergies', 'contraindications', 'treatments', 'other'] as const).map((k) => (
            <Field key={k} id={`h-${k}`} label={t(`health.${k}`)}>
              <textarea id={`h-${k}`} maxLength={1000} rows={2} value={notes[k] ?? ''} onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} className="input" />
            </Field>
          ))}
          <div className="rounded-xl border border-slate-200 px-4">
            <Toggle checked={Boolean(notes.pregnancy)} onChange={(v) => setNotes({ ...notes, pregnancy: v })} label={t('health.pregnancy')} />
          </div>
          <button type="submit" className="btn-primary w-full">{t('common.save')}</button>
          <button type="button" onClick={() => { setShown(false); setNotes({}) }} className="w-full text-sm text-slate-500">{t('health.hide')}</button>
        </form>
      )}
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
    </Card>
  )
}

// --- Consentements ------------------------------------------------------------------------------
const MARKETING: { purpose: ConsentPurpose; channel: ConsentChannel }[] = [
  { purpose: 'marketing', channel: 'sms' }, { purpose: 'marketing', channel: 'email' }, { purpose: 'marketing', channel: 'whatsapp' },
  { purpose: 'newsletter', channel: 'email' }, { purpose: 'appointment_reminders', channel: 'sms' },
]

function Consents({ client, canWrite, healthEnabled }: { client: ClientRow; canWrite: boolean; healthEnabled: boolean }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [rows, setRows] = useState<ClientConsentRow[]>([])
  const [signed, setSigned] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase.from('client_consents').select('*').eq('client_id', client.id).order('captured_at', { ascending: false })
    setRows(data ?? [])
  }, [client.id])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  const current = (p: ConsentPurpose, c: ConsentChannel) => rows.find((r) => r.purpose === p && r.channel === c)?.status === 'granted'
  async function record(purpose: ConsentPurpose, channel: ConsentChannel, granted: boolean, method: 'in_salon_verbal' | 'in_salon_signed' = 'in_salon_verbal') {
    if (!supabase) return
    setMsg(null)
    const { error } = await supabase.from('client_consents').insert({ company_id: client.company_id, client_id: client.id, purpose, channel, status: granted ? 'granted' : 'withdrawn', method })
    if (error) setMsg(t(authErrorKey(error)))
    await load()
  }
  const healthOn = current('health_data', 'none')

  return (
    <>
      <Card title={t('consents.marketingTitle')}>
        <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-4" data-testid="consents">
          {MARKETING.map(({ purpose, channel }) => (
            <Toggle key={`${purpose}-${channel}`} checked={current(purpose, channel)} disabled={!canWrite}
              onChange={(v) => void record(purpose, channel, v)} label={t(`consents.purpose.${purpose}`)} description={t(`consents.channel.${channel}`)} />
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('consents.proofNote')}</p>
      </Card>
      {healthEnabled && (
        <Card title={t('consents.healthTitle')}>
          <p className="text-xs text-slate-600">{t('consents.healthText')}</p>
          {healthOn ? (
            <button type="button" disabled={!canWrite} onClick={() => window.confirm(t('consents.healthWithdrawConfirm')) && void record('health_data', 'none', false)} className="btn-secondary w-full text-rose-600">{t('consents.healthWithdraw')}</button>
          ) : (
            <>
              <label className="flex min-h-10 items-center gap-3 text-sm text-slate-700"><input type="checkbox" checked={signed} onChange={(e) => setSigned(e.target.checked)} className="size-5 accent-brand" />{t('consents.healthSigned')}</label>
              <button type="button" disabled={!canWrite || !signed} onClick={() => void record('health_data', 'none', true, 'in_salon_signed')} className="btn-primary w-full">{t('consents.healthGrant')}</button>
            </>
          )}
        </Card>
      )}
      <Card title={t('consents.history')}>
        <ul className="divide-y divide-slate-100 text-sm">
          {rows.length === 0 && <li className="py-2 text-slate-500">{t('consents.none')}</li>}
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-slate-700">{t(`consents.purpose.${r.purpose}`)}{r.channel !== 'none' ? ` · ${t(`consents.channel.${r.channel}`)}` : ''}</span>
              <span className="shrink-0 text-xs text-slate-500">{t(`consents.status.${r.status}`)} · {formatDate(new Date(r.captured_at), lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </li>
          ))}
        </ul>
      </Card>
      {msg && <FormMessage kind="error">{msg}</FormMessage>}
    </>
  )
}

// --- Données (RGPD) : export, fusion, effacement ------------------------------------------------
function DataRights({ client }: { client: ClientRow }) {
  const { t } = useTranslation()
  const { can, active } = useTenant()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [merging, setMerging] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function exportData() {
    if (!supabase) return
    const { data, error } = await supabase.rpc('export_client_data', { p_client_id: client.id })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    const name = `solussimo-client-${new Date().toISOString().slice(0, 10)}.json`
    const file = new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' })
    // iPhone : feuille de partage iOS si disponible, sinon téléchargement.
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: name }).catch(() => undefined)
    } else {
      const url = URL.createObjectURL(file)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
    setMsg({ kind: 'success', text: t('gdpr.exported') })
  }
  async function erase(e: FormEvent) {
    e.preventDefault()
    if (!supabase || confirm !== t('account.deleteWord')) return
    const { error } = await supabase.rpc('erase_client', { p_client_id: client.id, p_confirm: true })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    navigate('/clients', { replace: true })
  }

  return (
    <>
      <Card title={t('gdpr.accessTitle')}>
        <p className="text-sm text-slate-600">{t('gdpr.accessText')}</p>
        {can('client.export') ? <button type="button" onClick={() => void exportData()} className="btn-secondary w-full"><Download className="size-4" aria-hidden="true" />{t('gdpr.export')}</button>
          : <p className="text-xs text-slate-500">{t('gdpr.ownerOnly')}</p>}
      </Card>
      <Card title={t('gdpr.rectifyTitle')}><p className="text-sm text-slate-600">{t('gdpr.rectifyText')}</p></Card>
      {can('client.merge') && (
        <Card title={t('merge.title')}>
          <p className="text-sm text-slate-600">{t('merge.text')}</p>
          <button type="button" onClick={() => setMerging(true)} className="btn-secondary w-full"><Users className="size-4" aria-hidden="true" />{t('merge.start')}</button>
        </Card>
      )}
      {can('client.erase') && (
        <Card title={t('gdpr.eraseTitle')}>
          <p className="text-sm text-slate-600">{t('gdpr.eraseText', { years: active?.company.accounting_retention_years ?? 10 })}</p>
          <form onSubmit={erase} className="space-y-2">
            <label htmlFor="eraseConfirm" className="block text-xs font-medium text-slate-600">{t('account.deleteConfirmLabel', { word: t('account.deleteWord') })}</label>
            <input id="eraseConfirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="input" />
            <button type="submit" disabled={confirm !== t('account.deleteWord')} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
              <Trash2 className="size-4" aria-hidden="true" />{t('gdpr.erase')}
            </button>
          </form>
        </Card>
      )}
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>
      {merging && <MergeSheet keep={client} onClose={() => setMerging(false)} onMerged={() => { setMerging(false); setMsg({ kind: 'success', text: t('merge.done') }) }} />}
    </>
  )
}

function MergeSheet({ keep, onClose, onMerged }: { keep: ClientRow; onClose: () => void; onMerged: () => void }) {
  const { t } = useTranslation()
  const { active } = useTenant()
  const [q, setQ] = useState('')
  const [cands, setCands] = useState<{ id: string; first_name: string | null; last_name: string | null; email_masked: string | null; phone_masked: string | null }[]>([])
  const [other, setOther] = useState<(typeof cands)[number] | null>(null)
  const [take, setTake] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase || !active) return
    // Suggestions automatiques, puis recherche libre.
    const p = q.trim().length >= 2
      ? supabase.rpc('search_clients', { p_company_id: active.company.id, p_query: q, p_limit: 10 })
      : supabase.rpc('find_duplicate_candidates', { p_company_id: active.company.id, p_first_name: keep.first_name, p_last_name: keep.last_name, p_exclude: keep.id })
    void p.then(({ data }) => setCands(((data ?? []) as typeof cands).filter((c) => c.id !== keep.id)))
  }, [q, active, keep])

  async function merge() {
    if (!supabase || !other) return
    const { error: err } = await supabase.rpc('merge_clients', { p_keep_id: keep.id, p_merge_id: other.id, p_take: take })
    if (err) return setError(t(authErrorKey(err)))
    onMerged()
  }
  const row = (label: string, field: string, a: string | null, b: string | null) => (
    <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2 text-sm" key={field}>
      <span className="text-xs text-slate-500">{label}</span>
      <label className="flex min-h-10 items-center gap-2 truncate"><input type="radio" name={field} checked={!take[field]} onChange={() => setTake({ ...take, [field]: false })} className="accent-brand" />{a ?? '—'}</label>
      <label className="flex min-h-10 items-center gap-2 truncate"><input type="radio" name={field} checked={Boolean(take[field])} onChange={() => setTake({ ...take, [field]: true })} className="accent-brand" />{b ?? '—'}</label>
    </div>
  )

  return (
    <Sheet title={t('merge.title')} onClose={onClose}>
      {!other ? (
        <div className="space-y-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('clientsLive.searchPlaceholder')} aria-label={t('clients.search')} className="input" />
          <ul className="space-y-1">
            {cands.length === 0 && <li className="text-sm text-slate-500">{t('merge.noCandidate')}</li>}
            {cands.map((c) => (
              <li key={c.id}><button type="button" onClick={() => setOther(c)} className="flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 px-3 text-left text-sm">
                <span className="font-medium">{clientName(c)}</span><span className="text-xs text-slate-500">{c.phone_masked ?? c.email_masked ?? ''}</span>
              </button></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">{t('merge.chooseFields')}</p>
          <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-xs font-semibold text-slate-500"><span /><span>{t('merge.keep')}</span><span>{t('merge.other')}</span></div>
          {row(t('clientsLive.firstName'), 'first_name', keep.first_name, other.first_name)}
          {row(t('clientsLive.lastName'), 'last_name', keep.last_name, other.last_name)}
          {row(t('clientsLive.phone'), 'phone_e164', keep.phone_masked, other.phone_masked)}
          {row(t('login.email'), 'email', keep.email_masked, other.email_masked)}
          <p className="text-xs text-slate-500">{t('merge.consentRule')}</p>
          <FormMessage kind="error">{error}</FormMessage>
          <button type="button" onClick={() => void merge()} className="btn-primary w-full" data-testid="confirm-merge">{t('merge.confirm')}</button>
        </div>
      )}
    </Sheet>
  )
}
