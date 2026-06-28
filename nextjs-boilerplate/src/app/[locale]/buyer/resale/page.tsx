'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface MyListing {
  id: string;
  ticket_id: string;
  ticket_type_name: string;
  seat_label: string | null;
  original_price_halire: number;
  listing_price_halire: number;
  platform_fee_halire: number;
  seller_payout_halire: number;
  status: string;
  listed_at: string;
  sold_at: string | null;
  event_title: string;
  event_slug: string;
  start_date: string;
}

const fmt = (h: number) => `${(h / 100).toLocaleString('cs-CZ')} Kč`;

const STATUS_LABEL: Record<string, string> = {
  available: 'V nabídce', reserved: 'Rezervováno', sold: 'Prodáno',
  cancelled: 'Zrušeno', expired: 'Vypršelo',
};
const STATUS_COLOR: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  reserved: 'bg-amber-100 text-amber-800',
  sold: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-slate-100 text-slate-500',
  expired: 'bg-red-100 text-red-600',
};

export default function MyResalePage() {
  const { locale } = useParams<{ locale: string }>();
  const [listings, setListings] = useState<MyListing[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const r = await fetch('/api/buyer/resale');
    const d = await r.json() as { listings: MyListing[] };
    setListings(d.listings ?? []);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function cancel(ticketId: string) {
    const r = await fetch(`/api/buyer/tickets/${ticketId}/list-for-resale`, { method: 'DELETE' });
    if (r.ok) await load();
    else {
      const d = await r.json() as { error?: string };
      alert(d.error ?? 'Chyba při rušení nabídky');
    }
  }

  if (loading) return <div className="flex items-center justify-center py-24 text-slate-400">Načítám…</div>;

  const active = listings.filter((l) => l.status === 'available' || l.status === 'reserved');
  const past = listings.filter((l) => l.status !== 'available' && l.status !== 'reserved');

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Moje nabídky k prodeji</h1>
        <Link href={`/${locale}/my-tickets`} className="text-sm text-indigo-700 hover:underline">
          ← Moje lístky
        </Link>
      </div>

      {listings.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">🎫</div>
          <div className="text-slate-600 font-medium">Žádné aktivní nabídky</div>
          <div className="text-slate-400 text-sm mt-1">
            Chcete prodat lístek? Jděte do <Link href={`/${locale}/my-tickets`} className="text-indigo-700 hover:underline">Moje lístky</Link> a klikněte na „Prodat".
          </div>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Aktivní</h2>
              {active.map((l) => (
                <div key={l.id} className="bg-white border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">{l.ticket_type_name}</span>
                        {l.seat_label && <span className="text-xs text-slate-400">🪑 {l.seat_label}</span>}
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[l.status] ?? ''}`}>
                          {STATUS_LABEL[l.status] ?? l.status}
                        </span>
                      </div>
                      <div className="text-sm text-slate-500 mt-0.5">{l.event_title}</div>
                      <div className="flex gap-4 mt-2 text-sm">
                        <div>
                          <div className="text-xs text-slate-400">Vaše nabídka</div>
                          <div className="font-bold text-slate-900">{fmt(l.listing_price_halire)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Dostanete (po fee)</div>
                          <div className="font-semibold text-emerald-700">{fmt(l.seller_payout_halire)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Fee Tixly</div>
                          <div className="text-slate-600">{fmt(l.platform_fee_halire)}</div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Face value</div>
                          <div className="text-slate-400 line-through">{fmt(l.original_price_halire)}</div>
                        </div>
                      </div>
                      <div className="text-xs text-slate-400 mt-1.5">
                        V nabídce od {new Date(l.listed_at).toLocaleDateString('cs-CZ')}
                      </div>
                      {l.status === 'reserved' && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-2">
                          Lístek je rezervován kupujícím — čeká se na platbu.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Link href={`/${locale}/events/${l.event_slug}/resale`}
                        className="text-xs px-3 py-1.5 border border-indigo-300 text-indigo-700 hover:bg-indigo-50 rounded-lg text-center">
                        Zobrazit na burze
                      </Link>
                      {l.status === 'available' && (
                        <button
                          onClick={() => void cancel(l.ticket_id)}
                          className="text-xs px-3 py-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded-lg">
                          Stáhnout nabídku
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {past.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Historie</h2>
              {past.map((l) => (
                <div key={l.id} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
                  <div className="flex-1 text-sm">
                    <span className="font-medium text-slate-700">{l.ticket_type_name}</span>
                    {' · '}<span className="text-slate-500">{l.event_title}</span>
                    {' · '}<span className="font-semibold">{fmt(l.listing_price_halire)}</span>
                    {l.status === 'sold' && (
                      <> · <span className="text-emerald-700 font-medium">výplata {fmt(l.seller_payout_halire)}</span></>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[l.status] ?? ''}`}>
                    {STATUS_LABEL[l.status] ?? l.status}
                  </span>
                  {l.sold_at && (
                    <span className="text-xs text-slate-400">{new Date(l.sold_at).toLocaleDateString('cs-CZ')}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
