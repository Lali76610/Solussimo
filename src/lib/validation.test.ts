import { describe, expect, it } from 'vitest'
import { authErrorKey } from './authErrors'
import { isStrongPassword, isValidDisplayName, isValidEmail } from './validation'

describe('validation', () => {
  it('mot de passe : ≥ 10 caractères, minuscule, majuscule, chiffre', () => {
    expect(isStrongPassword('Court1a')).toBe(false)
    expect(isStrongPassword('toutminuscule1')).toBe(false)
    expect(isStrongPassword('TOUTMAJUSCULE1')).toBe(false)
    expect(isStrongPassword('SansChiffreIci')).toBe(false)
    expect(isStrongPassword('Solussimo2026')).toBe(true)
  })
  it('e-mail et nom affiché', () => {
    expect(isValidEmail('camille@exemple.example')).toBe(true)
    expect(isValidEmail('pas-un-email')).toBe(false)
    expect(isValidDisplayName('  ')).toBe(false)
    expect(isValidDisplayName('x'.repeat(81))).toBe(false)
    expect(isValidDisplayName('Camille')).toBe(true)
  })
})

describe('authErrorKey — messages génériques', () => {
  it('ne distingue pas compte inexistant et mauvais mot de passe', () => {
    expect(authErrorKey({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe('errors.credentials')
  })
  it('traduit les erreurs RLS et métier', () => {
    expect(authErrorKey({ code: '42501', message: 'new row violates row-level security policy' })).toBe('errors.forbidden')
    expect(authErrorKey({ message: 'company_limit_reached' })).toBe('errors.companyLimit')
    expect(authErrorKey({ message: 'sole_owner_of_company' })).toBe('errors.soleOwner')
    expect(authErrorKey({ status: 429 })).toBe('errors.rateLimited')
    expect(authErrorKey(null)).toBe('errors.generic')
  })
})
