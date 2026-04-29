'use client';

import { FormEvent, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';
import { formatMoney } from '@/lib/format';

interface WristbandResponse {
  uid: string;
  ticketId: string;
  balanceHalire: number;
  active: boolean;
  ticket: {
    status: string;
    ticketTypeName: string;
    eventTitle: string;
    buyerEmail: string;
  };
  transactions: Transaction[];
}

interface Transaction {
  id: string;
  kind: string;
  amountHalire: number;
  balanceAfter: number;
  vendorLabel: string | null;
  description: string | null;
  performedAt: string;
}

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

export default function WristbandsPage() {
  const params = useParams();
  const eventId = String(params.id);

  // Bind form
  const [bindUid, setBindUid] = useState('');
  const [bindTicketId, setBindTicketId] = useState('');
  const [bindTopup, setBindTopup] = useState('0');
  const [bindBusy, setBindBusy] = useState(false);

  // Lookup
  const [lookupUid, setLookupUid] = useState('');
  const [info, setInfo] = useState<WristbandResponse | null>(null);
  const [txns, setTxns] = useState<Transaction[]>([]);

  // Top-up / charge
  const [opAmount, setOpAmount] = useState('100');
  const [opNote, setOpNote] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function bind(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setBindBusy(true);
    try {
      const res = await authFetch('/api/admin/wristbands/bind', {
        method: 'POST',
        body: JSON.stringify({
          uid: bindUid.trim(),
          ticketId: bindTicketId.trim(),
          initialTopupHalire: Number(bindTopup) * 100,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`UID ${bindUid} připojeno k ticketu.`);
      setBindUid('');
      setBindTicketId('');
      setBindTopup('0');
    } finally {
      setBindBusy(false);
    }
  }

  async function lookup(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setFeedback(null);
    setInfo(null);
    setTxns([]);
    try {
      const res = await authFetch(`/api/admin/wristbands/${encodeURIComponent(lookupUid.trim())}`);
      if (!res.ok) {
        setError(`Náramek nenalezen (${res.status})`);
        return;
      }
      const j = (await res.json()) as WristbandResponse;
      setInfo(j);
      setTxns(j.transactions ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function operation(action: 'topup' | 'charge') {
    if (!info) return;
    setError(null);
    setFeedback(null);
    try {
      const res = await authFetch(
        `/api/admin/wristbands/${encodeURIComponent(info.uid)}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({
            amountHalire: Number(opAmount) * 100,
            description: opNote || undefined,
          }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setFeedback(`${action === 'topup' ? 'Dobito' : 'Strženo'}: ${opAmount} Kč`);
      setOpNote('');
      await lookup();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="RFID náramky"
        description="Bind UID na ticket, top-up cashless balance, vendor charge u stánku."
      />

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Bind nový náramek</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={bind} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  UID náramku
                </label>
                <Input
                  value={bindUid}
                  onChange={(e) => setBindUid(e.target.value)}
                  placeholder="04A12B3C4D5E"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Ticket ID
                </label>
                <Input
                  value={bindTicketId}
                  onChange={(e) => setBindTicketId(e.target.value)}
                  placeholder="UUID lístku"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase text-muted-foreground">
                  Initial top-up (Kč, volitelné)
                </label>
                <Input
                  type="number"
                  min={0}
                  value={bindTopup}
                  onChange={(e) => setBindTopup(e.target.value)}
                />
              </div>
              <Button type="submit" disabled={bindBusy} className="w-full">
                {bindBusy ? 'Bindne…' : 'Bind UID'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Event: <code>{eventId.slice(0, 8)}…</code>
              </p>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Najít náramek</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={lookup} className="flex gap-2">
              <Input
                value={lookupUid}
                onChange={(e) => setLookupUid(e.target.value)}
                placeholder="UID"
                required
              />
              <Button type="submit">Najít</Button>
            </form>

            {info ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="font-medium">{info.ticket.buyerEmail}</div>
                  <div className="text-xs text-muted-foreground">
                    {info.ticket.ticketTypeName} · {info.ticket.eventTitle}
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {formatMoney(info.balanceHalire, 'CZK')}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {info.active ? 'Aktivní' : 'Deaktivovaný'} · Ticket{' '}
                    {info.ticketId.slice(0, 8)}…
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <Input
                      type="number"
                      min={1}
                      value={opAmount}
                      onChange={(e) => setOpAmount(e.target.value)}
                      placeholder="Částka v Kč"
                    />
                  </div>
                  <div className="col-span-2">
                    <Input
                      value={opNote}
                      onChange={(e) => setOpNote(e.target.value)}
                      placeholder="Poznámka (např. Bar A · 2× pivo)"
                    />
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => operation('topup')}
                    disabled={!opAmount}
                  >
                    + Dobít
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => operation('charge')}
                    disabled={!opAmount}
                  >
                    − Strhnout
                  </Button>
                </div>

                {txns.length > 0 ? (
                  <div className="mt-3">
                    <h4 className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                      Posledních {txns.length} transakcí
                    </h4>
                    <ul className="space-y-1 text-xs">
                      {txns.map((tx) => (
                        <li
                          key={tx.id}
                          className="flex items-center justify-between rounded bg-muted/20 px-2 py-1"
                        >
                          <span>
                            <span
                              className={
                                tx.kind === 'topup'
                                  ? 'font-medium text-emerald-700'
                                  : 'font-medium text-rose-700'
                              }
                            >
                              {tx.kind === 'topup' ? '+' : '−'}{' '}
                              {formatMoney(Math.abs(tx.amountHalire), 'CZK')}
                            </span>
                            {tx.description ? ` · ${tx.description}` : ''}
                            {tx.vendorLabel ? ` · ${tx.vendorLabel}` : ''}
                          </span>
                          <span className="text-muted-foreground">
                            {new Date(tx.performedAt).toLocaleTimeString('cs-CZ')}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
