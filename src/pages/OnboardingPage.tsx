import { LogOut, ShieldCheck, Store } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { FullPageSpinner } from '../components/FullPageSpinner'
import { SUPPORTED_LANGUAGES } from '../i18n'
import type { AppLocale, EstablishmentKind } from '../lib/database.types'
import { authErrorKey } from '../lib/authErrors'
import { COUNTRIES, countryName, CURRENCIES, defaultCurrency, defaultTimezone, ESTABLISHMENT_KINDS, listTimezones } from '../lib/regional'
import { readPendingInvitation } from '../lib/invitations'
import { supabase } from '../lib/supabase'
import { useTenant } from '../tenant/useTenant'

export function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { signOut } = useAuth()
  const { memberships, loading, refresh, setActiveCompany } = useTenant()
  const navigate = useNavigate()

  const [companyName, setCompanyName] = useState('')
  const [establishmentName, setEstablishmentName] = useState('')
  const [kind, setKind] = useState<EstablishmentKind>('hair_salon')
  const [country, setCountry] = useState('FR')
  const [city, setCity] = useState('')
  const [timezone, setTimezone] = useState(defaultTimezone('FR'))
  const [locale, setLocale] = useState<AppLocale>(lang as AppLocale)
  const [currency, setCurrency] = useState('EUR')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const timezones = useMemo(() => listTimezones(), [])

  if (loading) return <FullPageSpinner />
  // Invité en cours : il rejoint une entreprise existante au lieu d'en créer une.
  if (memberships.length === 0 && readPendingInvitation()) return <Navigate to="/invitation" replace />
  // Un salon existe déjà : on rejoint l'application (la création d'autres salons viendra ensuite).
  if (memberships.length > 0 && !submitting) return <Navigate to="/" replace />

  function onCountryChange(code: string) {
    setCountry(code)
    setCurrency(defaultCurrency(code))
    setTimezone(defaultTimezone(code))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!supabase || submitting) return
    setError(null)
    if (companyName.trim().length < 2 || establishmentName.trim().length < 2) return setError(t('errors.invalidInput'))
    setSubmitting(true)
    const { data, error: err } = await supabase.rpc('create_company_with_establishment', {
      p_company_name: companyName.trim(),
      p_establishment_name: establishmentName.trim(),
      p_kind: kind,
      p_country_code: country,
      p_city: city.trim() || null,
      p_timezone: timezone,
      p_locale: locale,
      p_currency: currency,
    })
    if (err || !data) {
      setSubmitting(false)
      return setError(t(authErrorKey(err)))
    }
    setActiveCompany(data)
    await refresh()
    navigate('/', { replace: true })
  }

  return (
    <AuthShell>
      <Store className="size-10 text-brand" aria-hidden="true" />
      <h1 className="mt-3 font-display text-3xl font-semibold text-slate-900">{t('onboarding.title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('onboarding.subtitle')}</p>

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <Field id="companyName" label={t('onboarding.companyName')} hint={t('onboarding.companyHint')}>
          <input id="companyName" required minLength={2} maxLength={120} autoComplete="organization" value={companyName}
            onChange={(e) => setCompanyName(e.target.value)} aria-describedby="companyName-hint" className="input" />
        </Field>
        <Field id="establishmentName" label={t('onboarding.establishmentName')}>
          <input id="establishmentName" required minLength={2} maxLength={120} value={establishmentName}
            onChange={(e) => setEstablishmentName(e.target.value)} className="input" />
        </Field>
        <Field id="kind" label={t('onboarding.kind')}>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as EstablishmentKind)} className="input">
            {ESTABLISHMENT_KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="country" label={t('onboarding.country')}>
            <select id="country" value={country} onChange={(e) => onCountryChange(e.target.value)} className="input">
              {COUNTRIES.map((c) => <option key={c} value={c}>{countryName(c, lang)}</option>)}
            </select>
          </Field>
          <Field id="city" label={`${t('onboarding.city')} (${t('common.optional')})`}>
            <input id="city" maxLength={120} autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} className="input" />
          </Field>
        </div>
        <Field id="timezone" label={t('onboarding.timezone')}>
          <select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input">
            {timezones.map((tz) => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="locale" label={t('onboarding.language')}>
            <select id="locale" value={locale} onChange={(e) => setLocale(e.target.value as AppLocale)} className="input">
              {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Field>
          <Field id="currency" label={t('onboarding.currency')}>
            <select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>

        <p className="flex items-start gap-2 text-xs text-slate-500">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden="true" />
          {t('onboarding.privacy')}
        </p>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? t('onboarding.submitting') : t('onboarding.submit')}
        </button>
      </form>
      <button type="button" onClick={() => void signOut()} className="mt-4 inline-flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-rose-600">
        <LogOut className="size-4" aria-hidden="true" /> {t('nav.logout')}
      </button>
    </AuthShell>
  )
}
