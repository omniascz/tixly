'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LOCALES_ACTIVE, LOCALE_NAMES, LOCALE_COOKIE, isRtlLocale, type ActiveLocale } from '@/lib/i18n';

const FLAGS: Record<string, string> = {
  cs: '🇨🇿',
  en: '🇬🇧',
  sk: '🇸🇰',
  de: '🇩🇪',
  fr: '🇫🇷',
  nl: '🇳🇱',
  es: '🇪🇸',
  pl: '🇵🇱',
  pt: '🇵🇹',
  it: '🇮🇹',
  sv: '🇸🇪',
  da: '🇩🇰',
  hu: '🇭🇺',
  ar: '🇸🇦',
  he: '🇮🇱',
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(target: ActiveLocale): void {
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;

    const segments = pathname.split('/');
    const currentPrefix = segments[1];
    const isLocalePrefix = (LOCALES_ACTIVE as readonly string[]).includes(currentPrefix ?? '');
    if (isLocalePrefix) {
      segments[1] = target;
    } else {
      segments.splice(1, 0, target);
    }
    router.push(segments.join('/') || '/');
  }

  if (LOCALES_ACTIVE.length <= 1) return null;

  return (
    <div className="relative flex items-center text-xs">
      <select
        onChange={(e) => switchTo(e.target.value as ActiveLocale)}
        className="rounded border bg-transparent px-2 py-1 text-xs hover:bg-muted cursor-pointer"
        defaultValue=""
        aria-label="Language"
      >
        <option value="" disabled>🌐 Lang</option>
        {LOCALES_ACTIVE.map((l) => (
          <option key={l} value={l} dir={isRtlLocale(l) ? 'rtl' : 'ltr'}>
            {FLAGS[l]} {LOCALE_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
