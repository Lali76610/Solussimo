import { AlertTriangle, Boxes, Euro, ShoppingCart } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { DemoNotice } from '../components/DemoNotice'
import { PageHeader } from '../components/PageHeader'
import { StatCard } from '../components/StatCard'
import { stock } from '../data/demo'
import { formatCurrency } from '../lib/format'

export function StockPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const totalValue = stock.reduce((s, p) => s + p.quantity * p.unitPrice, 0)
  const low = stock.filter((p) => p.quantity < p.minimum)

  return (
    <div>
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle')}
        actions={
          <button type="button" className="btn-primary">
            <ShoppingCart className="size-4" aria-hidden="true" /> {t('stock.order')}
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label={t('stock.references')} value={String(stock.length)} icon={Boxes} />
        <StatCard label={t('stock.lowCount')} value={String(low.length)} icon={AlertTriangle} accent="gold" />
        <div className="col-span-2 lg:col-span-1">
          <StatCard label={t('stock.totalValue')} value={formatCurrency(totalValue, lang)} icon={Euro} />
        </div>
      </div>

      <div className="card mt-6 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {stock.map((p) => {
            const isLow = p.quantity < p.minimum
            const pct = Math.min(100, Math.round((p.quantity / (p.minimum * 2)) * 100))
            return (
              <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 md:grid-cols-[2fr_1fr_1.5fr_auto]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{t(`products.${p.product}`)}</p>
                  <p className="text-xs text-slate-500 md:hidden">{t(`categories.${p.category}`)}</p>
                </div>
                <p className="hidden text-sm text-slate-500 md:block">{t(`categories.${p.category}`)}</p>
                <div className="order-last col-span-2 md:order-none md:col-span-1">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>
                      {t('stock.quantity')} : <strong className="text-slate-800">{p.quantity}</strong>
                    </span>
                    <span>
                      {t('stock.minimum')} : {p.minimum}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${isLow ? 'bg-gold' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className={`badge justify-self-end ${isLow ? 'bg-rose-50 text-rose-700' : 'bg-brand-light text-brand-dark'}`}>
                  {isLow ? t('stock.low') : t('stock.ok')}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <DemoNotice />
    </div>
  )
}
