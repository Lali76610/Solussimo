/**
 * Garde-fou : la clé Supabase exposée au navigateur doit être PUBLIQUE.
 * Partagé entre l'application (vérification à l'exécution) et vite.config.ts
 * (le build échoue si une clé secrète est fournie).
 */

export type KeyCheck = { ok: true } | { ok: false; reason: string }

function decodeJwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded) // disponible dans les navigateurs et Node ≥ 16
    const payload = JSON.parse(json) as { role?: unknown }
    return typeof payload.role === 'string' ? payload.role : null
  } catch {
    return null
  }
}

export function checkBrowserKey(key: string | undefined | null): KeyCheck {
  if (!key) return { ok: false, reason: 'missing' }
  const k = key.trim()
  if (k.startsWith('sb_secret_')) return { ok: false, reason: 'secret_key' }
  if (k.startsWith('sb_publishable_')) return { ok: true }
  const role = decodeJwtRole(k)
  if (role === 'anon') return { ok: true }
  if (role === 'service_role' || role === 'supabase_admin') return { ok: false, reason: 'service_role_key' }
  return { ok: false, reason: 'unrecognized_key' }
}

export function checkSupabaseUrl(url: string | undefined | null): KeyCheck {
  if (!url) return { ok: false, reason: 'missing' }
  try {
    const u = new URL(url)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !local) return { ok: false, reason: 'insecure_url' }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
}
