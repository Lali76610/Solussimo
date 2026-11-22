import { Minus, Package, Percent, Plus, Scissors, Search, Trash2, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router'
import { useAuth } from '../../../auth/useAuth'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import type { CompleteSalePayload, EstablishmentRow, SaleRow } from '../../../lib/database.types'
import { formatCurrency } from '../../../lib/format'
import { parseAmountToCents, previewTotals } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { ClientPicker, type PickedClient } from '../planning/ClientPicker'
import { PaymentSheet } from './PaymentSheet'
import { ReceiptSheet } from './ReceiptSheet'
import type { useCheckoutData } from './useCheckoutData'

type Data = ReturnType<typeof useCheckoutData>

export interface CartLine {
  key: string
  kind: 'service' | 'product' | 'custom'
  refId?: string
  label: string
  unitCents: number
  quantity: number
  discountBp: number
  staffId: string | null
}

export interface Discount {
  bp: number
  reason: string
  code: string
}

let seq = 0
const nextKey = () => `l${++seq}`

/** Composition d'une vente : catalogue, panier, client, acomptes, remise. Les montants définitifs sont calculés par le serveur. */
export function SaleComposer({ establishment, data }: { establishment: EstablishmentRow; data: Data }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { state } = useAuth()
  const { active, can } = useTenant()
  const [params, setParams] = useSearchParams()
  const userId = state.status === 'live' ? state.session.user.id : null
  const myStaffId = data.staff.find((s) => s.user_id === userId)?.id ?? null
  const money = (c: number) => formatCurrency(c / 100, lang, data.currency)

  const [mode, setMode] = useState<'sale' | 'deposit'>('sale')
  const [tab, setTab] = useState<'service' | 'product'>('service')
  const [q, setQ] = useState('')
  const [lines, setLines] = useState<CartLine[]>([])
  const [client, setClient] = useState<PickedClient>({ id: null, label: '' })
  const [appointmentId, setAppointmentId] = useState<string | null>(null)
  const [discount, setDiscount] = useState<Discount>({ bp: 0, reason: '', code: '' })
  const [deposits, setDeposits] = useState<SaleRow[]>([])
  const [useDeposits, setUseDeposits] = useState<string[]>([])
  const [depositInput, setDepositInput] = useState('')
  const [sheet, setSheet] = useState<null | 'discount' | 'custom' | 'pay'>(null)
  const [needCode, setNeedCode] = useState(false)
  const [receipt, setReceipt] = useState<{ saleId: string; documentNo: string; changeCents: number } | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Prérremplissage depuis un rendez-vous (?rdv=…) : prestation, collaborateur, client.
  const rdv = params.get('rdv')
  useEffect(() => {
    if (!supabase || !rdv) return
    void (async () => {
      const { data: appt } = await supabase!.from('appointments').select('*').eq('id', rdv).maybeSingle()
      if (!appt || appt.establishment_id !== establishment.id) return
      const svc = data.services.find((s) => s.id === appt.service_id)
      setAppointmentId(appt.id)
      setClient(appt.client_id ? { id: appt.client_id, label: appt.client_label } : { id: null, label: appt.client_label })
      if (svc) setLines([{ key: nextKey(), kind: 'service', refId: svc.id, label: svc.name, unitCents: svc.price_cents, quantity: 1, discountBp: 0, staffId: appt.staff_id }])
      setInfo(t('checkoutLive.fromAppointment'))
    })()
  }, [rdv, establishment.id, data.services, t])

  // Acomptes disponibles du client (non imputés, non remboursés). Le serveur revérifie.
  useEffect(() => {
    if (!supabase || !client.id) return
    void (async () => {
      const { data: deps } = await supabase!.from('sales').select('*').eq('client_id', client.id!).eq('kind', 'deposit').order('completed_at')
      const ids = (deps ?? []).map((d) => d.id)
      if (!ids.length) return setDeposits([])
      const [{ data: applied }, { data: refunded }] = await Promise.all([
        supabase!.from('sale_lines').select('ref_sale_id').in('ref_sale_id', ids),
        supabase!.from('sales').select('original_sale_id').in('original_sale_id', ids),
      ])
      const used = new Set([...(applied ?? []).map((a) => a.ref_sale_id), ...(refunded ?? []).map((r) => r.original_sale_id)])
      setDeposits((deps ?? []).filter((d) => !used.has(d.id)))
    })()
  }, [client.id])

  const catalog = useMemo(() => {
    const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    const needle = norm(q.trim())
    const list = tab === 'service'
      ? data.services.map((s) => ({ id: s.id, name: s.name, price: s.price_cents }))
      : data.products.map((p) => ({ id: p.id, name: p.name, price: p.price_cents }))
    return needle ? list.filter((x) => norm(x.name).includes(needle)) : list
  }, [tab, q, data.services, data.products])

  const visibleDeposits = client.id ? deposits : []
  const depositCents = visibleDeposits.filter((d) => useDeposits.includes(d.id)).reduce((s, d) => s + d.total_cents, 0)
  const preview = previewTotals(lines.map((l) => ({ unitCents: l.unitCents, quantity: l.quantity, discountBp: l.discountBp })), discount.bp, depositCents)
  const depositAmount = parseAmountToCents(depositInput)
  const total = mode === 'deposit' ? depositAmount ?? 0 : preview.total
  const role = active?.role
  const cap = role === 'owner' || role === 'admin' ? 10000 : role === 'manager' ? active?.company.discount_cap_manager_bp ?? 3000 : active?.company.discount_cap_staff_bp ?? 1000

  function add(kind: 'service' | 'product', item: { id: string; name: string; price: number }) {
    setLines((cur) => {
      const same = cur.find((l) => l.kind === kind && l.refId === item.id && l.discountBp === 0)
      if (same) return cur.map((l) => (l === same ? { ...l, quantity: Math.min(99, l.quantity + 1) } : l))
      return [...cur, { key: nextKey(), kind, refId: item.id, label: item.name, unitCents: item.price, quantity: 1, discountBp: 0, staffId: myStaffId ?? data.staff[0]?.id ?? null }]
    })
  }
  const update = (key: string, patch: Partial<CartLine>) => setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const remove = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key))

  function reset() {
    setLines([])
    setClient({ id: null, label: '' })
    setDiscount({ bp: 0, reason: '', code: '' })
    setUseDeposits([])
    setDepositInput('')
    setAppointmentId(null)
    setNeedCode(false)
    setInfo(null)
    if (rdv) setParams({}, { replace: true })
  }

  const payload: Omit<CompleteSalePayload, 'idempotency_key' | 'payments'> = mode === 'deposit'
    ? { establishment_id: establishment.id, session_id: data.session!.id, kind: 'deposit', client_id: client.id, deposit_amount_cents: depositAmount ?? 0 }
    : {
        establishment_id: establishment.id, session_id: data.session!.id, kind: 'sale', client_id: client.id, appointment_id: appointmentId,
        lines: lines.map((l) => (l.kind === 'custom'
          ? { kind: 'custom' as const, label: l.label, unit_price_cents: l.unitCents, quantity: l.quantity, discount_bp: l.discountBp, staff_id: l.staffId }
          : { kind: l.kind, ...(l.kind === 'service' ? { service_id: l.refId } : { product_id: l.refId }), quantity: l.quantity, discount_bp: l.discountBp, staff_id: l.staffId })),
        ticket_discount_bp: discount.bp, discount_reason: discount.reason.trim() || null, approval_code: discount.code.trim() || null,
        deposit_ids: useDeposits,
      }
  const canPay = mode === 'deposit' ? Boolean(client.id && depositAmount && depositAmount > 0) : lines.length > 0 && preview.total >= 0
    && (preview.discount === 0 || discount.reason.trim().length > 0)

  const chip = (on: boolean) => `min-h-10 flex-1 rounded-full text-sm font-semibold transition ${on ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label={t('checkoutLive.mode')}>
        <button type="button" className={chip(mode === 'sale')} aria-pressed={mode === 'sale'} onClick={() => setMode('sale')}>{t('checkoutLive.modeSale')}</button>
        <button type="button" className={chip(mode === 'deposit')} aria-pressed={mode === 'deposit'} onClick={() => setMode('deposit')} data-testid="mode-deposit">{t('checkoutLive.modeDeposit')}</button>
      </div>
      {info && <FormMessage kind="success">{info}</FormMessage>}

      <section className="card space-y-2 p-4">
        <p className="text-sm font-medium text-slate-700">{t('planningLive.client')}{mode === 'sale' && ` (${t('common.optional')})`}</p>
        <ClientPicker value={client} onChange={(v) => { setClient(v); setUseDeposits([]) }} establishment={establishment} disabled={Boolean(appointmentId && client.id)} />
        {mode === 'sale' && visibleDeposits.length > 0 && (
          <ul className="space-y-1 pt-1" aria-label={t('checkoutLive.availableDeposits')}>
            {visibleDeposits.map((d) => (
              <li key={d.id}>
                <label className="flex min-h-11 items-center gap-3 rounded-xl border border-gold/50 bg-gold-light/40 px-3 text-sm">
                  <input type="checkbox" className="size-5 accent-[#C4A875]" checked={useDeposits.includes(d.id)}
                    onChange={(e) => setUseDeposits((cur) => (e.target.checked ? [...cur, d.id] : cur.filter((x) => x !== d.id)))} />
                  <span className="flex-1">{t('checkoutLive.useDeposit', { no: d.document_no })}</span>
                  <span className="font-semibold tabular-nums">{money(d.total_cents)}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {mode === 'deposit' ? (
        <section className="card space-y-3 p-4">
          <Field id="depAmount" label={t('checkoutLive.depositAmount')} hint={t('checkoutLive.depositHint')}>
            <input id="depAmount" inputMode="decimal" value={depositInput} onChange={(e) => setDepositInput(e.target.value)} placeholder="0,00" className="input text-lg" />
          </Field>
          {!client.id && <p className="text-xs text-amber-700">{t('errors.clientRequired')}</p>}
        </section>
      ) : (
        <>
          <section className="card p-4" aria-label={t('checkoutLive.catalog')}>
            <div className="mb-3 flex gap-2" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'service'} className={chip(tab === 'service')} onClick={() => setTab('service')}>
                <Scissors className="mr-1 inline size-4" aria-hidden="true" />{t('checkoutLive.services')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'product'} className={chip(tab === 'product')} onClick={() => setTab('product')}>
                <Package className="mr-1 inline size-4" aria-hidden="true" />{t('checkoutLive.products')}
              </button>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('checkoutLive.searchCatalog')} aria-label={t('checkoutLive.searchCatalog')} className="input pl-10" />
            </div>
            {catalog.length === 0 ? (
              <p className="text-sm text-slate-500">{tab === 'product' ? t('checkoutLive.noProducts') : t('checkoutLive.noServices')}</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="catalog">
                {catalog.map((item) => (
                  <button key={item.id} type="button" onClick={() => add(tab, item)}
                    className="flex min-h-16 flex-col items-start justify-between rounded-xl border border-slate-200 bg-white p-3 text-left transition active:scale-[0.98] hover:border-brand">
                    <span className="line-clamp-2 text-sm font-semibold text-slate-800">{item.name}</span>
                    <span className="text-sm font-medium text-brand-dark tabular-nums">{money(item.price)}</span>
                  </button>
                ))}
              </div>
            )}
            {can('refund.issue') && (
              <button type="button" className="mt-3 inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-brand" onClick={() => setSheet('custom')}>
                <Plus className="size-4" aria-hidden="true" />{t('checkoutLive.customLine')}
              </button>
            )}
          </section>

          <section className="card divide-y divide-slate-100" aria-label={t('checkoutLive.cart')} data-testid="cart">
            {lines.length === 0 && <p className="p-4 text-sm text-slate-500">{t('checkoutLive.emptyCart')}</p>}
            {lines.map((l) => (
              <div key={l.key} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">{l.label}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{money(l.unitCents)}{l.discountBp > 0 && ` · −${l.discountBp / 100} %`}</p>
                  </div>
                  <p className="font-semibold tabular-nums">{money(l.unitCents * l.quantity)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-xl border border-slate-200">
                    <button type="button" className="grid size-10 place-items-center text-slate-500" aria-label={t('checkoutLive.less')}
                      onClick={() => (l.quantity <= 1 ? remove(l.key) : update(l.key, { quantity: l.quantity - 1 }))}>
                      {l.quantity <= 1 ? <Trash2 className="size-4 text-rose-500" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}
                    </button>
                    <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{l.quantity}</span>
                    <button type="button" className="grid size-10 place-items-center text-brand" aria-label={t('checkoutLive.more')}
                      onClick={() => update(l.key, { quantity: Math.min(99, l.quantity + 1) })}>
                      <Plus className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <select value={l.staffId ?? ''} onChange={(e) => update(l.key, { staffId: e.target.value || null })} aria-label={t('planningLive.staff')}
                    className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-sm">
                    <option value="">—</option>
                    {data.staff.map((s) => <option key={s.id} value={s.id}>{s.display_name}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </section>

          <button type="button" className="btn-secondary w-full" onClick={() => setSheet('discount')} disabled={lines.length === 0} data-testid="discount-button">
            <Percent className="size-4" aria-hidden="true" />
            {discount.bp ? t('checkoutLive.discountApplied', { pct: discount.bp / 100 }) : t('checkoutLive.addDiscount')}
          </button>
        </>
      )}

      {/* Total et paiement : barre fixe, au-dessus de la navigation mobile */}
      <div className="checkout-bar fixed inset-x-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <div className="min-w-0 flex-1">
            {mode === 'sale' && (preview.discount > 0 || depositCents > 0) && (
              <p className="text-xs text-slate-500 tabular-nums">
                {preview.discount > 0 && `${t('checkoutLive.discount')} −${money(preview.discount)}`}
                {depositCents > 0 && ` · ${t('checkoutLive.deposit')} −${money(depositCents)}`}
              </p>
            )}
            <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums" data-testid="cart-total">{money(total)}</p>
          </div>
          <button type="button" className="btn-primary min-w-36" disabled={!canPay} onClick={() => setSheet('pay')} data-testid="pay">
            <Wallet className="size-5" aria-hidden="true" />{t('checkoutLive.collect')}
          </button>
        </div>
      </div>

      {sheet === 'discount' && (
        <DiscountSheet value={discount} cap={cap} needCode={needCode} onClose={() => setSheet(null)}
          onApply={(d) => { setDiscount(d); setSheet(null) }} />
      )}
      {sheet === 'custom' && (
        <CustomLineSheet onClose={() => setSheet(null)} onAdd={(label, cents) => {
          setLines((cur) => [...cur, { key: nextKey(), kind: 'custom', label, unitCents: cents, quantity: 1, discountBp: 0, staffId: myStaffId }])
          setSheet(null)
        }} />
      )}
      {sheet === 'pay' && (
        <PaymentSheet totalCents={total} currency={data.currency} methods={data.methods} payload={payload}
          onClose={() => setSheet(null)}
          onApprovalRequired={() => { setNeedCode(true); setSheet('discount') }}
          onDone={(r) => { setSheet(null); setReceipt(r); reset(); void data.reload() }} />
      )}
      {receipt && <ReceiptSheet receipt={receipt} currency={data.currency} onClose={() => setReceipt(null)} />}
    </div>
  )
}

function DiscountSheet({ value, cap, needCode, onApply, onClose }: { value: Discount; cap: number; needCode: boolean; onApply: (d: Discount) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [pct, setPct] = useState(value.bp / 100)
  const [reason, setReason] = useState(value.reason)
  const [code, setCode] = useState(value.code)
  const [error, setError] = useState<string | null>(null)
  const over = pct * 100 > cap
  const presets = [5, 10, 15, 20, 30, 50]
  function apply() {
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return setError(t('errors.invalidInput'))
    if (pct > 0 && !reason.trim()) return setError(t('errors.discountReasonRequired'))
    if (over && !/^\d{8}$/.test(code.trim())) return setError(t('errors.discountApprovalRequired'))
    onApply({ bp: Math.round(pct * 100), reason: pct > 0 ? reason.trim() : '', code: over ? code.trim() : '' })
  }
  return (
    <Sheet title={t('checkoutLive.discountTitle')} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => setPct(p)} aria-pressed={pct === p}
              className={`min-h-11 min-w-16 rounded-xl text-sm font-semibold ${pct === p ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
              {p} %
            </button>
          ))}
          <button type="button" onClick={() => setPct(0)} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-rose-600">{t('checkoutLive.noDiscount')}</button>
        </div>
        <Field id="dPct" label={t('checkoutLive.discountPct')} hint={t('checkoutLive.yourCap', { pct: cap / 100 })}>
          <input id="dPct" type="number" inputMode="decimal" min={0} max={100} step={0.5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="input" />
        </Field>
        <Field id="dReason" label={t('checkoutLive.discountReason')}>
          <input id="dReason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={t('checkoutLive.discountReasonPh')} className="input" />
        </Field>
        {(over || needCode) && (
          <Field id="dCode" label={t('checkoutLive.approvalCode')} hint={t('checkoutLive.approvalCodeHint')}>
            <input id="dCode" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={8} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className="input font-mono tracking-widest" />
          </Field>
        )}
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-primary w-full" onClick={apply} data-testid="apply-discount">{t('checkoutLive.apply')}</button>
      </div>
    </Sheet>
  )
}

function CustomLineSheet({ onAdd, onClose }: { onAdd: (label: string, cents: number) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const cents = parseAmountToCents(amount)
  return (
    <Sheet title={t('checkoutLive.customLine')} onClose={onClose}>
      <div className="space-y-4">
        <Field id="cLabel" label={t('checkoutLive.customLabel')}>
          <input id="cLabel" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} className="input" />
        </Field>
        <Field id="cAmount" label={t('checkoutLive.customAmount')}>
          <input id="cAmount" value={amount} inputMode="decimal" onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="input" />
        </Field>
        <button type="button" className="btn-primary w-full" disabled={!label.trim() || cents == null} onClick={() => onAdd(label.trim(), cents ?? 0)}>{t('checkoutLive.add')}</button>
      </div>
    </Sheet>
  )
}
