import { KeyRound, Lock } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormMessage } from '../../../components/FormMessage'
import { PageHeader } from '../../../components/PageHeader'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency, formatDate } from '../../../lib/format'
import { countTotal } from '../../../lib/money'
import { supabase } from '../../../lib/supabase'
import { useTenant } from '../../../tenant/useTenant'
import { ApprovalCodeSheet } from './ApprovalCodeSheet'
import { CashCount } from './CashCount'
import { CheckoutNav } from './CheckoutNav'
import { SaleComposer } from './SaleComposer'
import { useCheckoutData, useCheckoutEstablishment } from './useCheckoutData'

export function LiveCheckoutPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const { can } = useTenant()
  const { establishments, establishment, choose } = useCheckoutEstablishment()
  const data = useCheckoutData(establishment?.id)
  const [count, setCount] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [approval, setApproval] = useState(false)

  async function openRegister() {
    if (!supabase || !data.register || busy) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('open_register', {
      p_register_id: data.register.id, p_opening_float_cents: countTotal(count), p_count: count,
    })
    setBusy(false)
    if (err) setError(t(authErrorKey(err)))
    await data.reload()
  }

  return (
    <div className="pb-28">
      <PageHeader
        title={t('nav.checkout')}
        subtitle={data.session
          ? t('checkoutLive.sessionOpenSince', { time: formatDate(new Date(data.session.opened_at), lang, { hour: '2-digit', minute: '2-digit' }) })
          : t('checkoutLive.subtitle')}
        actions={can('discount.approve') && data.session && (
          <button type="button" className="btn-secondary" onClick={() => setApproval(true)} data-testid="approval-code">
            <KeyRound className="size-4" aria-hidden="true" />{t('checkoutLive.approval.button')}
          </button>
        )}
      />
      <CheckoutNav establishments={establishments} establishment={establishment} onChoose={choose} />
      {data.error && <FormMessage kind="error">{t('errors.generic')}</FormMessage>}

      {!data.loading && !data.session && establishment && (
        <section className="card space-y-4 p-5" aria-labelledby="open-title">
          <div className="flex items-center gap-3">
            <span className="grid size-11 place-items-center rounded-full bg-brand-50 text-brand"><Lock className="size-5" aria-hidden="true" /></span>
            <div>
              <h2 id="open-title" className="font-display text-lg font-semibold text-slate-900">{t('checkoutLive.open.title')}</h2>
              <p className="text-sm text-slate-500">{t('checkoutLive.open.hint')}</p>
            </div>
          </div>
          <CashCount currency={data.currency} value={count} onChange={setCount} />
          <FormMessage kind="error">{error}</FormMessage>
          <button type="button" className="btn-primary w-full" disabled={busy || !data.register} onClick={() => void openRegister()} data-testid="open-register">
            {busy ? t('common.saving') : t('checkoutLive.open.submit', { amount: formatCurrency(countTotal(count) / 100, lang, data.currency) })}
          </button>
        </section>
      )}

      {data.loading && !data.session && <p className="card p-5 text-sm text-slate-500">{t('common.loading')}</p>}
      {/* Reste monté pendant les rechargements : le reçu affiché après encaissement n'est pas perdu. */}
      {data.session && establishment && (
        <SaleComposer establishment={establishment} data={data} />
      )}
      {approval && establishment && <ApprovalCodeSheet establishmentId={establishment.id} onClose={() => setApproval(false)} />}
    </div>
  )
}
