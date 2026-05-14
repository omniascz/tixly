'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Transaction {
  id: string;
  points_delta: number;
  kind: string;
  reason: string | null;
  order_id: string | null;
  created_at: string;
  expires_at: string | null;
}

interface LoyaltyData {
  pointsBalance: number;
  lifetimePoints: number;
  tier: 'bronze' | 'silver' | 'gold';
  nextTier: 'silver' | 'gold' | null;
  pointsToNextTier: number;
  transactions: Transaction[];
}

const TIER_COLORS: Record<string, string> = {
  bronze: 'bg-orange-100 text-orange-900 border-orange-300',
  silver: 'bg-slate-100 text-slate-900 border-slate-300',
  gold: 'bg-amber-100 text-amber-900 border-amber-300',
};

const TIER_LABELS: Record<string, string> = {
  bronze: '🥉 Bronze',
  silver: '🥈 Silver',
  gold: '🥇 Gold',
};

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

export function LoyaltyClient({ locale }: { locale: string }) {
  const [data, setData] = useState<LoyaltyData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await authFetch('/api/buyer/loyalty');
        if (res.status === 401) {
          setError('Pro zobrazení musíš být přihlášený.');
          return;
        }
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as LoyaltyData);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, []);

  if (error) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
        <div className="mt-2">
          <Link href={`/${locale}/login`} className="text-primary hover:underline">
            Přihlásit se →
          </Link>
        </div>
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání…</p>;
  }

  const progressPct =
    data.nextTier && data.pointsToNextTier > 0
      ? Math.min(
          100,
          Math.round(
            ((data.lifetimePoints) / (data.lifetimePoints + data.pointsToNextTier)) * 100,
          ),
        )
      : 100;

  return (
    <div className="space-y-6">
      {/* Balance + tier card */}
      <div className={`rounded-lg border-2 p-6 ${TIER_COLORS[data.tier]}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Tvůj zůstatek</div>
            <div className="mt-1 text-4xl font-bold tabular-nums">{data.pointsBalance} b.</div>
            <div className="mt-1 text-sm">
              ≈ {data.pointsBalance} Kč sleva na další nákup
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide opacity-70">Úroveň</div>
            <div className="mt-1 text-lg font-semibold">{TIER_LABELS[data.tier]}</div>
            <div className="text-xs opacity-70">Lifetime {data.lifetimePoints} b.</div>
          </div>
        </div>

        {data.nextTier ? (
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span>Do {TIER_LABELS[data.nextTier]} chybí</span>
              <span className="font-semibold">{data.pointsToNextTier} b.</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-white/60">
              <div
                className="h-full bg-emerald-500 transition-[width] duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 text-xs">
            Jsi na nejvyšší úrovni. Děkujeme za loajalitu! 🎉
          </div>
        )}
      </div>

      {/* Tier benefits */}
      <div className="rounded-md border bg-card p-4 text-sm">
        <h2 className="mb-3 font-semibold">Bonusy podle úrovně</h2>
        <ul className="space-y-1 text-xs">
          <li>🥉 <strong>Bronze</strong> (0+ b.): 1 bod / 10 Kč nákupu</li>
          <li>🥈 <strong>Silver</strong> (500+ b.): 1.1× body za nákup</li>
          <li>🥇 <strong>Gold</strong> (2000+ b.): 1.25× body za nákup</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Body expirují 24 měsíců od získání. V čekoutu lze uplatnit max 50 % z hodnoty objednávky.
        </p>
      </div>

      {/* Transaction history */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
          Historie ({data.transactions.length})
        </h2>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ještě žádné transakce.</p>
        ) : (
          <ul className="space-y-2">
            {data.transactions.map((tx) => (
              <li
                key={tx.id}
                className="flex items-center justify-between gap-3 rounded-md border bg-card p-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{tx.reason ?? tx.kind}</div>
                  <div className="text-muted-foreground">
                    {new Date(tx.created_at).toLocaleString('cs-CZ', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {tx.expires_at && tx.points_delta > 0 ? (
                      <span className="ml-2">
                        · expiruje{' '}
                        {new Date(tx.expires_at).toLocaleDateString('cs-CZ')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div
                  className={`font-mono text-sm font-semibold tabular-nums ${
                    tx.points_delta > 0 ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {tx.points_delta > 0 ? '+' : ''}
                  {tx.points_delta}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
