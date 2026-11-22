import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min'

/**
 * Normalise un numéro saisi (« 06 39 98 00 01 », « +33 6… ») au format international E.164,
 * avec le pays de l'établissement par défaut. Renvoie null si le numéro est invalide.
 */
export function toE164(input: string, defaultCountry: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  const parsed = parsePhoneNumberFromString(raw, defaultCountry.toUpperCase() as CountryCode)
  return parsed && parsed.isPossible() ? parsed.number : null
}

/** Affichage lisible d'un numéro complet (après autorisation serveur). */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164)
  return parsed ? parsed.formatInternational() : e164
}
