'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tixly.cookie-consent';
const COOKIE_NAME = 'tixly_cookie_consent';

interface ConsentValue {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
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
  document.cookie = `${COOKIE_NAME}=${encodeURIComponent(
    JSON.stringify(value),
  )}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.dispatchEvent(new CustomEvent('tixly:consent-changed', { detail: value }));
}

function logToServer(value: ConsentValue, source: 'settings-page' | 'reset') {
  void fetch('/api/consent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      essential: value.essential,
      analytics: value.analytics,
      marketing: value.marketing,
      source,
    }),
  }).catch(() => {
    // Network error — UX nesahá, audit log je best-effort
  });
}

const STRINGS = {
  cs: {
    essential: 'Nezbytné cookies',
    essentialNote: 'Vždy zapnuto — auth, košík, CSRF tokens.',
    analytics: 'Analytické cookies',
    analyticsNote: 'GA4, agregované metriky bez identifikace uživatele.',
    marketing: 'Marketingové cookies',
    marketingNote: 'Meta Pixel, retargeting kampaní.',
    save: 'Uložit změny',
    reset: 'Odvolat veškerý souhlas',
    saved: 'Volba uložena.',
    lastDecided: 'Naposledy upraveno',
  },
  sk: {
    essential: 'Nevyhnutné cookies',
    essentialNote: 'Vždy zapnuté — auth, košík, CSRF tokeny.',
    analytics: 'Analytické cookies',
    analyticsNote: 'GA4, agregované metriky bez identifikácie užívateľa.',
    marketing: 'Marketingové cookies',
    marketingNote: 'Meta Pixel, retargeting kampaní.',
    save: 'Uložiť zmeny',
    reset: 'Odvolať všetok súhlas',
    saved: 'Voľba uložená.',
    lastDecided: 'Naposledy upravené',
  },
  en: {
    essential: 'Essential cookies',
    essentialNote: 'Always on — auth, cart, CSRF tokens.',
    analytics: 'Analytics cookies',
    analyticsNote: 'GA4, aggregated metrics without user identification.',
    marketing: 'Marketing cookies',
    marketingNote: 'Meta Pixel, retargeting campaigns.',
    save: 'Save changes',
    reset: 'Withdraw all consent',
    saved: 'Choice saved.',
    lastDecided: 'Last updated',
  },
} as const;

export function CookieSettingsClient({ locale }: { locale: 'cs' | 'sk' | 'en' }) {
  const t = STRINGS[locale] ?? STRINGS.cs;
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [stored, setStored] = useState<ConsentValue | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    const s = readStored();
    if (s) {
      setStored(s);
      setAnalytics(s.analytics);
      setMarketing(s.marketing);
    }
  }, []);

  function save(source: 'settings-page' | 'reset') {
    const value: ConsentValue = {
      essential: true,
      analytics: source === 'reset' ? false : analytics,
      marketing: source === 'reset' ? false : marketing,
      decidedAt: new Date().toISOString(),
    };
    persist(value);
    logToServer(value, source);
    setStored(value);
    if (source === 'reset') {
      setAnalytics(false);
      setMarketing(false);
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3">
        <input type="checkbox" checked disabled className="mt-1" />
        <span>
          <strong className="text-sm">{t.essential}</strong>
          <p className="text-xs text-muted-foreground">{t.essentialNote}</p>
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={analytics}
          onChange={(e) => setAnalytics(e.target.checked)}
          className="mt-1"
        />
        <span>
          <strong className="text-sm">{t.analytics}</strong>
          <p className="text-xs text-muted-foreground">{t.analyticsNote}</p>
        </span>
      </label>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={marketing}
          onChange={(e) => setMarketing(e.target.checked)}
          className="mt-1"
        />
        <span>
          <strong className="text-sm">{t.marketing}</strong>
          <p className="text-xs text-muted-foreground">{t.marketingNote}</p>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2 pt-2">
        <button
          type="button"
          onClick={() => save('settings-page')}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {t.save}
        </button>
        <button
          type="button"
          onClick={() => save('reset')}
          className="rounded-md border px-4 py-2 text-sm hover:bg-accent"
        >
          {t.reset}
        </button>
        {savedFlash ? (
          <span className="text-xs text-green-700">{t.saved}</span>
        ) : null}
      </div>

      {stored ? (
        <p className="pt-2 text-xs text-muted-foreground">
          {t.lastDecided}: {new Date(stored.decidedAt).toLocaleString(locale)}
        </p>
      ) : null}
    </div>
  );
}
