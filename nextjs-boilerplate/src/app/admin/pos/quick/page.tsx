'use client';

/**
 * /admin/pos/quick — touchscreen-optimized POS pro festival box office.
 *
 * Flow:
 *   1. Vyber představení (raz na začátek session) → uloží se do state
 *   2. Velké karty ticket types s cenou a dostupností
 *   3. Tap na kartu = +1 do košíku
 *   4. Košík vpravo s celkovou cenou a quick payment metoda
 *   5. „Inkasovat" → POST /api/admin/pos/sale → reset košíku, „Připraveno pro dalšího zákazníka"
 *
 * Tablet (1024×768) friendly: minimum tap target 56px, žádný keyboard input nutný.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Banknote, CreditCard, Printer, Plus, Minus, ArrowLeft } from 'lucide-react';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
  ticketTypes: {
    id: string;
    name: string;
    basePrice: number;
    remainingQty: number;
    isSeated: boolean;
  }[];
}

interface CartItem {
  ticketTypeId: string;
  name: string;
  basePrice: number;
  quantity: number;
}

interface SaleResponse {
  orderId: string;
  totalAmountHalire: number;
  tickets: Array<{ ticketId: string; totpSecretBase32: string }>;
}

function fmt(halire: number, currency = 'CZK'): string {
  const amount = (halire / 100).toLocaleString('cs-CZ');
  return amount + (currency === 'EUR' ? ' €' : ' Kč');
}

export default function QuickPosPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<EventOption | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card_terminal'>('cash');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSale, setLastSale] = useState<SaleResponse | null>(null);

  useEffect(() => {
    void loadEvents();
  }, []);

  async function loadEvents() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    const res = await fetch('/api/admin/pos/events', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (res.ok) {
      const d = (await res.json()) as { events: EventOption[] };
      setEvents(d.events ?? []);
    }
  }

  function addToCart(tt: EventOption['ticketTypes'][number]) {
    setCart((prev) => {
      const existing = prev.find((i) => i.ticketTypeId === tt.id);
      if (existing) {
        return prev.map((i) =>
          i.ticketTypeId === tt.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { ticketTypeId: tt.id, name: tt.name, basePrice: tt.basePrice, quantity: 1 }];
    });
  }

  function changeQty(ticketTypeId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((i) =>
          i.ticketTypeId === ticketTypeId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i,
        )
        .filter((i) => i.quantity > 0),
    );
  }

  const total = cart.reduce((s, i) => s + i.basePrice * i.quantity, 0);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);

  async function charge() {
    if (!selectedEvent || cart.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const token = localStorage.getItem('accessToken');
      // Backend zatím podporuje jen 1 ticket_type per sale — uděláme N volání
      const sales: SaleResponse[] = [];
      for (const item of cart) {
        const res = await fetch('/api/admin/pos/sale', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            eventId: selectedEvent.id,
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            paymentMethod,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? data.error ?? `HTTP ${res.status}`);
          return;
        }
        sales.push(data as SaleResponse);
      }
      const combined: SaleResponse = {
        orderId: sales.map((s) => s.orderId.slice(0, 6)).join('+'),
        totalAmountHalire: sales.reduce((s, x) => s + x.totalAmountHalire, 0),
        tickets: sales.flatMap((s) => s.tickets),
      };
      setLastSale(combined);
      setCart([]);
      // Reload events pro aktualizaci dostupnosti
      void loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally {
      setBusy(false);
    }
  }

  if (!selectedEvent) {
    return (
      <div className="space-y-4 p-4">
        <h1 className="text-2xl font-bold">Quick POS — vyber akci</h1>
        <p className="text-sm text-muted-foreground">
          Vyber představení pro kterému budeš prodávat. Změníš později šipkou zpět.
        </p>
        {events.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Žádné aktivní akce.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {events.map((ev) => (
              <button
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className="rounded-lg border bg-card p-6 text-left transition hover:border-primary hover:shadow-md"
              >
                <div className="text-lg font-semibold">{ev.title}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {new Date(ev.dateStart).toLocaleString('cs-CZ', {
                    dateStyle: 'long',
                    timeStyle: 'short',
                  })}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {ev.ticketTypes.length} typů lístků ·{' '}
                  {ev.ticketTypes.reduce((s, t) => s + t.remainingQty, 0)} volných míst
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid h-[calc(100vh-4rem)] grid-cols-1 lg:grid-cols-[1fr_360px]">
      {/* Left: ticket types grid */}
      <div className="overflow-y-auto p-4">
        <div className="mb-4 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelectedEvent(null)}>
            <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
            Změnit akci
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{selectedEvent.title}</h1>
            <p className="text-xs text-muted-foreground">
              {new Date(selectedEvent.dateStart).toLocaleDateString('cs-CZ')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {selectedEvent.ticketTypes.map((tt) => {
            const soldOut = tt.remainingQty === 0;
            return (
              <button
                key={tt.id}
                onClick={() => !soldOut && addToCart(tt)}
                disabled={soldOut}
                className={`flex flex-col items-start rounded-lg border p-4 text-left transition min-h-[120px] ${
                  soldOut
                    ? 'cursor-not-allowed bg-muted text-muted-foreground'
                    : 'bg-card hover:border-primary hover:shadow-md active:scale-[0.98]'
                }`}
              >
                <div className="text-sm font-semibold leading-tight">{tt.name}</div>
                <div className="mt-auto pt-3">
                  <div className="text-xl font-bold">{fmt(tt.basePrice)}</div>
                  <div className="text-xs text-muted-foreground">
                    {soldOut ? 'Vyprodáno' : `${tt.remainingQty} volných`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {lastSale ? (
          <div className="mt-6 rounded-lg border border-emerald-300 bg-emerald-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-emerald-900">
                  ✓ Prodej hotov — {lastSale.tickets.length} lístků
                </div>
                <div className="text-xs text-emerald-800">
                  Celkem: {fmt(lastSale.totalAmountHalire)}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.print()}
              >
                <Printer className="mr-1 h-3 w-3" aria-hidden />
                Tisk
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Right: cart */}
      <aside className="flex flex-col border-l bg-muted/30 p-4">
        <h2 className="mb-3 text-sm font-medium uppercase text-muted-foreground">
          Košík ({itemCount})
        </h2>

        <div className="flex-1 space-y-2 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Klikni na kartu lístku pro přidání.
            </p>
          ) : (
            cart.map((item) => (
              <div
                key={item.ticketTypeId}
                className="flex items-center gap-2 rounded-md border bg-background p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{item.name}</div>
                  <div className="text-xs text-muted-foreground">{fmt(item.basePrice)}</div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => changeQty(item.ticketTypeId, -1)}
                  className="h-8 w-8 p-0"
                >
                  <Minus className="h-3 w-3" aria-hidden />
                </Button>
                <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => changeQty(item.ticketTypeId, +1)}
                  className="h-8 w-8 p-0"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                </Button>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 ? (
          <>
            <div className="my-3 flex items-baseline justify-between border-t pt-3">
              <span className="text-xs uppercase text-muted-foreground">Celkem</span>
              <span className="text-2xl font-bold tabular-nums">{fmt(total)}</span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('cash')}
                className={`flex flex-col items-center gap-1 rounded-md border p-3 transition ${
                  paymentMethod === 'cash' ? 'border-primary bg-primary/5' : 'hover:bg-muted/40'
                }`}
              >
                <Banknote className="h-6 w-6" aria-hidden />
                <span className="text-xs font-medium">Hotově</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('card_terminal')}
                className={`flex flex-col items-center gap-1 rounded-md border p-3 transition ${
                  paymentMethod === 'card_terminal'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/40'
                }`}
              >
                <CreditCard className="h-6 w-6" aria-hidden />
                <span className="text-xs font-medium">Terminál</span>
              </button>
            </div>

            {error ? (
              <div className="mb-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900">
                {error}
              </div>
            ) : null}

            <Button
              onClick={charge}
              disabled={busy}
              className="h-14 w-full text-lg"
              size="lg"
            >
              {busy ? 'Inkasuji…' : `Inkasovat ${fmt(total)}`}
            </Button>
          </>
        ) : null}
      </aside>
    </div>
  );
}
