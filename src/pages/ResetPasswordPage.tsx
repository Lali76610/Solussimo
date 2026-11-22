import { KeyRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { FullPageSpinner } from '../components/FullPageSpinner'
import { PasswordInput } from '../components/PasswordInput'
import { authErrorKey } from '../lib/authErrors'
import { isStrongPassword } from '../lib/validation'

/** Atteinte via le lien e-mail de réinitialisation (session de récupération Supabase). */
export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { state, updatePassword } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (state.status === 'loading') return <FullPageSpinner />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!isStrongPassword(password)) return setError(t('signup.errors.passwordRules'))
    setSubmitting(true)
    try {
      await updatePassword(password)
      setPassword('')
      navigate('/', { replace: true })
    } catch (err) {
      setError(t(authErrorKey(err)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold text-slate-900">{t('resetPassword.title')}</h1>
      {state.status !== 'live' ? (
        <>
          <div className="mt-6">
            <FormMessage kind="error">{t('resetPassword.invalidLink')}</FormMessage>
          </div>
          <Link to="/mot-de-passe-oublie" className="btn-secondary mt-6">
            {t('forgot.title')}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-slate-500">{t('resetPassword.subtitle')}</p>
          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            <Field id="password" label={t('resetPassword.newPassword')} hint={t('signup.passwordHint')}>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="password-hint" />
            </Field>
            <FormMessage kind="error">{error}</FormMessage>
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              <KeyRound className="size-4" aria-hidden="true" />
              {t('resetPassword.submit')}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  )
}
