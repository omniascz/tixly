'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface EventOption { id: string; name: string }
interface TicketTypeOption { id: string; name: string; base_price: number }
interface PhoneOrder {
  id: string;
  buyer_email: string;
  buyer_name: string | null;
  total_amount: number;
  status: string;
  phone_payment_link: string | null;
  created_at: string;
  event_name: string | null;
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

export default function CallCenterPage() {
  const [events, setEvents] = useState<EventOption[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeOption[]>([]);
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [eventId, setEventId] = useState('');
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ paymentLink: string; buyerEmail: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void authFetch('/api/admin/events?status=published&limit=200')
      .then((r) => r.json() as Promise<{ events: EventOption[] }>)
      .then((j) => setEvents(j.events ?? []));
    void loadOrders();
  }, []);

  async function loadOrders() {
    const r = await authFetch('/api/admin/call-center/orders');
    const j = (await r.json()) as { orders: PhoneOrder[] };
    setOrders(j.orders ?? []);
  }

  useEffect(() => {
    if (!eventId) { setTicketTypes([]); setTicketTypeId(''); return; }
    void authFetch(`/api/admin/events/${eventId}/ticket-types`)
      .then((r) => r.json() as Promise<{ ticketTypes: TicketTypeOption[] }>)
      .then((j) => { setTicketTypes(j.ticketTypes ?? []); setTicketTypeId(''); });
  }, [eventId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const res = await authFetch('/api/admin/call-center/order', {
        method: 'POST',
        body: JSON.stringify({ buyerEmail, buyerName, eventId, ticketTypeId, quantity }),
      });
      const j = (await res.json()) as { paymentLink?: string; buyerEmail?: string; error?: string };
      if (!res.ok) { setError(j.error ?? `Chyba ${res.status}`); return; }
      setResult({ paymentLink: j.paymentLink!, buyerEmail: j.buyerEmail! });
      await loadOrders();
    } finally {
      setBusy(false);
    }
  }

  function fmt(halire: number) { return `${(halire / 100).toFixed(0)} Kč`; }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">📞 Call center</h1>
      <p className="text-sm text-muted-foreground">
        Vytvoř objednávku jménem zákazníka po telefonu a předej mu platební link.
      </p>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Nová telefonická objednávka</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-3">
              <div>
                <label className="text-xs font-medium">Email zákazníka *</label>
                <Input value={buyerEmail} onChange={(e) => setBuyerEmail(e.target.value)} type="email" required />
              </div>
              <div>
                <label className="text-xs font-medium">Jméno zákazníka</label>
                <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium">Akce *</label>
                <select value={eventId} onChange={(e) => setEventId(e.target.value)} required className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">— vyberte —</option>
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Typ vstupenky *</label>
                <select value={ticketTypeId} onChange={(e) => setTicketTypeId(e.target.value)} required disabled={!eventId} className="w-full rounded border px-2 py-1.5 text-sm disabled:opacity-50">
                  <option value="">— vyberte —</option>
                  {ticketTypes.map((tt) => <option key={tt.id} value={tt.id}>{tt.name} ({fmt(tt.base_price)})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Počet *</label>
                <Input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} required />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {busy ? 'Vytvářím…' : 'Vytvořit objednávku'}
              </Button>
            </form>

            {result && (
              <div className="mt-4 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-sm font-semibold text-green-800">✓ Objednávka vytvořena pro {result.buyerEmail}</p>
                <div className="flex gap-2">
                  <Input value={result.paymentLink} readOnly className="text-xs" />
                  <Button size="sm" variant="outline"
                    onClick={() => { void navigator.clipboard.writeText(result!.paymentLink); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                    {copied ? '✓' : 'Kopírovat'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Platební link platí 48 h.</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Poslední telefonické objednávky</CardTitle></CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádné objednávky zatím.</p>
            ) : (
              <div className="space-y-2">
                {orders.slice(0, 20).map((o) => (
                  <div key={o.id} className="flex items-start justify-between border-b pb-2 text-xs">
                    <div>
                      <p className="font-medium">{o.buyer_email}</p>
                      <p className="text-muted-foreground">{o.event_name ?? '—'} · {fmt(o.total_amount)}</p>
                    </div>
                    <Badge variant={o.status === 'paid' ? 'default' : 'secondary'}>{o.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
