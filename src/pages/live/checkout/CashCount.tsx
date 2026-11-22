import { Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatCurrency } from '../../../lib/format'
import { countTotal, denominationsFor } from '../../../lib/money'

/** Comptage de caisse par coupures (billets et pièces), gros boutons tactiles. */
export function CashCount({ currency, value, onChange }: { currency: string; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const set = (d: number, n: number) => onChange({ ...value, [String(d)]: Math.max(0, Math.min(9999, n)) })
  return (
    <div>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white" aria-label={t('checkoutLive.count.title')}>
        {denominationsFor(currency).map((d) => {
          const n = value[String(d)] ?? 0
          return (
            <li key={d} className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className={`w-20 text-sm font-semibold ${d >= 500 ? 'text-brand-dark' : 'text-slate-600'}`}>{formatCurrency(d / 100, lang, currency)}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => set(d, n - 1)} className="grid size-10 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label={t('checkoutLive.count.minus', { value: formatCurrency(d / 100, lang, currency) })}>
                  <Minus className="size-4" aria-hidden="true" />
                </button>
                <input type="number" inputMode="numeric" min={0} max={9999} value={n || ''} placeholder="0"
                  onChange={(e) => set(d, Number(e.target.value) || 0)} aria-label={t('checkoutLive.count.quantity', { value: formatCurrency(d / 100, lang, currency) })}
                  className="h-10 w-14 rounded-lg border border-slate-200 text-center text-base" />
                <button type="button" onClick={() => set(d, n + 1)} className="grid size-10 place-items-center rounded-lg text-brand hover:bg-brand-50" aria-label={t('checkoutLive.count.plus', { value: formatCurrency(d / 100, lang, currency) })}>
                  <Plus className="size-4" aria-hidden="true" />
                </button>
              </div>
              <span className="w-20 text-right text-sm text-slate-500 tabular-nums">{n ? formatCurrency((n * d) / 100, lang, currency) : ''}</span>
            </li>
          )
        })}
      </ul>
      <p className="mt-3 flex items-center justify-between rounded-xl bg-brand-50 px-4 py-3 font-semibold text-brand-dark">
        <span>{t('checkoutLive.count.total')}</span>
        <span className="text-lg tabular-nums" data-testid="count-total">{formatCurrency(countTotal(value) / 100, lang, currency)}</span>
      </p>
    </div>
  )
}
