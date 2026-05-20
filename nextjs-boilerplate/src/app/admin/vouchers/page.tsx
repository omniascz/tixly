'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Gift, Download, Copy, Check } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { typedGet, typedPost, TypedFetchError } from '@/lib/typed-fetch';

interface Voucher {
  id: string;
  code: string;
  event_id: string | null;
  amount_halire: number;
  balance_halire: number;
  currency: string;
  issued_to_email: string | null;
  expires_at: string | null;
  fully_used_at: string | null;
  created_at: string;
}

function formatMoney(halire: number, currency: string): string {
  const kc = halire / 100;
  const symbol = currency === 'EUR' ? '€' : 'Kč';
  return `${kc.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
}

export default function VouchersAdminPage() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Form state
  const [amountKc, setAmountKc] = useState('500');
  const [issuedToEmail, setIssuedToEmail] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [count, setCount] = useState('1');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const data = await typedGet<{ vouchers: Voucher[] }>('/api/admin/vouchers');
      setVouchers(data.vouchers ?? []);
    } catch {
      // silent — auth issue se ukáže až při submit
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const data = await typedPost<{ codes: string[] }>(
        '/api/admin/vouchers',
        {
          amountKc: Number(amountKc),
          issuedToEmail: issuedToEmail || undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          count: Number(count),
        },
        { throwOnError: true },
      );
      setSuccess(
        data.codes.length === 1
          ? `Voucher ${data.codes[0]} vytvořen`
          : `${data.codes.length} voucherů vytvořeno`,
      );
      setAmountKc('500');
      setIssuedToEmail('');
      setExpiresAt('');
      setCount('1');
      await load();
    } catch (err) {
      if (err instanceof TypedFetchError) {
        const body = err.body as { error?: string; message?: string } | undefined;
        setError(body?.message ?? body?.error ?? `HTTP ${err.status}`);
      } else {
        setError(err instanceof Error ? err.message : 'Síťová chyba');
      }
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 1500);
    } catch {
      // ignore
    }
  }

  function downloadPdf(code: string) {
    window.open(`/api/vouchers/${encodeURIComponent(code)}/pdf?locale=cs`, '_blank');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dárkové poukazy"
        description="Vystav voucher s nominální hodnotou. Kupec ho uplatní v checkoutu jako platební metodu."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {success}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Nový voucher</CardTitle>
          <CardDescription>
            Kód generujeme automaticky (12 znaků, no ambiguous chars). PDF má branding promotéra.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Hodnota (Kč)</label>
              <Input
                type="number"
                min={50}
                max={50000}
                value={amountKc}
                onChange={(e) => setAmountKc(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Počet voucherů (batch)</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Email příjemce (volitelný)</label>
              <Input
                type="email"
                value={issuedToEmail}
                onChange={(e) => setIssuedToEmail(e.target.value)}
                placeholder="jan@example.cz"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Expirace (volitelná)</label>
              <Input
                type="datetime-local"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={busy || !amountKc}>
                {busy ? 'Vytvářím…' : 'Vystavit voucher'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Seznam ({vouchers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {vouchers.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <Gift className="mb-2 h-10 w-10 text-muted-foreground" aria-hidden />
              <p className="text-sm text-muted-foreground">
                Žádné vouchery. Vytvoř první dárkový poukaz.
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Kód</th>
                  <th className="text-right">Hodnota</th>
                  <th className="text-right">Zůstatek</th>
                  <th>Příjemce</th>
                  <th>Expirace</th>
                  <th>Stav</th>
                  <th className="text-right">PDF</th>
                </tr>
              </thead>
              <tbody>
                {vouchers.map((v) => {
                  const expired = v.expires_at && new Date(v.expires_at) < new Date();
                  const used = v.fully_used_at !== null;
                  const status = used
                    ? { label: 'vyčerpán', cls: 'bg-zinc-100 text-zinc-700' }
                    : expired
                      ? { label: 'expirovaný', cls: 'bg-rose-100 text-rose-800' }
                      : v.balance_halire < v.amount_halire
                        ? { label: 'částečně použit', cls: 'bg-amber-100 text-amber-800' }
                        : { label: 'aktivní', cls: 'bg-emerald-100 text-emerald-800' };
                  return (
                    <tr key={v.id} className="border-b hover:bg-muted/30">
                      <td className="py-2">
                        <code className="rounded bg-muted px-2 py-1 text-xs">{v.code}</code>
                        <button
                          type="button"
                          onClick={() => void copyCode(v.code)}
                          className="ml-2 text-muted-foreground hover:text-primary"
                          aria-label="Kopírovat kód"
                        >
                          {copiedCode === v.code ? (
                            <Check className="inline h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="inline h-3 w-3" />
                          )}
                        </button>
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(v.amount_halire, v.currency)}
                      </td>
                      <td className="text-right tabular-nums">
                        {formatMoney(v.balance_halire, v.currency)}
                      </td>
                      <td className="text-xs">{v.issued_to_email ?? '—'}</td>
                      <td className="text-xs">
                        {v.expires_at
                          ? new Date(v.expires_at).toLocaleDateString('cs-CZ')
                          : 'bez expirace'}
                      </td>
                      <td>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}
                        >
                          {status.label}
                        </span>
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => downloadPdf(v.code)}
                          className="text-xs text-primary hover:underline"
                          title="Stáhnout branded PDF"
                        >
                          <Download className="inline h-3 w-3" /> PDF
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
