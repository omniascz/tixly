// ── Locale configuration ──────────────────────────────────────────────────
//
// LOCALES — všechny locales SCHEMA (dictionaries, types, validation). Zachováno
//           pro budoucí rozšíření; middleware tyto akceptuje jako URL prefix.
// LOCALES_ACTIVE — locales, které jsou produkčně **plně přeloženy a publikované**:
//           sitemap je publikuje, language switcher je nabízí, OG meta tags
//           obsahují jen aktivní alternates. Default sub-set pro CZ provoz je `['cs']`.
//
// Až budou EN/DE/PL přeložené (locale dictionary keys vyplněné + UI stránky
// používají `getDict(locale)`), přidej je do LOCALES_ACTIVE.

export const LOCALES = ['cs', 'en', 'de', 'fr', 'nl', 'es', 'pl', 'sk'] as const
export const LOCALES_ACTIVE = ['cs', 'en', 'sk'] as const
export type Locale = (typeof LOCALES)[number]
export type ActiveLocale = (typeof LOCALES_ACTIVE)[number]
export const DEFAULT_LOCALE: Locale = 'cs'
export const LOCALE_COOKIE = 'NEXT_LOCALE'

export const LOCALE_NAMES: Record<Locale, string> = {
  cs: 'Čeština',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  nl: 'Nederlands',
  es: 'Español',
  pl: 'Polski',
  sk: 'Slovenčina',
}

export function isActiveLocale(value: string): value is ActiveLocale {
  return (LOCALES_ACTIVE as readonly string[]).includes(value)
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function isValidLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * Detects preferred locale.
 * Priority: saved cookie → Accept-Language header → default ('cs')
 */
export function detectLocale(
  acceptLanguage: string | null,
  cookieLocale: string | null,
): Locale {
  // 1. Saved preference
  if (cookieLocale && isValidLocale(cookieLocale)) return cookieLocale

  // 2. Accept-Language header (e.g. "en-GB,en;q=0.9,cs;q=0.8")
  if (acceptLanguage) {
    const preferred = acceptLanguage
      .split(',')
      .map((part) => {
        const [tag, q] = part.trim().split(';q=')
        return {
          lang: tag.split('-')[0].toLowerCase(),
          q: q !== undefined ? parseFloat(q) : 1.0,
        }
      })
      .sort((a, b) => b.q - a.q)
      .map(({ lang }) => lang)

    for (const lang of preferred) {
      if (isValidLocale(lang)) return lang
    }
  }

  // 3. Fallback
  return DEFAULT_LOCALE
}

/**
 * Returns the locale prefix from a pathname, or null if none.
 * '/cs/akce/abc' → 'cs'
 * '/akce/abc'    → null
 */
export function getPathnameLocale(pathname: string): Locale | null {
  const first = pathname.split('/')[1] ?? ''
  return isValidLocale(first) ? first : null
}

/**
 * Strips the locale prefix from a pathname.
 * '/cs/akce/abc' → '/akce/abc'
 * '/akce/abc'    → '/akce/abc'  (unchanged — no prefix)
 */
export function pathnameWithoutLocale(pathname: string): string {
  const locale = getPathnameLocale(pathname)
  if (!locale) return pathname
  const stripped = pathname.slice(`/${locale}`.length)
  return stripped === '' ? '/' : stripped
}
