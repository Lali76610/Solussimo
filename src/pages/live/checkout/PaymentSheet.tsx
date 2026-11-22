import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import type { CompleteSalePayload, PaymentMethodRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { centsToInput, newIdempotencyKey, parseAmountToCents } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { METHOD_ICON } from './methodIcons'


interface Pay {
  method: PaymentMethodRow
  amount: string
  tendered: string
  ref: string
}

/**
 * Encaissement : paiements simples ou mixtes, rendu monnaie (espèces), référence du terminal (jamais le numéro de carte).
 * La clé d'idempotence est créée à l'ouverture et conservée pour tout nouvel essai : un double appui
 * ou une coupure réseau ne crée jamais deux tickets.
 */
export function PaymentSheet({ totalCents, currency, methods, payload, onClose, onDone, onApprovalRequired }: {
  totalCents: number
  currency: string
  methods: PaymentMethodRow[]
  payload: Omit<CompleteSalePayload, 'idempotency_key' | 'payments'>
  onClose: () => void
  onDone: (r: { saleId: string; documentNo: string; changeCents: number }) => void
  onApprovalRequired: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const money = (c: number) => formatCurrency(c / 100, lang, currency)
  const [key] = useState(newIdempotencyKey)
  const [pays, setPays] = useState<Pay[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amounts = pays.map((p) => parseAmountToCents(p.amount) ?? 0)
  const paid = amounts.reduce((s, a) => s + a, 0)
  const remaining = totalCents - paid
  const change = pays.reduce((s, p, i) => {
    if (p.method.kind !== 'cash') return s
    const tendered = parseAmountToCents(p.tendered)
    return s + (tendered != null && tendered > (amounts[i] ?? 0) ? tendered - (amounts[i] ?? 0) : 0)
  }, 0)
  const invalidCash = pays.some((p, i) => p.method.kind === 'cash' && p.tendered !== '' && (parseAmountToCents(p.tendered) ?? 0) < (amounts[i] ?? 0))
  const ready = totalCents === 0 ? true : remaining === 0 && pays.every((_, i) => (amounts[i] ?? 0) > 0) && !invalidCash

  function addMethod(m: PaymentMethodRow) {
    const amount = Math.max(remaining, 0)
    setPays((cur) => [...cur, { method: m, amount: centsToInput(amount), tendered: '', ref: '' }])
  }
  const patch = (i: number, p: Partial<Pay>) => setPays((cur) => cur.map((x, j) => (j === i ? { ...x, ...p } : x)))

  async function confirm() {
    if (!supabase || busy || !ready) return
    if (pays.some((p) => /\d{12,}/.test(p.ref.replace(/\s/g, '')))) return setError(t('errors.cardNumberForbidden'))
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('complete_sale', {
      p_payload: {
        ...payload, idempotency_key: key,
        payments: pays.map((p, i) => ({
          method_id: p.method.id, amount_cents: amounts[i] ?? 0,
          ...(p.method.kind === 'cash' && parseAmountToCents(p.tendered) ? { tendered_cents: parseAmountToCents(p.tendered)! } : {}),
          external_ref: p.ref.trim() || null,
        })),
      },
    })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    if (data?.error === 'discount_approval_required') return onApprovalRequired()
    if (data?.sale_id) onDone({ saleId: data.sale_id, documentNo: data.document_no, changeCents: data.change_cents ?? 0 })
  }

  const quick = (amount: number) => [amount, ...[500, 1000, 2000, 5000, 10000].map((s) => Math.ceil(amount / s) * s)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 4)

  return (
    <Sheet title={t('checkoutLive.pay.title')} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-2xl bg-brand-50 p-4 text-center">
          <p className="text-sm text-brand-dark">{t('checkoutLive.pay.due')}</p>
          <p className="font-display text-3xl font-semibold text-brand-dark tabular-nums" data-testid="pay-total">{money(totalCents)}</p>
          {pays.length > 0 && remaining !== 0 && (
            <p className={`mt-1 text-sm font-semibold tabular-nums ${remaining > 0 ? 'text-amber-700' : 'text-rose-600'}`}>
              {remaining > 0 ? t('checkoutLive.pay.remaining', { amount: money(remaining) }) : t('checkoutLive.pay.over', { amount: money(-remaining) })}
            </p>
          )}
        </div>

        {pays.map((p, i) => {
          const Icon = METHOD_ICON[p.method.kind]
          const tendered = parseAmountToCents(p.tendered)
          return (
            <div key={i} className="space-y-2 rounded-2xl border border-slate-200 p-3">
              <div className="flex items-center gap-2">
                <Icon className="size-5 text-brand" aria-hidden="true" />
                <span className="flex-1 font-semibold">{p.method.label}</span>
                <input value={p.amount} inputMode="decimal" onChange={(e) => patch(i, { amount: e.target.value })} aria-label={t('checkoutLive.pay.amount', { method: p.method.label })}
                  className="h-11 w-28 rounded-xl border border-slate-200 px-3 text-right text-base tabular-nums" />
                <button type="button" onClick={() => setPays((cur) => cur.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-lg text-rose-500" aria-label={t('common.delete')}>
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
              {p.method.kind === 'cash' && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {quick(amounts[i] ?? 0).map((v) => (
                      <button key={v} type="button" onClick={() => patch(i, { tendered: centsToInput(v) })}
                        className="min-h-10 rounded-xl border border-slate-200 px-3 text-sm font-semibold tabular-nums">{money(v)}</button>
                    ))}
                  </div>
                  <input value={p.tendered} inputMode="decimal" placeholder={t('checkoutLive.pay.tendered')} onChange={(e) => patch(i, { tendered: e.target.value })}
                    aria-label={t('checkoutLive.pay.tendered')} className="input" data-testid="tendered" />
                  {tendered != null && tendered > (amounts[i] ?? 0) && (
                    <p className="text-right text-sm font-semibold text-brand-dark">{t('checkoutLive.pay.change', { amount: money(tendered - (amounts[i] ?? 0)) })}</p>
                  )}
                </div>
              )}
              {p.method.kind !== 'cash' && (
                <input value={p.ref} maxLength={40} onChange={(e) => patch(i, { ref: e.target.value })} placeholder={t('checkoutLive.pay.reference')}
                  aria-label={t('checkoutLive.pay.reference')} className="input text-sm" autoComplete="off" />
              )}
            </div>
          )
        })}

        {(remaining > 0 || pays.length === 0) && totalCents > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">{pays.length ? t('checkoutLive.pay.addMethod') : t('checkoutLive.pay.chooseMethod')}</p>
            <div className="grid grid-cols-2 gap-2" data-testid="methods">
              {methods.map((m) => {
                const Icon = METHOD_ICON[m.kind]
                return (
                  <button key={m.id} type="button" onClick={() => addMethod(m)}
                    className="flex min-h-14 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 text-left font-semibold text-slate-800 active:scale-[0.98] hover:border-brand">
                    <Icon className="size-5 text-brand" aria-hidden="true" />{m.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {pays.some((p) => p.method.kind === 'card') && <p className="text-xs text-slate-500">{t('checkoutLive.pay.cardHint')}</p>}
        {change > 0 && ready && (
          <p className="rounded-xl bg-gold-light px-4 py-3 text-center text-lg font-semibold text-gold-dark" data-testid="change-due">
            {t('checkoutLive.pay.change', { amount: money(change) })}
          </p>
        )}
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-primary w-full" disabled={!ready || busy} onClick={() => void confirm()} data-testid="confirm-payment">
          {busy ? t('common.saving') : t('checkoutLive.pay.confirm', { amount: money(totalCents) })}
        </button>
      </div>
    </Sheet>
  )
}
