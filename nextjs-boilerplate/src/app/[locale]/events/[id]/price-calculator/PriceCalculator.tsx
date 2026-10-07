'use client';

import { useEffect, useState, type JSX } from 'react';
import { Calculator, Info } from 'lucide-react';

interface TicketPreview {
  ticketTypeId: string;
  ticketTypeName: string;
  unitPrice: number;
  qty: number;
  subtotal: number;
  fees: { label: string; amount: number }[];
  total: number;
  allInPrice: number;
  availability: number | null;
  isSoldOut: boolean;
}

interface Preview {
  eventTitle: string;
  channel: string;
  currency: string;
  feePayer: string;
  qty: number;
  tickets: TicketPreview[];
  disclaimer: string;
}

const CHANNELS = [
  { value: 'online', label: 'Online (web)', desc: 'Standardní web nákup' },
  { value: 'box_office', label: 'Pokladna', desc: 'Osobně před akcí' },
  { value: 'partner', label: 'Partner', desc: 'Síťový distributor (TicketStream, GoOut)' },
  { value: 'kiosk', label: 'Samoobsluha', desc: 'Kiosk u venue' },
];

function fmt(halire: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : 'Kč';
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
}

export function PriceCalculator({ eventId }: { eventId: string }): JSX.Element {
  const [channel, setChannel] = useState('online');
  const [qty, setQty] = useState(1);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/public/events/${eventId}/price-preview?channel=${channel}&qty=${qty}`)
      .then((r) => r.json())
      .then((data: Preview | { error: string }) => {
        if ('error' in data) {
          setError(data.error);
        } else {
          setPreview(data);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Chyba'))
      .finally(() => setLoading(false));
  }, [channel, qty, eventId]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Vyber kanál</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNELS.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => setChannel(c.value)}
              className={`rounded-md border p-3 text-left transition ${
                channel === c.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-muted/30'
              }`}
            >
              <p className="text-sm font-medium">{c.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{c.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted-foreground">Počet lístků</p>
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <button
              type="button"
              key={n}
              onClick={() => setQty(n)}
              className={`h-10 w-10 rounded-md border font-semibold transition ${
                qty === n
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-muted/30'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
      ) : null}

      {loading && !preview ? (
        <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
          <Calculator className="mx-auto mb-2 h-8 w-8 animate-pulse" />
          Počítám…
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          {preview.tickets.length === 0 ? (
            <p className="rounded-md border bg-muted/30 p-4 text-sm">
              Žádné dostupné lístky.
            </p>
          ) : (
            preview.tickets.map((t) => (
              <div
                key={t.ticketTypeId}
                className={`rounded-lg border bg-card p-4 ${t.isSoldOut ? 'opacity-50' : ''}`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{t.ticketTypeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {qty}× {fmt(t.unitPrice, preview.currency)}
                      {t.isSoldOut ? ' · VYPRODÁNO' : ''}
                    </p>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-primary">
                    {fmt(t.allInPrice, preview.currency)}
                  </p>
                </div>
                <div className="space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>{qty}× lístek</span>
                    <span>{fmt(t.subtotal, preview.currency)}</span>
                  </div>
                  {t.fees.map((fee, i) => (
                    <div key={i} className="flex justify-between text-muted-foreground">
                      <span>{fee.label}</span>
                      <span>{fmt(fee.amount, preview.currency)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1 font-semibold">
                    <span>Celkem (all-in)</span>
                    <span className="tabular-nums">{fmt(t.allInPrice, preview.currency)}</span>
                  </div>
                </div>
              </div>
            ))
          )}

          <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <Info className="h-4 w-4 flex-shrink-0" />
            <span>{preview.disclaimer}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
