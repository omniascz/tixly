'use client';

/**
 * /admin/call-center
 *
 * Telefonní objednávky — operátor zadá údaje zákazníka, vybere akci + typ vstupenky,
 * systém vygeneruje pay-by-link. Operátor odkaz pošle zákazníkovi SMS/emailem.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/format';

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

interface Event {
  id: string;
  title: string;
  start_at: string;
  status: string;
}

interface TicketType {
  id: string;
  name: string;
  zone: string | null;
  basePrice: number;
  remainingQty: number;
}

interface PhoneOrder {
  id: string;
  event_id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  quantity: number;
  total_amount: number;
  status: string;
  pay_link_expires_at: string;
  created_at: string;
  payLink: string;
  event_title: string | null;
  ticket_type_name: string | null;
}

export default function CallCenterPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [orders, setOrders] = useState<PhoneOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [newPayLink, setNewPayLink] = useState<string | null>(null);

  // Form fields
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedTtId, setSelectedTtId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [evRes, ordRes] = await Promise.all([
          authFetch('/api/admin/events?status=published&limit=100'),
          authFetch('/api/admin/call-center/order?limit=50'),
        ]);
        if (evRes.ok) {
          const j = (await evRes.json()) as { events?: Event[] };
          setEvents(j.events ?? []);
        }
        if (ordRes.ok) {
          const j = (await ordRes.json()) as { orders?: PhoneOrder[] };
          setOrders(j.orders ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setTicketTypes([]);
      setSelectedTtId('');
      return;
    }
    void (async () => {
      const res = await authFetch(`/api/admin/events/${selectedEventId}/ticket-types`);
      if (res.ok) {
        const j = (await res.json()) as { ticketTypes?: TicketType[] };
        setTicketTypes(j.ticketTypes ?? []);
        const first = (j.ticketTypes ?? [])[0];
        if (first) setSelectedTtId(first.id);
      }
    })();
  }, [selectedEventId]);

  const selectedTt = ticketTypes.find((t) => t.id === selectedTtId);
  const totalAmount = selectedTt ? selectedTt.basePrice * quantity : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFeedback(null);
    setNewPayLink(null);

    if (!selectedEventId || !selectedTtId) {
      setError('Vyber akci a typ vstupenky.');
      return;
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Jméno a telefon zákazníka jsou povinné.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await authFetch('/api/admin/call-center/order', {
        method: 'POST',
        body: JSON.stringify({
          eventId: selectedEventId,
          ticketTypeId: selectedTtId,
          quantity,
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        phoneOrderId?: string;
        payLink?: string;
        totalAmount?: number;
        expiresAt?: string;
        error?: string;
        issues?: unknown;
      };
      if (!res.ok) {
        setError(j.error ?? `Chyba ${res.status}`);
        return;
      }
      setNewPayLink(j.payLink ?? null);
      setFeedback('Telefonní objednávka vytvořena. Zkopíruj odkaz a pošli zákazníkovi.');
      // Reset form
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setNotes('');
      setQuantity(1);
      // Reload orders
      const ordRes = await authFetch('/api/admin/call-center/order?limit=50');
      if (ordRes.ok) {
        const oj = (await ordRes.json()) as { orders?: PhoneOrder[] };
        setOrders(oj.orders ?? []);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function statusBadge(status: string) {
    switch (status) {
      case 'paid': return <Badge className="bg-emerald-100 text-emerald-800">Zaplaceno</Badge>;
      case 'pending_payment': return <Badge className="bg-amber-100 text-amber-800">Čeká na platbu</Badge>;
      case 'expired': return <Badge variant="outline">Expirováno</Badge>;
      case 'cancelled': return <Badge variant="destructive">Zrušeno</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  }

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Načítám…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Call Center — telefonní objednávky</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Zadej údaje zákazníka a vyber vstupenky. Systém vygeneruje platební odkaz (48h platný),
          který pošleš zákazníkovi SMS nebo emailem.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Formulář */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nová telefonní objednávka</CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="mb-4 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</div>
            ) : null}
            {feedback ? (
              <div className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{feedback}</div>
            ) : null}
            {newPayLink ? (
              <div className="mb-4 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm">
                <p className="mb-2 font-semibold text-blue-900">Platební odkaz pro zákazníka:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-white px-2 py-1 text-xs">{newPayLink}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard.writeText(newPayLink)}
                  >
                    Kopírovat
                  </Button>
                </div>
              </div>
            ) : null}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Akce</label>
                <select
                  value={selectedEventId}
                  onChange={(e) => setSelectedEventId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">-- Vyber akci --</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title} ({new Date(ev.start_at).toLocaleDateString('cs-CZ')})
                    </option>
                  ))}
                </select>
              </div>

              {ticketTypes.length > 0 ? (
                <div>
                  <label className="mb-1 block text-sm font-medium">Typ vstupenky</label>
                  <select
                    value={selectedTtId}
                    onChange={(e) => setSelectedTtId(e.target.value)}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    required
                  >
                    {ticketTypes.map((tt) => (
                      <option key={tt.id} value={tt.id}>
                        {tt.name}{tt.zone ? ` — ${tt.zone}` : ''} · {formatMoney(tt.basePrice, 'CZK')} · {tt.remainingQty} volných
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div>
                <label className="mb-1 block text-sm font-medium">Počet vstupenek</label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                  className="w-24"
                  required
                />
              </div>

              <div className="border-t pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Zákazník</p>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Jméno a příjmení <span className="text-rose-500">*</span></label>
                    <Input
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Jana Nováková"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Telefon <span className="text-rose-500">*</span></label>
                    <Input
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+420 777 123 456"
                      type="tel"
                      required
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Email (volitelný)</label>
                    <Input
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="jana@example.com"
                      type="email"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Poznámka (volitelná)</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Zákazník chce vstupenky blíže ke scéně…"
                      rows={2}
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {selectedTt ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{quantity}× {selectedTt.name}</span>
                    <span className="font-semibold">{formatMoney(totalAmount, 'CZK')}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Platební odkaz bude platný 48 hodin.</div>
                </div>
              ) : null}

              <Button type="submit" disabled={submitting || !selectedEventId || !selectedTtId} className="w-full">
                {submitting ? 'Vytvářím…' : 'Vytvořit objednávku a vygenerovat odkaz'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Nápověda */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Jak na to</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>1. Vyber akci a typ vstupenky.</p>
              <p>2. Zadej jméno, telefon a volitelně email zákazníka.</p>
              <p>3. Klikni „Vytvořit" — systém vygeneruje platební odkaz.</p>
              <p>4. Odkaz zkopíruj a pošli zákazníkovi SMS nebo emailem.</p>
              <p>5. Zákazník rozklikne odkaz, zaplatí online — vstupenky mu přijdou emailem.</p>
              <div className="mt-2 rounded-md border-l-2 border-amber-300 pl-2 text-amber-800">
                Odkaz je platný 48 hodin. Po expiraci jej lze znovu vygenerovat.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabulka objednávek */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Poslední telefonní objednávky</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné telefonní objednávky.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 text-left font-medium">Zákazník</th>
                    <th className="pb-2 text-left font-medium">Akce</th>
                    <th className="pb-2 text-left font-medium">Vstupenky</th>
                    <th className="pb-2 text-left font-medium">Celkem</th>
                    <th className="pb-2 text-left font-medium">Stav</th>
                    <th className="pb-2 text-left font-medium">Platební odkaz</th>
                    <th className="pb-2 text-left font-medium">Vytvořeno</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orders.map((order) => {
                    const isExpired = new Date(order.pay_link_expires_at) < new Date() && order.status === 'pending_payment';
                    return (
                      <tr key={order.id} className="text-xs">
                        <td className="py-2 pr-4">
                          <div className="font-medium">{order.customer_name}</div>
                          <div className="text-muted-foreground">{order.customer_phone}</div>
                          {order.customer_email ? <div className="text-muted-foreground">{order.customer_email}</div> : null}
                        </td>
                        <td className="py-2 pr-4 text-muted-foreground">
                          {order.event_title ?? order.event_id.slice(0, 8)}
                        </td>
                        <td className="py-2 pr-4">
                          {order.quantity}× {order.ticket_type_name ?? '—'}
                        </td>
                        <td className="py-2 pr-4 font-medium">
                          {formatMoney(order.total_amount, 'CZK')}
                        </td>
                        <td className="py-2 pr-4">
                          {isExpired ? <Badge variant="outline">Expirováno</Badge> : statusBadge(order.status)}
                        </td>
                        <td className="py-2 pr-4">
                          {order.status === 'pending_payment' && !isExpired ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void navigator.clipboard.writeText(order.payLink)}
                            >
                              Kopírovat odkaz
                            </Button>
                          ) : null}
                        </td>
                        <td className="py-2 text-muted-foreground">
                          {new Date(order.created_at).toLocaleString('cs-CZ', { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
