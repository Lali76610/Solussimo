import { ArrowLeft, HeartPulse, History, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { authErrorKey } from '../../../lib/authErrors'
import { formatDate } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { clientName } from './clientFormat'

type Msg = { kind: 'error' | 'success'; text: string } | null

export function ClientsSettingsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active, can, refresh } = useTenant()
  const company = active?.company
  const [acks, setAcks] = useState({ consent: false, dpia: false, information: false })
  const [review, setReview] = useState(String(company?.client_review_months ?? 36))
  const [accounting, setAccounting] = useState(String(company?.accounting_retention_years ?? 10))
  const [toReview, setToReview] = useState<{ id: string; first_name: string | null; last_name: string | null; last_activity: string }[]>([])
  const [msg, setMsg] = useState<Msg>(null)

  const loadReview = useCallback(async () => {
    if (!supabase || !company || !can('settings.retention')) return
    const { data } = await supabase.rpc('clients_to_review', { p_company_id: company.id })
    setToReview(data ?? [])
  }, [company, can])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadReview()
  }, [loadReview])

  if (!company) return null

  async function setHealth(enabled: boolean) {
    if (!supabase || !company) return
    if (!enabled && !window.confirm(t('settingsClients.disableConfirm'))) return
    const { error } = await supabase.rpc('set_health_data_enabled', {
      p_company_id: company.id, p_enabled: enabled, p_ack_consent: acks.consent, p_ack_dpia: acks.dpia, p_ack_information: acks.information,
    })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await refresh()
  }
  async function saveRetention() {
    if (!supabase || !company) return
    const { error } = await supabase.rpc('set_retention_settings', { p_company_id: company.id, p_review_months: Number(review), p_accounting_years: Number(accounting) })
    if (error) return setMsg({ kind: 'error', text: t(authErrorKey(error)) })
    setMsg({ kind: 'success', text: t('common.saved') })
    await refresh()
    await loadReview()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/clients" className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand"><ArrowLeft className="size-4" aria-hidden="true" />{t('clients.title')}</Link>
      <PageHeader title={t('settingsClients.title')} subtitle={t('settingsClients.subtitle')} />
      <FormMessage kind={msg?.kind ?? 'error'}>{msg?.text}</FormMessage>

      <section className="card space-y-4 p-5">
        <h2 className="flex items-center gap-2 font-semibold text-slate-900"><HeartPulse className="size-5 text-brand" aria-hidden="true" />{t('settingsClients.healthTitle')}</h2>
        <p className="text-sm text-slate-600">{t('settingsClients.healthText')}</p>
        {company.health_data_enabled ? (
          <>
            {company.health_data_enabled_at && (
              <p className="badge bg-brand-light text-brand-dark">{t('settingsClients.enabledSince', { date: formatDate(new Date(company.health_data_enabled_at), lang, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
            )}
            {can('settings.health') && <button type="button" onClick={() => void setHealth(false)} className="btn-secondary w-full text-rose-600">{t('settingsClients.disable')}</button>}
          </>
        ) : can('settings.health') ? (
          <>
            <fieldset className="space-y-2 rounded-xl border border-slate-200 p-3">
              <legend className="px-1 text-sm font-medium text-slate-700">{t('settingsClients.checklist')}</legend>
              {(['consent', 'dpia', 'information'] as const).map((k) => (
                <label key={k} className="flex items-start gap-3 py-1 text-sm text-slate-700">
                  <input type="checkbox" checked={acks[k]} onChange={(e) => setAcks({ ...acks, [k]: e.target.checked })} className="mt-0.5 size-5 shrink-0 accent-brand" />
                  {t(`settingsClients.ack.${k}`)}
                </label>
              ))}
            </fieldset>
            <p className="text-xs text-slate-500">{t('settingsClients.legalNote')}</p>
            <button type="button" disabled={!(acks.consent && acks.dpia && acks.information)} onClick={() => void setHealth(true)} className="btn-primary w-full">{t('settingsClients.enable')}</button>
          </>
        ) : <p className="text-xs text-slate-500">{t('settingsClients.ownerOnly')}</p>}
      </section>

      {can('settings.retention') && (
        <section className="card space-y-4 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck className="size-5 text-brand" aria-hidden="true" />{t('settingsClients.retentionTitle')}</h2>
          <p className="text-sm text-slate-600">{t('settingsClients.retentionText')}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="rReview" label={t('settingsClients.reviewMonths')}>
              <input id="rReview" type="number" inputMode="numeric" min={12} max={120} value={review} onChange={(e) => setReview(e.target.value)} className="input" />
            </Field>
            <Field id="rAcc" label={t('settingsClients.accountingYears')}>
              <input id="rAcc" type="number" inputMode="numeric" min={1} max={15} value={accounting} onChange={(e) => setAccounting(e.target.value)} className="input" />
            </Field>
          </div>
          <p className="text-xs text-slate-500">{t('settingsClients.countryDefault', { country: company.country_code })}</p>
          <button type="button" onClick={() => void saveRetention()} className="btn-primary">{t('common.save')}</button>
        </section>
      )}

      {can('settings.retention') && (
        <section className="card space-y-3 p-5" data-testid="review-list">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><History className="size-5 text-brand" aria-hidden="true" />{t('settingsClients.reviewTitle', { months: company.client_review_months })}</h2>
          <p className="text-sm text-slate-600">{t('settingsClients.reviewText')}</p>
          {toReview.length === 0 ? <p className="text-sm text-slate-500">{t('settingsClients.reviewEmpty')}</p> : (
            <ul className="divide-y divide-slate-100">
              {toReview.map((c) => (
                <li key={c.id}><Link to={`/clients/${c.id}`} className="flex min-h-11 items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium text-slate-800">{clientName(c)}</span>
                  <span className="text-xs text-slate-500">{formatDate(new Date(c.last_activity), lang, { month: 'short', year: 'numeric' })}</span>
                </Link></li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
