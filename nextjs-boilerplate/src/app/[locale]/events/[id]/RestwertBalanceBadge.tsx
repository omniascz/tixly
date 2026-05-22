'use client';

import { useEffect, useState } from 'react';

interface BalanceResponse {
  promoterId: string;
  balanceHalire: number;
  holdersWithCredit: number;
}

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
  return fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'x-user-id': userId } : {}),
    },
  });
}

const STRINGS = {
  cs: {
    available: (kc: string) => `Máš ${kc} Kč kredit (Restwert) u tohoto pořadatele`,
    hint: 'Uplatníš ho při placení vstupenky',
  },
  sk: {
    available: (kc: string) => `Máš ${kc} Kč kredit (Restwert) u tohto usporiadateľa`,
    hint: 'Uplatníš ho pri platbe vstupenky',
  },
  en: {
    available: (kc: string) => `You have ${kc} CZK Restwert credit with this promoter`,
    hint: 'Apply it at checkout',
  },
} as const;

export function RestwertBalanceBadge({
  promoterId,
  locale,
}: {
  promoterId: string;
  locale: 'cs' | 'sk' | 'en';
}): JSX.Element | null {
  const [balance, setBalance] = useState<number>(0);
  const t = STRINGS[locale] ?? STRINGS.cs;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch(`/api/buyer/restwert-balance?promoterId=${promoterId}`);
        if (!r.ok) return;
        const data = (await r.json()) as BalanceResponse;
        if (!cancelled) setBalance(data.balanceHalire);
      } catch {
        /* anonymní user — skip */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [promoterId]);

  if (balance <= 0) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
      data-testid="restwert-balance-badge"
    >
      <span className="text-lg" aria-hidden>
        💰
      </span>
      <div>
        <div className="font-medium">
          {t.available((balance / 100).toLocaleString('cs-CZ'))}
        </div>
        <div className="text-xs text-amber-800/80">{t.hint}</div>
      </div>
    </div>
  );
}
