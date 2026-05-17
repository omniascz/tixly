'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tixly.cookie-consent';
const COOKIE_NAME = 'tixly_cookie_consent';

interface ConsentValue {
  essential: true; // vždy true (nezbytné cookies)
  analytics: boolean;
  marketing: boolean;
  decidedAt: string; // ISO date
}

function readStored(): ConsentValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConsentValue) : null;
  } catch {
    return null;
  }
}

function persist(value: ConsentValue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  // Zapis i do cookie (365 dní), aby server-side rendering uměl přečíst
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(value),
  )}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  // Globální event pro analytic loaders, aby reagovali bez page reload
  window.dispatchEvent(new CustomEvent('tixly:consent-changed', { detail: value }));
}

// Locale strings — drží banner-side, abychom nezávisli na server dict.
const STRINGS = {
  cs: {
    title: 'Tixly používá cookies',
    description:
      'Nezbytné cookies vyžadujeme pro fungování (přihlášení, košík). Analytické a marketingové cookies pomáhají vylepšit službu — můžeš je odmítnout.',
    essential: 'Nezbytné',
    essentialNote: 'vždy zapnuto (auth, košík)',
    analyticsLabel: 'Analytika',
    analyticsNote: 'GA4, agregované metriky',
    marketingLabel: 'Marketing',
    marketingNote: 'Meta pixel, retargeting',
    customChoice: 'Vlastní volba',
    essentialOnly: 'Jen nezbytné',
    saveChoice: 'Uložit volbu',
    acceptAll: 'Přijmout vše',
  },
  sk: {
    title: 'Tixly používa cookies',
    description:
      'Nevyhnutné cookies vyžadujeme pre fungovanie (prihlásenie, košík). Analytické a marketingové cookies pomáhajú vylepšiť službu — môžeš ich odmietnuť.',
    essential: 'Nevyhnutné',
    essentialNote: 'vždy zapnuté (auth, košík)',
    analyticsLabel: 'Analytika',
    analyticsNote: 'GA4, agregované metriky',
    marketingLabel: 'Marketing',
    marketingNote: 'Meta pixel, retargeting',
    customChoice: 'Vlastná voľba',
    essentialOnly: 'Iba nevyhnutné',
    saveChoice: 'Uložiť voľbu',
    acceptAll: 'Prijať všetko',
  },
  en: {
    title: 'Tixly uses cookies',
    description:
      'Essential cookies are required for functionality (login, cart). Analytics and marketing cookies help improve the service — you can decline them.',
    essential: 'Essential',
    essentialNote: 'always on (auth, cart)',
    analyticsLabel: 'Analytics',
    analyticsNote: 'GA4, aggregated metrics',
    marketingLabel: 'Marketing',
    marketingNote: 'Meta pixel, retargeting',
    customChoice: 'Customize',
    essentialOnly: 'Essential only',
    saveChoice: 'Save choice',
    acceptAll: 'Accept all',
  },
} as const;

function detectLocale(): keyof typeof STRINGS {
  if (typeof window === 'undefined') return 'cs';
  const path = window.location.pathname;
  if (path.startsWith('/sk')) return 'sk';
  if (path.startsWith('/en')) return 'en';
  return 'cs';
}

export function CookieConsentBanner() {
  const [stored, setStored] = useState<ConsentValue | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [locale, setLocale] = useState<keyof typeof STRINGS>('cs');

  useEffect(() => {
    setStored(readStored());
    setLocale(detectLocale());
  }, []);

  if (stored !== null) return null;
  const t = STRINGS[locale];

  function decide(opts: { analytics: boolean; marketing: boolean }) {
    const value: ConsentValue = {
      essential: true,
      analytics: opts.analytics,
      marketing: opts.marketing,
      decidedAt: new Date().toISOString(),
    };
    persist(value);
    setStored(value);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookies"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-lg border bg-card p-4 shadow-lg sm:inset-x-auto sm:right-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>

          {showCustom ? (
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked disabled />
                <span>
                  <strong>{t.essential}</strong> · {t.essentialNote}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <span>
                  <strong>{t.analyticsLabel}</strong> · {t.analyticsNote}
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>
                  <strong>{t.marketingLabel}</strong> · {t.marketingNote}
                </span>
              </label>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {!showCustom ? (
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
          >
            {t.customChoice}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => decide({ analytics: false, marketing: false })}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
        >
          {t.essentialOnly}
        </button>
        {showCustom ? (
          <button
            type="button"
            onClick={() => decide({ analytics, marketing })}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {t.saveChoice}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => decide({ analytics: true, marketing: true })}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            {t.acceptAll}
          </button>
        )}
      </div>
    </div>
  );
}
