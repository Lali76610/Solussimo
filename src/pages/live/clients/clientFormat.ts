import type { ClientRow, ClientSearchRow } from '../../../lib/database.types'

export function clientName(c: Pick<ClientRow | ClientSearchRow, 'first_name' | 'last_name'>): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || '—'
}

export function birthdayLabel(day: number | null, month: number | null, lang: string): string | null {
  if (!day || !month) return null
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, month - 1, day)))
}

/** Petit délai de saisie avant d'interroger le serveur (recherche, doublons). */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let id: number | undefined
  return (...args: A) => {
    window.clearTimeout(id)
    id = window.setTimeout(() => fn(...args), ms)
  }
}
