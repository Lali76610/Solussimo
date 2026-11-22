import { Banknote, CreditCard, Euro, Lock, Nfc, Plus, Receipt, ShoppingBag } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DemoNotice } from '../components/DemoNotice'
import { PageHeader } from '../components/PageHeader'
import { StatCard } from '../components/StatCard'
import { transactions, type PaymentMethod } from '../data/demo'
import { formatCurrency } from '../lib/format'

const methodIcon: Record<PaymentMethod, typeof CreditCard> = { card: CreditCard, cash: Banknote, contactless: Nfc }

export function CheckoutPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const total = transactions.reduce((s, tr) => s + tr.amount, 0)
  const average = transactions.length ? total / transactions.length : 0
  const methods: PaymentMethod[] = ['card', 'contactless', 'cash']

  return (
    <div>
      <PageHeader
        title={t('checkout.title')}
        subtitle={t('checkout.subtitle')}
        actions={
          <>
            <button type="button" className="btn-secondary">
              <Lock className="size-4" aria-hidden="true" /> {t('checkout.closeRegister')}
            </button>
            <button type="button" className="btn-primary">
              <Plus className="size-4" aria-hidden="true" /> {t('checkout.newSale')}
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label={t('checkout.todayTotal')} value={formatCurrency(total, lang)} icon={Euro} />
        <StatCard label={t('checkout.transactions')} value={String(transactions.length)} icon={Receipt} accent="gold" />
        <div className="col-span-2 lg:col-span-1">
          <StatCard label={t('checkout.average')} value={formatCurrency(average, lang)} icon={ShoppingBag} />
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">{t('checkout.transactions')}</h2>
          <ul className="divide-y divide-slate-100">
            {[...transactions].reverse().map((tr) => {
              const Icon = methodIcon[tr.method]
              return (
                <li key={tr.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{t(`services.${tr.service}`)}</p>
                    <p className="text-xs text-slate-500">
                      {tr.time} · {t(`payment.${tr.method}`)}
                    </p>
                  </div>
                  <p className="text-sm font-semibold text-slate-900">{formatCurrency(tr.amount, lang)}</p>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">{t('checkout.byMethod')}</h2>
          <ul className="mt-4 space-y-4">
            {methods.map((m) => {
              const sum = transactions.filter((tr) => tr.method === m).reduce((s, tr) => s + tr.amount, 0)
              const pct = total ? Math.round((sum / total) * 100) : 0
              return (
                <li key={m}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="text-slate-600">{t(`payment.${m}`)}</span>
                    <span className="font-semibold text-slate-900">{formatCurrency(sum, lang)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
      <DemoNotice />
    </div>
  )
}
