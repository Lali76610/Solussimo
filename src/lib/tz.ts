/**
 * Calculs de dates dans le FUSEAU DE L'ÉTABLISSEMENT (et non celui de l'appareil).
 * Les jours sont manipulés comme des clés « AAAA-MM-JJ » (calendrier pur, sans heure),
 * les heures en minutes depuis minuit. La conversion d'une heure locale en instant UTC
 * est faite côté serveur pour les rendez-vous (book/reschedule) ; ces utilitaires
 * servent à l'affichage et aux absences.
 */

export type DateKey = string // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0')

const partsCache = new Map<string, Intl.DateTimeFormat>()
function formatter(timeZone: string) {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, f)
  }
  return f
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(date).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  }
}

export function dateKeyOf(date: Date, timeZone: string): DateKey {
  const z = zonedParts(date, timeZone)
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`
}

/** Minutes depuis minuit, heure locale de l'établissement. */
export function minutesOf(date: Date, timeZone: string): number {
  const z = zonedParts(date, timeZone)
  return z.hour * 60 + z.minute
}

export function todayKey(timeZone: string): DateKey {
  return dateKeyOf(new Date(), timeZone)
}

export function addDays(key: DateKey, days: number): DateKey {
  const [y, m, d] = key.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** Jour ISO : 1 = lundi … 7 = dimanche. */
export function isoWeekday(key: DateKey): number {
  const [y, m, d] = key.split('-').map(Number)
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
  return wd === 0 ? 7 : wd
}

export function startOfWeek(key: DateKey): DateKey {
  return addDays(key, 1 - isoWeekday(key))
}

/** Date « calendrier » utilisable avec Intl pour afficher un jour (midi UTC = sans ambiguïté). */
export function keyToDisplayDate(key: DateKey): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d!, 12))
}

export function minutesToHHMM(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`
}

export function hhmmToMinutes(hhmm: string): number {
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Horodatage local sans fuseau, attendu par les RPC de rendez-vous. */
export function localTimestamp(key: DateKey, minutes: number): string {
  return `${key}T${minutesToHHMM(minutes)}:00`
}

/**
 * Heure locale (fuseau de l'établissement) → instant UTC.
 * Méthode par correction itérative du décalage (gère les changements d'heure).
 */
export function zonedToUtc(key: DateKey, minutes: number, timeZone: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  const target = Date.UTC(y!, m! - 1, d!, Math.floor(minutes / 60), minutes % 60)
  let guess = target
  for (let i = 0; i < 3; i++) {
    const z = zonedParts(new Date(guess), timeZone)
    const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
    const diff = asUtc - target
    if (diff === 0) break
    guess -= diff
  }
  return new Date(guess)
}

/** Intervalle UTC couvrant largement une plage de jours locaux (pour les requêtes). */
export function utcWindow(fromKey: DateKey, toKeyExclusive: DateKey): { from: string; to: string } {
  return {
    from: new Date(Date.parse(`${addDays(fromKey, -1)}T00:00:00Z`)).toISOString(),
    to: new Date(Date.parse(`${addDays(toKeyExclusive, 1)}T00:00:00Z`)).toISOString(),
  }
}
