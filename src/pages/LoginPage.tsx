import { Lock, PlayCircle } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { PasswordInput } from '../components/PasswordInput'
import { authErrorKey } from '../lib/authErrors'
import { isSupabaseConfigured } from '../lib/supabase'
import { isValidEmail } from '../lib/validation'

const MAX_ATTEMPTS = 5
const LOCK_SECONDS = 30

export function LoginPage() {
  const { t } = useTranslation()
  const { state, signIn, enterDemo } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [lockedFor, setLockedFor] = useState(0)

  useEffect(() => {
    if (lockedFor <= 0) return
    const id = window.setTimeout(() => setLockedFor((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [lockedFor])

  if (state.status === 'live' || state.status === 'demo') {
    const from = (location.state as { from?: string } | null)?.from
    // Seuls les chemins internes sont acceptés (pas de redirection ouverte).
    const safe = from && from.startsWith('/') && !from.startsWith('//') ? from : '/'
    return <Navigate to={safe} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (lockedFor > 0 || submitting) return
    setError(null)
    if (!isValidEmail(email)) return setError(t('login.errors.invalidEmail'))
    if (password.length < 8) return setError(t('login.errors.passwordLength'))

    setSubmitting(true)
    try {
      await signIn(email, password)
      setPassword('')
    } catch (err) {
      setPassword('')
      const next = attempts + 1
      if (next >= MAX_ATTEMPTS) {
        setAttempts(0)
        setLockedFor(LOCK_SECONDS)
      } else {
        setAttempts(next)
      }
      setError(t(authErrorKey(err)))
    } finally {
      setSubmitting(false)
    }
  }

  function startDemo() {
    enterDemo()
    navigate('/', { replace: true })
  }

  return (
    <AuthShell>
      <h1 className="font-display text-3xl font-semibold text-slate-900">{t('login.title')}</h1>
      <p className="mt-2 text-sm text-slate-500">{t('login.subtitle')}</p>

      {isSupabaseConfigured ? (
        <>
          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            <Field id="email" label={t('login.email')}>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
              />
            </Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  {t('login.password')}
                </label>
                <Link to="/mot-de-passe-oublie" className="text-xs font-medium text-brand hover:text-brand-dark">
                  {t('login.forgot')}
                </Link>
              </div>
              <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
            </div>

            <div aria-live="polite">
              <FormMessage kind="error">{lockedFor > 0 ? t('login.errors.locked', { seconds: lockedFor }) : error}</FormMessage>
            </div>

            <button type="submit" className="btn-primary w-full" disabled={submitting || lockedFor > 0}>
              <Lock className="size-4" aria-hidden="true" />
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-500">
            {t('login.noAccount')}{' '}
            <Link to="/inscription" className="font-semibold text-brand hover:text-brand-dark">
              {t('login.createAccount')}
            </Link>
          </p>
        </>
      ) : (
        <p className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600" data-testid="auth-not-configured">
          {t('login.notConfigured')}
        </p>
      )}

      {/* Mode démonstration : séparé visuellement et techniquement de la vraie connexion */}
      <div className="mt-8 rounded-xl border border-dashed border-gold bg-gold-light/40 p-4">
        <p className="text-xs font-semibold tracking-wider text-gold-dark uppercase">{t('login.demoTitle')}</p>
        <p className="mt-1 text-xs text-gold-dark">{t('login.demoHint')}</p>
        <button type="button" onClick={startDemo} className="btn-secondary mt-3 w-full">
          <PlayCircle className="size-4" aria-hidden="true" />
          {t('login.demo')}
        </button>
      </div>
    </AuthShell>
  )
}
