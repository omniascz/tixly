'use client';

import { usePathname, useRouter } from 'next/navigation';
import { LOCALES_ACTIVE, LOCALE_NAMES, LOCALE_COOKIE, type ActiveLocale } from '@/lib/i18n';

const FLAGS: Record<string, string> = {
  cs: '🇨🇿',
  en: '🇬🇧',
  sk: '🇸🇰',
  de: '🇩🇪',
  fr: '🇫🇷',
  nl: '🇳🇱',
  es: '🇪🇸',
  pl: '🇵🇱',
};

export function LanguageSwitcher() {
  const pathname = usePathname();
  const router = useRouter();

  function switchTo(target: ActiveLocale): void {
    // Cookie persistence
    document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;

    // Replace prefix v pathname
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
    <div className="flex items-center gap-1 text-xs">
      {LOCALES_ACTIVE.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          className="rounded px-2 py-1 hover:bg-muted"
          title={LOCALE_NAMES[l]}
        >
          {FLAGS[l]} {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
