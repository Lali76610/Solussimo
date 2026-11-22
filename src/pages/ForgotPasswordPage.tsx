import { Send } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { authErrorKey } from '../lib/authErrors'
import { isSupabaseConfigured } from '../lib/supabase'
import { isValidEmail } from '../lib/validation'

export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!isSupabaseConfigured) return <Navigate to="/connexion" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isValidEmail(email)) return setError(t('login.errors.invalidEmail'))
    setSubmitting(true)
    try {
      await requestPasswordReset(email)
      setSent(true) // même message que le compte existe ou non (anti-énumération)
    } catch (err) {
      const key = authErrorKey(err)
      if (key === 'errors.rateLimited' || key === 'errors.network') setError(t(key))
      else setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold text-slate-900">{t('forgot.title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('forgot.subtitle')}</p>
      {sent ? (
        <div className="mt-8">
          <FormMessage kind="success">{t('forgot.sent')}</FormMessage>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
          <Field id="email" label={t('login.email')}>
            <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
              maxLength={254} required value={email} onChange={(e) => setEmail(e.target.value)} className="input" />
          </Field>
          <FormMessage kind="error">{error}</FormMessage>
          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            <Send className="size-4" aria-hidden="true" />
            {t('forgot.submit')}
          </button>
        </form>
      )}
      <Link to="/connexion" className="mt-6 text-center text-sm font-medium text-brand hover:text-brand-dark">
        {t('forgot.back')}
      </Link>
    </AuthShell>
  )
}
