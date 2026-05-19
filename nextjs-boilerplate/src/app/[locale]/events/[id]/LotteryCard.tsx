'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Lottery {
  id: string;
  name: string;
  description: string | null;
  closes_at: string;
  draw_at: string;
  max_per_entry: number;
  payment_deadline_hours: number;
}

interface TicketTypeOption {
  id: string;
  name: string;
}

interface Props {
  eventId: string;
  ticketTypes: TicketTypeOption[];
}

export function LotteryCard({ eventId, ticketTypes }: Props) {
  const [lotteries, setLotteries] = useState<Lottery[] | null>(null);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const res = await fetch(`/api/events/${eventId}/lotteries`);
        if (res.ok) {
          const j = (await res.json()) as { lotteries: Lottery[] };
          setLotteries(j.lotteries);
        } else {
          setLotteries([]);
        }
      } catch {
        setLotteries([]);
      }
    }
  }, [eventId]);

  if (!lotteries || lotteries.length === 0) return null;

  return (
    <div className="space-y-3">
      {lotteries.map((l) => (
        <LotteryEntry key={l.id} eventId={eventId} lottery={l} ticketTypes={ticketTypes} />
      ))}
    </div>
  );
}

function LotteryEntry({
  eventId,
  lottery,
  ticketTypes,
}: {
  eventId: string;
  lottery: Lottery;
  ticketTypes: TicketTypeOption[];
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [ticketTypeId, setTicketTypeId] = useState(ticketTypes[0]?.id ?? '');
  const [quantity, setQuantity] = useState('2');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/lotteries/${lottery.id}/enter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          email,
          name: name || undefined,
          ticketTypeId,
          quantity: Number(quantity),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean };
      if (!res.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  const closesIn = formatTimeLeft(lottery.closes_at);

  return (
    <Card className="border-purple-300 bg-purple-50/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-purple-900">
          🎲 {lottery.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {lottery.description ? <p className="text-purple-900">{lottery.description}</p> : null}
        <div className="rounded-md bg-white/70 p-2 text-xs text-purple-900">
          Losování probíhá <strong>{new Date(lottery.draw_at).toLocaleString('cs-CZ')}</strong>.
          Přihlášení do {closesIn}. Max {lottery.max_per_entry} lístků na žádost. Po výhře{' '}
          {lottery.payment_deadline_hours}h na zaplacení.
        </div>
        {done ? (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-900">
            Přihlášen/a. Po losování dostaneš e-mail s výsledkem.
          </div>
        ) : !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>
            Přihlásit do losování
          </Button>
        ) : (
          <form onSubmit={submit} className="space-y-2">
            <Input
              type="email"
              placeholder="E-mail"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              placeholder="Jméno (volitelné)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <select
              value={ticketTypeId}
              onChange={(e) => setTicketTypeId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              required
            >
              <option value="">— vyber typ vstupenky —</option>
              {ticketTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={1}
              max={lottery.max_per_entry}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy || !email || !ticketTypeId} size="sm">
              {busy ? 'Odesílám…' : 'Odeslat přihlášku'}
            </Button>
            {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'právě teď';
  const h = Math.floor(ms / (1000 * 60 * 60));
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} dnů`;
}
