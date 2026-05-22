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

export default function MockVoucherPaymentPage({
  params,
}: {
  params: { paymentId: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    voucherCode: string;
    amountHalire: number;
    buyerEmail?: string | null;
  } | null>(null);

  async function handleAction(action: 'pay' | 'cancel') {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/vouchers/holders/${params.paymentId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        voucherCode?: string;
        amountHalire?: number;
        buyerEmail?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(body.error ?? `${res.status}`);
        return;
      }
      if (action === 'cancel') {
        router.push('/cs/events');
      } else if (body.voucherCode) {
        setResult({
          voucherCode: body.voucherCode,
          amountHalire: body.amountHalire ?? 0,
          buyerEmail: body.buyerEmail,
        });
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
            <CardTitle>✅ Dárkový poukaz zakoupen</CardTitle>
            <CardDescription>
              Platba úspěšná. Kód poukazu je platný 3 roky.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-4 text-center">
              <div className="text-xs uppercase text-muted-foreground">Kód</div>
              <div
                className="mt-1 font-mono text-2xl font-bold tracking-wide"
                data-testid="voucher-code"
              >
                {result.voucherCode}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                Hodnota:{' '}
                <strong>
                  {(result.amountHalire / 100).toLocaleString('cs-CZ')} Kč
                </strong>
              </div>
            </div>
            {result.buyerEmail ? (
              <p className="text-sm text-muted-foreground">
                Potvrzení a PDF jsme odeslali na {result.buyerEmail}.
              </p>
            ) : null}
            <Button
              onClick={() =>
                router.push(
                  `/api/vouchers/${encodeURIComponent(result.voucherCode)}/pdf`,
                )
              }
              variant="outline"
              className="w-full"
            >
              Stáhnout PDF
            </Button>
            <Button onClick={() => router.push('/cs/events')} className="w-full">
              Vrátit se na Tixly
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
          <CardTitle>Mock platba — Dárkový poukaz</CardTitle>
          <CardDescription>
            Lokální simulace platby. V produkci by jsi byl na GoPay/ComGate
            bráně.
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
              data-testid="voucher-pay"
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
