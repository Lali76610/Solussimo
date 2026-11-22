/**
 * Gestion de session — PROTOTYPE FRONT-END.
 *
 * ⚠️ Aucune authentification réelle n'est effectuée côté client. En production :
 *  - l'authentification sera réalisée par l'API (mots de passe hachés Argon2id, MFA) ;
 *  - la session sera portée par un cookie HttpOnly + Secure + SameSite=Strict,
 *    jamais par un jeton lisible en JavaScript ;
 *  - le verrouillage anti-force brute sera appliqué côté serveur.
 *
 * Ici, on ne conserve qu'un profil minimal non sensible dans sessionStorage
 * (effacé à la fermeture de l'onglet). Le mot de passe n'est JAMAIS stocké.
 */

export interface SessionUser {
  displayName: string
  salonName: string
  role: 'owner'
}

interface StoredSession {
  user: SessionUser
  expiresAt: number
}

const SESSION_KEY = 'solussimo.session'
export const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes d'inactivité

/** Compte de démonstration — adresse sur domaine réservé (RFC 2606), donc fictive. */
export const DEMO_ACCOUNT = {
  email: 'demo@maison-elegance.example',
  password: 'Demo-Solussimo-2026',
} as const

export function readSession(): SessionUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    if (typeof parsed?.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed.user
  } catch {
    return null
  }
}

export function writeSession(user: SessionUser): void {
  try {
    const value: StoredSession = { user, expiresAt: Date.now() + SESSION_TTL_MS }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    /* stockage indisponible (navigation privée) : session en mémoire uniquement */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** Simule l'appel API d'authentification (comparaison en temps constant). */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  await new Promise((r) => setTimeout(r, 600))
  const ok = safeEqual(email.trim().toLowerCase(), DEMO_ACCOUNT.email) && safeEqual(password, DEMO_ACCOUNT.password)
  return ok ? { displayName: 'Camille', salonName: 'Maison Élégance', role: 'owner' } : null
}

function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}
