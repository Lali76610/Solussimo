/**
 * Session du MODE DÉMONSTRATION — entièrement locale, sans serveur.
 *
 * Clairement séparée de l'authentification réelle (Supabase Auth) :
 *  - aucune donnée réelle, aucun appel réseau ;
 *  - profil fictif conservé dans sessionStorage (effacé à la fermeture de
 *    l'onglet) et expiré après 30 minutes d'inactivité.
 */

export interface DemoUser {
  displayName: string
  salonName: string
}

interface StoredDemoSession {
  user: DemoUser
  expiresAt: number
}

const SESSION_KEY = 'solussimo.demo'
export const SESSION_TTL_MS = 30 * 60 * 1000

export const DEMO_USER: DemoUser = { displayName: 'Camille', salonName: 'Maison Élégance' }

export function readDemoSession(): DemoUser | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDemoSession
    if (typeof parsed?.expiresAt !== 'number' || parsed.expiresAt < Date.now()) {
      sessionStorage.removeItem(SESSION_KEY)
      return null
    }
    return parsed.user
  } catch {
    return null
  }
}

export function writeDemoSession(user: DemoUser): void {
  try {
    const value: StoredDemoSession = { user, expiresAt: Date.now() + SESSION_TTL_MS }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value))
  } catch {
    /* stockage indisponible (navigation privée) : session en mémoire uniquement */
  }
}

export function clearDemoSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}
