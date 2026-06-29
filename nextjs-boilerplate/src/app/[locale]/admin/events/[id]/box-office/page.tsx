'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';

interface TicketType {
  id: string;
  name: string;
  price_halire: number;
  remaining_qty: number;
  currency: string;
}

interface Session {
  id: string;
  cashier_name: string;
  opened_at: string;
  cash_in_halire: number;
  card_in_halire: number;
  tickets_sold: number;
  status: string;
}

interface EventInfo {
  title: string;
  date_start: string;
}

interface SaleResult {
  receiptNumber: string;
  totalHalire: number;
  changeHalire: number;
  ticketTypeName: string;
  quantity: number;
}

function fmt(halire: number): string {
  return (halire / 100).toFixed(2) + ' Kč';
}

export default function BoxOfficePage() {
  const params = useParams<{ id: string }>();
  const eventId = params.id;

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedType, setSelectedType] = useState<TicketType | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [paymentType, setPaymentType] = useState<'cash' | 'card'>('cash');
  const [cashTendered, setCashTendered] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [selling, setSelling] = useState(false);
  const [lastSale, setLastSale] = useState<SaleResult | null>(null);
  const [error, setError] = useState('');
  const [openingCash, setOpeningCash] = useState('0');
  const [openingSession, setOpeningSession] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/events/${eventId}/box-office`);
    const data = (await r.json()) as { event: EventInfo; activeSession: Session | null; ticketTypes: TicketType[] };
    setEvent(data.event);
    setSession(data.activeSession);
    setTypes(data.ticketTypes);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  async function openSession() {
    setOpeningSession(true);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/box-office`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openingCashHalire: Math.round(parseFloat(openingCash || '0') * 100) }),
      });
      if (r.ok) { await load(); }
    } finally {
      setOpeningSession(false);
    }
  }

  async function closeSession() {
    if (!session) return;
    if (!confirm(`Uzavřít pokladní session? Tržba: ${fmt(session.cash_in_halire + session.card_in_halire)}`)) return;
    await fetch(`/api/admin/events/${eventId}/box-office/sessions/${session.id}`, { method: 'DELETE' });
    await load();
  }

  async function sell() {
    if (!session || !selectedType) return;
    setError('');
    setSelling(true);
    setLastSale(null);
    try {
      const r = await fetch(`/api/admin/events/${eventId}/box-office/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          ticketTypeId: selectedType.id,
          quantity,
          paymentType,
          cashTenderedHalire: paymentType === 'cash' && cashTendered ? Math.round(parseFloat(cashTendered) * 100) : undefined,
          buyerEmail: buyerEmail || undefined,
          buyerName: buyerName || undefined,
        }),
      });
      const data = await r.json() as { error?: string } & SaleResult;
      if (!r.ok) { setError(data.error ?? 'Chyba prodeje'); return; }
      setLastSale(data);
      setCashTendered('');
      setBuyerEmail('');
      setBuyerName('');
      await load();
    } finally {
      setSelling(false);
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Načítám pokladnu...</div>;

  const total = selectedType ? selectedType.price_halire * quantity : 0;
  const change = paymentType === 'cash' && cashTendered ? Math.max(0, parseFloat(cashTendered) * 100 - total) : 0;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Pokladna</h1>
            {event && <p className="text-gray-400">{event.title} · {new Date(event.date_start).toLocaleDateString('cs')}</p>}
          </div>
          {session && (
            <div className="text-right">
              <div className="text-sm text-gray-400">Pokladník: {session.cashier_name}</div>
              <div className="text-sm text-green-400">Prodáno: {session.tickets_sold} vstupenek</div>
              <div className="text-sm">Hotovost: {fmt(session.cash_in_halire)} · Karta: {fmt(session.card_in_halire)}</div>
              <button onClick={closeSession} className="mt-1 text-xs text-red-400 hover:text-red-300 underline">
                Uzavřít session
              </button>
            </div>
          )}
        </div>

        {/* Open session */}
        {!session && (
          <div className="bg-gray-900 rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Otevřít pokladní session</h2>
            <div className="flex gap-3 items-end">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Počáteční hotovost v pokladně (Kč)</label>
                <input
                  type="number"
                  value={openingCash}
                  onChange={e => setOpeningCash(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 w-40"
                  placeholder="0"
                />
              </div>
              <button
                onClick={openSession}
                disabled={openingSession}
                className="bg-green-600 hover:bg-green-500 px-6 py-2 rounded-lg font-medium disabled:opacity-50"
              >
                Otevřít pokladnu
              </button>
            </div>
          </div>
        )}

        {session && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left: Ticket types */}
            <div className="md:col-span-2 space-y-3">
              <h2 className="font-semibold text-gray-300 text-sm uppercase tracking-wide">Typ vstupenky</h2>
              {types.length === 0 && <p className="text-gray-500">Žádné vstupenky k dispozici</p>}
              {types.map(tt => (
                <button
                  key={tt.id}
                  onClick={() => { setSelectedType(tt); setQuantity(1); }}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                    selectedType?.id === tt.id
                      ? 'border-indigo-500 bg-indigo-900/30'
                      : 'border-gray-700 bg-gray-900 hover:border-gray-500'
                  }`}
                >
                  <div className="flex justify-between">
                    <span className="font-medium">{tt.name}</span>
                    <span className="text-indigo-300 font-bold">{fmt(tt.price_halire)}</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">Zbývá: {tt.remaining_qty} ks</div>
                </button>
              ))}
            </div>

            {/* Right: POS */}
            <div className="bg-gray-900 rounded-xl p-4 space-y-4">
              <h2 className="font-semibold">Prodej</h2>

              {selectedType && (
                <>
                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Počet</label>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setQuantity(q => Math.max(1, q - 1))}
                        className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600">−</button>
                      <span className="text-xl font-bold w-8 text-center">{quantity}</span>
                      <button onClick={() => setQuantity(q => Math.min(selectedType.remaining_qty, q + 1))}
                        className="w-8 h-8 rounded-full bg-gray-700 hover:bg-gray-600">+</button>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Platba</label>
                    <div className="flex gap-2">
                      {(['cash', 'card'] as const).map(p => (
                        <button key={p} onClick={() => setPaymentType(p)}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                            paymentType === p ? 'bg-indigo-600' : 'bg-gray-700 hover:bg-gray-600'
                          }`}>
                          {p === 'cash' ? '💵 Hotovost' : '💳 Karta'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {paymentType === 'cash' && (
                    <div>
                      <label className="text-sm text-gray-400 block mb-1">Přijato (Kč)</label>
                      <input
                        type="number"
                        value={cashTendered}
                        onChange={e => setCashTendered(e.target.value)}
                        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2"
                        placeholder="0"
                      />
                      {change > 0 && (
                        <div className="mt-1 text-yellow-300 font-bold text-lg">Vrátit: {fmt(change)}</div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="text-sm text-gray-400 block mb-1">Email kupujícího (volitelné)</label>
                    <input
                      type="email"
                      value={buyerEmail}
                      onChange={e => setBuyerEmail(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
                      placeholder="jan@example.com"
                    />
                  </div>

                  <div className="border-t border-gray-700 pt-3">
                    <div className="flex justify-between text-lg font-bold mb-3">
                      <span>Celkem</span>
                      <span className="text-indigo-300">{fmt(total)}</span>
                    </div>
                    <button
                      onClick={sell}
                      disabled={selling}
                      className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-xl font-bold text-lg disabled:opacity-50 transition-colors"
                    >
                      {selling ? 'Prodávám...' : '✓ PRODAT'}
                    </button>
                  </div>
                </>
              )}

              {!selectedType && (
                <p className="text-gray-500 text-sm">Vyberte typ vstupenky vlevo</p>
              )}

              {error && (
                <div className="bg-red-900/50 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
                  {error}
                </div>
              )}

              {lastSale && (
                <div className="bg-green-900/50 border border-green-700 rounded-xl p-3 text-sm">
                  <div className="font-bold text-green-300">✓ Prodáno!</div>
                  <div className="text-gray-300">{lastSale.quantity}× {lastSale.ticketTypeName}</div>
                  <div>Celkem: <span className="font-bold">{fmt(lastSale.totalHalire)}</span></div>
                  {lastSale.changeHalire > 0 && (
                    <div className="text-yellow-300 font-bold text-lg">Vrátit: {fmt(lastSale.changeHalire)}</div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">Paragon: {lastSale.receiptNumber}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
