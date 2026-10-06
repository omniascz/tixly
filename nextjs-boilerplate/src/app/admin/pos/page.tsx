'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Banknote, CreditCard, Printer, Plus, Minus } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PosSeatGrid } from './PosSeatGrid';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  venueCity?: string | null;
  ticketTypes: { id: string; name: string; basePrice: number; remainingQty: number; isSeated: boolean }[];
}

interface IssuedTicket {
  ticketId: string;
  totpSecretBase32: string;
  qrPayload: string;
}

interface SaleResponse {
  orderId: string;
  eventTitle: string;
  ticketTypeName: string;
  paymentMethod: 'cash' | 'card_terminal';
  totalAmountHalire: number;
  buyerName: string;
  tickets: IssuedTicket[];
}

function formatCzk(halire: number): string {
  return `${(halire / 100).toLocaleString('cs-CZ')} Kč`;
}

export default function PosPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventId, setEventId] = useState<string>('');
  const [ticketTypeId, setTicketTypeId] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  // Kolo 8 / krok 3: prodej z pojmenované blokace (místa vybraná z jedné blokace)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [buyerName, setBuyerName] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card_terminal'>('cash');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sale, setSale] = useState<SaleResponse | null>(null);

  useEffect(() => {
    void loadEvents();
  }, []);

  async function loadEvents() {
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/pos/events', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) return;
      const data = (await res.json()) as { events: EventOption[] };
      setEvents(data.events ?? []);
    } catch {
      // ignore
    }
  }

  const event = events.find((e) => e.id === eventId);
  const ticketType = event?.ticketTypes.find((t) => t.id === ticketTypeId);
  const isSeated = ticketType?.isSeated ?? false;
  const effectiveQuantity = isSeated ? selectedSeatIds.length : quantity;
  const total = ticketType ? ticketType.basePrice * effectiveQuantity : 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/pos/sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          eventId,
          ticketTypeId,
          quantity: effectiveQuantity,
          buyerName: buyerName.trim() || undefined,
          paymentMethod,
          ...(isSeated && selectedSeatIds.length > 0 ? { seatIds: selectedSeatIds } : {}),
          ...(isSeated && selectedBlockId ? { blockId: selectedBlockId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSale(data as SaleResponse);
      // Reset pro dalšího zákazníka
      setBuyerName('');
      setQuantity(1);
      setSelectedSeatIds([]);
      setSelectedBlockId(null);
      // ticketTypeId / eventId zůstává — typicky 1 představení po sobě
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setLoading(false);
    }
  }

  // Po vystavení lístků otevřeme print preview
  function handlePrint() {
    if (typeof window !== 'undefined') window.print();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pokladna"
        description="Prodej vstupenek na místě — hotově nebo kartou na terminálu. Vstupenku hned vytisknete."
      />

      <div className="grid gap-6 lg:grid-cols-2 print:hidden">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Nový prodej</CardTitle>
            <CardDescription>Vyberte představení, místa a způsob platby.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="pos-event" className="mb-1 block text-xs font-medium">
                  Představení
                </label>
                <select
                  id="pos-event"
                  value={eventId}
                  onChange={(e) => {
                    setEventId(e.target.value);
                    setTicketTypeId('');
                  }}
                  required
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— vyberte představení —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}{ev.venueCity ? ` — ${ev.venueCity}` : ''} ({new Date(ev.dateStart).toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })})
                    </option>
                  ))}
                </select>
                {/* Kolo 12: rezervace k vyzvednutí byly jen přes Akce → Upravit → Vstupenky → Rezervace na pokladně */}
                {eventId ? (
                  <a href={`/admin/events/${eventId}/rezervace`} className="mt-1 inline-block text-sm text-primary underline">
                    Rezervace k vyzvednutí na toto představení →
                  </a>
                ) : null}
              </div>

              {event ? (
                <div>
                  <label htmlFor="pos-tt" className="mb-1 block text-xs font-medium">
                    Cenová zóna / typ vstupenky
                  </label>
                  <select
                    id="pos-tt"
                    value={ticketTypeId}
                    onChange={(e) => {
                      setTicketTypeId(e.target.value);
                      setSelectedSeatIds([]);
                      setSelectedBlockId(null);
                    }}
                    required
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="">— vyber typ —</option>
                    {event.ticketTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} — {formatCzk(t.basePrice)} (volné: {t.remainingQty})
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {ticketType && isSeated ? (
                <div>
                  <label className="mb-1 block text-xs font-medium">Výběr sedadel</label>
                  <PosSeatGrid
                    eventId={eventId}
                    ticketTypeId={ticketTypeId}
                    selected={selectedSeatIds}
                    onChange={(ids, blockId) => { setSelectedSeatIds(ids); setSelectedBlockId(blockId); }}
                    max={20}
                  />
                </div>
              ) : null}

              {ticketType && !isSeated ? (
                <div>
                  <label className="mb-1 block text-xs font-medium">Počet kusů</label>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={quantity <= 1}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                      aria-label="Snížit počet"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </Button>
                    <span className="w-12 text-center text-lg font-semibold">{quantity}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={quantity >= Math.min(20, ticketType.remainingQty)}
                      onClick={() => setQuantity((q) => Math.min(20, ticketType.remainingQty, q + 1))}
                      aria-label="Zvýšit počet"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ) : null}

              <div>
                <label htmlFor="pos-buyer" className="mb-1 block text-xs font-medium">
                  Jméno kupce <span className="text-muted-foreground">(volitelné)</span>
                </label>
                <Input
                  id="pos-buyer"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="např. Jan Novák"
                />
              </div>

              <fieldset className="border-0 p-0">
                <legend className="mb-1 block text-xs font-medium">Způsob platby</legend>
                <div className="flex gap-2">
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${paymentMethod === 'cash' ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <input
                      type="radio"
                      name="pm"
                      value="cash"
                      checked={paymentMethod === 'cash'}
                      onChange={() => setPaymentMethod('cash')}
                    />
                    <Banknote className="h-4 w-4" aria-hidden />
                    <span className="font-medium">Hotově</span>
                  </label>
                  <label
                    className={`flex flex-1 cursor-pointer items-center gap-2 rounded-md border p-3 text-sm ${paymentMethod === 'card_terminal' ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <input
                      type="radio"
                      name="pm"
                      value="card_terminal"
                      checked={paymentMethod === 'card_terminal'}
                      onChange={() => setPaymentMethod('card_terminal')}
                    />
                    <CreditCard className="h-4 w-4" aria-hidden />
                    <span className="font-medium">Karta (externí terminál)</span>
                  </label>
                </div>
                {paymentMethod === 'card_terminal' ? (
                  <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
                    ⚠ Tixly kartu <strong>neúčtuje</strong>. Platbu zpracuj na svém
                    platebním terminálu zvlášť; tady ji jen zaeviduješ a vystavíš lístek.
                  </p>
                ) : null}
              </fieldset>

              {error ? (
                <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                  {error}
                </div>
              ) : null}

              <div className="flex items-center justify-between border-t pt-4">
                <div>
                  <div className="text-xs text-muted-foreground">Celkem k inkasu</div>
                  <div className="text-2xl font-bold">{formatCzk(total)}</div>
                </div>
                <Button
                  type="submit"
                  disabled={
                    loading ||
                    !ticketTypeId ||
                    (isSeated ? selectedSeatIds.length < 1 : quantity < 1)
                  }
                >
                  {loading ? 'Vystavuji…' : 'Vystavit vstupenku'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Last sale */}
        <Card>
          <CardHeader>
            <CardTitle>Poslední prodej</CardTitle>
            <CardDescription>
              {sale ? 'Vstupenka vystavena — vytiskněte ji a předejte kupci.' : 'Zatím jste nic neprodali.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sale ? (
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-emerald-50 border border-emerald-300 p-3 text-emerald-900">
                  <div className="font-medium">{sale.eventTitle}</div>
                  <div className="text-xs">
                    {sale.ticketTypeName} × {sale.tickets.length} · {formatCzk(sale.totalAmountHalire)} ·{' '}
                    {sale.paymentMethod === 'cash' ? 'hotově' : 'terminál'}
                  </div>
                  <div className="mt-1 text-xs text-emerald-700">Objednávka: {sale.orderId.slice(0, 8)}</div>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                    Vystavené lístky ({sale.tickets.length})
                  </div>
                  <ul className="space-y-1 text-xs">
                    {sale.tickets.map((t, i) => (
                      <li key={t.ticketId} className="flex items-center justify-between rounded border p-2">
                        <span>Vstupenka č. {i + 1}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                {/* Kolo 12: tisk vstupenek s QR kódem (stejné jako tištěné vstupenky u vstupu); dřív window.print()
                    souhrnu s ID a TOTP tajemstvím — bez QR, tedy nepoužitelné u vstupu, a tajemství nepatří na papír */}
                <a
                  href={`/api/admin/orders/${sale.orderId}/print-labels`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Printer className="mr-2 h-4 w-4" aria-hidden />
                  Vytisknout vstupenky (s QR kódem)
                </a>
                <Button type="button" variant="outline" className="w-full" onClick={handlePrint}>
                  Vytisknout doklad o prodeji
                </Button>
                <p className="text-xs text-muted-foreground">
                  Vstupenky se otevřou jako PDF — vytiskněte je na tiskárně pokladny a předejte kupci. QR kód načte obsluha u vstupu.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Po vystavení tu uvidíte souhrn a tlačítko pro tisk vstupenek.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Print-friendly receipt */}
      {sale ? (
        <div className="hidden print:block">
          <p className="text-2xl font-bold">{sale.eventTitle}</p>
          <p className="mt-2 text-sm">
            {sale.ticketTypeName} × {sale.tickets.length} · {formatCzk(sale.totalAmountHalire)} ·{' '}
            {sale.paymentMethod === 'cash' ? 'hotově' : 'platba kartou na terminálu'}
          </p>
          <p className="text-xs text-muted-foreground">Objednávka: {sale.orderId}</p>
          <p className="text-xs text-muted-foreground">Vystaveno: {new Date().toLocaleString('cs-CZ')}</p>
          <hr className="my-4" />
          {sale.tickets.map((t, i) => (
            <div key={t.ticketId} className="mb-4 break-inside-avoid">
              <p className="font-medium">Vstupenka č. {i + 1}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
