'use client';

import { useEffect, useState, type JSX } from 'react';
import { Clock, TrendingDown } from 'lucide-react';

interface EventAvail {
  id: string;
  title: string;
  date_start: string;
  category: string | null;
  promoter_name: string;
  total_capacity: number;
  remaining: number;
  cheapest_price: number;
  currency: string;
  is_sold_out: boolean;
  cover_image_url: string | null;
}

interface Props {
  venueName: string;
  events: EventAvail[];
  theme: 'dark' | 'light';
}

const PAGE_SIZE = 6;
const PAGE_INTERVAL_MS = 15_000;
const REFRESH_INTERVAL_MS = 30_000;

function fmtMoney(halire: number, currency: string): string {
  const symbol = currency === 'EUR' ? '€' : 'Kč';
  if (halire === 0) return 'Zdarma';
  return `${(halire / 100).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })} ${symbol}`;
}

function fmtDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'long' }),
    time: d.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function SignageView({ venueName, events, theme }: Props): JSX.Element {
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // Force-refresh whole page á 30s to refetch availability
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof window !== 'undefined') window.location.reload();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  // Tick clock + auto-page rotace
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 1000);
    const pager = setInterval(() => {
      setPage((p) => (p + 1) % Math.max(1, Math.ceil(events.length / PAGE_SIZE)));
    }, PAGE_INTERVAL_MS);
    return () => { clearInterval(clock); clearInterval(pager); };
  }, [events.length]);

  const dark = theme === 'dark';
  const bg = dark ? 'bg-slate-950 text-white' : 'bg-white text-slate-900';
  const cardBg = dark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200';
  const muted = dark ? 'text-slate-400' : 'text-slate-600';

  const visible = events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));

  return (
    <div className={`flex h-screen flex-col ${bg}`}>
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-6">
        <div>
          <h1 className="text-4xl font-bold">{venueName}</h1>
          <p className={`mt-1 text-sm ${muted}`}>Aktuální dostupnost lístků</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-bold tabular-nums">
            {now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
          </p>
          <p className={`text-sm ${muted}`}>
            {now.toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
      </header>

      {/* Events grid */}
      <main className="flex-1 px-8 pb-4">
        {events.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className={`text-2xl ${muted}`}>Žádné nadcházející akce</p>
          </div>
        ) : (
          <div className="grid h-full grid-cols-3 gap-4">
            {visible.map((e) => {
              const date = fmtDate(e.date_start);
              const remainingPct = e.total_capacity > 0 ? (e.remaining / e.total_capacity) * 100 : 0;
              return (
                <div key={e.id} className={`flex flex-col overflow-hidden rounded-2xl border ${cardBg}`}>
                  {e.cover_image_url ? (
                    <div className="aspect-video bg-slate-800">
                      <img
                        src={e.cover_image_url}
                        alt={e.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-1 flex-col justify-between p-5">
                    <div>
                      <p className={`text-xs uppercase ${muted}`}>{e.category ?? e.promoter_name}</p>
                      <h2 className="mt-1 line-clamp-2 text-xl font-bold leading-tight">{e.title}</h2>
                      <p className={`mt-3 flex items-center gap-1 text-sm ${muted}`}>
                        <Clock className="h-3.5 w-3.5" />
                        {date.date}, {date.time}
                      </p>
                    </div>
                    <div className="mt-4 flex items-end justify-between">
                      <div>
                        {e.is_sold_out ? (
                          <p className="rounded-full bg-rose-600 px-3 py-1 text-sm font-bold text-white">
                            VYPRODÁNO
                          </p>
                        ) : (
                          <>
                            <p className={`text-xs ${muted}`}>od</p>
                            <p className="text-2xl font-bold">{fmtMoney(e.cheapest_price, e.currency)}</p>
                          </>
                        )}
                      </div>
                      {!e.is_sold_out ? (
                        <div className="text-right">
                          <p className={`flex items-center gap-1 text-xs ${remainingPct < 20 ? 'text-amber-500' : muted}`}>
                            {remainingPct < 20 ? <TrendingDown className="h-3 w-3" /> : null}
                            {e.remaining > 0 ? `${e.remaining} volných` : 'Doprodáváme'}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer s page indicators */}
      <footer className={`flex items-center justify-between px-8 py-4 ${muted}`}>
        <p className="text-xs">
          Stránka {page + 1} / {totalPages} · auto-refresh á 30s · tixly.cz
        </p>
        <div className="flex gap-1.5">
          {Array.from({ length: totalPages }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full transition ${
                i === page ? 'bg-primary' : dark ? 'bg-slate-700' : 'bg-slate-300'
              }`}
            />
          ))}
        </div>
      </footer>
    </div>
  );
}
