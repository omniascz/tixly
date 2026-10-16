'use client';

/**
 * Výběr slevové kategorie u každého podrženého místa a odeslání objednávky (kolo 8 / krok 4).
 * Ceny zobrazené zde jsou informativní — /api/checkout/seats je počítá znovu na serveru.
 */
import { useEffect, useMemo, useState } from 'react';

interface Category { id: string; code: string; name: string; kind: string; requiresProof: boolean; proofLabel: string | null }
interface PriceRow { categoryId: string; ticketTypeId: string; priceMinor: number }
interface SeatRow { id: string; sector: string | null; row: string | null; seatNumber: string | null; ticketTypeId: string; seatType: string | null; seatNote: string | null }
interface Zone { id: string; name: string; color: string | null }
interface Data { currency: string; zones: Zone[]; categories: Category[]; prices: PriceRow[]; seats: SeatRow[]; reservation?: { available: boolean; until: string | null } }

const ERRORS: Record<string, string> = {
  COMPANION_WITHOUT_ZTPP: 'Doprovod ZTP/P lze koupit jen spolu se vstupenkou ZTP/P.',
  TOO_MANY_COMPANIONS: 'Na jednu vstupenku ZTP/P připadá nejvýš jeden doprovod.',
  CATEGORY_LIMIT: 'Vybraná kategorie je na tento termín vyprodaná.',
  PROMO_CODE_INVALID: 'Slevový kód neplatí.',
  PROMO_CODE_NOT_APPLICABLE: 'Slevový kód nelze použít na vybrané vstupenky.',
  SEAT_UNAVAILABLE: 'Některé místo už není volné nebo vypršelo podržení. Vyberte místa znovu.',
  RESERVATION_LIMIT: 'Na jeden e-mail lze mít na tento termín nejvýš 2 aktivní rezervace.',
  RESERVATION_SEAT_LIMIT: 'Na jeden e-mail lze na tento termín rezervovat nejvýš 10 míst.',
  RESERVATION_CLOSED: 'Rezervace na tento termín už skončily — kupte prosím vstupenky online.',
  RESERVATIONS_DISABLED: 'Na tento termín nelze rezervovat.',
};

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency, maximumFractionDigits: 0 }).format(minor / 100);
}

export function CategoryCheckout({ eventId, locale, holdToken, seatIds }: { eventId: string; locale: string; holdToken: string; seatIds: string[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [promo, setPromo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reserved, setReserved] = useState<{ code: string; until: string; total: number } | null>(null);

  useEffect(() => {
    fetch(`/api/public/events/${eventId}/seat-prices`)
      .then((r) => (r.ok ? (r.json() as Promise<Data>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setData(d);
        const full = d.categories.find((c) => c.kind === 'full') ?? d.categories[0];
        if (full) setChoice(Object.fromEntries(seatIds.map((id) => [id, full.id])));
      })
      .catch((e: Error) => setError(e.message));
  }, [eventId, seatIds]);

  const seats = useMemo(() => (data ? seatIds.map((id) => data.seats.find((s) => s.id === id)).filter((s): s is SeatRow => !!s) : []), [data, seatIds]);
  const priceOf = (catId: string, ttId: string): number | null => data?.prices.find((p) => p.categoryId === catId && p.ticketTypeId === ttId)?.priceMinor ?? null;
  const total = seats.reduce((sum, s) => sum + (priceOf(choice[s.id], s.ticketTypeId) ?? 0), 0);

  async function submit(e: React.FormEvent, mode: 'gopay' | 'box_office_reservation' = 'gopay') {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/seats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventId, seatHoldToken: holdToken,
          items: seats.map((s) => ({ seatId: s.id, categoryId: choice[s.id] })),
          buyerEmail: email, buyerName: name, buyerPhone: phone || undefined, promoCode: promo.trim() || undefined,
          paymentMethod: mode,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string; message?: string; gatewayUrl?: string; reservationCode?: string; expiresAt?: string; totalAmount?: number;
      };
      if (res.ok && j.reservationCode && j.expiresAt) {
        setReserved({ code: j.reservationCode, until: j.expiresAt, total: j.totalAmount ?? 0 });
        return;
      }
      if (!res.ok || !j.gatewayUrl) {
        setError((j.error && ERRORS[j.error]) ?? j.message ?? j.error ?? `HTTP ${res.status}`);
        return;
      }
      window.location.href = j.gatewayUrl;
    } finally {
      setBusy(false);
    }
  }

  if (!holdToken || seatIds.length === 0) {
    return <p className="text-sm">Nejdřív vyberte místa na <a className="underline" href={`/${locale}/events/${eventId}/seats`}>plánku sálu</a>.</p>;
  }
  if (!data) return <p className="text-sm text-slate-500">{error ?? 'Načítám…'}</p>;
  if (reserved) {
    return (
      <div className="space-y-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4" data-testid="reservation-done">
        <h2 className="text-lg font-semibold">Rezervace je hotová</h2>
        <p>Kód rezervace: <strong className="text-xl tracking-widest" data-testid="reservation-code">{reserved.code}</strong></p>
        <p>Cena celkem: <strong>{money(reserved.total, data.currency)}</strong></p>
        <p>Vyzvedněte a zaplaťte na pokladně nejpozději <strong>{new Date(reserved.until).toLocaleString('cs-CZ')}</strong>. Potom se místa uvolní.</p>
        <p className="text-sm text-slate-600">Potvrzení s kódem a odkazem pro zrušení jsme poslali na {email}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" data-testid="category-checkout">
      <ul className="space-y-3">
        {seats.map((s) => {
          const zone = data.zones.find((z) => z.id === s.ticketTypeId);
          const cat = data.categories.find((c) => c.id === choice[s.id]);
          return (
            <li key={s.id} className="rounded-lg border border-slate-200 p-3" data-testid="seat-category-row">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: zone?.color ?? '#94a3b8' }} />
                {s.sector}, řada {s.row}, místo {s.seatNumber}
                <span className="ml-auto text-slate-500">{zone?.name}</span>
              </div>
              {s.seatType === 'restricted' && <p className="mt-1 text-xs text-amber-700">Omezený výhled{s.seatNote ? `: ${s.seatNote}` : ''}</p>}
              <select
                aria-label={`Kategorie pro řadu ${s.row ?? ''} místo ${s.seatNumber ?? ''}`}
                className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-base"
                value={choice[s.id] ?? ''}
                onChange={(e) => setChoice({ ...choice, [s.id]: e.target.value })}
              >
                {data.categories.map((c) => {
                  const p = priceOf(c.id, s.ticketTypeId);
                  return p === null ? null : <option key={c.id} value={c.id}>{c.name} — {money(p, data.currency)}</option>;
                })}
              </select>
              {cat?.requiresProof && <p className="mt-1 text-xs text-slate-600">Při vstupu předložte průkaz: {cat.proofLabel ?? cat.name}</p>}
            </li>
          );
        })}
      </ul>

      <div className="grid gap-3">
        <input required type="email" autoComplete="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-md border border-slate-300 px-3 py-3 text-base" />
        <input required autoComplete="name" placeholder="Jméno a příjmení" value={name} onChange={(e) => setName(e.target.value)} className="rounded-md border border-slate-300 px-3 py-3 text-base" />
        <input type="tel" autoComplete="tel" placeholder="Telefon (nepovinné)" value={phone} onChange={(e) => setPhone(e.target.value)} className="rounded-md border border-slate-300 px-3 py-3 text-base" />
        <input placeholder="Slevový kód (nepovinné)" value={promo} onChange={(e) => setPromo(e.target.value)} className="rounded-md border border-slate-300 px-3 py-3 text-base" />
      </div>

      {error && <p role="alert" className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}

      <div className="sticky bottom-0 -mx-4 border-t border-slate-200 bg-white px-4 py-3">
        <div className="mb-2 flex justify-between text-base font-semibold">
          <span>Celkem {promo.trim() ? '(před slevovým kódem)' : ''}</span>
          <span data-testid="category-total">{money(total, data.currency)}</span>
        </div>
        <button type="submit" disabled={busy} className="w-full rounded-md bg-slate-900 px-4 py-3 text-base font-semibold text-white disabled:opacity-50">
          {busy ? 'Odesílám…' : 'Zaplatit'}
        </button>
        {data.reservation?.available && (
          <button
            type="button"
            disabled={busy}
            data-testid="reserve-box-office"
            onClick={(e) => {
              const form = (e.currentTarget as HTMLButtonElement).form;
              if (form && !form.reportValidity()) return;
              void submit(e as unknown as React.FormEvent, 'box_office_reservation');
            }}
            className="mt-2 w-full rounded-md border border-slate-900 px-4 py-3 text-base font-semibold text-slate-900 disabled:opacity-50"
          >
            Rezervovat, zaplatím na pokladně
            {data.reservation.until && <span className="block text-xs font-normal">vyzvednout do {new Date(data.reservation.until).toLocaleString('cs-CZ')}</span>}
          </button>
        )}
      </div>
    </form>
  );
}
