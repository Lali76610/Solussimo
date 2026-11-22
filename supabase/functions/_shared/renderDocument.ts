/**
 * SOLUSSIMO — rendu PDF des pièces de caisse (reçu, facture, avoir, acompte, ticket Z).
 * Module PUR partagé entre l'Edge Function « generate-document-pdf » (Deno) et le navigateur
 * (aperçu / repli) : mêmes données serveur (get_document), même rendu.
 * Aucune donnée n'est recalculée ici : tous les montants proviennent du serveur.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

export interface DocLine { label: string; kind: string; quantity: number; unit_price_cents: number; discount_cents: number; tax_rate_bp: number; total_cents: number }
export interface DocPayment { label: string; kind: string; amount_cents: number; tendered_cents: number | null; change_cents: number }
export interface DocTax { rate_bp: number; net_cents: number; tax_cents: number; total_cents: number }
export interface DocTotals {
  count_sales: number; count_deposits: number; count_credit_notes: number
  total_cents: number; tax_cents: number; net_cents: number; discount_cents: number; refunds_cents: number
  by_method: { kind: string; label: string; amount_cents: number }[]
  by_rate: DocTax[]
  cash?: { opening_float_cents: number; cash_sales_cents: number; movements_in_cents: number; movements_out_cents: number; expected_cents: number; counted_cents: number; difference_cents: number }
}
export interface DocumentData {
  type: 'sale' | 'deposit' | 'credit_note' | 'invoice' | 'closure'
  duplicate: boolean
  print_count: number
  fiscal_mode: 'demo' | 'uncertified' | 'certified'
  country_code: string
  currency: string
  timezone: string
  seller: { establishment: string; city: string | null; legal_name: string; tax_id: string | null; vat_number: string | null; address: string | null; legal_mentions: string | null }
  document_no: string
  date: string
  hash: string
  // Pièces de vente
  sale_document_no?: string
  original_document_no?: string | null
  refund_reason?: string | null
  buyer?: { name: string; address?: string; vat_number?: string; tax_id?: string } | null
  invoice_document_no?: string | null
  subtotal_cents?: number
  discount_cents?: number
  total_cents?: number
  tax_cents?: number
  net_cents?: number
  staff?: string | null
  lines?: DocLine[]
  payments?: DocPayment[]
  taxes?: DocTax[]
  // Clôtures
  kind?: 'z' | 'month' | 'year'
  period_start?: string
  period_end?: string
  totals?: DocTotals
  grand_total_cents?: number
}

export interface DocLabels {
  receipt: string; invoice: string; creditNote: string; deposit: string; closureZ: string; closureMonth: string; closureYear: string
  duplicate: string; uncertified: string; number: string; date: string; originalDoc: string; reason: string; buyer: string
  vatNumber: string; taxId: string; subtotal: string; discount: string; total: string; net: string; tax: string; rate: string
  payments: string; tendered: string; change: string; staff: string; fingerprint: string; period: string
  sales: string; deposits: string; creditNotes: string; refunds: string; byMethod: string; byRate: string; cash: string
  openingFloat: string; cashSales: string; movementsIn: string; movementsOut: string; expected: string; counted: string
  difference: string; grandTotal: string; thanks: string; invoiceRef: string
}

// Les polices standard PDF (WinAnsi) couvrent FR/EN/ES/DE ; tout autre caractère est remplacé.
const EXTRA = '€…–—‘’“”•™ŒœŠšŽžŸ'
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/\u2212/g, '-')
    .replace(/[^\n\x20-\x7E\u00A1-\u00FF]/g, (c) => (EXTRA.includes(c) ? c : '?'))
}

export async function renderDocumentPdf(doc: DocumentData, labels: DocLabels, locale: string): Promise<Uint8Array> {
  const money = (c: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: doc.currency }).format(c / 100)
  const pct = (bp: number) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(bp / 100)} %`
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short', timeZone: doc.timezone }).format(new Date(iso))
  const day = (d: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`))

  const pdf = await PDFDocument.create()
  pdf.setTitle(pdfSafe(`${doc.document_no} — ${doc.seller.establishment}`))
  pdf.setProducer('SOLUSSIMO')
  pdf.setCreator('SOLUSSIMO')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const brand = rgb(0, 0.545, 0.545)
  const gold = rgb(0.77, 0.66, 0.46)
  const grey = rgb(0.39, 0.45, 0.55)
  const W = 595.28
  const H = 841.89
  const M = 48
  let page: PDFPage = pdf.addPage([W, H])
  let y = H - M

  const ensure = (h: number) => {
    if (y - h < M) {
      page = pdf.addPage([W, H])
      y = H - M
    }
  }
  const text = (s: string, x: number, size = 10, f: PDFFont = font, color = rgb(0.1, 0.12, 0.16)) =>
    page.drawText(pdfSafe(s), { x, y, size, font: f, color })
  const right = (s: string, xRight: number, size = 10, f: PDFFont = font, color = rgb(0.1, 0.12, 0.16)) => {
    const safe = pdfSafe(s)
    page.drawText(safe, { x: xRight - f.widthOfTextAtSize(safe, size), y, size, font: f, color })
  }
  const wrap = (s: string, width: number, size = 9, f: PDFFont = font) => {
    const out: string[] = []
    for (const para of pdfSafe(s).split('\n')) {
      let line = ''
      for (const word of para.split(' ')) {
        const tryLine = line ? `${line} ${word}` : word
        if (f.widthOfTextAtSize(tryLine, size) > width && line) {
          out.push(line)
          line = word
        } else line = tryLine
      }
      out.push(line)
    }
    return out
  }
  const para = (s: string, size = 9, color = grey) => {
    for (const l of wrap(s, W - 2 * M, size)) {
      ensure(size + 4)
      text(l, M, size, font, color)
      y -= size + 3
    }
  }
  const rule = (color = rgb(0.89, 0.91, 0.94)) => {
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color })
    y -= 12
  }
  const row = (label: string, value: string, f: PDFFont = font, size = 10) => {
    if (size > 10) y -= size - 8 // interligne supplémentaire pour les montants mis en avant
    ensure(size + 6)
    text(label, M, size, f)
    right(value, W - M, size, f)
    y -= size + 6
  }

  // En-tête vendeur
  text('SOLUSSIMO', W - M - bold.widthOfTextAtSize('SOLUSSIMO', 9), 9, bold, gold)
  text(doc.seller.legal_name, M, 14, bold, brand)
  y -= 16
  text(doc.seller.establishment + (doc.seller.city ? ` · ${doc.seller.city}` : ''), M, 10)
  y -= 13
  if (doc.seller.address) para(doc.seller.address, 9)
  const ids = [doc.seller.tax_id && `${labels.taxId} ${doc.seller.tax_id}`, doc.seller.vat_number && `${labels.vatNumber} ${doc.seller.vat_number}`].filter(Boolean)
  if (ids.length) para(ids.join(' · '), 9)
  y -= 8

  // Bandeau de conformité (V0.5 : jamais « certifié »)
  if (doc.fiscal_mode !== 'certified') {
    page.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 22, color: rgb(1, 0.96, 0.9) })
    text(labels.uncertified, M + 8, 9, bold, rgb(0.6, 0.35, 0.05))
    y -= 30
  }

  const title =
    doc.type === 'closure'
      ? doc.kind === 'month' ? labels.closureMonth : doc.kind === 'year' ? labels.closureYear : labels.closureZ
      : doc.type === 'invoice' ? labels.invoice : doc.type === 'credit_note' ? labels.creditNote : doc.type === 'deposit' ? labels.deposit : labels.receipt
  text(title.toUpperCase(), M, 18, bold)
  if (doc.duplicate) right(`${labels.duplicate} (${doc.print_count})`, W - M, 12, bold, rgb(0.75, 0.1, 0.1))
  y -= 22
  row(labels.number, doc.document_no, bold)
  row(labels.date, when(doc.date))
  if (doc.type === 'invoice' && doc.sale_document_no) row(labels.receipt, doc.sale_document_no)
  if (doc.invoice_document_no && doc.type !== 'invoice') row(labels.invoiceRef, doc.invoice_document_no)
  if (doc.original_document_no) row(labels.originalDoc, doc.original_document_no)
  if (doc.refund_reason) row(labels.reason, doc.refund_reason)
  if (doc.staff) row(labels.staff, doc.staff)
  if (doc.period_start && doc.period_end) row(labels.period, `${day(doc.period_start)} – ${day(doc.period_end)}`)

  if (doc.buyer) {
    y -= 4
    text(labels.buyer, M, 9, bold, grey)
    y -= 13
    text(doc.buyer.name, M, 11, bold)
    y -= 14
    if (doc.buyer.address) para(doc.buyer.address, 9, rgb(0.1, 0.12, 0.16))
    const b = [doc.buyer.tax_id && `${labels.taxId} ${doc.buyer.tax_id}`, doc.buyer.vat_number && `${labels.vatNumber} ${doc.buyer.vat_number}`].filter(Boolean)
    if (b.length) para(b.join(' · '), 9)
  }
  y -= 6
  rule()

  if (doc.type !== 'closure') {
    for (const l of doc.lines ?? []) {
      const lines = wrap(l.label, W - 2 * M - 150, 10)
      ensure(14 * lines.length + 12)
      lines.forEach((ln, i) => {
        text(ln, M, 10, i === 0 ? bold : font)
        if (i === 0) right(money(l.total_cents), W - M, 10, bold)
        y -= 13
      })
      const detail = `${l.quantity} × ${money(l.unit_price_cents)}${l.discount_cents ? ` · ${labels.discount} ${money(-l.discount_cents)}` : ''} · ${pct(l.tax_rate_bp)}`
      text(detail, M, 8.5, font, grey)
      y -= 15
    }
    rule()
    if (doc.discount_cents) {
      row(labels.subtotal, money(doc.subtotal_cents ?? 0))
      row(labels.discount, money(-(doc.discount_cents ?? 0)))
    }
    row(labels.total, money(doc.total_cents ?? 0), bold, 13)
    row(labels.net, money(doc.net_cents ?? 0))
    y -= 4
    // Ventilation de la TVA par taux
    ensure(40)
    text(labels.rate, M, 8.5, bold, grey)
    right(labels.net, M + 260, 8.5, bold, grey)
    right(labels.tax, M + 360, 8.5, bold, grey)
    right(labels.total, W - M, 8.5, bold, grey)
    y -= 13
    for (const t of doc.taxes ?? []) {
      ensure(14)
      text(pct(t.rate_bp), M, 9)
      right(money(t.net_cents), M + 260, 9)
      right(money(t.tax_cents), M + 360, 9)
      right(money(t.total_cents), W - M, 9)
      y -= 13
    }
    y -= 6
    rule()
    text(labels.payments, M, 9, bold, grey)
    y -= 14
    for (const p of doc.payments ?? []) {
      row(p.label, money(p.amount_cents))
      if (p.change_cents > 0 && p.tendered_cents != null) {
        row(`   ${labels.tendered}`, money(p.tendered_cents), font, 9)
        row(`   ${labels.change}`, money(p.change_cents), font, 9)
      }
    }
  } else if (doc.totals) {
    const t = doc.totals
    row(labels.sales, String(t.count_sales))
    row(labels.deposits, String(t.count_deposits))
    row(labels.creditNotes, String(t.count_credit_notes))
    row(labels.discount, money(-t.discount_cents))
    row(labels.refunds, money(t.refunds_cents))
    row(labels.total, money(t.total_cents), bold, 13)
    row(labels.net, money(t.net_cents))
    row(labels.tax, money(t.tax_cents))
    if (doc.grand_total_cents != null) row(labels.grandTotal, money(doc.grand_total_cents), bold)
    y -= 4
    rule()
    text(labels.byMethod, M, 9, bold, grey)
    y -= 14
    for (const m of t.by_method) row(m.label, money(m.amount_cents))
    y -= 4
    text(labels.byRate, M, 9, bold, grey)
    y -= 14
    for (const r of t.by_rate) row(`${pct(r.rate_bp)} · ${labels.net} ${money(r.net_cents)}`, `${labels.tax} ${money(r.tax_cents)}`)
    if (t.cash) {
      y -= 4
      rule()
      text(labels.cash, M, 9, bold, grey)
      y -= 14
      row(labels.openingFloat, money(t.cash.opening_float_cents))
      row(labels.cashSales, money(t.cash.cash_sales_cents))
      row(labels.movementsIn, money(t.cash.movements_in_cents))
      row(labels.movementsOut, money(-t.cash.movements_out_cents))
      row(labels.expected, money(t.cash.expected_cents), bold)
      row(labels.counted, money(t.cash.counted_cents), bold)
      row(labels.difference, money(t.cash.difference_cents), bold)
    }
  }

  y -= 8
  rule()
  if (doc.seller.legal_mentions) para(doc.seller.legal_mentions, 8.5)
  para(`${labels.fingerprint} : ${doc.hash.slice(0, 16)}…${doc.hash.slice(-8)}`, 7.5)
  if (doc.type !== 'closure') {
    y -= 6
    ensure(16)
    text(labels.thanks, M, 10, bold, brand)
  }
  return pdf.save()
}
