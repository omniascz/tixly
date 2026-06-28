'use client';

/**
 * /admin/events/[id]/seats
 *
 * Promotér vidí vizuální mapu sedadel s live stavem (available/held/sold/blocked).
 * Polling každé 3 s — bez SSE aby šlo jednoduše použít za auth headery.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

interface SeatData {
  id: string;
  sector: string;
  row: string;
  seatNumber: string;
  x: number;
  y: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  holdUntil: string | null;
  ticketTypeName: string | null;
  accessibility: boolean;
}

interface LiveResponse {
  viewBox: string;
  seats: SeatData[];
  summary: { available: number; held: number; sold: number; blocked: number };
  fetchedAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  available: '#22c55e',
  held: '#f59e0b',
  sold: '#ef4444',
  blocked: '#94a3b8',
};

const STATUS_LABEL: Record<string, string> = {
  available: 'Volné',
  held: 'Rezervováno',
  sold: 'Prodáno',
  blocked: 'Blokováno',
};

function authFetch(url: string): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  return fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
}

export default function AdminSeatsPage({ params }: { params: { id: string } }) {
  const { id: eventId } = params;
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ seat: SeatData; mx: number; my: number } | null>(null);
  const [filter, setFilter] = useState<string>('all');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastFetchRef = useRef<string>('');

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/admin/events/${eventId}/seats/live`);
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const j = (await res.json()) as LiveResponse;
      if (j.fetchedAt !== lastFetchRef.current) {
        lastFetchRef.current = j.fetchedAt;
        setData(j);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    intervalRef.current = setInterval(() => { void load(); }, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  if (error) {
    return (
      <div className="p-6 rounded-md border border-rose-300 bg-rose-50 text-sm text-rose-900">
        Chyba: {error}
      </div>
    );
  }

  if (!data) {
    return <p className="p-6 text-sm text-muted-foreground">Načítání mapy sedadel…</p>;
  }

  const visibleSeats = filter === 'all' ? data.seats : data.seats.filter((s) => s.status === filter);
  const total = data.summary.available + data.summary.held + data.summary.sold + data.summary.blocked;
  const soldPct = total > 0 ? Math.round((data.summary.sold / total) * 100) : 0;

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href={`/admin/events/${eventId}`} className="text-sm text-primary hover:underline">
            ← Zpět na event
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Mapa sedadel — live</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Aktualizace každé 3 s · poslední: {new Date(data.fetchedAt).toLocaleTimeString('cs-CZ')}
          </p>
        </div>
        <div className="flex gap-4 text-sm flex-wrap">
          {Object.entries(STATUS_LABEL).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              className={`flex items-center gap-1.5 rounded px-2 py-1 border transition-colors ${
                filter === key ? 'border-foreground bg-muted' : 'border-transparent hover:bg-muted/50'
              }`}
            >
              <span
                className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                style={{ background: STATUS_COLOR[key] }}
              />
              <span className="font-medium">{label}</span>
              <span className="text-muted-foreground">
                {data.summary[key as keyof typeof data.summary]}
              </span>
            </button>
          ))}
          <div className="flex items-center gap-1 text-muted-foreground">
            <span>Prodáno:</span>
            <span className="font-bold text-foreground">{soldPct} %</span>
          </div>
        </div>
      </div>

      {data.seats.length === 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Tento event nemá vygenerovaná sedadla. Vygenerujte je přes{' '}
          <Link href={`/admin/events/${eventId}/edit`} className="underline">
            nastavení eventu
          </Link>
          .
        </div>
      ) : (
        <div
          className="relative overflow-auto rounded-xl border bg-slate-950"
          style={{ maxHeight: '70vh' }}
          onMouseLeave={() => setTooltip(null)}
        >
          <svg
            viewBox={data.viewBox}
            className="w-full h-auto min-h-[400px]"
            style={{ display: 'block' }}
          >
            {visibleSeats.map((seat) => (
              <circle
                key={seat.id}
                cx={seat.x}
                cy={seat.y}
                r={10}
                fill={STATUS_COLOR[seat.status] ?? '#94a3b8'}
                opacity={filter === 'all' || seat.status === filter ? 1 : 0.15}
                stroke={seat.accessibility ? '#fff' : 'none'}
                strokeWidth={seat.accessibility ? 2 : 0}
                className="cursor-pointer transition-opacity"
                onMouseEnter={(e) => {
                  const svgEl = (e.target as SVGCircleElement).closest('svg')!;
                  const rect = svgEl.getBoundingClientRect();
                  setTooltip({ seat, mx: e.clientX - rect.left, my: e.clientY - rect.top });
                }}
              />
            ))}
          </svg>

          {tooltip && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-lg"
              style={{ left: tooltip.mx + 12, top: tooltip.my - 8 }}
            >
              <div className="font-semibold">{tooltip.seat.sector} · ř. {tooltip.seat.row} · sed. {tooltip.seat.seatNumber}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: STATUS_COLOR[tooltip.seat.status] }}
                />
                <span>{STATUS_LABEL[tooltip.seat.status]}</span>
              </div>
              {tooltip.seat.ticketTypeName && (
                <div className="text-muted-foreground mt-0.5">{tooltip.seat.ticketTypeName}</div>
              )}
              {tooltip.seat.holdUntil && tooltip.seat.status === 'held' && (
                <div className="text-amber-600 mt-0.5">
                  Rezervace do {new Date(tooltip.seat.holdUntil).toLocaleTimeString('cs-CZ')}
                </div>
              )}
              {tooltip.seat.accessibility && (
                <div className="text-blue-500 mt-0.5">♿ Bezbariérové</div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>Celkem sedadel: <strong className="text-foreground">{total}</strong></span>
        <span>·</span>
        <span>Volných: <strong className="text-green-600">{data.summary.available}</strong></span>
        <span>·</span>
        <span>Rezervovaných: <strong className="text-amber-600">{data.summary.held}</strong></span>
        <span>·</span>
        <span>Prodaných: <strong className="text-rose-600">{data.summary.sold}</strong></span>
        {data.summary.blocked > 0 && (
          <>
            <span>·</span>
            <span>Blokovaných: <strong className="text-slate-400">{data.summary.blocked}</strong></span>
          </>
        )}
      </div>
    </div>
  );
}
