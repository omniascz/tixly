'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Výplaty pořadatelům — platform admin (kolo 7, C-57).
 * Ruční (CZK) výplata čeká ve stavu awaiting_manual_transfer; po převodu v bankovnictví ji admin potvrdí
 * datem a referencí platby. Teprve potom je `paid` (zapisuje se do audit logu).
 */
interface Payout {
  id: string;
  promoter_name: string;
  iban: string | null;
  period_from: string;
  period_to: string;
  net_payout: number;
  currency: string;
  status: string;
  payout_provider: string | null;
  bank_reference: string | null;
  transfer_date: string | null;
  confirmed_by_email: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Připravuje se',
  approved: 'Schváleno',
  processing: 'Odesílá se (banka)',
  awaiting_manual_transfer: 'Čeká na ruční převod',
  paid: 'Vyplaceno',
  failed: 'Selhalo',
  cancelled: 'Zrušeno',
};

function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

const money = (minor: number, currency: string) =>
  (minor / 100).toLocaleString('cs-CZ', { style: 'currency', currency: currency.trim() || 'CZK' });
const day = (iso: string) => new Date(iso).toLocaleDateString('cs-CZ');

export default function PlatformPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, { date: string; ref: string }>>({});

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    try {
      const res = await authFetch('/api/platform/admin/payouts');
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      setPayouts(((await res.json()) as { payouts: Payout[] }).payouts ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function confirmTransfer(id: string) {
    const f = form[id] ?? { date: '', ref: '' };
    setBusy(id);
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(`/api/platform/admin/payouts/${id}/confirm-transfer`, {
        method: 'POST',
        body: JSON.stringify({ transferDate: f.date, bankReference: f.ref }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback('Převod potvrzen, výplata je vyplacená.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  const awaiting = payouts.filter((p) => p.status === 'awaiting_manual_transfer');
  const others = payouts.filter((p) => p.status !== 'awaiting_manual_transfer');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Výplaty pořadatelům</h1>
        <p className="text-sm text-muted-foreground">
          Výplata v Kč se převádí ručně z bankovnictví. Jako vyplacenou ji označte až po převodu — s datem a referencí platby.
        </p>
      </div>
      {error ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
      {feedback ? <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">{feedback}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Čeká na ruční převod ({awaiting.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {awaiting.length === 0 ? <p className="text-sm text-muted-foreground">Nic nečeká.</p> : null}
          {awaiting.map((p) => {
            const f = form[p.id] ?? { date: '', ref: '' };
            return (
              <div key={p.id} data-testid="payout-awaiting" className="rounded-md border p-3 text-sm">
                <div className="font-medium">{p.promoter_name} — {money(p.net_payout, p.currency)}</div>
                <div className="text-muted-foreground">
                  Období {day(p.period_from)} – {day(p.period_to)} · IBAN {p.iban ?? 'nevyplněn'} · VS/ref {p.id.slice(0, 8)}
                </div>
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="text-xs">
                    Datum převodu
                    <input
                      type="date"
                      value={f.date}
                      onChange={(e) => setForm({ ...form, [p.id]: { ...f, date: e.target.value } })}
                      className="mt-1 block rounded-md border bg-background px-2 py-1"
                    />
                  </label>
                  <label className="text-xs">
                    Reference platby
                    <input
                      value={f.ref}
                      onChange={(e) => setForm({ ...form, [p.id]: { ...f, ref: e.target.value } })}
                      className="mt-1 block rounded-md border bg-background px-2 py-1"
                      placeholder="např. ID transakce v bance"
                    />
                  </label>
                  <Button onClick={() => confirmTransfer(p.id)} disabled={busy === p.id || !f.date || !f.ref.trim()}>
                    Potvrdit převod
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ostatní výplaty</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1">Pořadatel</th>
                <th>Období</th>
                <th className="text-right">Částka</th>
                <th>Stav</th>
                <th>Převod</th>
              </tr>
            </thead>
            <tbody>
              {others.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1">{p.promoter_name}</td>
                  <td>{day(p.period_from)} – {day(p.period_to)}</td>
                  <td className="text-right">{money(p.net_payout, p.currency)}</td>
                  <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                  <td className="text-muted-foreground">
                    {p.status === 'paid'
                      ? `${p.transfer_date ?? (p.payout_provider === 'wise' ? 'Wise' : '')} ${p.bank_reference ?? ''} ${p.confirmed_by_email ? `(${p.confirmed_by_email})` : ''}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
