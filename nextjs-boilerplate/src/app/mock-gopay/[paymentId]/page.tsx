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

export default function MockPaymentPage({
  params,
}: {
  params: { paymentId: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: 'pay' | 'cancel') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mock-gopay/${params.paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `${res.status}`);
        return;
      }
      const data = await res.json();
      if (action === 'pay') {
        router.push(`/cs/order-confirmation/${data.orderId}`);
      } else {
        router.push('/cs/events');
      }
    } catch {
      setError('Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Mock GoPay brána</CardTitle>
          <CardDescription>
            Lokální simulace platby. V produkci jdeš na skutečnou GoPay.
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
              {loading ? '...' : 'Zaplatit'}
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
