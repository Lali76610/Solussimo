import { LogIn, MailCheck, UserPlus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { AuthShell } from '../components/AuthShell'
import { FormMessage } from '../components/FormMessage'
import { FullPageSpinner } from '../components/FullPageSpinner'
import type { CompanyRole } from '../lib/database.types'
import { authErrorKey } from '../lib/authErrors'
import { clearPendingInvitation, readPendingInvitation, readTokenFromHash, savePendingInvitation } from '../lib/invitations'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useTenant } from '../tenant/useTenant'

type Info = { company_name: string; role: CompanyRole; email: string; status: string }

/** Acceptation d'une invitation (lien reçu : /invitation#t=<jeton>). */
export function InvitationPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { state, signOut } = useAuth()
  const { refresh, setActiveCompany } = useTenant()
  const [token] = useState<string | null>(() => {
    const fromHash = readTokenFromHash(window.location.hash)
    if (fromHash) {
      savePendingInvitation(fromHash)
      // Retire le jeton de la barre d'adresse (historique, captures d'écran).
      window.history.replaceState(null, '', '/invitation')
      return fromHash
    }
    return readPendingInvitation()
  })
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const live = state.status === 'live'

  useEffect(() => {
    if (!live || !token || !supabase) return
    void supabase.rpc('get_invitation', { p_token: token }).then(({ data, error: err }) => {
      if (err) return setError(t(authErrorKey(err)))
      const row = data?.[0]
      if (!row) return setError(t('errors.invitationInvalid'))
      setInfo(row)
    })
  }, [live, token, t])

  if (state.status === 'loading') return <FullPageSpinner />

  async function accept() {
    if (!supabase || !token) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('accept_invitation', { p_token: token })
    if (err || !data) {
      setBusy(false)
      return setError(t(authErrorKey(err)))
    }
    clearPendingInvitation()
    setActiveCompany(data)
    await refresh()
    navigate('/', { replace: true })
  }

  function forget() {
    clearPendingInvitation()
    navigate('/connexion', { replace: true })
  }

  const email = state.status === 'live' ? state.session.user.email?.toLowerCase() : null

  return (
    <AuthShell>
      <Users className="size-10 text-brand" aria-hidden="true" />
      <h1 className="mt-3 font-display text-3xl font-semibold text-slate-900">{t('invite.title')}</h1>

      {!token || !isSupabaseConfigured ? (
        <div className="mt-6"><FormMessage kind="error">{t('errors.invitationInvalid')}</FormMessage></div>
      ) : !live ? (
        <>
          <p className="mt-2 text-sm text-slate-600">{t('invite.signInFirst')}</p>
          <div className="mt-6 grid gap-3">
            <Link to="/connexion" state={{ from: '/invitation' }} className="btn-primary"><LogIn className="size-4" aria-hidden="true" />{t('login.submit')}</Link>
            <Link to="/inscription" className="btn-secondary"><UserPlus className="size-4" aria-hidden="true" />{t('login.createAccount')}</Link>
          </div>
        </>
      ) : info ? (
        <div className="mt-6 space-y-4">
          <div className="card space-y-1 p-4">
            <p className="text-sm text-slate-500">{t('invite.joining')}</p>
            <p className="font-display text-xl font-semibold text-brand-dark">{info.company_name}</p>
            <p className="text-sm text-slate-600">{t('invite.asRole', { role: t(`companyRoles.${info.role}`) })}</p>
            <p className="text-xs text-slate-500">{t('invite.forEmail', { email: info.email })}</p>
          </div>
          {info.status !== 'pending' ? (
            <FormMessage kind="error">{t('errors.invitationInvalid')}</FormMessage>
          ) : email !== info.email ? (
            <>
              <FormMessage kind="error">{t('invite.wrongAccount', { email: info.email })}</FormMessage>
              <button type="button" className="btn-secondary w-full" onClick={() => void signOut()}>{t('nav.logout')}</button>
            </>
          ) : (
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void accept()}>
              <MailCheck className="size-4" aria-hidden="true" />{t('invite.accept')}
            </button>
          )}
          <FormMessage kind="error">{error}</FormMessage>
        </div>
      ) : (
        <div className="mt-6"><FormMessage kind="error">{error}</FormMessage></div>
      )}
      {token && (
        <button type="button" onClick={forget} className="mt-6 text-center text-sm text-slate-500 hover:text-rose-600">{t('invite.ignore')}</button>
      )}
    </AuthShell>
  )
}
