'use client';

/**
 * /admin/reservations — B2B/phone rezervace UI
 *
 * Box office staff:
 *   1. Vybere akci + ticket type + počet
 *   2. Vyplní kupce (email, jméno, telefon, volitelně firma + DIČ)
 *   3. „Vytvořit rezervaci" → POST /api/admin/reservations
 *   4. Zobrazí se VS + bankovní účet + instrukce k zaslání kupci
 */

import { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/admin/PageHeader';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  ticketTypes: {
    id: string;
    name: string;
    basePrice: number;
    remainingQty: number;
  }[];
}

interface ReservationResult {
  orderId: string;
  variableSymbol: string;
  expiresAt: string;
  totalAmountHalire: number;
  bankAccount?: string;
}

function fmt(halire: number, currency = 'CZK'): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} ${currency === 'EUR' ? '€' : 'Kč'}`;
}

export default function ReservationsPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState('');
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyVatId, setCompanyVatId] = useState('');
  const [expiryDays, setExpiryDays] = useState(7);
  const [paymentMethod, setPaymentMethod] = useState<'bank_transfer' | 'invoice'>(
    'bank_transfer',
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReservationResult | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    const token = localStorage.getItem('accessToken');
    const res = await fetch('/api/admin/pos/events', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.ok) {
      const d = (await res.json()) as { events: EventOption[] };
      setEvents(d.events ?? []);
    }
  }

  const event = events.find((e) => e.id === eventId);
  const ticketType = event?.ticketTypes.find((t) => t.id === ticketTypeId);
  const total = ticketType ? ticketType.basePrice * quantity : 0;

  async function submit() {
    if (!ticketTypeId) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          quantity,
          buyerEmail,
          buyerName,
          buyerPhone: buyerPhone || undefined,
          companyName: companyName || undefined,
          companyVatId: companyVatId || undefined,
          reservationExpiryDays: expiryDays,
          paymentMethod,
          internalNote: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setResult(data as ReservationResult);
      // Reset
      setQuantity(1);
      setBuyerEmail('');
      setBuyerName('');
      setBuyerPhone('');
      setCompanyName('');
      setCompanyVatId('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rezervace (B2B / telefonické)"
        description="Vytvořit rezervaci pro firemního klienta nebo telefonického kupce. Zaplatí převodem na účet do X dní; po platbě se mu vystaví lístky."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Nová rezervace</CardTitle>
            <CardDescription>
              Vyplň údaje. Order = pending; kupec dostane VS a bank účet emailem.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label htmlFor="r-event" className="mb-1 block text-xs font-medium">
                Představení
              </label>
              <select
                id="r-event"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={eventId}
                onChange={(e) => {
                  setEventId(e.target.value);
                  setTicketTypeId('');
                }}
              >
                <option value="">— vyber —</option>
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                  </option>
                ))}
              </select>
            </div>

            {event ? (
              <div>
                <label htmlFor="r-tt" className="mb-1 block text-xs font-medium">
                  Typ lístku
                </label>
                <select
                  id="r-tt"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={ticketTypeId}
                  onChange={(e) => setTicketTypeId(e.target.value)}
                >
                  <option value="">— vyber —</option>
                  {event.ticketTypes.map((tt) => (
                    <option key={tt.id} value={tt.id}>
                      {tt.name} — {fmt(tt.basePrice)} ({tt.remainingQty} volných)
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label htmlFor="r-qty" className="mb-1 block text-xs font-medium">
                Počet
              </label>
              <Input
                id="r-qty"
                type="number"
                min={1}
                max={100}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
                className="max-w-32"
              />
            </div>

            <div className="border-t pt-3">
              <h3 className="mb-2 text-xs font-medium uppercase">Kupec</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="r-email" className="mb-1 block text-xs">
                    E-mail *
                  </label>
                  <Input
                    id="r-email"
                    type="email"
                    value={buyerEmail}
                    onChange={(e) => setBuyerEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="r-name" className="mb-1 block text-xs">
                    Jméno *
                  </label>
                  <Input
                    id="r-name"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="r-phone" className="mb-1 block text-xs">
                    Telefon (volitelné)
                  </label>
                  <Input
                    id="r-phone"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <h3 className="mb-2 text-xs font-medium uppercase">Firma (B2B, volitelné)</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="r-co-name" className="mb-1 block text-xs">
                    Název
                  </label>
                  <Input
                    id="r-co-name"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="r-co-dic" className="mb-1 block text-xs">
                    DIČ
                  </label>
                  <Input
                    id="r-co-dic"
                    value={companyVatId}
                    onChange={(e) => setCompanyVatId(e.target.value)}
                    placeholder="CZ12345678"
                  />
                </div>
              </div>
            </div>

            <div className="border-t pt-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label htmlFor="r-expiry" className="mb-1 block text-xs">
                    Splatnost (dní)
                  </label>
                  <Input
                    id="r-expiry"
                    type="number"
                    min={1}
                    max={30}
                    value={expiryDays}
                    onChange={(e) => setExpiryDays(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label htmlFor="r-pm" className="mb-1 block text-xs">
                    Metoda platby
                  </label>
                  <select
                    id="r-pm"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={paymentMethod}
                    onChange={(e) =>
                      setPaymentMethod(e.target.value as 'bank_transfer' | 'invoice')
                    }
                  >
                    <option value="bank_transfer">Bank převod (VS)</option>
                    <option value="invoice">Faktura</option>
                  </select>
                </div>
              </div>
              <div className="mt-2">
                <label htmlFor="r-note" className="mb-1 block text-xs">
                  Interní poznámka (volitelné)
                </label>
                <textarea
                  id="r-note"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>

            {error ? (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-2 text-sm text-rose-900">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-between border-t pt-3">
              <div>
                <div className="text-xs text-muted-foreground">Celkem</div>
                <div className="text-xl font-bold">{fmt(total)}</div>
              </div>
              <Button
                onClick={submit}
                disabled={busy || !ticketTypeId || !buyerEmail || !buyerName || quantity < 1}
              >
                {busy ? 'Vytvářím…' : 'Vytvořit rezervaci'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Výsledek */}
        <Card>
          <CardHeader>
            <CardTitle>Poslední rezervace</CardTitle>
            <CardDescription>
              VS a instrukce pro kupce. Pošli mu email — po zaplacení Fio cron auto-page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3">
                  <div className="text-xs uppercase text-emerald-800">Variabilní symbol</div>
                  <div className="font-mono text-2xl font-bold text-emerald-900">
                    {result.variableSymbol}
                  </div>
                </div>

                <div className="space-y-1">
                  <p>
                    <strong>Částka:</strong> {fmt(result.totalAmountHalire)}
                  </p>
                  <p>
                    <strong>Splatnost:</strong>{' '}
                    {new Date(result.expiresAt).toLocaleString('cs-CZ', {
                      dateStyle: 'long',
                      timeStyle: 'short',
                    })}
                  </p>
                  {result.bankAccount ? (
                    <p>
                      <strong>Účet:</strong> <code>{result.bankAccount}</code>
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Order: <code>{result.orderId.slice(0, 8)}</code>
                  </p>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    void navigator.clipboard.writeText(result.variableSymbol);
                  }}
                >
                  📋 Kopírovat VS
                </Button>

                <p className="text-xs text-muted-foreground">
                  Klient dostal automaticky email s těmito detaily. Po zaplacení (Fio cron)
                  se vystaví lístek a pošle PDF.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Po vytvoření tu uvidíš VS a další detaily pro klienta.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
