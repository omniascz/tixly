'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Push notification subscribe/unsubscribe UI.
 *
 * Vyžaduje:
 *   - NEXT_PUBLIC_VAPID_PUBLIC_KEY env (base64url-encoded P-256 public key)
 *   - service worker /sw.js (Tixly už má offline-first SW s push handlerem)
 *   - HTTPS nebo localhost (Notifications API)
 *
 * Backend: POST /api/buyer/push/subscribe — vyžaduje x-user-id (přihlášený user).
 * Bez VAPID env button se nezobrazuje.
 */

type SubscribeState = 'unsupported' | 'not_subscribed' | 'subscribed' | 'permission_denied';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export function PushSubscribeButton() {
  const [state, setState] = useState<SubscribeState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  useEffect(() => {
    void checkState();
    async function checkState(): Promise<void> {
      if (
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      ) {
        setState('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        setState('permission_denied');
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'subscribed' : 'not_subscribed');
    }
  }, []);

  if (!vapidKey) {
    return (
      <p className="text-xs text-muted-foreground">
        Push notifikace nejsou nakonfigurované (chybí NEXT_PUBLIC_VAPID_PUBLIC_KEY).
      </p>
    );
  }

  if (state === 'loading') {
    return <p className="text-xs text-muted-foreground">Načítání…</p>;
  }

  if (state === 'unsupported') {
    return (
      <p className="text-xs text-muted-foreground">
        Tvůj prohlížeč push notifikace nepodporuje.
      </p>
    );
  }

  if (state === 'permission_denied') {
    return (
      <p className="text-xs text-amber-700">
        Notifikace zablokované. Povol je v nastavení prohlížeče (zámek u adresy).
      </p>
    );
  }

  async function subscribe(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey!),
      });
      const json = sub.toJSON();
      const res = await authFetch('/api/buyer/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: {
            p256dh: json.keys?.p256dh,
            auth: json.keys?.auth,
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        await sub.unsubscribe();
        return;
      }
      setState('subscribed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        setState('not_subscribed');
        return;
      }
      const endpoint = sub.endpoint;
      await sub.unsubscribe();
      await authFetch('/api/buyer/push/subscribe', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      });
      setState('not_subscribed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {state === 'subscribed' ? (
        <>
          <p className="text-xs text-emerald-700">✓ Push notifikace aktivní.</p>
          <Button size="sm" variant="outline" onClick={unsubscribe} disabled={busy}>
            {busy ? 'Odhlašuji…' : 'Vypnout push notifikace'}
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={subscribe} disabled={busy}>
          {busy ? 'Aktivuji…' : '🔔 Zapnout push notifikace'}
        </Button>
      )}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
