'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface ResaleListing {
  id: string;
  ticket_type_name: string;
  seat_label: string | null;
  section_label: string | null;
  original_price_halire: number;
  listing_price_halire: number;
  platform_fee_halire: number;
  listed_at: string;
  seller_notes: string | null;
  markup_pct: string;
}
interface PageData {
  resale_enabled: boolean;
  max_price_pct: number;
  platform_fee_pct: number;
  fansale_mode: boolean;
  listings: ResaleListing[];
  count: number;
}

const fmt = (h: number) => `${(h / 100).toLocaleString('cs-CZ')} Kč`;

export default function EventResalePage() {
  const { id: eventId, locale } = useParams<{ id: string; locale: string }>();
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'price' | 'markup' | 'date'>('price');
  const [filterType, setFilterType] = useState('all');
  const [buyingId, setBuyingId] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/events/${eventId}/resale-listings`)
      .then((r) => r.json())
      .then((d) => { setData(d as PageData); setLoading(false); });
  }, [eventId]);

  async function handleBuy(listingId: string) {
    setBuyingId(listingId);
    const r = await fetch(`/api/resale/purchase/${listingId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payment_method: 'gopay' }),
    });

    if (r.status === 401) {
      window.location.href = `/${locale}/login?return=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    const d = await r.json() as { payment_url?: string; error?: string };
    if (d.payment_url) {
      window.location.href = d.payment_url;
    } else {
      alert(d.error ?? 'Chyba při nákupu. Zkuste to znovu.');
      setBuyingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-slate-400">
        Načítám nabídky…
      </div>
    );
  }

  if (!data?.resale_enabled) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-slate-900 mb-2">Sekundární trh není aktivní</h1>
        <p className="text-slate-500">Pořadatel pro tuto akci nepovoli prodej vstupenek mezi fanoušky.</p>
        <Link href={`/${locale}/events/${eventId}`} className="mt-6 inline-block text-indigo-700 hover:underline text-sm">
          ← Zpět na akci
        </Link>
      </div>
    );
  }

  const ticketTypes = [...new Set(data.listings.map((l) => l.ticket_type_name))];

  const sorted = [...data.listings]
    .filter((l) => filterType === 'all' || l.ticket_type_name === filterType)
    .sort((a, b) => {
      if (sortBy === 'price') return a.listing_price_halire - b.listing_price_halire;
      if (sortBy === 'markup') return Number(a.markup_pct) - Number(b.markup_pct);
      return new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime();
    });

  const cheapest = sorted[0]?.listing_price_halire;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link href={`/${locale}/events/${eventId}`} className="text-sm text-indigo-700 hover:underline">
          ← Zpět na akci
        </Link>
        <div className="flex items-center gap-3 mt-3 flex-wrap">
          <h1 className="text-2xl font-bold text-slate-900">🔄 Fan-to-fan resale</h1>
          {data.fansale_mode && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-700 text-white text-xs font-bold tracking-wide">
              🛡️ Tixly fanSALE
            </span>
          )}
        </div>
        {data.fansale_mode ? (
          <p className="text-slate-600 text-sm mt-1">
            Vstupenky od jiných fanoušků za{' '}
            <strong>max. jmenovitou cenu</strong> — žádné přirážky, žádné překupníky.
            Tixly si nechá {data.platform_fee_pct} % jako poplatek za zprostředkování.
          </p>
        ) : (
          <p className="text-slate-500 text-sm mt-1">
            Vstupenky od jiných fanoušků. Cena max.{' '}
            <strong>{(data.max_price_pct - 100).toFixed(0)} %</strong> nad face value.
            Tixly si nechá {data.platform_fee_pct} % jako ochranu — zbytek jde prodávajícímu.
          </p>
        )}
      </div>

      {/* fanSALE info banner */}
      {data.fansale_mode && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <p className="font-semibold text-emerald-900 text-sm">Tixly fanSALE — garantovaná cena</p>
              <p className="text-sm text-emerald-800 mt-0.5">
                Pořadatel aktivoval fanSALE. Každá vstupenka na tomto trhu je nabízena{' '}
                <strong>za max. původní cenu</strong> — systém to technicky vynucuje při listingu.
                Nemůžete přeplatit za vstupenku více, než jste zaplatili u přeprodejce.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Info bar */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-5 py-3 flex items-center justify-between text-sm">
        <div className="text-indigo-900">
          <strong>{data.count}</strong> {data.count === 1 ? 'nabídka' : data.count < 5 ? 'nabídky' : 'nabídek'} k dispozici
          {cheapest !== undefined && (
            <> · nejlevnější od <strong>{fmt(cheapest)}</strong></>
          )}
        </div>
        <div className="text-xs text-indigo-700">Platba chráněná · nový QR kód vydán okamžitě</div>
      </div>

      {/* Filters + sort */}
      <div className="flex gap-2 flex-wrap items-center">
        <span className="text-xs text-slate-500">Typ:</span>
        {['all', ...ticketTypes].map((t) => (
          <button key={t} onClick={() => setFilterType(t)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium ${
              filterType === t ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
            }`}>
            {t === 'all' ? 'Vše' : t}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <span className="text-xs text-slate-500 self-center">Seřadit:</span>
          {[['price', 'Cena'], ['markup', 'Přirážka'], ['date', 'Datum']] .map(([val, label]) => (
            <button key={val} onClick={() => setSortBy(val as typeof sortBy)}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                sortBy === val ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Listings */}
      {sorted.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🎫</div>
          <div className="text-slate-500">Momentálně žádné nabídky.</div>
          <div className="text-slate-400 text-sm mt-1">Zkuste to znovu později nebo si přidejte do hlídání.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((l) => {
            const markup = Number(l.markup_pct);
            const isBuying = buyingId === l.id;
            return (
              <div key={l.id} className="bg-white border rounded-xl p-4 flex items-center gap-4 hover:border-indigo-300 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900">{l.ticket_type_name}</span>
                    {l.seat_label && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                        🪑 {l.seat_label}
                      </span>
                    )}
                    {l.section_label && (
                      <span className="text-xs text-slate-400">{l.section_label}</span>
                    )}
                    {data.fansale_mode ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-100 text-emerald-800">
                        🛡️ fanSALE · {markup <= 0 ? 'pod face' : markup === 0 ? 'jmenovitá cena' : `+${markup} %`}
                      </span>
                    ) : (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        markup <= 0 ? 'bg-emerald-100 text-emerald-800' :
                        markup <= 5 ? 'bg-blue-100 text-blue-800' :
                        markup <= 10 ? 'bg-amber-100 text-amber-800' :
                        'bg-orange-100 text-orange-800'
                      }`}>
                        {markup >= 0 ? '+' : ''}{markup} % {markup <= 0 ? '(pod face)' : markup <= 5 ? '(mírná přirážka)' : ''}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-3 mt-1.5">
                    <span className="text-xl font-bold text-slate-900">{fmt(l.listing_price_halire)}</span>
                    <span className="text-sm text-slate-400 line-through">{fmt(l.original_price_halire)} face</span>
                  </div>

                  <div className="text-xs text-slate-400 mt-0.5">
                    Přidáno {new Date(l.listed_at).toLocaleDateString('cs-CZ')}
                    {l.seller_notes && <> · <em>{l.seller_notes}</em></>}
                  </div>
                </div>

                <div className="shrink-0">
                  <button
                    onClick={() => void handleBuy(l.id)}
                    disabled={isBuying}
                    className="bg-indigo-700 hover:bg-indigo-800 text-white px-5 py-2.5 rounded-xl font-medium text-sm disabled:opacity-50 transition-colors"
                  >
                    {isBuying ? 'Přesměrovávám…' : 'Koupit'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Trust badges */}
      <div className="grid grid-cols-3 gap-3 pt-2">
        {[
          { icon: '🔒', title: 'Bezpečná platba', desc: 'Chráněno Tixly — peníze zpět pokud transfer selže' },
          { icon: '🎫', title: 'Nový QR kód', desc: 'Starý lístek je zneplatněn, dostanete nový ihned' },
          data.fansale_mode
            ? { icon: '🛡️', title: 'Tixly fanSALE', desc: 'Cena max. = jmenovitá hodnota — systém vynucuje, nelze obejít' }
            : { icon: '💸', title: 'Transparentní ceny', desc: `Max ${(data.max_price_pct - 100).toFixed(0)} % nad face value — žádné skryté přirážky` },
        ].map((b) => (
          <div key={b.title} className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
            <div className="text-2xl mb-1">{b.icon}</div>
            <div className="text-xs font-semibold text-slate-800">{b.title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{b.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
