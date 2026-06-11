'use client';

import { useEffect, useMemo, useState } from 'react';

interface TicketType {
  id: string;
  name: string;
  basePrice: number;
  remainingQty: number;
}
interface Seat {
  id: string;
  sector: string;
  row: string;
  num: string;
  status: string;
  ttId: string | null;
}
interface Event {
  id: string;
  title: string;
  date_start: string;
  city: string | null;
  venue_name: string | null;
  cover_image: string | null;
  promoter_name: string;
  brand_color_hex: string | null;
}

const MAX_SEATS = 10;

/**
 * Stabilní per-prohlížeč tag pro guest hold. Posílá se jako x-fingerprint, aby
 * server uměl při retry uvolnit POUZE předchozí hold tohoto prohlížeče (ne cizí).
 * localStorage drží hodnotu napříč pokusy; v private/blokovaném režimu vrací '' →
 * server pak úklid přeskočí (bezpečný no-op místo uvolnění sdíleného tagu).
 */
function guestFingerprint(): string {
  try {
    const KEY = 'tixly_guest_fp';
    let v = localStorage.getItem(KEY);
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(KEY, v);
    }
    return v;
  } catch {
    return '';
  }
}

/**
 * Inline prodejní widget — celý nákup UVNITŘ iframu (žádný odskok). Dva režimy:
 *  - SEATED: číslovaná místa (mapa sektor→řada→místo z /api/events/:id/seats,
 *    hold + seated checkout) — pro divadlo (seat plan ze superadminu).
 *  - GA: volný vstup (typ + počet).
 * Stejná logika je použitelná i jako nativní React komponenta (Path A) bez iframu.
 */
export function EmbedClient({ event }: { event: Event; variant?: string }) {
  const brand =
    event.brand_color_hex && /^#[0-9a-f]{6}$/i.test(event.brand_color_hex)
      ? event.brand_color_hex
      : '#B8261A';

  const [mode, setMode] = useState<'loading' | 'ga' | 'seated'>('loading');
  // GA
  const [types, setTypes] = useState<TicketType[]>([]);
  const [gaSel, setGaSel] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  // SEATED
  const [seats, setSeats] = useState<Seat[]>([]);
  const [ttPrice, setTtPrice] = useState<Map<string, number>>(new Map());
  const [picked, setPicked] = useState<string[]>([]);
  const [activeTt, setActiveTt] = useState<string | null>(null);
  // shared
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ gatewayUrl: string } | null>(null);

  // Načti — nejdřív zkus mapu sedadel; když není, spadni na GA (ticket-types).
  useEffect(() => {
    void (async () => {
      try {
        const sres = await fetch(`/api/events/${event.id}/seats`);
        if (sres.ok) {
          const j = (await sres.json()) as { seats: Seat[]; ticketTypes: { id: string; price: number }[] };
          if (j.seats && j.seats.length > 0) {
            setSeats(j.seats);
            setTtPrice(new Map(j.ticketTypes.map((t) => [t.id, t.price])));
            setMode('seated');
            return;
          }
        }
      } catch {
        /* spadni na GA */
      }
      try {
        const res = await fetch(`/api/events/${event.id}/ticket-types`);
        const j = (await res.json()) as { ticketTypes?: TicketType[] };
        const list = (j.ticketTypes ?? []).filter((t) => t.remainingQty > 0);
        setTypes(list);
        if (list.length > 0) setGaSel(list[0].id);
      } catch {
        /* prázdné */
      }
      setMode('ga');
    })();
  }, [event.id]);

  // Auto-resize iframu (parent embed.js poslouchá 'tixly:resize').
  useEffect(() => {
    function postHeight(): void {
      if (typeof window === 'undefined' || !window.parent) return;
      window.parent.postMessage({ type: 'tixly:resize', height: document.documentElement.scrollHeight }, '*');
    }
    postHeight();
    const ro = new ResizeObserver(postHeight);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [mode, picked, gaSel, qty, done, error]);

  // SEATED: seskup sedadla sektor → řada (pro mřížku).
  const grid = useMemo(() => {
    const bySector = new Map<string, Map<string, Seat[]>>();
    for (const s of seats) {
      const sec = bySector.get(s.sector) ?? new Map<string, Seat[]>();
      const row = sec.get(s.row) ?? [];
      row.push(s);
      sec.set(s.row, row);
      bySector.set(s.sector, sec);
    }
    for (const sec of bySector.values())
      for (const row of sec.values()) row.sort((a, b) => Number(a.num) - Number(b.num) || a.num.localeCompare(b.num));
    return bySector;
  }, [seats]);

  function toggleSeat(s: Seat): void {
    if (s.status !== 'available') return;
    setError(null);
    setPicked((prev) => {
      if (prev.includes(s.id)) {
        const next = prev.filter((x) => x !== s.id);
        if (next.length === 0) setActiveTt(null);
        return next;
      }
      if (activeTt && s.ttId !== activeTt) {
        setError('V jedné objednávce vyber místa stejné cenové kategorie.');
        return prev;
      }
      if (prev.length >= MAX_SEATS) {
        setError(`Max ${MAX_SEATS} míst na objednávku.`);
        return prev;
      }
      if (!activeTt) setActiveTt(s.ttId);
      return [...prev, s.id];
    });
  }

  const gaType = types.find((t) => t.id === gaSel) ?? null;
  const total =
    mode === 'seated'
      ? picked.reduce((sum, id) => {
          const s = seats.find((x) => x.id === id);
          return sum + (s?.ttId ? ttPrice.get(s.ttId) ?? 0 : 0);
        }, 0) / 100
      : gaType
        ? (gaType.basePrice * qty) / 100
        : 0;
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const canBuy = emailValid && (mode === 'seated' ? picked.length > 0 : !!gaSel);

  async function buy(): Promise<void> {
    if (!canBuy) return;
    setLoading(true);
    setError(null);
    try {
      const buyerEmail = email.trim().toLowerCase();
      const buyerName = name.trim() || email.split('@')[0];
      let body: Record<string, unknown>;

      if (mode === 'seated') {
        const hres = await fetch(`/api/events/${event.id}/seats/hold`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-fingerprint': guestFingerprint() },
          body: JSON.stringify({ seatIds: picked }),
        });
        const hj = (await hres.json()) as { holdToken?: string; error?: string };
        if (!hres.ok || !hj.holdToken) {
          setError(hj.error === 'SEAT_UNAVAILABLE' ? 'Některé místo právě obsadil někdo jiný — vyber jiné.' : 'Rezervace míst selhala.');
          // refresh mapy
          const sres = await fetch(`/api/events/${event.id}/seats`);
          if (sres.ok) { const j = (await sres.json()) as { seats: Seat[] }; setSeats(j.seats); setPicked([]); setActiveTt(null); }
          return;
        }
        body = {
          eventId: event.id, ticketTypeId: activeTt, quantity: picked.length,
          seatIds: picked, seatHoldToken: hj.holdToken, buyerEmail, buyerName,
        };
      } else {
        body = { eventId: event.id, ticketTypeId: gaSel, quantity: qty, buyerEmail, buyerName };
      }

      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const j = (await res.json()) as { orderId?: string; gatewayUrl?: string; error?: string; message?: string };
      if (!res.ok || !j.gatewayUrl) {
        setError(j.message ?? j.error ?? 'Nákup se nezdařil.');
        return;
      }
      setDone({ gatewayUrl: j.gatewayUrl });
    } catch {
      setError('Chyba spojení.');
    } finally {
      setLoading(false);
    }
  }

  const card: React.CSSProperties = {
    border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
    background: 'white', maxWidth: 480, fontFamily: 'system-ui, sans-serif', color: '#1A1814',
  };

  if (done) {
    const payUrl = done.gatewayUrl.startsWith('http') ? done.gatewayUrl : window.location.origin + done.gatewayUrl;
    return (
      <div style={card}>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🎟</div>
          <h2 style={{ margin: '8px 0 0', fontSize: 18 }}>Objednávka vytvořena</h2>
          <p style={{ color: '#5C564B', fontSize: 14, margin: '6px 0 16px' }}>{total.toLocaleString('cs-CZ')} Kč</p>
          <a href={payUrl} target="_blank" rel="noreferrer"
             style={{ display: 'block', background: brand, color: '#fff', padding: '14px 16px', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>
            Zaplatit {total.toLocaleString('cs-CZ')} Kč
          </a>
          <p style={{ color: '#8A8478', fontSize: 11, marginTop: 10 }}>Vstupenky dorazí e-mailem po zaplacení.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={card}>
      {event.cover_image ? (
        <div style={{ aspectRatio: '16/9', backgroundImage: `url(${event.cover_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
      ) : (
        <div style={{ aspectRatio: '16/9', background: `linear-gradient(135deg, ${brand}, ${brand}99)` }} />
      )}
      <div style={{ padding: 18 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{event.title}</h2>
        <p style={{ margin: '4px 0 14px', fontSize: 13, color: '#5C564B' }}>
          {new Date(event.date_start).toLocaleString('cs-CZ', { dateStyle: 'long', timeStyle: 'short' })}
          {event.venue_name ? ` · ${event.venue_name}` : ''}
        </p>

        {mode === 'loading' ? <p style={{ color: '#8A8478', fontSize: 14 }}>Načítám…</p> : null}

        {mode === 'seated' ? (
          <>
            <div style={{ fontSize: 12, color: '#8A8478', marginBottom: 8 }}>🎭 Vyber si místo v sále</div>
            <div style={{ border: '1px solid #f0ede5', borderRadius: 8, padding: 10, maxHeight: 280, overflowY: 'auto' }}>
              <div style={{ textAlign: 'center', fontSize: 11, color: '#8A8478', borderBottom: `2px solid ${brand}`, paddingBottom: 6, marginBottom: 10 }}>JEVIŠTĚ</div>
              {Array.from(grid.entries()).map(([sector, rows]) => (
                <div key={sector} style={{ marginBottom: 10 }}>
                  {grid.size > 1 ? <div style={{ fontSize: 11, fontWeight: 700, color: '#5C564B', marginBottom: 4 }}>{sector}</div> : null}
                  {Array.from(rows.entries()).map(([row, rs]) => (
                    <div key={row} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                      <span style={{ width: 18, fontSize: 10, color: '#8A8478', flexShrink: 0 }}>{row}</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {rs.map((s) => {
                          const isPicked = picked.includes(s.id);
                          const avail = s.status === 'available';
                          return (
                            <button key={s.id} type="button" title={`${row}${s.num}`}
                              onClick={() => toggleSeat(s)} disabled={!avail && !isPicked}
                              style={{
                                width: 20, height: 20, borderRadius: 4, fontSize: 8, cursor: avail ? 'pointer' : 'default',
                                border: `1px solid ${isPicked ? brand : avail ? '#cfc8ba' : 'transparent'}`,
                                background: isPicked ? brand : avail ? '#fff' : '#e5e0d5',
                                color: isPicked ? '#fff' : '#8A8478',
                              }}>
                              {s.num}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#8A8478', margin: '8px 0 4px' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, border: '1px solid #cfc8ba', borderRadius: 2, verticalAlign: 'middle' }} /> volné</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: brand, borderRadius: 2, verticalAlign: 'middle' }} /> vybrané</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#e5e0d5', borderRadius: 2, verticalAlign: 'middle' }} /> obsazené</span>
            </div>
            {picked.length > 0 ? (
              <p style={{ fontSize: 13, fontWeight: 600, margin: '6px 0' }}>
                Vybráno {picked.length}× ·{' '}
                {picked.map((id) => { const s = seats.find((x) => x.id === id); return s ? `${s.row}${s.num}` : ''; }).join(', ')}
              </p>
            ) : null}
          </>
        ) : null}

        {mode === 'ga' ? (
          types.length === 0 ? (
            <p style={{ color: '#8A8478', fontSize: 14 }}>Momentálně nejsou v prodeji žádné vstupenky.</p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 8 }}>
                {types.map((t) => (
                  <label key={t.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: `1px solid ${gaSel === t.id ? brand : '#e5e7eb'}`, borderRadius: 8, cursor: 'pointer', background: gaSel === t.id ? `${brand}0d` : '#fff' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input type="radio" name="tt" checked={gaSel === t.id} onChange={() => setGaSel(t.id)} style={{ accentColor: brand }} />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{t.name}</span>
                    </span>
                    <strong style={{ fontSize: 14 }}>{(t.basePrice / 100).toLocaleString('cs-CZ')} Kč</strong>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '14px 0' }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Počet</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} style={stepBtn(brand)}>−</button>
                  <span style={{ minWidth: 22, textAlign: 'center', fontWeight: 700 }}>{qty}</span>
                  <button type="button" onClick={() => setQty((q) => Math.min(gaType ? Math.min(gaType.remainingQty, 10) : 10, q + 1))} style={stepBtn(brand)}>+</button>
                </span>
              </div>
            </>
          )
        ) : null}

        {mode !== 'loading' && !(mode === 'ga' && types.length === 0) ? (
          <>
            <input type="email" inputMode="email" placeholder="Tvůj e-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inp, marginTop: 10 }} />
            <input type="text" placeholder="Jméno (volitelné)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, marginTop: 8 }} />
            {error ? <p style={{ color: '#B8261A', fontSize: 13, margin: '10px 0 0' }}>{error}</p> : null}
            <button type="button" onClick={() => void buy()} disabled={loading || !canBuy}
              style={{ width: '100%', marginTop: 14, background: brand, color: '#fff', padding: '14px 16px', borderRadius: 8, border: 0, fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: loading || !canBuy ? 0.6 : 1 }}>
              {loading ? 'Zpracovávám…' : `Koupit · ${total.toLocaleString('cs-CZ')} Kč`}
            </button>
            <p style={{ color: '#8A8478', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              Vstupenky na <span style={{ color: brand }}>{event.promoter_name}</span> · platba kartou
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = {
  width: '100%', padding: '11px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 14, color: '#1A1814', background: '#FAF8F4', boxSizing: 'border-box',
};
function stepBtn(brand: string): React.CSSProperties {
  return { width: 36, height: 36, borderRadius: 8, border: 0, background: '#F0EDE5', color: brand, fontSize: 20, fontWeight: 700, cursor: 'pointer' };
}
