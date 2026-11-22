import { localeFor } from '../i18n'

export function formatCurrency(amount: number, lang: string, currency = 'EUR'): string {
  return new Intl.NumberFormat(localeFor(lang), { style: 'currency', currency }).format(amount)
}

export function formatDate(date: Date, lang: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeFor(lang), options).format(date)
}

export function formatNumber(value: number, lang: string): string {
  return new Intl.NumberFormat(localeFor(lang)).format(value)
}

/** Met en majuscule la première lettre uniquement (« dimanche 22 novembre » → « Dimanche 22 novembre »). */
export function capitalizeFirst(value: string): string {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1)
}
