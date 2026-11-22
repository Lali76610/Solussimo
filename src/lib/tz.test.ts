import { describe, expect, it } from 'vitest'
import { addDays, dateKeyOf, isoWeekday, localTimestamp, minutesOf, startOfWeek, zonedToUtc } from './tz'

describe('fuseaux horaires de l’établissement', () => {
  it('convertit une heure locale de Paris en UTC (hiver / été)', () => {
    expect(zonedToUtc('2026-12-07', 600, 'Europe/Paris').toISOString()).toBe('2026-12-07T09:00:00.000Z')
    expect(zonedToUtc('2027-03-29', 600, 'Europe/Paris').toISOString()).toBe('2027-03-29T08:00:00.000Z')
  })
  it('gère le jour du changement d’heure (28/03/2027)', () => {
    expect(zonedToUtc('2027-03-28', 60, 'Europe/Paris').toISOString()).toBe('2027-03-28T00:00:00.000Z')
    expect(zonedToUtc('2027-03-28', 240, 'Europe/Paris').toISOString()).toBe('2027-03-28T02:00:00.000Z')
  })
  it('affiche l’heure locale de l’établissement, pas celle de l’appareil', () => {
    const d = new Date('2026-12-13T15:00:00Z')
    expect(minutesOf(d, 'America/New_York')).toBe(600)
    expect(minutesOf(d, 'Europe/Paris')).toBe(960)
    expect(dateKeyOf(new Date('2026-12-07T23:30:00Z'), 'Europe/Paris')).toBe('2026-12-08')
  })
  it('calendrier : jours ISO, semaines, passage de mois', () => {
    expect(isoWeekday('2026-12-07')).toBe(1)
    expect(isoWeekday('2026-12-13')).toBe(7)
    expect(startOfWeek('2026-12-10')).toBe('2026-12-07')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(localTimestamp('2026-12-07', 570)).toBe('2026-12-07T09:30:00')
  })
})
