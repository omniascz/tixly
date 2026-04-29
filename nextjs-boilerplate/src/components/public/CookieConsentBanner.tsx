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

export function CookieConsentBanner() {
  const [stored, setStored] = useState<ConsentValue | null>(null);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    setStored(readStored());
  }, []);

  if (stored !== null) return null;

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
          <h2 className="text-sm font-semibold">Tixly používá cookies</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nezbytné cookies vyžadujeme pro fungování (přihlášení, košík). Analytické
            a marketingové cookies pomáhají vylepšit službu — můžeš je odmítnout.
          </p>

          {showCustom ? (
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked disabled />
                <span>
                  <strong>Nezbytné</strong> · vždy zapnuto (auth, košík)
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                />
                <span>
                  <strong>Analytika</strong> · GA4, agregované metriky
                </span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                />
                <span>
                  <strong>Marketing</strong> · Meta pixel, retargeting
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
            Vlastní volba
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => decide({ analytics: false, marketing: false })}
          className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
        >
          Jen nezbytné
        </button>
        {showCustom ? (
          <button
            type="button"
            onClick={() => decide({ analytics, marketing })}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Uložit volbu
          </button>
        ) : (
          <button
            type="button"
            onClick={() => decide({ analytics: true, marketing: true })}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Přijmout vše
          </button>
        )}
      </div>
    </div>
  );
}
