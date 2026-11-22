import { Download, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { Field } from '../components/Field'
import { FormMessage } from '../components/FormMessage'
import { PageHeader } from '../components/PageHeader'
import { SUPPORTED_LANGUAGES } from '../i18n'
import type { AppLocale } from '../lib/database.types'
import { authErrorKey } from '../lib/authErrors'
import { supabase } from '../lib/supabase'
import { isValidDisplayName } from '../lib/validation'

export function AccountPage() {
  const { t, i18n } = useTranslation()
  const { state, refreshProfile, signOut } = useAuth()
  const navigate = useNavigate()
  const profile = state.status === 'live' ? state.profile : null
  const [name, setName] = useState(profile?.display_name ?? '')
  const [locale, setLocale] = useState<AppLocale>(profile?.locale ?? 'fr')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  if (state.status !== 'live') {
    return (
      <div>
        <PageHeader title={t('account.title')} />
        <p className="card p-6 text-sm text-slate-500">{t('account.demoUnavailable')}</p>
      </div>
    )
  }
  const userId = state.session.user.id

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    if (!isValidDisplayName(name)) return setMessage({ kind: 'error', text: t('signup.errors.displayName') })
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ display_name: name.trim(), locale }).eq('id', userId)
    setBusy(false)
    if (error) return setMessage({ kind: 'error', text: t(authErrorKey(error)) })
    await i18n.changeLanguage(locale)
    await refreshProfile()
    setMessage({ kind: 'success', text: t('common.saved') })
  }

  async function exportData() {
    if (!supabase) return
    const { data, error } = await supabase.rpc('export_my_data')
    if (error) return setMessage({ kind: 'error', text: t(authErrorKey(error)) })
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `solussimo-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function deleteAccount(e: FormEvent) {
    e.preventDefault()
    if (!supabase || confirm !== t('account.deleteWord')) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_my_account')
    setBusy(false)
    if (error) return setMessage({ kind: 'error', text: t(authErrorKey(error)) })
    await signOut()
    navigate('/connexion', { replace: true })
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />
      <div className="mb-4" aria-live="polite">{message && <FormMessage kind={message.kind}>{message.text}</FormMessage>}</div>

      <form onSubmit={saveProfile} className="card space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">{t('account.profileTitle')}</h2>
        <Field id="accEmail" label={t('account.email')}>
          <input id="accEmail" value={state.session.user.email ?? ''} readOnly className="input bg-slate-50 text-slate-500" />
        </Field>
        <Field id="accName" label={t('signup.displayName')}>
          <input id="accName" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </Field>
        <Field id="accLocale" label={t('account.language')}>
          <select id="accLocale" value={locale} onChange={(e) => setLocale(e.target.value as AppLocale)} className="input">
            {SUPPORTED_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </Field>
        <button type="submit" className="btn-primary" disabled={busy}>{busy ? t('common.saving') : t('common.save')}</button>
      </form>

      <section className="card mt-6 space-y-5 p-5">
        <h2 className="font-semibold text-slate-900">{t('account.privacyTitle')}</h2>
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{t('account.exportTitle')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('account.exportText')}</p>
          <button type="button" onClick={() => void exportData()} className="btn-secondary mt-3">
            <Download className="size-4" aria-hidden="true" /> {t('account.exportButton')}
          </button>
        </div>
        <form onSubmit={deleteAccount} className="border-t border-slate-100 pt-5">
          <h3 className="text-sm font-semibold text-rose-700">{t('account.deleteTitle')}</h3>
          <p className="mt-1 text-sm text-slate-500">{t('account.deleteText')}</p>
          <label htmlFor="accDelete" className="mt-3 block text-xs font-medium text-slate-600">
            {t('account.deleteConfirmLabel', { word: t('account.deleteWord') })}
          </label>
          <input id="accDelete" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" className="input mt-1 max-w-xs" />
          <button type="submit" disabled={busy || confirm !== t('account.deleteWord')}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
            <Trash2 className="size-4" aria-hidden="true" /> {t('account.deleteButton')}
          </button>
        </form>
      </section>
    </div>
  )
}
