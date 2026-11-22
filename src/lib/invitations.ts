/**
 * Lien d'invitation : le jeton est placé dans le FRAGMENT (#t=…), jamais envoyé
 * au serveur web (ni journaux d'accès, ni en-tête Referer).
 * En attente d'acceptation, il est conservé localement 72 h au plus, puis effacé.
 */
const KEY = 'solussimo.pendingInvitation'
const TTL_MS = 72 * 60 * 60 * 1000

export function invitationLink(token: string): string {
  return `${window.location.origin}/invitation#t=${token}`
}

export function readTokenFromHash(hash: string): string | null {
  const m = hash.match(/[#&]t=([0-9a-f]{64})\b/)
  return m ? m[1]! : null
}

export function savePendingInvitation(token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, expiresAt: Date.now() + TTL_MS }))
  } catch {
    /* stockage indisponible */
  }
}

export function readPendingInvitation(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { token?: string; expiresAt?: number }
    if (!v.token || !v.expiresAt || v.expiresAt < Date.now()) {
      localStorage.removeItem(KEY)
      return null
    }
    return v.token
  } catch {
    return null
  }
}

export function clearPendingInvitation(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
