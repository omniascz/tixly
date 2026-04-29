import type { Locale, TranslationKey, InterpolationParams } from '../lib/types.js';
import { safeInterpolate } from '../lib/interpolation.js';
import { cs } from '../locales/cs.js';
import { en } from '../locales/en.js';
import { sk } from '../locales/sk.js';
import { de } from '../locales/de.js';

const localeMap: Record<Locale, Record<string, string>> = { cs, en, sk, de };

/**
 * Looks up a raw (un-interpolated) string for a key in the given locale.
 * Returns undefined if not found.
 */
function lookup(key: string, locale: Locale): string | undefined {
  return localeMap[locale]?.[key];
}

/**
 * Translates a known TranslationKey into the target locale, with optional interpolation.
 * Throws if the key is not found in the locale.
 */
export function translate(
  key: TranslationKey,
  locale: Locale,
  params?: InterpolationParams,
): string {
  const raw = lookup(key, locale);
  if (raw === undefined) {
    throw new Error(`Translation key "${key}" not found for locale "${locale}"`);
  }
  return safeInterpolate(raw, params);
}

/**
 * Translates any string key with fallback:
 * 1. Try target locale
 * 2. Fallback to 'cs' (primary)
 * 3. If still not found, return the key itself
 */
export function translateWithFallback(
  key: string,
  locale: Locale,
  params?: InterpolationParams,
): string {
  const raw = lookup(key, locale) ?? lookup(key, 'cs') ?? key;
  return safeInterpolate(raw, params);
}

/**
 * Creates a translator instance bound to a specific locale.
 */
export function createTranslator(locale: Locale): {
  t(key: TranslationKey, params?: InterpolationParams): string;
  tSafe(key: string, params?: InterpolationParams): string;
  locale: Locale;
} {
  return {
    locale,
    t(key: TranslationKey, params?: InterpolationParams): string {
      return translate(key, locale, params);
    },
    tSafe(key: string, params?: InterpolationParams): string {
      return translateWithFallback(key, locale, params);
    },
  };
}
