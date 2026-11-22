import { ArrowDownLeft, ArrowUpRight, Lock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { Sheet } from '../../../components/Sheet'
import type { ClosureRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency, formatDate } from '../../../lib/format'
import { countTotal, parseAmountToCents } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { CashCount } from './CashCount'
import { CheckoutNav } from './CheckoutNav'
import { DocumentButton } from './DocumentButton'
import { useCheckoutData, useCheckoutEstablishment } from './useCheckoutData'

/** Clôture de session (ticket Z) : comptage à l'aveugle, écart justifié, PDF ; mouvements d'espèces (responsables). */
export function ClosingPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { can } = useTenant()
  const { establishments, establishment, choose } = useCheckoutEstablishment()
  const data = useCheckoutData(establishment?.id)
  const money = (c: number) => formatCurrency(c / 100, lang, data.currency)
  const [count, setCount] = useState<Record<string, number>>({})
  const [reason, setReason] = useState('')
  const [needReason, setNeedReason] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ closure_id: string; document_no: string; expected_cents: number; difference_cents: number } | null>(null)
  const [closures, setClosures] = useState<ClosureRow[]>([])
  const [movement, setMovement] = useState<'in' | 'out' | null>(null)

  const loadClosures = useCallback(async () => {
    if (!supabase || !establishment) return
    const { data: rows } = await supabase.from('closures').select('*').eq('establishment_id', establishment.id).order('created_at', { ascending: false }).limit(20)
    setClosures(rows ?? [])
  }, [establishment])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadClosures()
  }, [loadClosures])

  async function close() {
    if (!supabase || !data.session || busy) return
    if (!window.confirm(t('checkoutLive.close.confirm'))) return
    setBusy(true)
    setError(null)
    const { data: res, error: err } = await supabase.rpc('close_register', {
      p_session_id: data.session.id, p_counted_cash_cents: countTotal(count), p_count: count, p_reason: reason.trim() || null,
    })
    setBusy(false)
    if (err) {
      const key = authErrorKey(err)
      if (key === 'errors.differenceReasonRequired') setNeedReason(true)
      return setError(t(key))
    }
    setResult(res)
    setCount({})
    setReason('')
    setNeedReason(false)
    await Promise.all([data.reload(), loadClosures()])
  }

  return (
    <div>
      <PageHeader title={t('checkoutLive.close.title')} subtitle={t('checkoutLive.close.subtitle')} />
      <CheckoutNav establishments={establishments} establishment={establishment} onChoose={choose} />

      {result && (
        <section className="card mb-4 space-y-3 p-5" data-testid="z-result">
          <p className="font-display text-lg font-semibold text-slate-900">{t('checkoutLive.close.done', { no: result.document_no })}</p>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">{t('checkoutLive.doc.expected')}</dt><dd className="text-right font-semibold tabular-nums">{money(result.expected_cents)}</dd>
            <dt className="text-slate-500">{t('checkoutLive.doc.difference')}</dt>
            <dd className={`text-right font-semibold tabular-nums ${result.difference_cents === 0 ? 'text-brand-dark' : 'text-rose-600'}`} data-testid="z-difference">{money(result.difference_cents)}</dd>
          </dl>
          <DocumentButton kind="closure" id={result.closure_id} label={t('checkoutLive.close.pdf')} primary onError={setError} />
        </section>
      )}

      {!data.loading && !data.session && !result && <p className="card p-5 text-sm text-slate-500">{t('checkoutLive.close.noSession')}</p>}

      {data.session && (
        <section className="card space-y-4 p-5">
          {can('cash.movement') && (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-secondary" onClick={() => setMovement('in')}><ArrowDownLeft className="size-4" aria-hidden="true" />{t('checkoutLive.movement.in')}</button>
              <button type="button" className="btn-secondary" onClick={() => setMovement('out')}><ArrowUpRight className="size-4" aria-hidden="true" />{t('checkoutLive.movement.out')}</button>
            </div>
          )}
          <p className="text-sm text-slate-600">{t('checkoutLive.close.countHint')}</p>
          <CashCount currency={data.currency} value={count} onChange={setCount} />
          {needReason && (
            <Field id="zReason" label={t('checkoutLive.close.reason')}>
              <input id="zReason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} className="input" data-testid="z-reason" />
            </Field>
          )}
          <FormMessage kind="error">{error}</FormMessage>
          <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void close()} data-testid="close-register">
            <Lock className="size-4" aria-hidden="true" />{t('checkoutLive.close.submit')}
          </button>
        </section>
      )}

      {closures.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-display text-lg font-semibold text-slate-900">{t('checkoutLive.close.history')}</h2>
          <ul className="space-y-2">
            {closures.map((c) => (
              <li key={c.id} className="card flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-semibold">{c.document_no}</p>
                  <p className="text-xs text-slate-500">{formatDate(new Date(c.created_at), lang, { dateStyle: 'medium', timeStyle: 'short' })} · {money(c.total_cents)}</p>
                </div>
                <div className="w-28"><DocumentButton kind="closure" id={c.id} label="PDF" onError={setError} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {movement && data.session && (
        <MovementSheet direction={movement} sessionId={data.session.id} onClose={() => setMovement(null)} />
      )}
    </div>
  )
}

function MovementSheet({ direction, sessionId, onClose }: { direction: 'in' | 'out'; sessionId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cents = parseAmountToCents(amount)
  async function save() {
    if (!supabase || cents == null || cents <= 0) return
    setBusy(true)
    const { error: err } = await supabase.rpc('add_cash_movement', { p_session_id: sessionId, p_direction: direction, p_amount_cents: cents, p_reason: reason.trim() })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    onClose()
  }
  return (
    <Sheet title={t(direction === 'in' ? 'checkoutLive.movement.in' : 'checkoutLive.movement.out')} onClose={onClose}>
      <div className="space-y-4">
        <Field id="mvAmount" label={t('checkoutLive.customAmount')}>
          <input id="mvAmount" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="input" />
        </Field>
        <Field id="mvReason" label={t('checkoutLive.movement.reason')}>
          <input id="mvReason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="input" />
        </Field>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-primary w-full" disabled={busy || !cents || reason.trim().length < 2} onClick={() => void save()}>{t('common.save')}</button>
      </div>
    </Sheet>
  )
}
