import { describe, it, expect } from 'vitest'
import {
  isValidLocale,
  detectLocale,
  getPathnameLocale,
  pathnameWithoutLocale,
  DEFAULT_LOCALE,
} from './i18n'

describe('isValidLocale', () => {
  it('returns true for cs', () => expect(isValidLocale('cs')).toBe(true))
  it('returns true for en', () => expect(isValidLocale('en')).toBe(true))
  it('returns true for de', () => expect(isValidLocale('de')).toBe(true))
  it('returns false for unsupported zz', () => expect(isValidLocale('zz')).toBe(false))
  it('returns false for empty string', () => expect(isValidLocale('')).toBe(false))
  it('returns false for CS (uppercase)', () => expect(isValidLocale('CS')).toBe(false))
})

describe('detectLocale', () => {
  it('returns cookie locale when valid', () => {
    expect(detectLocale('en,de', 'cs')).toBe('cs')
  })

  it('ignores invalid cookie locale, falls through to Accept-Language', () => {
    expect(detectLocale('en-GB,en;q=0.9', 'xx')).toBe('en')
  })

  it('parses Accept-Language with quality values', () => {
    expect(detectLocale('zz;q=0.9,cs;q=0.8', null)).toBe('cs')
  })

  it('picks highest-q supported locale', () => {
    expect(detectLocale('en;q=1.0,cs;q=0.5', null)).toBe('en')
  })

  it('ignores unsupported locales in Accept-Language', () => {
    expect(detectLocale('zz,xx;q=0.9,cs;q=0.5', null)).toBe('cs')
  })

  it('returns default locale when no match found', () => {
    expect(detectLocale('zz,xx,ja', null)).toBe(DEFAULT_LOCALE)
  })

  it('returns default locale when both inputs are null', () => {
    expect(detectLocale(null, null)).toBe(DEFAULT_LOCALE)
  })

  it('handles Accept-Language with region subtag (en-GB → en)', () => {
    expect(detectLocale('en-GB', null)).toBe('en')
  })

  it('handles cs-CZ subtag correctly', () => {
    expect(detectLocale('cs-CZ,cs;q=0.9', null)).toBe('cs')
  })
})

describe('getPathnameLocale', () => {
  it('extracts cs from /cs/akce/festival', () => {
    expect(getPathnameLocale('/cs/akce/festival')).toBe('cs')
  })

  it('extracts en from /en/events/festival', () => {
    expect(getPathnameLocale('/en/events/festival')).toBe('en')
  })

  it('returns null when no locale prefix', () => {
    expect(getPathnameLocale('/akce/festival')).toBeNull()
  })

  it('returns null for unsupported locale prefix', () => {
    expect(getPathnameLocale('/zz/events')).toBeNull()
  })

  it('handles root path /', () => {
    expect(getPathnameLocale('/')).toBeNull()
  })

  it('handles locale-only path /cs', () => {
    expect(getPathnameLocale('/cs')).toBe('cs')
  })

  it('handles locale-only path /en/', () => {
    expect(getPathnameLocale('/en/')).toBe('en')
  })
})

describe('pathnameWithoutLocale', () => {
  it('strips /cs prefix', () => {
    expect(pathnameWithoutLocale('/cs/akce/festival')).toBe('/akce/festival')
  })

  it('strips /en prefix', () => {
    expect(pathnameWithoutLocale('/en/events/festival')).toBe('/events/festival')
  })

  it('returns unchanged path when no locale prefix', () => {
    expect(pathnameWithoutLocale('/akce/festival')).toBe('/akce/festival')
  })

  it('returns / when path is just /cs', () => {
    expect(pathnameWithoutLocale('/cs')).toBe('/')
  })

  it('returns / when path is /en/', () => {
    expect(pathnameWithoutLocale('/en/')).toBe('/')
  })

  it('preserves query strings (path only)', () => {
    expect(pathnameWithoutLocale('/cs/akce?page=2')).toBe('/akce?page=2')
  })
})
