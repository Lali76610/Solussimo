import type { EstablishmentKind } from './database.types'

/** Pays proposés au lancement (extensible). Libellés traduits via Intl.DisplayNames. */
export const COUNTRIES = ['FR', 'BE', 'CH', 'LU', 'MC', 'ES', 'DE', 'AT', 'IT', 'PT', 'NL', 'IE', 'GB', 'CA', 'US'] as const
export const CURRENCIES = ['EUR', 'CHF', 'GBP', 'CAD', 'USD'] as const
export const ESTABLISHMENT_KINDS: EstablishmentKind[] = ['hair_salon', 'beauty_institute', 'barbershop', 'nail_salon', 'spa']

const DEFAULT_CURRENCY: Record<string, string> = { CH: 'CHF', GB: 'GBP', CA: 'CAD', US: 'USD' }
const DEFAULT_TZ: Record<string, string> = {
  FR: 'Europe/Paris', BE: 'Europe/Brussels', CH: 'Europe/Zurich', LU: 'Europe/Luxembourg', MC: 'Europe/Monaco',
  ES: 'Europe/Madrid', DE: 'Europe/Berlin', AT: 'Europe/Vienna', IT: 'Europe/Rome', PT: 'Europe/Lisbon',
  NL: 'Europe/Amsterdam', IE: 'Europe/Dublin', GB: 'Europe/London', CA: 'America/Toronto', US: 'America/New_York',
}

export function defaultCurrency(country: string): string {
  return DEFAULT_CURRENCY[country] ?? 'EUR'
}

export function defaultTimezone(country: string): string {
  return DEFAULT_TZ[country] ?? 'Europe/Paris'
}

export function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

export function listTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return Object.values(DEFAULT_TZ)
  }
}
