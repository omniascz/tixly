'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';

export default function MockSubscriptionPaymentPage({
  params,
}: {
  params: { paymentId: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    holderId: string;
    ticketsIssued?: number;
    totalEvents?: number;
  } | null>(null);

  async function handleAction(action: 'pay' | 'cancel') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/subscriptions/holders/${params.paymentId}/confirm`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `${res.status}`);
        return;
      }
      const data = await res.json();
      if (action === 'cancel') {
        router.push('/cs/events');
      } else {
        setResult(data);
      }
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div className="mx-auto mt-12 max-w-md px-4">
        <Card>
          <CardHeader>
            <CardTitle>✅ Abonentka aktivní</CardTitle>
            <CardDescription>
              Platba úspěšná. Lístky pro {result.ticketsIssued} z{' '}
              {result.totalEvents} představení vystaveny.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Holder ID: <code>{result.holderId}</code>
            </p>
            <p className="text-sm">
              Lístky najdeš v sekci Moje vstupenky. Při vstupu skener detekuje
              abonentku a označí přítomnost.
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
      <Card>
        <CardHeader>
          <CardTitle>Mock platba — Abonentka</CardTitle>
          <CardDescription>
            Lokální simulace platby za abonentku. V produkci by jsi byl na
            skutečné GoPay/ComGate bráně.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Payment ID: <code>{params.paymentId}</code>
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button
              onClick={() => handleAction('pay')}
              disabled={loading}
              className="flex-1"
            >
              {loading ? '...' : 'Zaplatit a aktivovat'}
            </Button>
            <Button
              onClick={() => handleAction('cancel')}
              disabled={loading}
              variant="outline"
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
