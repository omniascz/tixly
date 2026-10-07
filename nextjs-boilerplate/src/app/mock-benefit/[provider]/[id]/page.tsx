'use client';

import { useState, type JSX } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

/**
 * Mock vendor portal pro benefit payment providery.
 *
 * Buyer je sem přesměrován po checkoutu s benefitní metodou (Pluxee/Sodexo/
 * Benefit Plus/Gallery Beta/Edenred). Stránka simuluje vendor UI a buttonem
 * triggeruje callback API, který označí order jako paid a vystaví tickety.
 *
 * V produkci tato stránka neexistuje — real vendor portal je na vendor doméně
 * a callback jde přímo z jejich serverů.
 */

const PROVIDER_INFO: Record<
  string,
  { name: string; color: string; emoji: string; description: string }
> = {
  pluxee: {
    name: 'Pluxee (Sodexo)',
    color: 'bg-red-600',
    emoji: '🍽️',
    description: 'Stravenková a benefitní karta',
  },
  sodexo: {
    name: 'Sodexo',
    color: 'bg-red-600',
    emoji: '🍽️',
    description: 'Sodexo Benefits (přes Pluxee infrastrukturu)',
  },
  benefit_plus: {
    name: 'Benefit Plus',
    color: 'bg-orange-600',
    emoji: '🎁',
    description: 'Cafeterie zaměstnaneckých benefitů',
  },
  gallery_beta: {
    name: 'Gallery Beta',
    color: 'bg-purple-600',
    emoji: '🎨',
    description: 'Kulturní benefity od zaměstnavatele',
  },
  edenred: {
    name: 'Edenred',
    color: 'bg-blue-600',
    emoji: '🎫',
    description: 'Ticket Restaurant + benefitní karty',
  },
  multisport: {
    name: 'Multisport',
    color: 'bg-green-600',
    emoji: '🏊',
    description: 'Multisport Kultura — kulturní a divadelní vstupenky',
  },
};

export default function MockBenefitPage(): JSX.Element {
  const params = useParams<{ provider: string; id: string }>();
  const router = useRouter();
  const provider = params.provider.toLowerCase();
  const externalId = params.id;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'paid' | 'cancelled' | null>(null);

  const info = PROVIDER_INFO[provider] ?? {
    name: provider,
    color: 'bg-slate-600',
    emoji: '💳',
    description: 'Benefit payment provider',
  };

  async function complete(success: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const callbackProvider = provider === 'sodexo' ? 'pluxee' : provider;
      const res = await fetch('/api/payments/benefit/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: callbackProvider,
          externalId,
          success,
          payload: { source: 'mock', uiTimestamp: new Date().toISOString() },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        orderId?: string;
        status?: string;
        error?: string;
      };
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(success ? 'paid' : 'cancelled');
      if (success && j.orderId) {
        // Mírné zpoždění na ticket issuing (fire-and-forget v callbacku)
        setTimeout(() => {
          router.push(`/cs/order-confirmation/${j.orderId}`);
        }, 1500);
      } else if (!success) {
        setTimeout(() => router.push('/cs/events'), 1500);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card className="overflow-hidden">
        <div
          className={`${info.color} px-6 py-4 text-center text-white`}
          data-testid="benefit-vendor-header"
        >
          <div className="text-3xl">{info.emoji}</div>
          <div className="mt-1 text-lg font-semibold">{info.name}</div>
          <div className="text-xs opacity-80">{info.description}</div>
        </div>
        <CardHeader>
          <CardTitle>Mock benefit brána</CardTitle>
          <CardDescription>
            Lokální simulace platby benefitní kartou. V produkci jdeš na skutečný portal
            vendora (např. <code>portal.pluxee.cz</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Payment ID: <code data-testid="benefit-external-id">{externalId}</code>
          </p>

          {done === 'paid' ? (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              ✅ Zaplaceno benefitní kartou. Přesměrovávám…
            </div>
          ) : done === 'cancelled' ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
              ❌ Platba zrušena. Přesměrovávám…
            </div>
          ) : (
            <>
              {error ? (
                <p className="text-sm text-destructive" data-testid="benefit-error">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button
                  onClick={() => void complete(true)}
                  disabled={busy}
                  className="flex-1"
                  data-testid="benefit-pay"
                >
                  {busy ? '…' : 'Zaplatit'}
                </Button>
                <Button
                  onClick={() => void complete(false)}
                  disabled={busy}
                  variant="outline"
                  className="flex-1"
                  data-testid="benefit-cancel"
                >
                  Zrušit
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
