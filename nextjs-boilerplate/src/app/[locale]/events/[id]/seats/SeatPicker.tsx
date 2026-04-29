'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';

interface Seat {
  id: string;
  sector: string;
  row: string;
  num: string;
  status: 'available' | 'held' | 'sold' | 'blocked';
  acc: boolean;
  ttId: string;
}

interface LayoutSector {
  name: string;
  color?: string;
  rows: { label: string; seats: { num: string; x: number; y: number }[] }[];
}

interface Layout {
  viewBox: string;
  sectors: LayoutSector[];
}

interface TicketType {
  id: string;
  price: number;
  count: number;
}

interface Data {
  layout: Layout;
  seats: Seat[];
  ticketTypes: TicketType[];
}

const MAX_SELECTION = 10;

interface Props {
  eventId: string;
  locale: string;
  ticketTypeId: string | null;
  eventDayId: string | null;
}

export function SeatPicker({ eventId, locale, ticketTypeId, eventDayId }: Props) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
    async function load() {
      try {
        const url = new URL(`/api/events/${eventId}/seats`, window.location.origin);
        if (eventDayId) url.searchParams.set('eventDayId', eventDayId);
        const res = await fetch(url.toString());
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as Data);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }, [eventId, eventDayId]);

  const seatsById = useMemo(() => {
    const m = new Map<string, Seat>();
    if (data) for (const s of data.seats) m.set(s.id, s);
    return m;
  }, [data]);

  const selectedTtId = useMemo(() => {
    for (const id of selected) {
      const s = seatsById.get(id);
      if (s) return s.ttId;
    }
    return null;
  }, [selected, seatsById]);

  function toggle(seat: Seat) {
    if (seat.status !== 'available') return;
    // Pokud má buyer ticketTypeId v URL, vynutíme jen daný typ
    if (ticketTypeId && seat.ttId !== ticketTypeId) {
      setError('Toto sedadlo patří do jiné cenové kategorie.');
      return;
    }
    // Mix-typ: zakážeme, pokud už je něco vybráno
    if (!ticketTypeId && selectedTtId && seat.ttId !== selectedTtId) {
      setError('Mixovat typy v jedné objednávce nelze. Zruš výběr a začni znovu.');
      return;
    }
    const next = new Set(selected);
    if (next.has(seat.id)) {
      next.delete(seat.id);
    } else {
      if (next.size >= MAX_SELECTION) return;
      next.add(seat.id);
    }
    setSelected(next);
    setError(null);
  }

  async function holdAndProceed() {
    if (selected.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const seatIds = [...selected];
      const res = await fetch(`/api/events/${eventId}/seats/hold`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fingerprint': fingerprint(),
        },
        credentials: 'include',
        body: JSON.stringify({ seatIds }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        holdToken?: string;
        error?: string;
        unavailableIds?: string[];
      };
      if (!res.ok || !j.holdToken) {
        setError(j.error ?? `HTTP ${res.status}`);
        // Reload state
        const reload = await fetch(`/api/events/${eventId}/seats`);
        if (reload.ok) setData((await reload.json()) as Data);
        return;
      }
      const ttId = selectedTtId;
      const params = new URLSearchParams({
        eventId,
        ticketTypeId: ttId ?? '',
        seatHoldToken: j.holdToken,
        seatIds: seatIds.join(','),
        quantity: String(seatIds.length),
      });
      window.location.href = `/${locale}/checkout?${params.toString()}`;
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
        {error}
      </div>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Načítání rozložení sálu…</p>;
  }

  const totalPrice = [...selected].reduce((sum, id) => {
    const s = seatsById.get(id);
    if (!s) return sum;
    const tt = data.ticketTypes.find((t) => t.id === s.ttId);
    return sum + (tt?.price ?? 0);
  }, 0);

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-card p-3">
        <h3 className="mb-2 text-sm font-semibold">Cenové kategorie</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          {data.ticketTypes.map((tt) => (
            <span key={tt.id} className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-3 rounded"
                style={{ background: colorForType(tt.id, data) }}
                aria-hidden
              />
              {formatMoney(tt.price, 'CZK')} ({tt.count} sedadel)
            </span>
          ))}
          <span className="ml-2 flex items-center gap-1 text-muted-foreground">
            <span className="inline-block h-3 w-3 rounded bg-slate-200" aria-hidden />
            Prodáno
          </span>
        </div>
      </div>

      <div className="rounded-md border bg-card p-3">
        <SvgChart data={data} selected={selected} onToggle={toggle} />
      </div>

      <div className="sticky bottom-0 rounded-md border bg-card p-4 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              {selected.size} / {MAX_SELECTION} sedadel
            </div>
            <div className="text-2xl font-bold tabular-nums">
              {formatMoney(totalPrice, 'CZK')}
            </div>
          </div>
          <Button
            onClick={holdAndProceed}
            disabled={busy || selected.size === 0}
          >
            {busy ? 'Rezervuji…' : 'Pokračovat na pokladnu'}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-rose-700">{error}</p>
        ) : null}
      </div>
    </div>
  );
}

function SvgChart({
  data,
  selected,
  onToggle,
}: {
  data: Data;
  selected: Set<string>;
  onToggle: (s: Seat) => void;
}) {
  // Build seat lookup by (sector, row, num)
  const seatLookup = new Map<string, Seat>();
  for (const s of data.seats) {
    seatLookup.set(`${s.sector}|${s.row}|${s.num}`, s);
  }

  return (
    <div className="overflow-auto">
      <svg
        viewBox={data.layout.viewBox}
        className="mx-auto block w-full max-w-3xl"
        style={{ minHeight: 400 }}
        role="img"
        aria-label="Plán sálu"
      >
        {data.layout.sectors.map((sector) => (
          <g key={sector.name}>
            {sector.rows.map((row) =>
              row.seats.map((seatPos) => {
                const seat = seatLookup.get(`${sector.name}|${row.label}|${seatPos.num}`);
                if (!seat) return null;
                const isSelected = selected.has(seat.id);
                const fill = isSelected
                  ? '#10b981'
                  : seat.status === 'sold' || seat.status === 'held'
                    ? '#cbd5e1'
                    : seat.status === 'blocked'
                      ? '#94a3b8'
                      : (data.ticketTypes.find((t) => t.id === seat.ttId)
                          ? colorForType(seat.ttId, data)
                          : sector.color ?? '#64748b');
                const interactive = seat.status === 'available';
                return (
                  <circle
                    key={seat.id}
                    cx={seatPos.x}
                    cy={seatPos.y}
                    r={9}
                    fill={fill}
                    stroke={isSelected ? '#047857' : '#fff'}
                    strokeWidth={isSelected ? 2 : 1}
                    style={{ cursor: interactive ? 'pointer' : 'not-allowed' }}
                    onClick={() => interactive && onToggle(seat)}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : -1}
                    onKeyDown={(e) => {
                      if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onToggle(seat);
                      }
                    }}
                    aria-label={`Sektor ${sector.name}, řada ${row.label}, sedadlo ${seatPos.num}, ${seat.status}`}
                  >
                    <title>
                      {sector.name} · řada {row.label} · sedadlo {seatPos.num}
                      {seat.acc ? ' · ♿ accessibility' : ''}
                    </title>
                  </circle>
                );
              }),
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function colorForType(ttId: string, data: Data): string {
  const palette = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16'];
  const idx = data.ticketTypes.findIndex((t) => t.id === ttId);
  return palette[idx % palette.length] ?? '#64748b';
}

function fingerprint(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const lang = typeof navigator !== 'undefined' ? navigator.language : '';
  let hash = 0;
  const s = `${ua}|${tz}|${lang}`;
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0;
  return `fp_${Math.abs(hash).toString(36)}`;
}
