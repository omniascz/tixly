'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Mock BNPL platba — Twisto / Skip Pay simulátor.
 *
 * Buyer si zvolí počet splátek (3× / 4× / 6×) → "Schválit" → POST
 * /api/mock-bnpl/[provider]/[paymentId]/confirm (action='approve' or 'reject').
 *
 * CZ priority #2 (FR/UK/IT audit, ROI 8/10). V produkci by real Twisto API
 * vrátil schválení po credit check (typicky <5 s).
 */
const PROVIDER_LABELS: Record<string, { name: string; icon: string; color: string }> = {
  twisto: { name: 'Twisto', icon: '⚡', color: 'bg-orange-50 border-orange-200' },
  skippay: { name: 'Skip Pay', icon: '🎯', color: 'bg-emerald-50 border-emerald-200' },
};

export default function MockBnplPage(): JSX.Element {
  const params = useParams<{ provider: string; paymentId: string }>();
  const router = useRouter();
  const provider = PROVIDER_LABELS[params.provider] ?? PROVIDER_LABELS.twisto;
  const [installments, setInstallments] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ orderId: string } | null>(null);

  async function handleAction(action: 'approve' | 'reject'): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/mock-bnpl/${params.provider}/${params.paymentId}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, installments }),
        },
      );
      const body = (await r.json().catch(() => ({}))) as {
        orderId?: string;
        error?: string;
      };
      if (!r.ok) {
        setError(body.error ?? `${r.status}`);
        return;
      }
      if (action === 'reject') {
        router.push('/cs/events');
      } else if (body.orderId) {
        setResult({ orderId: body.orderId });
      }
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4">
        <Card data-testid="bnpl-success">
          <CardHeader>
            <CardTitle>✅ Splátky schváleny</CardTitle>
            <CardDescription>
              {provider.name} ti rozloží platbu na {installments} splátky.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">
              Vstupenka je tvoje, najdeš ji v sekci{' '}
              <strong>Moje vstupenky</strong>. {provider.name} ti pošle email se
              splátkovým kalendářem.
            </p>
            <Button onClick={() => router.push('/cs/my-tickets')} className="w-full">
              Moje vstupenky
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card className={provider.color}>
        <CardHeader>
          <CardTitle>
            <span aria-hidden className="mr-1">
              {provider.icon}
            </span>
            {provider.name} — Splátky
          </CardTitle>
          <CardDescription>
            Mock simulátor BNPL provider. V produkci credit check + KYC.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Payment ID: <code>{params.paymentId}</code>
          </p>

          <div>
            <div className="mb-1 text-sm font-medium">Počet splátek</div>
            <div className="flex gap-2">
              {[3, 4, 6].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setInstallments(n)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm ${
                    installments === n
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-muted/40'
                  }`}
                  data-testid={`bnpl-installments-${n}`}
                >
                  {n}×
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : null}

          <div className="flex gap-2">
            <Button
              onClick={() => void handleAction('approve')}
              disabled={loading}
              className="flex-1"
              data-testid="bnpl-approve"
            >
              {loading ? '…' : 'Schválit'}
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleAction('reject')}
              disabled={loading}
              className="flex-1"
            >
              Zrušit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
