'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const QUICK_AMOUNTS = [500, 1000, 2000, 5000];

export function VoucherCheckoutForm({
  slug,
  promoterName,
}: {
  slug: string;
  promoterName: string;
}): JSX.Element {
  const router = useRouter();
  const [amount, setAmount] = useState<number>(1000);
  const [customAmount, setCustomAmount] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = customAmount ? Number(customAmount) : amount;

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (!effectiveAmount || effectiveAmount < 100) {
      setError('Minimální hodnota poukazu je 100 Kč.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/p/${slug}/vouchers/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountKc: effectiveAmount,
          buyerEmail,
          buyerName,
          recipientEmail: recipientEmail || undefined,
          recipientName: recipientName || undefined,
          message: message || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        gatewayUrl?: string;
        error?: string;
        message?: string;
      };
      if (!res.ok || !body.gatewayUrl) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(body.gatewayUrl);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Koupit dárkový poukaz</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase">
              Hodnota poukazu
            </label>
            <div className="flex flex-wrap gap-2">
              {QUICK_AMOUNTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => {
                    setAmount(a);
                    setCustomAmount('');
                  }}
                  className={`rounded-md border px-4 py-2 text-sm ${
                    amount === a && !customAmount
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'hover:bg-muted/50'
                  }`}
                  data-testid={`voucher-amount-${a}`}
                >
                  {a.toLocaleString('cs-CZ')} Kč
                </button>
              ))}
            </div>
            <div className="mt-2">
              <label className="mb-1 block text-xs text-muted-foreground">
                nebo vlastní částka (Kč)
              </label>
              <Input
                type="number"
                min={100}
                max={50000}
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="např. 1500"
                className="max-w-[200px]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Tvůj email *</label>
              <Input
                type="email"
                required
                value={buyerEmail}
                onChange={(e) => setBuyerEmail(e.target.value)}
                data-testid="voucher-buyer-email"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Tvé jméno *</label>
              <Input
                required
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                data-testid="voucher-buyer-name"
              />
            </div>
          </div>

          <details className="rounded-md border bg-muted/20 p-3 text-sm">
            <summary className="cursor-pointer font-medium">
              Dárek pro někoho jiného (volitelné)
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Jméno obdarovaného
                </label>
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">
                  Email obdarovaného
                </label>
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium">Zpráva</label>
                <textarea
                  rows={2}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="block w-full rounded-md border bg-card px-3 py-2 text-sm"
                  placeholder="Hodně štěstí k narozeninám…"
                  maxLength={500}
                />
              </div>
            </div>
          </details>

          {error ? (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            disabled={busy || !buyerEmail || !buyerName || effectiveAmount < 100}
            className="w-full"
            data-testid="voucher-submit"
          >
            {busy
              ? 'Připravuji platbu…'
              : `Pokračovat — ${effectiveAmount.toLocaleString('cs-CZ')} Kč`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Platíš pořadateli {promoterName}. Po platbě obdržíš kód, který je
            platný 3 roky.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
