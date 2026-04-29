'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface StatusResponse {
  status: 'waiting' | 'admitted' | 'completed' | 'expired' | 'cancelled';
  position?: number;
  ahead?: number;
  activeBuyers?: number;
  maxConcurrent?: number;
  etaSeconds?: number;
  admittedAt?: string;
  expiresAt?: string;
  message?: string;
}

interface Props {
  eventId: string;
  locale: string;
  initialToken: string | null;
  ticketTypeId: string | null;
}

const POLL_INTERVAL_MS = 3000;

function fingerprint(): string {
  // Lightweight FP — pro produkci by se použila knihovna jako FingerprintJS
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  const screen = typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : '';
  let hash = 0;
  const s = `${ua}|${tz}|${lang}|${screen}`;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return `fp_${Math.abs(hash).toString(36).padStart(10, '0')}`;
}

export function QueueWaiter({ eventId, locale, initialToken, ticketTypeId }: Props) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(initialToken);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (token) return;
    void joinQueue();
    async function joinQueue() {
      try {
        const res = await fetch(`/api/queue/${eventId}/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ fingerprint: fingerprint() }),
        });
        if (!res.ok) {
          setError(`Nelze se připojit do fronty (${res.status})`);
          return;
        }
        const json = (await res.json()) as { queueEnabled: boolean; token: string | null };
        if (!json.queueEnabled || !json.token) {
          setBypassed(true);
          // Skip queue → go directly to checkout
          const ttId = ticketTypeId ?? '';
          router.replace(`/${locale}/checkout?eventId=${eventId}&ticketTypeId=${ttId}`);
          return;
        }
        setToken(json.token);
        const url = new URL(window.location.href);
        url.searchParams.set('token', json.token);
        window.history.replaceState({}, '', url.toString());
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [token, eventId, ticketTypeId, locale, router]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/queue/${eventId}/status/${token}`, {
          credentials: 'include',
        });
        if (!res.ok) {
          setError(`Status check failed (${res.status})`);
          return;
        }
        const json = (await res.json()) as StatusResponse;
        if (cancelled) return;
        setStatus(json);
        if (json.status === 'admitted') {
          // Forward to checkout with queue token
          const ttId = ticketTypeId ?? '';
          router.replace(
            `/${locale}/checkout?eventId=${eventId}&ticketTypeId=${ttId}&queueToken=${token}`,
          );
          return;
        }
        if (json.status !== 'waiting') {
          // expired/cancelled/completed
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch (e) {
        setError((e as Error).message);
      }
    };
    void poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [token, eventId, ticketTypeId, locale, router]);

  if (bypassed) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm">
        Přesměrovávám na pokladnu…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        Chyba: {error}
      </div>
    );
  }
  if (!status) {
    return <div className="text-center text-sm text-muted-foreground">Připojuji do fronty…</div>;
  }
  if (status.status === 'admitted') {
    return (
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-center">
        <div className="text-2xl font-semibold text-emerald-900">Jsi na řadě!</div>
        <p className="mt-2 text-sm text-emerald-800">Přesměrovávám na pokladnu…</p>
      </div>
    );
  }
  if (status.status === 'expired' || status.status === 'cancelled' || status.status === 'completed') {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-center">
        <div className="text-lg font-semibold text-amber-900">
          Token {status.status === 'expired' ? 'vypršel' : 'zrušen'}
        </div>
        <button
          type="button"
          onClick={() => {
            setToken(null);
            setStatus(null);
            setError(null);
          }}
          className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Zkusit znovu
        </button>
      </div>
    );
  }

  const eta = formatEta(status.etaSeconds ?? 0);
  return (
    <div className="space-y-4 rounded-lg border bg-card p-6 text-center shadow-sm">
      <div className="text-xs font-medium uppercase text-muted-foreground">
        Virtuální fronta
      </div>
      <div className="text-5xl font-bold tabular-nums">
        #{status.position ?? '?'}
      </div>
      <div className="text-sm text-muted-foreground">
        {status.ahead ?? 0} {(status.ahead ?? 0) === 1 ? 'člověk přede' : 'lidí před'} tebou
      </div>
      <div className="rounded-md bg-muted/40 p-3 text-xs">
        <div>
          Aktuálně na pokladně:{' '}
          <strong>
            {status.activeBuyers ?? 0} / {status.maxConcurrent ?? '?'}
          </strong>
        </div>
        <div className="mt-1">
          Odhadovaný čas: <strong>{eta}</strong>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Stránku nezavírej — automaticky budeš přesměrován až přijdeš na řadu. Frontu
        opouštíš zavřením této stránky.
      </p>
    </div>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m} min ${s}s`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
