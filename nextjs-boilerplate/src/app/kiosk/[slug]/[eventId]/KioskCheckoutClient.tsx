'use client';

import { useState, useEffect, useRef } from 'react';
import { Minus, Plus, CreditCard, CheckCircle, Loader2, ArrowLeft, Ticket } from 'lucide-react';
import Link from 'next/link';
import QRCodeLib from 'qrcode';

interface TicketType {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  remaining_qty: number;
  currency: string;
}

interface IssuedTicket {
  ticketId: string;
  totpSecretBase32: string;
}

type Phase = 'select' | 'email' | 'payment' | 'success';

interface Props {
  promoterSlug: string;
  eventId: string;
  eventTitle: string;
  ticketTypes: TicketType[];
  currency: string;
}

function QrCanvas({ value }: { value: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      void QRCodeLib.toCanvas(ref.current, value, { width: 160, margin: 1, color: { dark: '#ffffff', light: '#00000000' } });
    }
  }, [value]);
  return <canvas ref={ref} />;
}

function formatCZK(halire: number, currency: string) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 })
    .format(halire / 100);
}

export function KioskCheckoutClient({ promoterSlug, eventId, eventTitle, ticketTypes, currency }: Props) {
  const [selectedTt, setSelectedTt] = useState<TicketType | null>(ticketTypes[0] ?? null);
  const [quantity, setQuantity]     = useState(1);
  const [buyerEmail, setBuyerEmail] = useState('');
  const [phase, setPhase]           = useState<Phase>('select');
  const [busy, setBusy]             = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [tickets, setTickets]       = useState<IssuedTicket[]>([]);

  const total = selectedTt ? selectedTt.base_price * quantity : 0;

  async function confirmPayment() {
    if (!selectedTt) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch('/api/kiosk/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          promoterSlug,
          eventId,
          ticketTypeId: selectedTt.id,
          quantity,
          buyerEmail: buyerEmail || undefined,
        }),
      });
      const d = await res.json() as { ok?: boolean; tickets?: IssuedTicket[]; error?: string; remaining?: number };
      if (!res.ok) {
        if (d.error === 'OUT_OF_STOCK') setError(`Vyprodáno — zbývá ${d.remaining ?? 0} vstupenek.`);
        else setError(d.error ?? 'Chyba při zpracování objednávky.');
        setPhase('select');
        return;
      }
      setTickets(d.tickets ?? []);
      setPhase('success');
    } catch {
      setError('Chyba sítě — zkuste znovu.');
      setPhase('select');
    } finally {
      setBusy(false);
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────
  if (phase === 'success') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-8 text-center">
        <CheckCircle className="h-20 w-20 text-emerald-400" />
        <div>
          <h2 className="text-3xl font-bold text-white">Platba přijata!</h2>
          <p className="text-gray-400 mt-2">Vaše vstupenky jsou připraveny</p>
        </div>
        <div className="flex flex-wrap gap-6 justify-center">
          {tickets.map((t, i) => (
            <div key={t.ticketId} className="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center">
              <p className="text-sm text-gray-400 mb-3">Vstupenka {i + 1}</p>
              <QrCanvas value={`tixly:${t.ticketId}:KIOSK`} />
              <p className="text-xs text-gray-500 mt-3 font-mono">{t.ticketId.slice(0, 8).toUpperCase()}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-gray-500">Naskenujte QR u vstupu · Vstupenky byly odeslány e-mailem</p>
        <Link
          href={`/kiosk/${promoterSlug}`}
          className="mt-4 px-8 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 text-white font-semibold text-lg transition-colors"
        >
          Nový nákup
        </Link>
      </div>
    );
  }

  // ── Payment waiting ───────────────────────────────────────────────────────
  if (phase === 'payment') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-8 text-center">
        <CreditCard className="h-20 w-20 text-brand-400" />
        <div>
          <h2 className="text-3xl font-bold">Přiložte kartu k terminálu</h2>
          <p className="text-2xl font-bold text-brand-400 mt-3">{formatCZK(total, currency)}</p>
          <p className="text-gray-400 mt-1">{quantity}× {selectedTt?.name}</p>
        </div>
        <div className="flex gap-4">
          <button
            onClick={() => setPhase('email')}
            className="px-8 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold text-lg transition-colors"
          >
            <ArrowLeft className="inline h-5 w-5 mr-2" />Zpět
          </button>
          <button
            onClick={confirmPayment}
            disabled={busy}
            className="px-10 py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-semibold text-lg transition-colors flex items-center gap-3"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
            Platba potvrzena
          </button>
        </div>
        {error && <p className="text-rose-400 text-sm">{error}</p>}
      </div>
    );
  }

  // ── Email (optional) ──────────────────────────────────────────────────────
  if (phase === 'email') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-8">
        <Ticket className="h-16 w-16 text-brand-400" />
        <h2 className="text-2xl font-bold text-center">Zaslat vstupenky e-mailem?</h2>
        <p className="text-gray-400 text-center max-w-sm">Nepovinné — zadejte e-mail a vstupenky dostanete i do schránky.</p>
        <input
          type="email"
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          placeholder="vas@email.cz"
          className="w-full max-w-sm rounded-xl bg-gray-800 border border-gray-700 px-5 py-4 text-lg text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
        />
        <div className="flex gap-4 w-full max-w-sm">
          <button
            onClick={() => setPhase('select')}
            className="flex-1 py-4 rounded-xl bg-gray-800 hover:bg-gray-700 font-semibold transition-colors"
          >
            <ArrowLeft className="inline h-5 w-5 mr-2" />Zpět
          </button>
          <button
            onClick={() => setPhase('payment')}
            className="flex-1 py-4 rounded-xl bg-brand-600 hover:bg-brand-500 font-semibold transition-colors"
          >
            Pokračovat
          </button>
        </div>
      </div>
    );
  }

  // ── Ticket type selection ─────────────────────────────────────────────────
  return (
    <div className="flex flex-col min-h-screen">
      <header className="flex items-center gap-4 px-8 py-5 border-b border-gray-800 bg-gray-900 shrink-0">
        <Link href={`/kiosk/${promoterSlug}`} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <h1 className="text-xl font-bold line-clamp-1">{eventTitle}</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-8 space-y-6">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-900/20 px-6 py-4 text-rose-300 text-sm">
            {error}
          </div>
        )}

        <h2 className="text-xl font-semibold text-gray-200">Vyberte typ vstupenky</h2>

        <div className="space-y-4">
          {ticketTypes.map((tt) => (
            <button
              key={tt.id}
              onClick={() => { setSelectedTt(tt); setQuantity(1); }}
              className={`w-full rounded-2xl border p-6 text-left transition-all ${
                selectedTt?.id === tt.id
                  ? 'border-brand-500 bg-brand-900/30'
                  : 'border-gray-700 bg-gray-900 hover:border-gray-600'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold">{tt.name}</p>
                  {tt.description && <p className="text-sm text-gray-400 mt-0.5">{tt.description}</p>}
                  {tt.remaining_qty < 20 && (
                    <p className="text-xs text-amber-400 mt-1">Zbývá {tt.remaining_qty} vstupenek</p>
                  )}
                </div>
                <p className="text-2xl font-bold text-white">{formatCZK(tt.base_price, currency)}</p>
              </div>
            </button>
          ))}
        </div>

        {selectedTt && (
          <div className="rounded-2xl border border-gray-700 bg-gray-900 p-6">
            <h3 className="font-semibold text-gray-200 mb-4">Počet vstupenek</h3>
            <div className="flex items-center gap-6">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="h-14 w-14 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
              >
                <Minus className="h-6 w-6" />
              </button>
              <span className="text-4xl font-bold w-16 text-center">{quantity}</span>
              <button
                onClick={() => setQuantity((q) => Math.min(selectedTt.remaining_qty, q + 1))}
                className="h-14 w-14 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center transition-colors"
              >
                <Plus className="h-6 w-6" />
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Sticky bottom CTA */}
      {selectedTt && (
        <footer className="shrink-0 border-t border-gray-800 bg-gray-900 p-6">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div>
              <p className="text-sm text-gray-400">{quantity}× {selectedTt.name}</p>
              <p className="text-3xl font-bold">{formatCZK(total, currency)}</p>
            </div>
            <button
              onClick={() => setPhase('email')}
              className="px-10 py-5 rounded-2xl bg-brand-600 hover:bg-brand-500 text-white font-bold text-xl transition-colors flex items-center gap-3"
            >
              <CreditCard className="h-6 w-6" />
              Koupit
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
