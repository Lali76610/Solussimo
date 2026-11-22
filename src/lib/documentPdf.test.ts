import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { pdfSafe, renderDocumentPdf, type DocLabels, type DocumentData } from '../../supabase/functions/_shared/renderDocument'
import fr from '../i18n/locales/fr.json'

const labels = fr.checkoutLive.doc as unknown as DocLabels

const sale: DocumentData = {
  type: 'sale', duplicate: false, print_count: 1, fiscal_mode: 'uncertified', country_code: 'FR', currency: 'EUR', timezone: 'Europe/Paris',
  seller: { establishment: 'Maison Élégance', city: 'Lyon', legal_name: 'Maison Élégance SARL (fictif)', tax_id: '000000000', vat_number: null, address: '1 rue de l’Exemple', legal_mentions: 'TVA acquittée sur les débits — données fictives' },
  document_no: 'T-2026-000001', date: '2026-11-22T14:05:00Z', hash: 'a'.repeat(64), sale_document_no: 'T-2026-000001',
  subtotal_cents: 6400, discount_cents: 640, total_cents: 5760, tax_cents: 960, net_cents: 4800, staff: 'Chloé',
  lines: [
    { label: 'Coupe brushing — cheveux longs avec soin profond kératine et finition', kind: 'service', quantity: 1, unit_price_cents: 3200, discount_cents: 320, tax_rate_bp: 2000, total_cents: 2880 },
    { label: 'Shampooing', kind: 'product', quantity: 2, unit_price_cents: 1600, discount_cents: 320, tax_rate_bp: 2000, total_cents: 2880 },
  ],
  payments: [{ label: 'Espèces', kind: 'cash', amount_cents: 5760, tendered_cents: 6000, change_cents: 240 }],
  taxes: [{ rate_bp: 2000, net_cents: 4800, tax_cents: 960, total_cents: 5760 }],
}

describe('rendu PDF des pièces', () => {
  it('produit un PDF valide pour un ticket, une facture et un Z', async () => {
    for (const doc of [
      sale,
      { ...sale, type: 'invoice' as const, document_no: 'F-2026-000001', buyer: { name: 'Société Fictive SAS', address: '2 avenue Test', vat_number: 'FR00999999999' }, duplicate: true, print_count: 2 },
      {
        ...sale, type: 'closure' as const, kind: 'z' as const, document_no: 'Z-2026-000001', period_start: '2026-11-22', period_end: '2026-11-22', grand_total_cents: 5760,
        totals: { count_sales: 1, count_deposits: 0, count_credit_notes: 0, total_cents: 5760, tax_cents: 960, net_cents: 4800, discount_cents: 640, refunds_cents: 0,
          by_method: [{ kind: 'cash', label: 'Espèces', amount_cents: 5760 }], by_rate: [{ rate_bp: 2000, net_cents: 4800, tax_cents: 960, total_cents: 5760 }],
          cash: { opening_float_cents: 10000, cash_sales_cents: 5760, movements_in_cents: 0, movements_out_cents: 0, expected_cents: 15760, counted_cents: 15710, difference_cents: -50 } },
      },
    ]) {
      for (const locale of ['fr-FR', 'en-GB', 'es-ES', 'de-DE']) {
        const bytes = await renderDocumentPdf(doc, labels, locale)
        expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
        const parsed = await PDFDocument.load(bytes)
        expect(parsed.getPageCount()).toBeGreaterThanOrEqual(1)
        expect(parsed.getTitle()).toContain(doc.document_no)
      }
    }
  })

  it('remplace les caractères hors police standard (espaces fines, signes)', () => {
    expect(pdfSafe('12,50 €')).toBe('12,50 €')
    expect(pdfSafe('−10 %')).toBe('-10 %')
    expect(pdfSafe('Straße Peña Éloïse')).toBe('Straße Peña Éloïse')
    expect(pdfSafe('日本')).toBe('??')
  })

  it('les libellés PDF existent dans les 4 langues', async () => {
    for (const lang of ['en', 'es', 'de']) {
      const other = (await import(`../i18n/locales/${lang}.json`)).default.checkoutLive.doc
      expect(Object.keys(other).sort()).toEqual(Object.keys(labels).sort())
    }
  })
})
