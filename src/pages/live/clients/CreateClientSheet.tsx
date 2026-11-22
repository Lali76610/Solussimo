import { AlertTriangle, UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import type { EstablishmentRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { toE164 } from '../../../lib/phone'
import { supabase } from '../../../lib/supabase'
import { isValidEmail } from '../../../lib/validation'
import { useTenant } from '../../../tenant/useTenant'
import { clientName, debounce } from './clientFormat'

type Candidate = { id: string; first_name: string | null; last_name: string | null; email_masked: string | null; phone_masked: string | null; score: number }

interface Props {
  establishments: EstablishmentRow[]
  defaultEstablishmentId?: string
  initialName?: string
  onClose: () => void
  onCreated: (id: string, label: string) => void
}

export function CreateClientSheet({ establishments, defaultEstablishmentId, initialName = '', onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const { active } = useTenant()
  const [firstName, setFirstName] = useState(initialName)
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [estId, setEstId] = useState(defaultEstablishmentId ?? establishments[0]?.id ?? '')
  const [bDay, setBDay] = useState('')
  const [bMonth, setBMonth] = useState('')
  const [smsOk, setSmsOk] = useState(false)
  const [emailOk, setEmailOk] = useState(false)
  const [dupes, setDupes] = useState<Candidate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const country = establishments.find((e) => e.id === estId)?.country_code ?? active?.company.country_code ?? 'FR'

  // Détection des doublons pendant la saisie (serveur, résultats masqués).
  const check = useMemo(() => debounce((f: string, l: string, p: string, e: string, c: string) => {
    if (!supabase || !active) return
    const ph = p ? toE164(p, c) : null
    if (f.trim().length + l.trim().length < 3 && !ph && !isValidEmail(e)) return setDupes([])
    void supabase.rpc('find_duplicate_candidates', {
      p_company_id: active.company.id, p_first_name: f || null, p_last_name: l || null,
      p_email: isValidEmail(e) ? e : null, p_phone: ph,
    }).then(({ data }) => setDupes(data ?? []))
  }, 400), [active])
  useEffect(() => check(firstName, lastName, phone, email, country), [firstName, lastName, phone, email, country, check])

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (!supabase || !active || busy) return
    setError(null)
    if (!firstName.trim() && !lastName.trim()) return setError(t('clientsLive.errors.nameRequired'))
    const e164 = phone.trim() ? toE164(phone, country) : null
    if (phone.trim() && !e164) return setError(t('clientsLive.errors.phoneInvalid'))
    if (email.trim() && !isValidEmail(email)) return setError(t('login.errors.invalidEmail'))
    if ((bDay && !bMonth) || (!bDay && bMonth)) return setError(t('clientsLive.errors.birthday'))
    setBusy(true)
    const { data, error: err } = await supabase.from('clients').insert({
      company_id: active.company.id, home_establishment_id: estId,
      first_name: firstName.trim() || null, last_name: lastName.trim() || null,
      phone_e164: e164, email: email.trim() || null,
      birthday_day: bDay ? Number(bDay) : null, birthday_month: bMonth ? Number(bMonth) : null,
    }).select('id').single()
    if (err || !data) {
      setBusy(false)
      return setError(t(authErrorKey(err)))
    }
    // Consentements : uniquement si cochés (jamais par défaut).
    const consents = [
      ...(smsOk ? [{ channel: 'sms' as const }] : []),
      ...(emailOk ? [{ channel: 'email' as const }] : []),
    ].map((c) => ({ company_id: active.company.id, client_id: data.id, purpose: 'marketing' as const, channel: c.channel, status: 'granted' as const }))
    if (consents.length) await supabase.from('client_consents').insert(consents)
    setBusy(false)
    onCreated(data.id, clientName({ first_name: firstName.trim() || null, last_name: lastName.trim() || null }))
  }

  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))))

  return (
    <Sheet title={t('clientsLive.newClient')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="cFirst" label={t('clientsLive.firstName')}>
            <input id="cFirst" autoComplete="off" maxLength={60} value={firstName} onChange={(e) => setFirstName(e.target.value)} className="input" autoFocus />
          </Field>
          <Field id="cLast" label={t('clientsLive.lastName')}>
            <input id="cLast" autoComplete="off" maxLength={80} value={lastName} onChange={(e) => setLastName(e.target.value)} className="input" />
          </Field>
        </div>
        <p className="-mt-2 text-xs text-slate-500">{t('clientsLive.nameHint')}</p>

        {dupes.length > 0 && (
          <div className="rounded-xl border border-gold bg-gold-light/40 p-3" role="status" data-testid="duplicate-warning">
            <p className="flex items-center gap-2 text-sm font-semibold text-gold-dark"><AlertTriangle className="size-4" aria-hidden="true" />{t('clientsLive.duplicateFound')}</p>
            <ul className="mt-2 space-y-1">
              {dupes.map((d) => (
                <li key={d.id}>
                  <Link to={`/clients/${d.id}`} onClick={onClose} className="flex min-h-10 items-center justify-between gap-2 rounded-lg bg-white px-3 text-sm">
                    <span className="truncate font-medium text-slate-800">{clientName(d)}</span>
                    <span className="truncate text-xs text-slate-500">{d.phone_masked ?? d.email_masked ?? ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field id="cPhone" label={`${t('clientsLive.phone')} (${t('common.optional')})`}>
          <input id="cPhone" type="tel" inputMode="tel" autoComplete="off" maxLength={25} value={phone} onChange={(e) => setPhone(e.target.value)} className="input" />
        </Field>
        <Field id="cEmail" label={`${t('login.email')} (${t('common.optional')})`}>
          <input id="cEmail" type="email" inputMode="email" autoCapitalize="none" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">{t('clientsLive.birthday')} ({t('common.optional')})</legend>
          <div className="grid grid-cols-2 gap-3">
            <select aria-label={t('clientsLive.day')} value={bDay} onChange={(e) => setBDay(e.target.value)} className="input">
              <option value="">{t('clientsLive.day')}</option>
              {Array.from({ length: 31 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
            </select>
            <select aria-label={t('clientsLive.month')} value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="input">
              <option value="">{t('clientsLive.month')}</option>
              {months.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <p className="mt-1 text-xs text-slate-500">{t('clientsLive.birthdayHint')}</p>
        </fieldset>
        {establishments.length > 1 && (
          <Field id="cEst" label={t('clientsLive.homeEstablishment')}>
            <select id="cEst" value={estId} onChange={(e) => setEstId(e.target.value)} className="input">
              {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </Field>
        )}
        <fieldset className="space-y-2 rounded-xl border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-700">{t('consents.marketingTitle')}</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm text-slate-700">
            <input type="checkbox" checked={smsOk} onChange={(e) => setSmsOk(e.target.checked)} className="size-5 accent-brand" />{t('consents.agreeSms')}
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm text-slate-700">
            <input type="checkbox" checked={emailOk} onChange={(e) => setEmailOk(e.target.checked)} className="size-5 accent-brand" />{t('consents.agreeEmail')}
          </label>
          <p className="text-xs text-slate-500">{t('consents.uncheckedByDefault')}</p>
        </fieldset>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          <UserPlus className="size-4" aria-hidden="true" />{busy ? t('common.saving') : t('clientsLive.create')}
        </button>
      </form>
    </Sheet>
  )
}
