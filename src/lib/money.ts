/**
 * Montants en unités mineures (centimes) — aucun calcul en virgule flottante.
 * Les totaux de référence sont TOUJOURS recalculés par le serveur (complete_sale) ;
 * ces fonctions servent à l'aperçu et à la saisie.
 */

/** « 12,5 » / « 12.50 » / « 12 » → 1250 ; null si invalide. */
export function parseAmountToCents(input: string): number | null {
  const s = input.replace(/[\s\u00A0\u202F\u20AC$\u00A3]|CHF/g, '').replace(',', '.')
  if (!/^\d{1,7}(\.\d{0,2})?$/.test(s)) return null
  const [int, dec = ''] = s.split('.')
  return Number(int) * 100 + Number((dec + '00').slice(0, 2))
}

/** 1250 → « 12,50 » (saisie, sans symbole). */
export function centsToInput(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`
}

/** Remise en points de base (1000 = 10 %) appliquée à un montant, arrondie au centime (comme le serveur). */
export function discountOf(amountCents: number, bp: number): number {
  return Math.round((amountCents * bp) / 10000)
}

/** TVA contenue dans un montant TTC (taux en points de base), arrondie comme le serveur. */
export function taxIncluded(totalCents: number, rateBp: number): number {
  return Math.round((totalCents * rateBp) / (10000 + rateBp))
}

export interface PreviewLine {
  unitCents: number
  quantity: number
  discountBp: number
}

/** Aperçu des totaux d'un panier (même algorithme que complete_sale). */
export function previewTotals(lines: PreviewLine[], ticketDiscountBp: number, depositsCents = 0) {
  let subtotal = 0
  let discount = 0
  for (const l of lines) {
    const gross = l.unitCents * l.quantity
    let d = discountOf(gross, l.discountBp)
    d += discountOf(gross - d, ticketDiscountBp)
    subtotal += gross
    discount += d
  }
  const total = subtotal - discount - depositsCents
  const effectiveBp = discount > 0 ? Math.ceil((discount * 10000) / Math.max(subtotal, 1)) : 0
  return { subtotal, discount, total, effectiveBp }
}

/** Pièces et billets courants par devise (comptage de caisse), en centimes, du plus grand au plus petit. */
export function denominationsFor(currency: string): number[] {
  switch (currency) {
    case 'CHF':
      return [100000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5]
    case 'GBP':
      return [5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]
    default:
      return [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]
  }
}

/** Somme d'un comptage { "2000": 3, "500": 2 } → centimes. */
export function countTotal(count: Record<string, number>): number {
  return Object.entries(count).reduce((sum, [value, n]) => sum + Number(value) * (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0), 0)
}

/** Identifiant d'idempotence (une clé par tentative d'encaissement, conservée en cas de nouvel essai). */
export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}
