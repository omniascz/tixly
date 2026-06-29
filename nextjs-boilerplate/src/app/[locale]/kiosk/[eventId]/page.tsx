'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface TicketType {
  id: string;
  name: string;
  remainingQty: number;
  soldOut: boolean;
  capacity: number | null;
}

interface KioskData {
  id: string;
  title: string;
  dateStart: string;
  dateEnd: string | null;
  venueName: string | null;
  venueCity: string | null;
  coverImageUrl: string | null;
  status: string;
  ticketTypes: TicketType[];
  totalRemaining: number;
  totalCapacity: number;
  lastUpdated: string;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('cs-CZ', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return iso;
  }
}

function fillPercent(tt: TicketType): number {
  if (!tt.capacity || tt.capacity <= 0) return tt.soldOut ? 100 : 0;
  return Math.min(100, Math.round(((tt.capacity - tt.remainingQty) / tt.capacity) * 100));
}

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-orange-400';
  return 'bg-emerald-500';
}

export default function KioskDisplayPage() {
  const params = useParams();
  const eventId = String(params.eventId);

  const [data, setData] = useState<KioskData | null>(null);
  const [error, setError] = useState(false);
  const [clock, setClock] = useState('');

  async function fetchData() {
    try {
      const res = await fetch(`/api/public/events/${eventId}/kiosk`);
      if (res.ok) {
        const d = (await res.json()) as KioskData;
        setData(d);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void fetchData();
    const interval = setInterval(() => void fetchData(), 30_000);
    return () => clearInterval(interval);
  }, [eventId]);

  useEffect(() => {
    setClock(formatTime(new Date().toISOString()));
    const t = setInterval(() => setClock(formatTime(new Date().toISOString())), 1000);
    return () => clearInterval(t);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-xl text-red-400">Událost nenalezena nebo není dostupná.</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-lg text-gray-400 animate-pulse">Načítám…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-white p-0">
      <div className="flex flex-col md:flex-row gap-0 border-b border-white/10">
        {data.coverImageUrl && (
          <div className="md:w-64 lg:w-80 shrink-0">
            <img
              src={data.coverImageUrl}
              alt={data.title}
              className="h-48 w-full object-cover md:h-full"
            />
          </div>
        )}
        <div className="flex-1 p-8 flex flex-col justify-center gap-3">
          <h1 className="text-4xl font-bold leading-tight tracking-tight">{data.title}</h1>
          <p className="flex items-center gap-2 text-xl text-gray-300">
            <span>📅</span>
            {formatDateTime(data.dateStart)}
            {data.dateEnd && (
              <span className="text-gray-500 text-base">– {formatTime(data.dateEnd)}</span>
            )}
          </p>
          {(data.venueName || data.venueCity) && (
            <p className="flex items-center gap-2 text-xl text-gray-300">
              <span>📍</span>
              {[data.venueName, data.venueCity].filter(Boolean).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 p-8 space-y-5">
        {data.ticketTypes.length === 0 ? (
          <p className="text-center text-gray-400 text-xl py-8">Žádné typy vstupenek.</p>
        ) : (
          data.ticketTypes.map((tt) => {
            const pct = fillPercent(tt);
            const color = barColor(pct);
            return (
              <div key={tt.id} className="flex items-center gap-4">
                <div className="w-56 shrink-0 text-lg font-medium">{tt.name}</div>
                <div className="flex-1 relative h-8 rounded-full overflow-hidden bg-white/10">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-700 ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-40 shrink-0 text-right text-lg">
                  {tt.soldOut ? (
                    <span className="rounded-full bg-red-700 px-3 py-0.5 text-sm font-bold uppercase tracking-wide">
                      VYPRODÁNO
                    </span>
                  ) : tt.capacity ? (
                    <span className="text-gray-200">
                      {tt.remainingQty.toLocaleString('cs-CZ')}/{tt.capacity.toLocaleString('cs-CZ')}
                    </span>
                  ) : (
                    <span className="text-gray-200">{tt.remainingQty.toLocaleString('cs-CZ')} volných</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-white/10 px-8 py-4 flex items-center justify-between text-gray-400 text-sm">
        <span>
          Celkem volných:{' '}
          <strong className="text-white text-lg">{data.totalRemaining.toLocaleString('cs-CZ')}</strong>
          {data.totalCapacity > 0 && (
            <span className="ml-1 text-gray-500">/ {data.totalCapacity.toLocaleString('cs-CZ')}</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          🕐 Aktualizováno: <strong className="text-white font-mono">{clock}</strong>
        </span>
      </div>
    </div>
  );
}
