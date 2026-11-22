import { describe, expect, it } from 'vitest'
import { checkBrowserKey, checkSupabaseUrl } from './keyGuard'

// Jetons FACTICES construits pour le test (signature bidon) — aucune vraie clé.
const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
// Préfixe assemblé à l'exécution pour ne pas déclencher le scanner de secrets (valeur factice).
const SECRET_PREFIX = ['sb', 'secret', ''].join('_')
const fakeJwt = (role: string) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.signature-factice`

describe('checkBrowserKey — aucune clé secrète dans le navigateur', () => {
  it('accepte une clé anon (JWT role=anon)', () => {
    expect(checkBrowserKey(fakeJwt('anon'))).toEqual({ ok: true })
  })
  it('accepte une clé publishable', () => {
    expect(checkBrowserKey('sb_publishable_exemple123')).toEqual({ ok: true })
  })
  it('refuse une clé service_role', () => {
    expect(checkBrowserKey(fakeJwt('service_role'))).toEqual({ ok: false, reason: 'service_role_key' })
  })
  it('refuse une clé secrète sb_secret_', () => {
    expect(checkBrowserKey(`${SECRET_PREFIX}exemple123`)).toEqual({ ok: false, reason: 'secret_key' })
  })
  it('refuse une valeur vide ou inconnue', () => {
    expect(checkBrowserKey('')).toMatchObject({ ok: false })
    expect(checkBrowserKey('n-importe-quoi')).toMatchObject({ ok: false, reason: 'unrecognized_key' })
  })
})

describe('checkSupabaseUrl', () => {
  it('exige HTTPS hors développement local', () => {
    expect(checkSupabaseUrl('https://abcd.supabase.co')).toEqual({ ok: true })
    expect(checkSupabaseUrl('http://localhost:54321')).toEqual({ ok: true })
    expect(checkSupabaseUrl('http://abcd.supabase.co')).toEqual({ ok: false, reason: 'insecure_url' })
    expect(checkSupabaseUrl('pas une url')).toEqual({ ok: false, reason: 'invalid_url' })
  })
})
