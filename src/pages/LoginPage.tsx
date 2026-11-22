import { Eye, EyeOff, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { DEMO_ACCOUNT } from '../auth/session'
import { useAuth } from '../auth/useAuth'
import { LanguageSwitcher } from '../components/LanguageSwitcher'
import { Logo } from '../components/Logo'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_ATTEMPTS = 5
const LOCK_SECONDS = 30

export function LoginPage() {
  const { t } = useTranslation()
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [lockedFor, setLockedFor] = useState(0)

  useEffect(() => {
    if (lockedFor <= 0) return
    const id = window.setTimeout(() => setLockedFor((s) => s - 1), 1000)
    return () => window.clearTimeout(id)
  }, [lockedFor])

  if (user) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from && from.startsWith('/') ? from : '/'} replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (lockedFor > 0 || submitting) return
    setError(null)
    if (!EMAIL_RE.test(email.trim())) return setError(t('login.errors.invalidEmail'))
    if (password.length < 8) return setError(t('login.errors.passwordLength'))

    setSubmitting(true)
    const ok = await login(email, password)
    setSubmitting(false)
    if (ok) {
      setPassword('')
      navigate('/', { replace: true })
      return
    }
    const next = attempts + 1
    setPassword('')
    if (next >= MAX_ATTEMPTS) {
      setAttempts(0)
      setLockedFor(LOCK_SECONDS)
    } else {
      setAttempts(next)
    }
    // Message générique : ne révèle pas si le compte existe.
    setError(t('login.errors.credentials'))
  }

  function fillDemo() {
    setEmail(DEMO_ACCOUNT.email)
    setPassword(DEMO_ACCOUNT.password)
    setError(null)
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Panneau de marque */}
      <section className="relative hidden overflow-hidden bg-brand lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          className="pointer-events-none absolute -top-32 -right-32 size-[28rem] rounded-full bg-brand-light/20"
          aria-hidden="true"
        />
        <div className="pointer-events-none absolute -bottom-40 -left-24 size-96 rounded-full border-[3rem] border-gold/30" aria-hidden="true" />
        <Logo variant="light" />
        <div className="relative max-w-md">
          <Sparkles className="mb-4 size-8 text-gold" aria-hidden="true" />
          <h2 className="font-display text-4xl leading-tight font-semibold text-white">{t('login.heroTitle')}</h2>
          <p className="mt-4 text-brand-light">{t('login.heroText')}</p>
        </div>
        <p className="relative flex items-center gap-2 text-sm text-brand-light">
          <ShieldCheck className="size-4 text-gold" aria-hidden="true" />
          {t('login.secure')}
        </p>
      </section>

      {/* Formulaire */}
      <section className="pt-safe pb-safe flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo className="lg:invisible" />
          <LanguageSwitcher />
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-semibold text-slate-900">{t('login.title')}</h1>
          <p className="mt-2 text-sm text-slate-500">{t('login.subtitle')}</p>

          <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                {t('login.email')}
              </label>
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
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  {t('login.password')}
                </label>
                <button type="button" className="text-xs font-medium text-brand hover:text-brand-dark">
                  {t('login.forgot')}
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  maxLength={128}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-400 hover:text-brand"
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>

            <div aria-live="polite" className="min-h-5">
              {(error || lockedFor > 0) && (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
                  {lockedFor > 0 ? t('login.errors.locked', { seconds: lockedFor }) : error}
                </p>
              )}
            </div>

            <button type="submit" className="btn-primary w-full" disabled={submitting || lockedFor > 0}>
              <Lock className="size-4" aria-hidden="true" />
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-gold/50 bg-gold-light/40 p-4">
            <p className="text-xs text-gold-dark">{t('login.demoHint')}</p>
            <button type="button" onClick={fillDemo} className="btn-secondary mt-3 w-full">
              {t('login.demo')}
            </button>
          </div>
        </div>

        <p className="mx-auto max-w-sm text-center text-xs text-slate-400">{t('login.privacy')}</p>
      </section>
    </div>
  )
}
