import { describe, expect, it } from 'vitest'
import { formatPhone, toE164 } from './phone'

describe('téléphones (numéros fictifs ARCEP 06 39 98)', () => {
  it('normalise un numéro national selon le pays de l’établissement', () => {
    expect(toE164('06 39 98 00 01', 'FR')).toBe('+33639980001')
    expect(toE164('+33 6 39 98 00 01', 'ES')).toBe('+33639980001')
  })
  it('refuse un numéro impossible', () => {
    expect(toE164('12', 'FR')).toBeNull()
    expect(toE164('', 'FR')).toBeNull()
  })
  it('affiche au format international', () => {
    expect(formatPhone('+33639980001')).toBe('+33 6 39 98 00 01')
  })
})
