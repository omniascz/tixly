'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MockWeroPage() {
  const params = useParams();
  const router = useRouter();
  const paymentId = String(params.paymentId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function action(act: 'pay' | 'reject') {
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch(`/api/mock-wero/${paymentId}`, {
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
            <span className="rounded-md bg-blue-600 px-2 py-1 text-xs font-bold uppercase text-white">
              Wero
            </span>
            Mock platební brána
          </CardTitle>
          <CardDescription>
            Wero — European A2A (account-to-account) platba. SEPA Instant.
            V demo režimu klikni "Zaplatit" pro instant settlement.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <p>
              <strong>Payment ID:</strong> <code>{paymentId}</code>
            </p>
            <p className="mt-1">
              V produkci by zde byl QR kód pro tvoji bankovní app (Air Bank, ČSOB,
              KB, Raiffeisen) a kupec by potvrdil převod přímo v ní.
            </p>
          </div>

          {result && <p className="text-sm">{result}</p>}

          <div className="flex gap-2">
            <Button onClick={() => action('pay')} disabled={loading} className="flex-1">
              {loading ? 'Posílám…' : 'Zaplatit přes Wero'}
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
