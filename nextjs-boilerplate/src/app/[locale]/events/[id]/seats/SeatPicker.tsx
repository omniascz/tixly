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
  stage?: { label: string; position?: 'top' | 'bottom' | 'left' | 'right' | 'center' };
  field?: { x: number; y: number; width: number; height: number };
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

// Práh pro overview mód. Nad tímto počtem sedadel se defaultně skrývají
// jednotlivá sedadla a zobrazí se sektory jako bloky, na klik zoom dovnitř.
// 800 vychází z testů: O2 Arena (16 848) i Letná (50 000) v overview, malý
// koncertní sál (1500) taky overview, divadlo (308) plná mapa rovnou.
const OVERVIEW_THRESHOLD = 800;

interface SectorBBox {
  name: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  totalSeats: number;
  availableSeats: number;
  ttIds: Set<string>;
}

function computeBBoxes(data: Data, seatLookup: Map<string, Seat>): SectorBBox[] {
  const out: SectorBBox[] = [];
  for (const sector of data.layout.sectors) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let total = 0;
    let available = 0;
    const ttIds = new Set<string>();
    for (const row of sector.rows) {
      for (const seatPos of row.seats) {
        if (seatPos.x < minX) minX = seatPos.x;
        if (seatPos.y < minY) minY = seatPos.y;
        if (seatPos.x > maxX) maxX = seatPos.x;
        if (seatPos.y > maxY) maxY = seatPos.y;
        total++;
        const seat = seatLookup.get(`${sector.name}|${row.label}|${seatPos.num}`);
        if (seat) {
          if (seat.status === 'available') available++;
          ttIds.add(seat.ttId);
        }
      }
    }
    out.push({
      name: sector.name,
      minX, minY, maxX, maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      totalSeats: total,
      availableSeats: available,
      ttIds,
    });
  }
  return out;
}

function avgSeatPitch(layout: Layout): number {
  let sum = 0, count = 0;
  for (const sector of layout.sectors) {
    for (const row of sector.rows) {
      for (let i = 1; i < row.seats.length; i++) {
        sum += Math.abs(row.seats[i].x - row.seats[i - 1].x);
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 20;
}

function StageMarker({ layout }: { layout: Layout }) {
  if (!layout.stage) return null;
  const [vx, vy, vw, vh] = layout.viewBox.split(/\s+/).map(Number);
  let x = vx + vw / 2;
  let y = vy + 30;
  let width = vw * 0.4;
  let height = 40;
  const pos = layout.stage.position ?? 'top';
  if (pos === 'bottom') y = vy + vh - 60;
  if (pos === 'left') { x = vx + 20; y = vy + vh / 2 - 20; width = 40; height = vh * 0.3; }
  if (pos === 'right') { x = vx + vw - 60; y = vy + vh / 2 - 20; width = 40; height = vh * 0.3; }
  // Field má vlastní render, stage label se umístí dovnitř fieldu
  if (layout.field) {
    return (
      <g>
        <rect
          x={layout.field.x}
          y={layout.field.y}
          width={layout.field.width}
          height={layout.field.height}
          fill="#86efac"
          stroke="#16a34a"
          strokeWidth={2}
          rx={8}
        />
        <text
          x={layout.field.x + layout.field.width / 2}
          y={layout.field.y + layout.field.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.min(layout.field.width, layout.field.height) * 0.08}
          fontWeight="bold"
          fill="#14532d"
        >
          {layout.stage.label}
        </text>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={x - width / 2}
        y={y}
        width={width}
        height={height}
        fill="#1e293b"
        rx={4}
      />
      <text
        x={x}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={height * 0.5}
        fontWeight="bold"
        fill="#fff"
      >
        {layout.stage.label}
      </text>
    </g>
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
  const seatLookup = useMemo(() => {
    const m = new Map<string, Seat>();
    for (const s of data.seats) m.set(`${s.sector}|${s.row}|${s.num}`, s);
    return m;
  }, [data.seats]);

  const bboxes = useMemo(() => computeBBoxes(data, seatLookup), [data, seatLookup]);
  const pitch = useMemo(() => avgSeatPitch(data.layout), [data.layout]);
  const seatRadius = Math.max(2, Math.min(12, pitch * 0.42));

  const isLarge = data.seats.length > OVERVIEW_THRESHOLD;
  const [zoomedSector, setZoomedSector] = useState<string | null>(null);

  // Effective viewBox: pokud zoomed, použij bbox sektoru s paddingem
  const effectiveViewBox = useMemo(() => {
    if (!zoomedSector) return data.layout.viewBox;
    const b = bboxes.find((x) => x.name === zoomedSector);
    if (!b) return data.layout.viewBox;
    const pad = pitch * 4;
    return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  }, [zoomedSector, bboxes, pitch, data.layout.viewBox]);

  const showSeats = !isLarge || zoomedSector !== null;
  const visibleSectorNames = zoomedSector ? new Set([zoomedSector]) : new Set(data.layout.sectors.map((s) => s.name));

  return (
    <div className="space-y-2">
      {isLarge ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {zoomedSector
              ? `Zoomed: ${zoomedSector} — klikni na sedadla`
              : 'Klikni na sektor pro výběr sedadel'}
          </span>
          {zoomedSector ? (
            <button
              type="button"
              onClick={() => setZoomedSector(null)}
              className="rounded-md border bg-background px-2 py-1 hover:bg-muted"
            >
              ← Celkový pohled
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="overflow-auto">
        <svg
          viewBox={effectiveViewBox}
          preserveAspectRatio="xMidYMid meet"
          className="mx-auto block w-full max-w-4xl bg-slate-50"
          style={{ minHeight: 480, maxHeight: 720 }}
          role="img"
          aria-label="Plán sálu"
        >
          <StageMarker layout={data.layout} />

          {/* Overview mód: sektor jako polygon s labelem */}
          {!showSeats &&
            bboxes.map((b) => {
              const sector = data.layout.sectors.find((s) => s.name === b.name)!;
              const ttId = [...b.ttIds][0];
              const baseColor = ttId
                ? colorForType(ttId, data)
                : sector.color ?? '#64748b';
              const soldOut = b.availableSeats === 0;
              const dim = soldOut ? '#cbd5e1' : baseColor;
              const w = b.maxX - b.minX;
              const h = b.maxY - b.minY;
              const labelSize = Math.min(w, h) * 0.18;
              return (
                <g key={b.name} style={{ cursor: soldOut ? 'not-allowed' : 'pointer' }}>
                  <rect
                    x={b.minX - 4}
                    y={b.minY - 4}
                    width={w + 8}
                    height={h + 8}
                    fill={dim}
                    fillOpacity={0.85}
                    stroke="#fff"
                    strokeWidth={2}
                    rx={4}
                    onClick={() => !soldOut && setZoomedSector(b.name)}
                    role="button"
                    tabIndex={soldOut ? -1 : 0}
                    onKeyDown={(e) => {
                      if (!soldOut && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        setZoomedSector(b.name);
                      }
                    }}
                    aria-label={`Sektor ${b.name}, dostupných ${b.availableSeats} z ${b.totalSeats} sedadel`}
                  />
                  <text
                    x={b.cx}
                    y={b.cy - labelSize * 0.3}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={labelSize}
                    fontWeight="bold"
                    fill="#fff"
                    pointerEvents="none"
                  >
                    {b.name}
                  </text>
                  <text
                    x={b.cx}
                    y={b.cy + labelSize * 0.9}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={labelSize * 0.55}
                    fill="#fff"
                    pointerEvents="none"
                  >
                    {soldOut ? 'Vyprodáno' : `${b.availableSeats} volných`}
                  </text>
                </g>
              );
            })}

          {/* Detail mód: jednotlivá sedadla + label sektoru nad nimi */}
          {showSeats &&
            data.layout.sectors
              .filter((s) => visibleSectorNames.has(s.name))
              .map((sector) => {
                const b = bboxes.find((x) => x.name === sector.name)!;
                return (
                  <g key={sector.name}>
                    {/* sector label nad bloku */}
                    <text
                      x={b.cx}
                      y={b.minY - pitch}
                      textAnchor="middle"
                      fontSize={Math.min(b.maxX - b.minX, b.maxY - b.minY) * 0.12}
                      fontWeight="bold"
                      fill="#475569"
                    >
                      {sector.name}
                    </text>
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
                            r={seatRadius}
                            fill={fill}
                            stroke={isSelected ? '#047857' : '#fff'}
                            strokeWidth={isSelected ? Math.max(1, seatRadius * 0.25) : 0.5}
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
                );
              })}
        </svg>
      </div>
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
