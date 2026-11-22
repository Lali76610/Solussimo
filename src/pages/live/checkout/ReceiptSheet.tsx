import { CheckCircle2, FileText } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Field } from '../../../components/Field'
import { FormMessage } from '../../../components/FormMessage'
import { Sheet } from '../../../components/Sheet'
import { authErrorKey } from '../../../lib/authErrors'
import { formatCurrency } from '../../../lib/format'
import { supabase } from '../../../lib/supabase'
import { DocumentButton } from './DocumentButton'

/** Confirmation d'encaissement : rendu monnaie, reçu PDF, facture nominative à la demande. */
export function ReceiptSheet({ receipt, currency, onClose }: { receipt: { saleId: string; documentNo: string; changeCents: number }; currency: string; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'fr'
  const [error, setError] = useState<string | null>(null)
  return (
    <Sheet title={t('checkoutLive.receipt.title')} onClose={onClose}>
      <div className="space-y-4" data-testid="receipt">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="size-14 text-brand" aria-hidden="true" />
          <p className="font-semibold text-slate-900">{t('checkoutLive.receipt.done')}</p>
          <p className="font-mono text-sm text-slate-500" data-testid="document-no">{receipt.documentNo}</p>
        </div>
        {receipt.changeCents > 0 && (
          <p className="rounded-xl bg-gold-light px-4 py-3 text-center text-xl font-semibold text-gold-dark">
            {t('checkoutLive.pay.change', { amount: formatCurrency(receipt.changeCents / 100, lang, currency) })}
          </p>
        )}
        <DocumentButton kind="receipt" id={receipt.saleId} label={t('checkoutLive.receipt.pdf')} primary onError={setError} />
        <InvoiceForm saleId={receipt.saleId} onError={setError} />
        <FormMessage kind="error">{error}</FormMessage>
        <button type="button" className="btn-secondary w-full" onClick={onClose} data-testid="new-sale">{t('checkoutLive.receipt.newSale')}</button>
      </div>
    </Sheet>
  )
}

/** Facture nominative (série F) : identité de l'acheteur conservée au titre de l'obligation comptable. */
export function InvoiceForm({ saleId, onError, existing }: { saleId: string; onError: (m: string) => void; existing?: string | null }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [vat, setVat] = useState('')
  const [invoiceNo, setInvoiceNo] = useState<string | null>(existing ?? null)
  const [busy, setBusy] = useState(false)

  async function issue() {
    if (!supabase) return
    setBusy(true)
    const buyer: { name: string; address?: string; vat_number?: string } = { name: name.trim() }
    if (address.trim()) buyer.address = address.trim()
    if (vat.trim()) buyer.vat_number = vat.trim()
    const { data, error } = await supabase.rpc('issue_invoice', { p_sale_id: saleId, p_buyer: buyer })
    setBusy(false)
    if (error) return onError(t(authErrorKey(error)))
    setInvoiceNo(data.document_no)
    setOpen(false)
  }

  if (invoiceNo) return <DocumentButton kind="invoice" id={saleId} label={t('checkoutLive.invoice.pdf', { no: invoiceNo })} onError={onError} />
  if (!open) {
    return (
      <button type="button" className="btn-secondary w-full" onClick={() => setOpen(true)} data-testid="invoice-open">
        <FileText className="size-4" aria-hidden="true" />{t('checkoutLive.invoice.request')}
      </button>
    )
  }
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 p-3">
      <Field id="ibName" label={t('checkoutLive.invoice.name')}>
        <input id="ibName" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} className="input" autoComplete="organization" />
      </Field>
      <Field id="ibAddress" label={`${t('checkoutLive.invoice.address')} (${t('common.optional')})`}>
        <textarea id="ibAddress" value={address} maxLength={300} rows={2} onChange={(e) => setAddress(e.target.value)} className="input py-2" />
      </Field>
      <Field id="ibVat" label={`${t('checkoutLive.invoice.vat')} (${t('common.optional')})`}>
        <input id="ibVat" value={vat} maxLength={40} onChange={(e) => setVat(e.target.value)} className="input" autoCapitalize="characters" />
      </Field>
      <p className="text-xs text-slate-500">{t('checkoutLive.invoice.notice')}</p>
      <button type="button" className="btn-primary w-full" disabled={busy || name.trim().length < 2} onClick={() => void issue()} data-testid="invoice-issue">
        {t('checkoutLive.invoice.issue')}
      </button>
    </div>
  )
}
