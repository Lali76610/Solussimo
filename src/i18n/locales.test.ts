import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'

type Tree = { [k: string]: string | Tree }
function keys(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [prefix + k] : keys(v, `${prefix}${k}.`))).sort()
}
function placeholders(tree: Tree, prefix = ''): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(tree).flatMap(([k, v]) =>
      typeof v === 'string'
        ? [[prefix + k, [...v.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort()]]
        : Object.entries(placeholders(v, `${prefix}${k}.`)),
    ),
  )
}

const reference = keys(fr as Tree)

describe('i18n FR / EN / ES / DE', () => {
  it.each([['en', en], ['es', es], ['de', de]])('%s contient exactement les mêmes clés que fr', (_, locale) => {
    expect(keys(locale as Tree)).toEqual(reference)
  })
  it.each([['en', en], ['es', es], ['de', de]])('%s conserve les mêmes variables {{…}}', (_, locale) => {
    expect(placeholders(locale as Tree)).toEqual(placeholders(fr as Tree))
  })
  it('aucune traduction vide', () => {
    for (const locale of [fr, en, es, de]) {
      const empty = Object.entries(placeholders(locale as Tree)).filter(([k]) => {
        const v = k.split('.').reduce<unknown>((o, p) => (o as Tree)[p], locale)
        return typeof v === 'string' && v.trim() === ''
      })
      expect(empty).toEqual([])
    }
  })
})
