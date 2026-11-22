import { describe, expect, it } from 'vitest'
import { centsToInput, countTotal, denominationsFor, discountOf, parseAmountToCents, previewTotals, taxIncluded } from './money'

describe('money', () => {
  it('convertit les saisies en centimes sans flottant', () => {
    expect(parseAmountToCents('12,5')).toBe(1250)
    expect(parseAmountToCents('12.50')).toBe(1250)
    expect(parseAmountToCents('0,1')).toBe(10)
    expect(parseAmountToCents('1 234,56 €')).toBe(123456)
    expect(parseAmountToCents('19.99')).toBe(1999) // 19.99 * 100 = 1998.9999… en flottant
    expect(parseAmountToCents('12,345')).toBeNull()
    expect(parseAmountToCents('-5')).toBeNull()
    expect(parseAmountToCents('abc')).toBeNull()
    expect(centsToInput(1250)).toBe('12,50')
    expect(centsToInput(-305)).toBe('-3,05')
  })

  it('calcule TVA et remises comme le serveur', () => {
    expect(taxIncluded(3200, 2000)).toBe(533)
    expect(taxIncluded(1000, 2000)).toBe(167)
    expect(taxIncluded(1000, 550)).toBe(52)
    expect(discountOf(3200, 1000)).toBe(320)
    // Remise de ticket appliquée après la remise de ligne
    const p = previewTotals([{ unitCents: 3200, quantity: 1, discountBp: 0 }], 2500)
    expect(p).toEqual({ subtotal: 3200, discount: 800, total: 2400, effectiveBp: 2500 })
    expect(previewTotals([{ unitCents: 3200, quantity: 2, discountBp: 1000 }], 0, 1000).total).toBe(4760)
  })

  it('compte la caisse par coupures', () => {
    expect(countTotal({ '5000': 1, '2000': 2, '50': 3 })).toBe(9150)
    expect(countTotal({ '1000': -2, '500': Number.NaN })).toBe(0)
    expect(denominationsFor('EUR')[0]).toBe(50000)
    expect(denominationsFor('CHF')).toContain(5)
  })
})
