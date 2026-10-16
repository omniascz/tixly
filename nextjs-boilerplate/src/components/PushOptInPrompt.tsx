'use client';

import { useEffect, useState, type JSX } from 'react';

/**
 * Push notification opt-in prompt.
 *
 * Strategy:
 *   1. Mount → fetch VAPID public key. Pokud { configured: false }, render null.
 *   2. Pokud serviceWorker není registered, render null.
 *   3. Pokud Notification.permission === 'denied' nebo už 'granted',
 *      render null.
 *   4. Pokud user dismissed v posledních 14 dnech, render null.
 *   5. Jinak zobraz banner. Klik "Povolit" → requestPermission → subscribe →
 *      POST /api/buyer/push/subscribe. Klik "Zatím ne" → dismiss localStorage.
 *
 * Zobrazí se 8s po načtení (ne immediately — buyer se nejdřív rozkouká).
 */

const DISMISS_KEY = 'tixly.push-dismissed-at';
const DISMISS_DAYS = 14;

interface VapidResponse {
  configured: boolean;
  publicKey?: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const b64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function shouldShow(): boolean {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator)) return false;
  if (!('Notification' in window)) return false;
  // Už granted (subscriber existuje) nebo denied — žádné UI
  if (Notification.permission === 'denied') return false;
  if (Notification.permission === 'granted') return false;
  const dismissedAt = localStorage.getItem(DISMISS_KEY);
  if (!dismissedAt) return true;
  return Date.now() - Number(dismissedAt) > DISMISS_DAYS * 24 * 3600 * 1000;
}

function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('userId');
}

async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = localStorage.getItem('accessToken');
  const userId = localStorage.getItem('userId');
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function PushOptInPrompt(): JSX.Element | null {
  const [show, setShow] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shouldShow() || !isLoggedIn()) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const r = await fetch('/api/public/push/vapid-key');
        if (!r.ok) return;
        const data = (await r.json()) as VapidResponse;
        if (!data.configured || !data.publicKey) return;
        if (cancelled) return;
        setPublicKey(data.publicKey);
        setShow(true);
      } catch {
        /* skip */
      }
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  function dismiss(): void {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  async function handleEnable(): Promise<void> {
    if (!publicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        dismiss();
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // DOM types v Node 24 mají ArrayBufferView<ArrayBuffer> strict;
        // BufferSource cast je safe — Uint8Array je validní BufferSource.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const json = subscription.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
        setError('Subscription JSON neúplný');
        return;
      }

      const post = await authFetch('/api/buyer/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      });
      if (!post.ok) {
        setError(`Server odmítl: ${post.status}`);
        return;
      }
      setShow(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Push subscribe selhal');
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-40 mx-auto max-w-md rounded-lg border bg-card p-4 shadow-lg"
      data-testid="push-optin-prompt"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          🔔
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-medium">Upozornění od Tixly</p>
          <p className="text-xs text-muted-foreground">
            Připomeneme ti akce, na které jdeš, a upozorníme když přítel
            někam jde. Můžeš kdykoliv vypnout.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Zavřít"
        >
          ×
        </button>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-rose-700" data-testid="push-error">
          {error}
        </p>
      ) : null}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50"
        >
          Zatím ne
        </button>
        <button
          type="button"
          onClick={() => void handleEnable()}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          data-testid="push-optin-accept"
        >
          {busy ? '…' : 'Povolit'}
        </button>
      </div>
    </div>
  );
}
