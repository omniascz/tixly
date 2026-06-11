'use client';

import { useEffect, useState } from 'react';

interface TicketType {
  id: string;
  name: string;
  basePrice: number;
  remainingQty: number;
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

/**
 * Inline prodejní widget — celý nákup proběhne UVNITŘ iframu (žádný odskok na
 * tixly.cz). Výběr typu → počet → e-mail/jméno → POST /api/checkout (guest) →
 * krok platby. Stejná logika je použitelná i jako nativní React komponenta
 * (Path A) bez iframu — pak jen absolutní URL + CORS.
 */
export function EmbedClient({ event }: { event: Event; variant?: string }) {
  const [types, setTypes] = useState<TicketType[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; gatewayUrl: string } | null>(null);

  const brand =
    event.brand_color_hex && /^#[0-9a-f]{6}$/i.test(event.brand_color_hex)
      ? event.brand_color_hex
      : '#B8261A';

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/events/${event.id}/ticket-types`);
        const j = (await res.json()) as { ticketTypes?: TicketType[] };
        const list = (j.ticketTypes ?? []).filter((t) => t.remainingQty > 0);
        setTypes(list);
        if (list.length > 0) setSelected(list[0].id);
      } catch {
        setTypes([]);
      }
    })();
  }, [event.id]);

  // Auto-resize iframu podle obsahu (parent embed.js poslouchá 'tixly:resize').
  useEffect(() => {
    function postHeight(): void {
      if (typeof window === 'undefined' || !window.parent) return;
      window.parent.postMessage({ type: 'tixly:resize', height: document.documentElement.scrollHeight }, '*');
    }
    postHeight();
    const ro = new ResizeObserver(postHeight);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [types, done, error, selected, qty]);

  const sel = types?.find((t) => t.id === selected) ?? null;
  const total = sel ? (sel.basePrice * qty) / 100 : 0;
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

  async function buy(): Promise<void> {
    if (!selected || !emailValid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId: event.id,
          ticketTypeId: selected,
          quantity: qty,
          buyerEmail: email.trim().toLowerCase(),
          buyerName: name.trim() || email.split('@')[0],
        }),
      });
      const j = (await res.json()) as { orderId?: string; gatewayUrl?: string; error?: string; message?: string };
      if (!res.ok || !j.orderId || !j.gatewayUrl) {
        setError(j.message ?? j.error ?? 'Nákup se nezdařil.');
        return;
      }
      setDone({ orderId: j.orderId, gatewayUrl: j.gatewayUrl });
    } catch {
      setError('Chyba spojení.');
    } finally {
      setLoading(false);
    }
  }

  const card: React.CSSProperties = {
    border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden',
    background: 'white', maxWidth: 460, fontFamily: 'system-ui, sans-serif', color: '#1A1814',
  };

  if (done) {
    const payUrl = done.gatewayUrl.startsWith('http') ? done.gatewayUrl : window.location.origin + done.gatewayUrl;
    return (
      <div style={card}>
        <div style={{ padding: 20, textAlign: 'center' }}>
          <div style={{ fontSize: 40 }}>🎟</div>
          <h2 style={{ margin: '8px 0 0', fontSize: 18 }}>Objednávka vytvořena</h2>
          <p style={{ color: '#5C564B', fontSize: 14, margin: '6px 0 16px' }}>
            {qty}× {sel?.name} · {total.toLocaleString('cs-CZ')} Kč
          </p>
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
          {event.city ? ` · ${event.city}` : ''}
        </p>

        {types === null ? (
          <p style={{ color: '#8A8478', fontSize: 14 }}>Načítám vstupenky…</p>
        ) : types.length === 0 ? (
          <p style={{ color: '#8A8478', fontSize: 14 }}>Momentálně nejsou v prodeji žádné vstupenky.</p>
        ) : (
          <>
            <div style={{ display: 'grid', gap: 8 }}>
              {types.map((t) => (
                <label key={t.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', border: `1px solid ${selected === t.id ? brand : '#e5e7eb'}`, borderRadius: 8, cursor: 'pointer', background: selected === t.id ? `${brand}0d` : '#fff' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="radio" name="tt" checked={selected === t.id} onChange={() => setSelected(t.id)} style={{ accentColor: brand }} />
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
                <button type="button" onClick={() => setQty((q) => Math.min(sel ? Math.min(sel.remainingQty, 10) : 10, q + 1))} style={stepBtn(brand)}>+</button>
              </span>
            </div>

            <input type="email" inputMode="email" placeholder="Tvůj e-mail" value={email} onChange={(e) => setEmail(e.target.value)} style={inp} />
            <input type="text" placeholder="Jméno (volitelné)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, marginTop: 8 }} />

            {error ? <p style={{ color: '#B8261A', fontSize: 13, margin: '10px 0 0' }}>{error}</p> : null}

            <button type="button" onClick={() => void buy()} disabled={loading || !emailValid || !selected}
              style={{ width: '100%', marginTop: 14, background: brand, color: '#fff', padding: '14px 16px', borderRadius: 8, border: 0, fontWeight: 700, fontSize: 15, cursor: 'pointer', opacity: loading || !emailValid ? 0.6 : 1 }}>
              {loading ? 'Zpracovávám…' : `Koupit · ${total.toLocaleString('cs-CZ')} Kč`}
            </button>
            <p style={{ color: '#8A8478', fontSize: 11, textAlign: 'center', marginTop: 8 }}>
              Vstupenky na <span style={{ color: brand }}>{event.promoter_name}</span> · platba kartou
            </p>
          </>
        )}
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
