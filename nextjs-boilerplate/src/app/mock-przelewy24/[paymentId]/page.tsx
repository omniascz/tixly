'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function MockPrzelewy24Page() {
  const params = useParams();
  const router = useRouter();
  const paymentId = String(params.paymentId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function action(act: 'pay' | 'reject') {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/mock-przelewy24/${paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      });
      const d = await r.json();
      if (!r.ok) {
        setResult(`Chyba: ${d.error ?? r.status}`);
        return;
      }
      if (d.status === 'paid') {
        router.push(`/cs/order-confirmation/${d.orderId}`);
      } else {
        setResult(`Stav: ${d.status}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="rounded-md bg-orange-500 px-2 py-1 text-xs font-bold uppercase text-white">
              Przelewy24
            </span>
            Mock platební brána
          </CardTitle>
          <CardDescription>
            Polský platební gateway. V produkci redirect na bankovní volbu nebo
            BLIK kód.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <p>
              <strong>Payment ID:</strong> <code>{paymentId}</code>
            </p>
            <p className="mt-1">
              V produkci by zde byla volba: BLIK (rychlý kód z mobile bankingu),
              přímý převod ze 100+ polských bank, karta.
            </p>
          </div>

          {result && <p className="text-sm">{result}</p>}

          <div className="flex gap-2">
            <Button onClick={() => action('pay')} disabled={loading} className="flex-1">
              {loading ? 'Posílám…' : 'Zaplatit přes Przelewy24'}
            </Button>
            <Button
              variant="outline"
              onClick={() => action('reject')}
              disabled={loading}
            >
              Odmítnout
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
