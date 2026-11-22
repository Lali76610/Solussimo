import { MailCheck, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { PasswordInput } from '../components/PasswordInput'
import type { AppLocale } from '../lib/database.types'
import { authErrorKey } from '../lib/authErrors'
import { isSupabaseConfigured } from '../lib/supabase'
import { isStrongPassword, isValidDisplayName, isValidEmail } from '../lib/validation'

export function SignUpPage() {
  const { t, i18n } = useTranslation()
  const { state, signUp } = useAuth()
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const [consentBefore = '', consentAfter = ''] = t('signup.consent', { link: '\u0000' }).split('\u0000')

  if (!isSupabaseConfigured) return <Navigate to="/connexion" replace />
  if (state.status === 'live') return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (submitting) return
    setError(null)
    if (!isValidDisplayName(displayName)) return setError(t('signup.errors.displayName'))
    if (!isValidEmail(email)) return setError(t('login.errors.invalidEmail'))
    if (!isStrongPassword(password)) return setError(t('signup.errors.passwordRules'))
    if (!consent) return setError(t('signup.errors.consent'))

    setSubmitting(true)
    try {
      await signUp({ email, password, displayName, locale: (i18n.resolvedLanguage ?? 'fr') as AppLocale })
      setPassword('')
      setDone(true)
    } catch (err) {
      setError(t(authErrorKey(err)))
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <AuthShell>
        <MailCheck className="size-12 text-brand" aria-hidden="true" />
        <h1 className="mt-4 font-display text-3xl font-semibold text-slate-900">{t('signup.checkEmailTitle')}</h1>
        <p className="mt-3 text-sm text-slate-600">{t('signup.checkEmailText')}</p>
        <Link to="/connexion" className="btn-secondary mt-8">
          {t('forgot.back')}
        </Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold text-slate-900">{t('signup.title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('signup.subtitle')}</p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        <Field id="displayName" label={t('signup.displayName')}>
          <input id="displayName" autoComplete="nickname" maxLength={80} required value={displayName}
            onChange={(e) => setDisplayName(e.target.value)} className="input" />
        </Field>
        <Field id="email" label={t('login.email')}>
          <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
        </Field>
        <Field id="password" label={t('login.password')} hint={t('signup.passwordHint')}>
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-hint" />
        </Field>

        <label className="flex items-start gap-3 text-sm text-slate-600">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-brand" />
          <span>
            {consentBefore}
            <Link to="/confidentialite" target="_blank" rel="noopener" className="font-medium text-brand underline">
              {t('signup.consentLink')}
            </Link>
            {consentAfter}
          </span>
        </label>

        <div aria-live="polite">
          <FormMessage kind="error">{error}</FormMessage>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          <UserPlus className="size-4" aria-hidden="true" />
          {submitting ? t('signup.submitting') : t('signup.submit')}
        </button>
      </form>

      <p className="mt-4 text-center text-sm text-slate-500">
        {t('signup.haveAccount')}{' '}
        <Link to="/connexion" className="font-semibold text-brand hover:text-brand-dark">
          {t('signup.signIn')}
        </Link>
      </p>
    </AuthShell>
  )
}
