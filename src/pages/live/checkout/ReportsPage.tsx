import { CalendarCheck, Download, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import type { SalesReport } from '../../../lib/database.types'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { addDays, todayKey, type DateKey } from '../../../lib/tz'
import { useTenant } from '../../../tenant/useTenant'
import { CheckoutNav } from './CheckoutNav'
import { downloadText } from './documents'
import { METHOD_ICON } from './methodIcons'
import { useCheckoutData, useCheckoutEstablishment } from './useCheckoutData'

type Preset = 'today' | 'week' | 'month' | 'lastMonth'

function range(preset: Preset, today: DateKey): [DateKey, DateKey] {
  const [y, m] = today.split('-').map(Number) as [number, number]
  const first = `${y}-${String(m).padStart(2, '0')}-01`
  switch (preset) {
    case 'today': return [today, today]
    case 'week': return [addDays(today, -6), today]
    case 'month': return [first, today]
    case 'lastMonth': {
      const lastDay = addDays(first, -1)
      return [`${lastDay.slice(0, 7)}-01`, lastDay]
    }
  }
}

/** Rapports (D6 : périmètre personnel pour le collaborateur), exports comptables, intégrité, clôtures de période. */
export function ReportsPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { can } = useTenant()
  const { establishments, establishment, choose } = useCheckoutEstablishment()
  const data = useCheckoutData(establishment?.id)
  const today = todayKey(establishment?.timezone ?? 'Europe/Paris')
  const [preset, setPreset] = useState<Preset>('today')
  const [from, to] = range(preset, today)
  const [report, setReport] = useState<SalesReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const money = (c: number) => formatCurrency(c / 100, lang, report?.currency ?? data.currency)

  const load = useCallback(async () => {
    if (!supabase || !establishment) return
    const { data: r, error: err } = await supabase.rpc('sales_report', { p_establishment_id: establishment.id, p_from: from, p_to: to })
    if (err) return setError(t(authErrorKey(err)))
    setError(null)
    setReport(r)
  }, [establishment, from, to, t])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  async function exportAs(format: 'csv' | 'fec') {
    if (!supabase || !establishment) return
    setBusy(true)
    const { data: res, error: err } = await supabase.rpc('export_accounting', { p_establishment_id: establishment.id, p_from: from, p_to: to, p_format: format })
    setBusy(false)
    if (err) return setError(t(authErrorKey(err)))
    downloadText(res.content, res.filename, format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8')
    setInfo(t('checkoutLive.reports.exported', { count: res.rows }))
  }
  async function verify() {
    if (!supabase || !establishment) return
    const { data: res, error: err } = await supabase.rpc('verify_integrity', { p_establishment_id: establishment.id })
    if (err) return setError(t(authErrorKey(err)))
    if (res.ok) setInfo(t('checkoutLive.reports.integrityOk', { sales: res.sales.documents, closures: res.closures.documents, journal: res.journal.entries }))
    else setError(t('checkoutLive.reports.integrityKo', { doc: res.sales.first_broken ?? res.closures.first_broken ?? `#${res.journal.first_broken}` }))
  }
  async function closeLastMonth() {
    if (!supabase || !establishment || !window.confirm(t('checkoutLive.reports.closeMonthConfirm'))) return
    const [start] = range('lastMonth', today)
    const { data: res, error: err } = await supabase.rpc('close_period', { p_establishment_id: establishment.id, p_kind: 'month', p_period_start: start })
    if (err) return setError(t(authErrorKey(err)))
    setInfo(t('checkoutLive.reports.monthClosed', { no: res.document_no }))
  }

  const chip = (on: boolean) => `min-h-10 shrink-0 rounded-full px-4 text-sm font-semibold ${on ? 'bg-brand text-white' : 'border border-slate-200 bg-white text-slate-600'}`
  const max = Math.max(1, ...(report?.by_day ?? []).map((d) => Math.abs(d.total_cents)))
  return (
    <div>
      <PageHeader title={t('checkoutLive.reports.title')} subtitle={report?.scope === 'own' ? t('checkoutLive.reports.ownScope') : t('checkoutLive.reports.subtitle')} />
      <CheckoutNav establishments={establishments} establishment={establishment} onChoose={choose} />
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label={t('checkoutLive.reports.period')}>
        {(['today', 'week', 'month', 'lastMonth'] as const).map((p) => (
          <button key={p} type="button" className={chip(preset === p)} aria-pressed={preset === p} onClick={() => setPreset(p)}>{t(`checkoutLive.reports.${p}`)}</button>
        ))}
      </div>
      {error && <FormMessage kind="error">{error}</FormMessage>}
      {info && <FormMessage kind="success">{info}</FormMessage>}
      {report && (
        <div className="space-y-4" data-testid="report">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [t('checkoutLive.reports.revenue'), money(report.total_cents)],
              [t('checkoutLive.doc.net'), money(report.net_cents)],
              [t('checkoutLive.reports.salesCount'), String(report.count_sales)],
              [t('checkoutLive.reports.average'), money(report.count_sales ? Math.round((report.total_cents - report.refunds_cents) / report.count_sales) : 0)],
            ].map(([label, value]) => (
              <div key={label} className="card p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-display text-xl font-semibold text-slate-900 tabular-nums">{value}</p>
              </div>
            ))}
          </div>
          {report.by_day.length > 1 && (
            <section className="card p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">{t('checkoutLive.reports.byDay')}</h2>
              <div className="flex h-32 items-end gap-1" role="img" aria-label={t('checkoutLive.reports.byDay')}>
                {report.by_day.map((d) => (
                  <div key={d.day} className="flex-1 rounded-t bg-brand/80" style={{ height: `${Math.max(4, (Math.abs(d.total_cents) / max) * 100)}%` }} title={`${d.day} · ${money(d.total_cents)}`} />
                ))}
              </div>
            </section>
          )}
          <section className="card divide-y divide-slate-100">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-700">{t('checkoutLive.doc.byMethod')}</h2>
            {report.by_method.map((m) => {
              const Icon = METHOD_ICON[m.kind]
              return (
                <p key={m.label} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <Icon className="size-4 text-brand" aria-hidden="true" /><span className="flex-1">{m.label}</span><span className="font-semibold tabular-nums">{money(m.amount_cents)}</span>
                </p>
              )
            })}
          </section>
          {report.scope === 'establishment' && report.by_staff.length > 0 && (
            <section className="card divide-y divide-slate-100">
              <h2 className="px-4 py-3 text-sm font-semibold text-slate-700">{t('checkoutLive.reports.byStaff')}</h2>
              {report.by_staff.map((s) => (
                <p key={s.staff_id ?? 'none'} className="flex justify-between px-4 py-2 text-sm"><span>{s.name}</span><span className="font-semibold tabular-nums">{money(s.total_cents)}</span></p>
              ))}
            </section>
          )}
          <section className="card divide-y divide-slate-100">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-700">{t('checkoutLive.reports.byItem')}</h2>
            {report.by_item.slice(0, 10).map((i) => (
              <p key={`${i.kind}-${i.label}`} className="flex justify-between gap-2 px-4 py-2 text-sm">
                <span className="truncate">{i.label} <span className="text-slate-400">× {i.quantity}</span></span><span className="font-semibold tabular-nums">{money(i.total_cents)}</span>
              </p>
            ))}
          </section>
          <section className="card divide-y divide-slate-100">
            <h2 className="px-4 py-3 text-sm font-semibold text-slate-700">{t('checkoutLive.doc.byRate')}</h2>
            {report.by_rate.map((r) => (
              <p key={r.rate_bp} className="flex justify-between px-4 py-2 text-sm tabular-nums">
                <span>{r.rate_bp / 100} % · {t('checkoutLive.doc.net')} {money(r.net_cents)}</span><span>{t('checkoutLive.doc.tax')} {money(r.tax_cents)}</span>
              </p>
            ))}
          </section>

          {(can('accounting.export') || can('reports.read')) && (
            <section className="card space-y-2 p-4">
              {can('accounting.export') && (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void exportAs('csv')} data-testid="export-csv"><Download className="size-4" aria-hidden="true" />CSV</button>
                  <button type="button" className="btn-secondary" disabled={busy} onClick={() => void exportAs('fec')} data-testid="export-fec"><Download className="size-4" aria-hidden="true" />FEC</button>
                </div>
              )}
              {can('reports.read') && (
                <>
                  <button type="button" className="btn-secondary w-full" onClick={() => void verify()} data-testid="verify-integrity"><ShieldCheck className="size-4" aria-hidden="true" />{t('checkoutLive.reports.verify')}</button>
                  <button type="button" className="btn-secondary w-full" onClick={() => void closeLastMonth()}><CalendarCheck className="size-4" aria-hidden="true" />{t('checkoutLive.reports.closeMonth')}</button>
                </>
              )}
              <p className="text-xs text-slate-500">{t('checkoutLive.reports.exportNotice')}</p>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
