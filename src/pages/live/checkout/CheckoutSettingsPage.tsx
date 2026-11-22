import { Plus } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { Sheet } from '../../../components/Sheet'
import { Toggle } from '../../../components/Toggle'
import type { AccountingAccountRow, PaymentMethodRow, ProductRow, TaxRateRow } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { centsToInput, parseAmountToCents } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { CheckoutNav } from './CheckoutNav'
import { useCheckoutData, useCheckoutEstablishment } from './useCheckoutData'

/** Réglages de caisse : mentions vendeur, moyens de paiement, plafonds de remise, produits, plan de comptes. */
export function CheckoutSettingsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { active, can, refresh } = useTenant()
  const { establishments, establishment, choose } = useCheckoutEstablishment()
  const data = useCheckoutData(establishment?.id)
  const companyId = active?.company.id
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [allMethods, setAllMethods] = useState<PaymentMethodRow[]>([])
  const [products, setProducts] = useState<ProductRow[]>([])
  const [rates, setRates] = useState<TaxRateRow[]>([])
  const [accounts, setAccounts] = useState<AccountingAccountRow[]>([])
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null)
  const [form, setForm] = useState({ seller_legal_name: '', seller_tax_id: '', seller_vat_number: '', seller_address: '', legal_mentions: '' })
  const [caps, setCaps] = useState({ staff: 10, manager: 30 })

  const load = useCallback(async () => {
    if (!supabase || !companyId) return
    const [m, p, r, a] = await Promise.all([
      supabase.from('payment_methods').select('*').eq('company_id', companyId).order('sort'),
      supabase.from('products').select('*').eq('company_id', companyId).order('name'),
      supabase.from('tax_rates').select('*').eq('company_id', companyId).order('rate_bp', { ascending: false }),
      supabase.from('accounting_accounts').select('*').eq('company_id', companyId).order('account'),
    ])
    setAllMethods(m.data ?? [])
    setProducts(p.data ?? [])
    setRates(r.data ?? [])
    setAccounts(a.data ?? [])
  }, [companyId])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])
  useEffect(() => {
    const p = data.profile
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (p) setForm({ seller_legal_name: p.seller_legal_name ?? '', seller_tax_id: p.seller_tax_id ?? '', seller_vat_number: p.seller_vat_number ?? '', seller_address: p.seller_address ?? '', legal_mentions: p.legal_mentions ?? '' })
  }, [data.profile])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) setCaps({ staff: active.company.discount_cap_staff_bp / 100, manager: active.company.discount_cap_manager_bp / 100 })
  }, [active])

  const done = (err: unknown, okKey = 'common.saved') => setMsg(err ? { kind: 'error', text: t(authErrorKey(err)) } : { kind: 'success', text: t(okKey) })

  async function saveProfile(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !establishment) return
    const n = (v: string) => v.trim() || null
    const clean = { seller_legal_name: n(form.seller_legal_name), seller_tax_id: n(form.seller_tax_id), seller_vat_number: n(form.seller_vat_number),
      seller_address: n(form.seller_address), legal_mentions: n(form.legal_mentions) }
    const { error } = await supabase.from('fiscal_profiles').update(clean).eq('establishment_id', establishment.id)
    done(error)
    await data.reload()
  }
  async function toggleMethod(m: PaymentMethodRow) {
    if (!supabase) return
    const { error } = await supabase.from('payment_methods').update({ active: !m.active }).eq('id', m.id)
    done(error)
    await Promise.all([load(), data.reload()])
  }
  async function saveCaps() {
    if (!supabase || !companyId) return
    const { error } = await supabase.rpc('set_discount_caps', { p_company_id: companyId, p_staff_bp: Math.round(caps.staff * 100), p_manager_bp: Math.round(caps.manager * 100) })
    done(error)
    await refresh()
  }
  async function saveAccount(a: AccountingAccountRow, account: string) {
    if (!supabase || account === a.account) return
    const { error } = await supabase.from('accounting_accounts').update({ account: account.trim().toUpperCase() }).eq('company_id', a.company_id).eq('key', a.key)
    done(error)
    await load()
  }

  const fiscal = can('settings.fiscal')
  return (
    <div>
      <PageHeader title={t('checkoutLive.settings.title')} subtitle={t('checkoutLive.settings.subtitle')} />
      <CheckoutNav establishments={establishments} establishment={establishment} onChoose={choose} />
      {msg && <FormMessage kind={msg.kind}>{msg.text}</FormMessage>}
      <div className="space-y-6">
        {fiscal && data.profile && (
          <form onSubmit={saveProfile} className="card space-y-4 p-5">
            <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.seller')}</h2>
            <p className="text-xs text-slate-500">{t('checkoutLive.settings.sellerHint', { country: data.profile.country_code, currency: data.profile.currency })}</p>
            {(['seller_legal_name', 'seller_tax_id', 'seller_vat_number'] as const).map((k) => (
              <Field key={k} id={k} label={t(`checkoutLive.settings.${k}`)}>
                <input id={k} value={form[k]} maxLength={k === 'seller_legal_name' ? 160 : 40} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="input" />
              </Field>
            ))}
            <Field id="seller_address" label={t('checkoutLive.settings.seller_address')}>
              <textarea id="seller_address" rows={2} value={form.seller_address} maxLength={300} onChange={(e) => setForm({ ...form, seller_address: e.target.value })} className="input py-2" />
            </Field>
            <Field id="legal_mentions" label={t('checkoutLive.settings.legal_mentions')} hint={t('checkoutLive.settings.legalHint')}>
              <textarea id="legal_mentions" rows={3} value={form.legal_mentions} maxLength={1000} onChange={(e) => setForm({ ...form, legal_mentions: e.target.value })} className="input py-2" />
            </Field>
            <button type="submit" className="btn-primary w-full">{t('common.save')}</button>
          </form>
        )}

        {fiscal && (
          <section className="card space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.methods')}</h2>
            {allMethods.map((m) => (
              <Toggle key={m.id} checked={m.active} onChange={() => void toggleMethod(m)} label={m.label} />
            ))}
          </section>
        )}

        {fiscal && (
          <section className="card space-y-3 p-5">
            <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.caps')}</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field id="capStaff" label={t('checkoutLive.settings.capStaff')}>
                <input id="capStaff" type="number" min={0} max={100} value={caps.staff} onChange={(e) => setCaps({ ...caps, staff: Number(e.target.value) })} className="input" />
              </Field>
              <Field id="capManager" label={t('checkoutLive.settings.capManager')}>
                <input id="capManager" type="number" min={0} max={100} value={caps.manager} onChange={(e) => setCaps({ ...caps, manager: Number(e.target.value) })} className="input" />
              </Field>
            </div>
            <button type="button" className="btn-secondary w-full" onClick={() => void saveCaps()}>{t('common.save')}</button>
          </section>
        )}

        <section className="card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.products')}</h2>
            {can('catalog.write') && (
              <button type="button" className="btn-secondary" onClick={() => setEditing('new')} data-testid="product-new"><Plus className="size-4" aria-hidden="true" />{t('checkoutLive.add')}</button>
            )}
          </div>
          {products.length === 0 && <p className="text-sm text-slate-500">{t('checkoutLive.noProducts')}</p>}
          <ul className="divide-y divide-slate-100">
            {products.map((p) => (
              <li key={p.id}>
                <button type="button" disabled={!can('catalog.write')} onClick={() => setEditing(p)} className="flex min-h-12 w-full items-center justify-between gap-2 text-left text-sm">
                  <span className={p.active ? 'font-medium' : 'text-slate-400 line-through'}>{p.name}</span>
                  <span className="tabular-nums">{formatCurrency(p.price_cents / 100, lang, data.currency)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card space-y-2 p-5">
          <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.rates')}</h2>
          {rates.filter((r) => r.country_code === data.profile?.country_code).map((r) => (
            <p key={r.id} className="flex justify-between text-sm"><span>{r.label} <span className="text-slate-400">({r.code})</span></span><span className="tabular-nums">{r.rate_bp / 100} %</span></p>
          ))}
          <p className="text-xs text-slate-500">{t('checkoutLive.settings.ratesHint')}</p>
        </section>

        {accounts.length > 0 && (
          <section className="card space-y-2 p-5">
            <h2 className="font-display text-lg font-semibold">{t('checkoutLive.settings.accounts')}</h2>
            <p className="text-xs text-slate-500">{t('checkoutLive.settings.accountsHint')}</p>
            {accounts.map((a) => (
              <div key={a.key} className="flex items-center gap-2 text-sm">
                <span className="flex-1">{a.label}</span>
                <input defaultValue={a.account} maxLength={20} onBlur={(e) => void saveAccount(a, e.target.value)} aria-label={a.label}
                  className="h-10 w-28 rounded-lg border border-slate-200 px-2 font-mono" />
              </div>
            ))}
          </section>
        )}
      </div>
      {editing && companyId && (
        <ProductSheet product={editing === 'new' ? null : editing} companyId={companyId} rates={rates.filter((r) => r.country_code === data.profile?.country_code)}
          onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await Promise.all([load(), data.reload()]) }} />
      )}
    </div>
  )
}

function ProductSheet({ product, companyId, rates, onClose, onSaved }: { product: ProductRow | null; companyId: string; rates: TaxRateRow[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const { t } = useTranslation()
  const [name, setName] = useState(product?.name ?? '')
  const [sku, setSku] = useState(product?.sku ?? '')
  const [price, setPrice] = useState(product ? centsToInput(product.price_cents) : '')
  const [taxCode, setTaxCode] = useState(product?.tax_code ?? 'standard')
  const [activeP, setActiveP] = useState(product?.active ?? true)
  const [error, setError] = useState<string | null>(null)
  const cents = parseAmountToCents(price)
  async function save() {
    if (!supabase || cents == null || name.trim().length < 2) return setError(t('errors.invalidInput'))
    const row = { name: name.trim(), sku: sku.trim() || null, price_cents: cents, tax_code: taxCode, active: activeP }
    const { error: err } = product
      ? await supabase.from('products').update(row).eq('id', product.id)
      : await supabase.from('products').insert({ ...row, company_id: companyId })
    if (err) return setError(t(authErrorKey(err)))
    await onSaved()
  }
  const codes = [...new Set(rates.map((r) => r.code))]
  return (
    <Sheet title={product ? product.name : t('checkoutLive.settings.newProduct')} onClose={onClose}>
      <div className="space-y-4">
        <Field id="pName" label={t('checkoutLive.customLabel')}><input id="pName" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="pPrice" label={t('checkoutLive.settings.priceTtc')}><input id="pPrice" value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} className="input" /></Field>
          <Field id="pSku" label={`SKU (${t('common.optional')})`}><input id="pSku" value={sku} maxLength={40} onChange={(e) => setSku(e.target.value)} className="input" /></Field>
        </div>
        <Field id="pTax" label={t('checkoutLive.settings.taxCode')}>
          <select id="pTax" value={taxCode} onChange={(e) => setTaxCode(e.target.value)} className="input">
            {codes.map((c) => <option key={c} value={c}>{rates.find((r) => r.code === c)?.label ?? c}</option>)}
          </select>
        </Field>
        <Toggle checked={activeP} onChange={setActiveP} label={t('checkoutLive.settings.activeProduct')} />
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-primary w-full" onClick={() => void save()} data-testid="product-save">{t('common.save')}</button>
      </div>
    </Sheet>
  )
}
