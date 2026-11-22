import { ChevronRight, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { Sheet } from '../../../components/Sheet'
import type { InvoiceRow, SaleLineRow, SalePaymentRow, SaleRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency, formatDate } from '../../../lib/format'
import { newIdempotencyKey } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { addDays, dateKeyOf, zonedToUtc, type DateKey } from '../../../lib/tz'
import { useTenant } from '../../../tenant/useTenant'
import { CheckoutNav } from './CheckoutNav'
import { DocumentButton } from './DocumentButton'
import { METHOD_ICON } from './methodIcons'
import { InvoiceForm } from './ReceiptSheet'
import { useCheckoutData, useCheckoutEstablishment } from './useCheckoutData'

/** Historique des pièces (D6 : le collaborateur ne voit que ses ventes — filtré par la RLS). */
export function TicketsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { establishments, establishment, choose } = useCheckoutEstablishment()
  const data = useCheckoutData(establishment?.id)
  const tz = establishment?.timezone ?? 'Europe/Paris'
  const [day, setDay] = useState<DateKey>(() => dateKeyOf(new Date(), tz))
  const [rows, setRows] = useState<SaleRow[]>([])
  const [open, setOpen] = useState<SaleRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const money = (c: number) => formatCurrency(c / 100, lang, data.currency)

  const load = useCallback(async () => {
    if (!supabase || !establishment) return
    // Journée locale de l'établissement (changements d'heure compris).
    const from = zonedToUtc(day, 0, tz).toISOString()
    const to = zonedToUtc(addDays(day, 1), 0, tz).toISOString()
    const { data: sales, error: err } = await supabase.from('sales').select('*').eq('establishment_id', establishment.id)
      .gte('completed_at', from).lt('completed_at', to).order('completed_at', { ascending: false })
    if (err) setError(t(authErrorKey(err)))
    setRows(sales ?? [])
  }, [establishment, day, tz, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const total = rows.reduce((s, r) => s + r.total_cents, 0)
  return (
    <div>
      <PageHeader title={t('checkoutLive.tickets.title')} subtitle={t('checkoutLive.tickets.subtitle')} />
      <CheckoutNav establishments={establishments} establishment={establishment} onChoose={choose} />
      <div className="mb-3 flex items-center gap-3">
        <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label={t('planningLive.date')} className="input max-w-48" />
        <p className="ml-auto text-right text-sm text-slate-500">
          {t('checkoutLive.tickets.count', { count: rows.length })}<br />
          <span className="font-semibold text-slate-900 tabular-nums">{money(total)}</span>
        </p>
      </div>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {rows.length === 0 && <p className="card p-5 text-sm text-slate-500">{t('checkoutLive.tickets.empty')}</p>}
      <ul className="space-y-2" data-testid="ticket-list">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" onClick={() => setOpen(r)} className="card flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:border-brand">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-semibold text-slate-900">{r.document_no}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(new Date(r.completed_at), lang, { hour: '2-digit', minute: '2-digit', timeZone: tz })} · {t(`checkoutLive.kind.${r.kind}`)}
                </p>
              </div>
              <span className={`font-semibold tabular-nums ${r.total_cents < 0 ? 'text-rose-600' : 'text-slate-900'}`}>{money(r.total_cents)}</span>
              <ChevronRight className="size-5 text-slate-300" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <TicketDetailSheet sale={open} currency={data.currency} timezone={tz} sessionId={data.session?.id ?? null}
          methods={data.methods} onClose={() => setOpen(null)} onChanged={() => void load()} />
      )}
    </div>
  )
}

function TicketDetailSheet({ sale, currency, timezone, sessionId, methods, onClose, onChanged }: {
  sale: SaleRow
  currency: string
  timezone: string
  sessionId: string | null
  methods: ReturnType<typeof useCheckoutData>['methods']
  onClose: () => void
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { can } = useTenant()
  const money = (c: number) => formatCurrency(c / 100, lang, currency)
  const [lines, setLines] = useState<SaleLineRow[]>([])
  const [payments, setPayments] = useState<SalePaymentRow[]>([])
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null)
  const [refunded, setRefunded] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [refund, setRefund] = useState(false)

  useEffect(() => {
    if (!supabase) return
    void (async () => {
      const [l, p, inv, credit] = await Promise.all([
        supabase!.from('sale_lines').select('*').eq('sale_id', sale.id).order('position'),
        supabase!.from('sale_payments').select('*').eq('sale_id', sale.id).order('received_at'),
        supabase!.from('invoices').select('*').eq('sale_id', sale.id).maybeSingle(),
        supabase!.from('sales').select('id').eq('original_sale_id', sale.id),
      ])
      setLines(l.data ?? [])
      setPayments(p.data ?? [])
      setInvoice(inv.data)
      const ids = (credit.data ?? []).map((c) => c.id)
      if (ids.length) {
        const { data: cl } = await supabase!.from('sale_lines').select('original_line_id, quantity').in('sale_id', ids)
        const map: Record<string, number> = {}
        for (const r of cl ?? []) if (r.original_line_id) map[r.original_line_id] = (map[r.original_line_id] ?? 0) - r.quantity
        setRefunded(map)
      }
    })()
  }, [sale.id])

  const refundable = sale.kind !== 'credit_note' && lines.some((l) => l.kind !== 'deposit_applied' && l.quantity - (refunded[l.id] ?? 0) > 0)
  return (
    <Sheet title={sale.document_no} onClose={onClose}>
      <div className="space-y-4" data-testid="ticket-detail">
        <p className="text-sm text-slate-500">
          {t(`checkoutLive.kind.${sale.kind}`)} · {formatDate(new Date(sale.completed_at), lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone })}
        </p>
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200">
          {lines.map((l) => (
            <li key={l.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium text-slate-800">{l.label}</p>
                <p className="text-xs text-slate-500">
                  {l.quantity} × {money(l.unit_price_cents)}{l.discount_cents ? ` · −${money(l.discount_cents)}` : ''} · {l.tax_rate_bp / 100} %
                  {refunded[l.id] ? ` · ${t('checkoutLive.tickets.refunded', { count: refunded[l.id] })}` : ''}
                </p>
              </div>
              <span className="font-semibold tabular-nums">{money(l.total_cents)}</span>
            </li>
          ))}
          <li className="flex justify-between px-3 py-2 font-semibold"><span>{t('checkoutLive.doc.total')}</span><span className="tabular-nums">{money(sale.total_cents)}</span></li>
          <li className="flex justify-between px-3 py-2 text-xs text-slate-500"><span>{t('checkoutLive.doc.tax')}</span><span className="tabular-nums">{money(sale.tax_cents)}</span></li>
        </ul>
        <ul className="space-y-1 text-sm">
          {payments.map((p) => {
            const Icon = METHOD_ICON[p.method_kind]
            return (
              <li key={p.id} className="flex items-center gap-2">
                <Icon className="size-4 text-brand" aria-hidden="true" />
                <span className="flex-1">{p.method_label}{p.change_cents ? ` · ${t('checkoutLive.pay.change', { amount: money(p.change_cents) })}` : ''}</span>
                <span className="tabular-nums">{money(p.amount_cents)}</span>
              </li>
            )
          })}
        </ul>
        {sale.discount_reason && <p className="text-xs text-slate-500">{t('checkoutLive.discountReason')} : {sale.discount_reason}</p>}
        {sale.refund_reason && <p className="text-xs text-slate-500">{t('checkoutLive.doc.reason')} : {sale.refund_reason}</p>}
        <DocumentButton kind="receipt" id={sale.id} label={t('checkoutLive.receipt.pdf')} primary onError={setError} />
        <InvoiceForm saleId={sale.id} onError={setError} existing={invoice?.document_no} />
        {can('refund.issue') && refundable && (
          sessionId
            ? <button type="button" className="btn-secondary w-full text-rose-600" onClick={() => setRefund(true)} data-testid="refund-open">
                <RotateCcw className="size-4" aria-hidden="true" />{t('checkoutLive.refund.button')}
              </button>
            : <p className="text-xs text-slate-500">{t('checkoutLive.refund.needSession')}</p>
        )}
        <FormMessage kind="error">{error}</FormMessage>
      </div>
      {refund && sessionId && (
        <RefundSheet sale={sale} lines={lines} refunded={refunded} sessionId={sessionId} methods={methods} payments={payments} currency={currency}
          onClose={() => setRefund(false)} onDone={() => { setRefund(false); onChanged(); onClose() }} />
      )}
    </Sheet>
  )
}

function RefundSheet({ sale, lines, refunded, sessionId, methods, payments, currency, onClose, onDone }: {
  sale: SaleRow
  lines: SaleLineRow[]
  refunded: Record<string, number>
  sessionId: string
  methods: ReturnType<typeof useCheckoutData>['methods']
  payments: SalePaymentRow[]
  currency: string
  onClose: () => void
  onDone: () => void
}) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const money = (c: number) => formatCurrency(c / 100, lang, currency)
  const refundableLines = lines.filter((l) => l.kind !== 'deposit_applied' && l.quantity - (refunded[l.id] ?? 0) > 0)
  const [qty, setQty] = useState<Record<string, number>>(() => Object.fromEntries(refundableLines.map((l) => [l.id, l.quantity - (refunded[l.id] ?? 0)])))
  const [reason, setReason] = useState('')
  const defaultMethod = methods.find((m) => m.kind === payments[0]?.method_kind) ?? methods[0]
  const [methodId, setMethodId] = useState(defaultMethod?.id ?? '')
  const [key] = useState(newIdempotencyKey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Montant indicatif (proportionnel, comme le serveur) ; le serveur fait foi.
  const amount = refundableLines.reduce((s, l) => s + Math.round((l.total_cents * (qty[l.id] ?? 0)) / l.quantity), 0)
  const result = useRefundResult()

  async function submit() {
    if (!supabase || busy) return
    if (!reason.trim()) return setError(t('errors.refundReasonRequired'))
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('refund_sale', {
      p_payload: {
        original_sale_id: sale.id, session_id: sessionId, idempotency_key: key, reason: reason.trim(),
        lines: refundableLines.map((l) => ({ line_id: l.id, quantity: qty[l.id] ?? 0 })),
        payments: amount > 0 ? [{ method_id: methodId, amount_cents: amount }] : [],
      },
    })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    result.set(data.document_no)
  }

  if (result.value) {
    return (
      <Sheet title={t('checkoutLive.refund.title')} onClose={onDone}>
        <div className="space-y-3 text-center" data-testid="refund-done">
          <p className="font-semibold">{t('checkoutLive.refund.done', { no: result.value })}</p>
          <button type="button" className="btn-primary w-full" onClick={onDone}>{t('common.close')}</button>
        </div>
      </Sheet>
    )
  }
  return (
    <Sheet title={t('checkoutLive.refund.title')} onClose={onClose}>
      <div className="space-y-4">
        <ul className="space-y-2">
          {refundableLines.map((l) => {
            const max = l.quantity - (refunded[l.id] ?? 0)
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.label}</span>
                <select value={qty[l.id] ?? 0} onChange={(e) => setQty({ ...qty, [l.id]: Number(e.target.value) })} aria-label={t('checkoutLive.refund.quantity', { label: l.label })}
                  className="min-h-10 rounded-lg border border-slate-200 px-2">
                  {Array.from({ length: max + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </li>
            )
          })}
        </ul>
        <div>
          <label htmlFor="rfReason" className="mb-1.5 block text-sm font-medium text-slate-700">{t('checkoutLive.refund.reason')}</label>
          <input id="rfReason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="input" />
        </div>
        <div>
          <label htmlFor="rfMethod" className="mb-1.5 block text-sm font-medium text-slate-700">{t('checkoutLive.refund.method')}</label>
          <select id="rfMethod" value={methodId} onChange={(e) => setMethodId(e.target.value)} className="input">
            {methods.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-center font-semibold text-rose-700 tabular-nums">{t('checkoutLive.refund.amount', { amount: money(amount) })}</p>
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-primary w-full" disabled={busy || amount <= 0} onClick={() => void submit()} data-testid="refund-confirm">
          {t('checkoutLive.refund.confirm')}
        </button>
      </div>
    </Sheet>
  )
}

function useRefundResult() {
  const [value, set] = useState<string | null>(null)
  return { value, set }
}
