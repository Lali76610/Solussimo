import type { TFunction } from 'i18next'
import { localeFor } from '../../../i18n'
import { supabase } from '../../../lib/supabase'
import type { DocLabels, DocumentData } from '../../../../supabase/functions/_shared/renderDocument'

export type DocKind = 'receipt' | 'invoice' | 'closure'

export function documentLabels(t: TFunction): DocLabels {
  const k = (key: string) => t(`checkoutLive.doc.${key}`)
  return {
    receipt: k('receipt'), invoice: k('invoice'), creditNote: k('creditNote'), deposit: k('deposit'), closureZ: k('closureZ'),
    closureMonth: k('closureMonth'), closureYear: k('closureYear'), duplicate: k('duplicate'), uncertified: k('uncertified'),
    number: k('number'), date: k('date'), originalDoc: k('originalDoc'), reason: k('reason'), buyer: k('buyer'), vatNumber: k('vatNumber'),
    taxId: k('taxId'), subtotal: k('subtotal'), discount: k('discount'), total: k('total'), net: k('net'), tax: k('tax'), rate: k('rate'),
    payments: k('payments'), tendered: k('tendered'), change: k('change'), staff: k('staff'), fingerprint: k('fingerprint'), period: k('period'),
    sales: k('sales'), deposits: k('deposits'), creditNotes: k('creditNotes'), refunds: k('refunds'), byMethod: k('byMethod'), byRate: k('byRate'),
    cash: k('cash'), openingFloat: k('openingFloat'), cashSales: k('cashSales'), movementsIn: k('movementsIn'), movementsOut: k('movementsOut'),
    expected: k('expected'), counted: k('counted'), difference: k('difference'), grandTotal: k('grandTotal'), thanks: k('thanks'), invoiceRef: k('invoiceRef'),
  }
}

/**
 * Génère le PDF d'une pièce. Par défaut via l'Edge Function serveur (VITE_PDF_EDGE=1, une fois déployée),
 * sinon rendu local avec le MÊME module à partir des données serveur (get_document, droits et journal appliqués).
 */
export async function buildDocumentPdf(kind: DocKind, id: string, t: TFunction, lang: string): Promise<{ blob: Blob; name: string }> {
  if (!supabase) throw new Error('network')
  const labels = documentLabels(t)
  const locale = localeFor(lang)
  if (import.meta.env.VITE_PDF_EDGE === '1') {
    const { data, error } = await supabase.functions.invoke('generate-document-pdf', { body: { kind, id, locale, labels } })
    if (!error && data instanceof Blob) return { blob: data, name: `${kind}-${id.slice(0, 8)}.pdf` }
  }
  const { data, error } = await supabase.rpc('get_document', { p_kind: kind, p_id: id })
  if (error) throw error
  const doc = data as DocumentData
  const { renderDocumentPdf } = await import('../../../../supabase/functions/_shared/renderDocument')
  const bytes = await renderDocumentPdf(doc, labels, locale)
  return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), name: `${doc.document_no}.pdf` }
}

/** Partage (feuille iOS) ou ouverture du PDF. */
export async function shareOrOpen(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Téléchargement d'un export texte (CSV / FEC). */
export function downloadText(content: string, name: string, type: string): void {
  void shareOrOpen(new Blob([content], { type }), name)
}
