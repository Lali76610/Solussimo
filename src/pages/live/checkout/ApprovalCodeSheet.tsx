import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import { authErrorKey } from '../../../lib/authErrors'
import { formatDate } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'

/** D5 : un responsable génère un code à usage unique (15 min) autorisant une remise au-delà du plafond. */
export function ApprovalCodeSheet({ establishmentId, onClose }: { establishmentId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [pct, setPct] = useState(30)
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!supabase) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('create_discount_approval', { p_establishment_id: establishmentId, p_max_bp: pct * 100 })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    setCode(data?.[0] ?? null)
  }

  return (
    <Sheet title={t('checkoutLive.approval.title')} onClose={onClose}>
      {code ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-slate-500">{t('checkoutLive.approval.give', { pct })}</p>
          <p className="font-mono text-4xl font-bold tracking-[0.3em] text-brand-dark" data-testid="approval-value">{code.code}</p>
          <p className="text-xs text-slate-500">
            {t('checkoutLive.approval.expires', { time: formatDate(new Date(code.expires_at), lang, { hour: '2-digit', minute: '2-digit' }) })}
          </p>
          <button type="button" className="btn-primary w-full" onClick={onClose}>{t('common.close')}</button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">{t('checkoutLive.approval.hint')}</p>
          <label htmlFor="apPct" className="block text-sm font-medium text-slate-700">{t('checkoutLive.approval.max', { pct })}</label>
          <input id="apPct" type="range" min={5} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-full accent-[#008B8B]" />
          <FormMessage kind="error">{error}</FormMessage>
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void create()}>{t('checkoutLive.approval.create')}</button>
        </div>
      )}
    </Sheet>
  )
}
