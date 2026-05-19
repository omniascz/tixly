'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Banknote, CreditCard, Printer, Plus, Minus } from 'lucide-react';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface EventOption {
  id: string;
  title: string;
  dateStart: string;
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
  const total = ticketType ? ticketType.basePrice * quantity : 0;

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
          quantity,
          buyerName: buyerName.trim() || undefined,
          paymentMethod,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSale(data as SaleResponse);
      // Reset form pro další zákazník
      setBuyerName('');
      setQuantity(1);
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
        title="Pokladna (POS)"
        description="Hotovostní/terminálový prodej u kasy. Vystaví lístek okamžitě s QR pro scanner."
      />

      <div className="grid gap-6 lg:grid-cols-2 print:hidden">
        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle>Nový prodej</CardTitle>
            <CardDescription>Vyber představení a počet lístků.</CardDescription>
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
                  <option value="">— vyber představení —</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.dateStart).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              {event ? (
                <div>
                  <label htmlFor="pos-tt" className="mb-1 block text-xs font-medium">
                    Typ lístku
                  </label>
                  <select
                    id="pos-tt"
                    value={ticketTypeId}
                    onChange={(e) => setTicketTypeId(e.target.value)}
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

              {ticketType ? (
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
                  placeholder="Walk-in kupující"
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
                    <span className="font-medium">Terminál</span>
                  </label>
                </div>
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
                <Button type="submit" disabled={loading || !ticketTypeId || quantity < 1}>
                  {loading ? 'Vystavuji…' : 'Vystavit lístek'}
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
              {sale ? 'Lístek vystaven — vytiskni a předej kupci.' : 'Žádný prodej v této session.'}
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
                        <span>
                          Lístek #{i + 1}: <code>{t.ticketId.slice(0, 8)}</code>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={handlePrint}>
                  <Printer className="mr-2 h-4 w-4" aria-hidden />
                  Vytisknout / uložit jako PDF
                </Button>
                <p className="text-xs text-muted-foreground">
                  Plný PDF lístek s QR kódem dostane kupec přes mail (pokud zadáš e-mail).
                  Tady ti stačí potvrzení o vystavení a evidenci pro účetní.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Po vystavení tu uvidíš souhrn a tlačítko pro tisk.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Print-friendly receipt */}
      {sale ? (
        <div className="hidden print:block">
          <h1 className="text-2xl font-bold">{sale.eventTitle}</h1>
          <p className="mt-2 text-sm">
            {sale.ticketTypeName} × {sale.tickets.length} · {formatCzk(sale.totalAmountHalire)} ·{' '}
            {sale.paymentMethod === 'cash' ? 'hotově' : 'platba kartou na terminálu'}
          </p>
          <p className="text-xs text-muted-foreground">Objednávka: {sale.orderId}</p>
          <p className="text-xs text-muted-foreground">Vystaveno: {new Date().toLocaleString('cs-CZ')}</p>
          <hr className="my-4" />
          {sale.tickets.map((t, i) => (
            <div key={t.ticketId} className="mb-4 break-inside-avoid">
              <p className="font-medium">Lístek #{i + 1}</p>
              <p className="text-xs">ID: {t.ticketId}</p>
              <p className="text-xs">TOTP secret: {t.totpSecretBase32}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
