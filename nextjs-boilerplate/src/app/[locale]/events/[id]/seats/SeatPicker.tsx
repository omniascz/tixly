'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/format';
import { pickBestAvailable as pickBest } from '@/lib/seating/best-available';

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
  name: string;
  zone: string | null;
  price: number;
  count: number;
}

interface Data {
  layout: Layout;
  seats: Seat[];
  ticketTypes: TicketType[];
}

interface ViewPhoto {
  photoUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  is360?: boolean;
  embedUrl?: string | null;
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
  const [bestCount, setBestCount] = useState(2);
  // Kolo 8 / krok 4: termín se slevovými kategoriemi = místa z více zón v jedné objednávce, kategorie u každého místa
  const [hasCategories, setHasCategories] = useState(false);
  useEffect(() => {
    fetch(`/api/public/events/${eventId}/seat-prices`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { categories?: unknown[] } | null) => setHasCategories((j?.categories?.length ?? 0) > 0))
      .catch(() => setHasCategories(false));
  }, [eventId]);
  // Click&View (DACH P2-6): mapa sectorName → photoUrl pro buyer preview.
  const [sectorPhotos, setSectorPhotos] = useState<Record<string, ViewPhoto>>({});
  const [previewSeat, setPreviewSeat] = useState<{
    seatId: string;
    sector: string;
    row: string;
    num: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/events/${eventId}/seat-view-photos`)
      .then((r) => (r.ok ? r.json() : { photos: {} }))
      .then((d: { sectorPhotos?: Record<string, ViewPhoto> }) => {
        if (!cancelled) setSectorPhotos(d.sectorPhotos ?? {});
      })
      .catch(() => {
        /* graceful — žádné photos */
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    let cancelled = false;
    void load();
    async function load() {
      try {
        const url = new URL(`/api/events/${eventId}/seats`, window.location.origin);
        if (eventDayId) url.searchParams.set('eventDayId', eventDayId);
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (!cancelled) setError(`HTTP ${res.status}`);
          return;
        }
        if (!cancelled) setData((await res.json()) as Data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [eventId, eventDayId]);

  // SSE real-time seat updates
  useEffect(() => {
    if (!data) return;
    const url = new URL(`/api/events/${eventId}/seats/stream`, window.location.origin);
    if (eventDayId) url.searchParams.set('eventDayId', eventDayId);
    const es = new EventSource(url.toString());

    function applyDelta(payload: { seats: { id: string; status: string }[] }): void {
      setData((prev) => {
        if (!prev) return prev;
        const byId = new Map(prev.seats.map((s) => [s.id, s]));
        for (const upd of payload.seats) {
          const ex = byId.get(upd.id);
          if (ex && ex.status !== upd.status) {
            byId.set(upd.id, { ...ex, status: upd.status as Seat['status'] });
          }
        }
        return { ...prev, seats: Array.from(byId.values()) };
      });
      // Drop now-unavailable from selection
      setSelected((prev) => {
        const sold = new Set(
          payload.seats.filter((s) => s.status !== 'available').map((s) => s.id),
        );
        let changed = false;
        const next = new Set(prev);
        for (const id of prev) {
          if (sold.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    es.addEventListener('delta', (e) => {
      try {
        applyDelta(JSON.parse((e).data));
      } catch {
        // ignore malformed
      }
    });
    es.addEventListener('error', () => {
      // Browser auto-reconnects EventSource; nothing to do.
    });

    return () => es.close();
  }, [eventId, eventDayId, data === null]);

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
    if (!hasCategories && !ticketTypeId && selectedTtId && seat.ttId !== selectedTtId) {
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

  function pickBestAvailable(count: number): void {
    if (!data) return;
    // Algoritmus je sdílený s API /seats/best-available, aby plánek, embed
    // widget i pokladna vybíraly stejná místa. Viz lib/seating/best-available.
    const ttFilter: string | null =
      ticketTypeId ??
      selectedTtId ??
      (data.ticketTypes.length > 0
        ? data.ticketTypes.slice().sort((a, b) => a.price - b.price)[0].id
        : null);

    const result = pickBest(data.layout, data.seats, {
      count,
      ticketTypeId: ttFilter,
      maxCount: MAX_SELECTION,
    });

    if (result.found === 0) {
      setError(result.reason);
      return;
    }
    setSelected(new Set(result.seatIds));
    setError(result.found < count || !result.contiguous ? result.reason : null);
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
      if (hasCategories) {
        const q = new URLSearchParams({ token: j.holdToken, seats: seatIds.join(',') });
        window.location.href = `/${locale}/events/${eventId}/seats/kategorie?${q.toString()}`;
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
        <h3 className="mb-2 text-sm font-semibold">Cenové zóny</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          {data.ticketTypes.map((tt) => (
            <span key={tt.id} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 flex-shrink-0 rounded"
                style={{ background: sectorColorForType(tt.id, data) }}
                aria-hidden
              />
              <span className="font-medium">{tt.zone ?? tt.name}</span>
              <span className="text-muted-foreground">
                {formatMoney(tt.price, 'CZK')} · {tt.count} sedadel
              </span>
            </span>
          ))}
          <span className="ml-2 flex items-center gap-1 text-muted-foreground">
            <span className="inline-block h-3 w-3 rounded bg-slate-200" aria-hidden />
            Prodáno
          </span>
          {data.seats.some((s) => s.acc) ? (
            <span className="ml-2 flex items-center gap-1 text-muted-foreground">
              <span className="inline-block h-3 w-3 rounded border-2 border-green-600 bg-transparent" aria-hidden />
              ♿ Bezbariérové
            </span>
          ) : null}
          {Object.keys(sectorPhotos).length > 0 ? (
            <span className="ml-2 flex items-center gap-1 text-muted-foreground">
              <span className="inline-block h-3 w-3 rounded border-2 border-amber-400 bg-transparent" aria-hidden />
              📷 Pohled — klikni na sektor nebo Shift+klik na sedadlo
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3">
        <label className="text-xs text-muted-foreground">Počet sedadel:</label>
        <input
          type="number"
          min={1}
          max={MAX_SELECTION}
          value={bestCount}
          onChange={(e) => setBestCount(Math.max(1, Math.min(MAX_SELECTION, Number(e.target.value) || 1)))}
          className="w-16 rounded border px-2 py-1 text-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => pickBestAvailable(bestCount)}
          disabled={busy}
        >
          ⭐ Vyber nejlepší dostupná
        </Button>
        {selected.size > 0 ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:underline"
            onClick={() => {
              setSelected(new Set());
              setError(null);
            }}
          >
            Vymazat výběr
          </button>
        ) : null}
      </div>

      <div className="rounded-md border bg-card p-3">
        <SvgChart
          data={data}
          selected={selected}
          onToggle={toggle}
          sectorPhotos={sectorPhotos}
          onPreview={setPreviewSeat}
        />
      </div>

      {previewSeat && sectorPhotos[previewSeat.sector] ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewSeat(null)}
          data-testid="seat-view-modal"
        >
          <div
            className="w-full max-w-3xl rounded-lg bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">
                {sectorPhotos[previewSeat.sector]!.is360 ? '360° ' : ''}
                {previewSeat.row
                  ? `Pohled ze sedadla ${previewSeat.sector} · ${previewSeat.row}/${previewSeat.num}`
                  : `Pohled ze sektoru ${previewSeat.sector}`}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewSeat(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>
            {sectorPhotos[previewSeat.sector]!.is360 ? (
              <iframe
                src={sectorPhotos[previewSeat.sector]!.embedUrl ?? sectorPhotos[previewSeat.sector]!.photoUrl ?? ''}
                title={`360° pohled ze sektoru ${previewSeat.sector}`}
                className="h-[60vh] w-full rounded-md border-0"
                allowFullScreen
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={sectorPhotos[previewSeat.sector]!.photoUrl ?? ''}
                alt={`Pohled ze sektoru ${previewSeat.sector}`}
                className="max-h-[70vh] w-full rounded-md object-contain"
              />
            )}
            {sectorPhotos[previewSeat.sector]!.caption ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {sectorPhotos[previewSeat.sector]!.caption}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

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
            {busy ? 'Rezervuji…' : 'Pokračovat k objednávce'}
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

function StageMarker({
  viewBox,
  stage,
  field,
}: {
  viewBox: string;
  stage?: Layout['stage'];
  field?: Layout['field'];
}) {
  if (!stage && !field) return null;
  const [vx, vy, vw, vh] = viewBox.split(/\s+/).map(Number);
  if (![vx, vy, vw, vh].every(Number.isFinite)) return null;
  let x = vx + vw / 2;
  let y = vy + 24;
  let width = Math.min(vw * 0.5, 420);
  let height = 34;
  const pos = stage?.position ?? 'top';
  if (pos === 'bottom') y = vy + vh - height - 24;
  if (pos === 'left') { x = vx + 20; y = vy + vh / 2 - 20; width = 34; height = vh * 0.3; }
  if (pos === 'right') { x = vx + vw - 54; y = vy + vh / 2 - 20; width = 34; height = vh * 0.3; }
  const label = stage?.label ?? 'JEVIŠTĚ';
  // Field má vlastní render, stage label se umístí dovnitř fieldu
  if (field) {
    return (
      <g>
        <rect
          x={field.x}
          y={field.y}
          width={field.width}
          height={field.height}
          fill="#86efac"
          stroke="#16a34a"
          strokeWidth={2}
          rx={8}
        />
        <text
          x={field.x + field.width / 2}
          y={field.y + field.height / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={Math.min(field.width, field.height) * 0.08}
          fontWeight="bold"
          fill="#14532d"
        >
          {label}
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
        rx={6}
      />
      <text
        x={x}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={height * 0.45}
        fontWeight="bold"
        fill="#fff"
        letterSpacing={2}
      >
        {label}
      </text>
    </g>
  );
}

function SvgChart({
  data,
  selected,
  onToggle,
  sectorPhotos,
  onPreview,
}: {
  data: Data;
  selected: Set<string>;
  onToggle: (s: Seat) => void;
  sectorPhotos: Record<string, ViewPhoto>;
  onPreview: (info: { seatId: string; sector: string; row: string; num: string }) => void;
}) {
  const seatLookup = useMemo(() => {
    const m = new Map<string, Seat>();
    for (const s of data.seats) m.set(`${s.sector}|${s.row}|${s.num}`, s);
    return m;
  }, [data.seats]);

  const bboxes = useMemo(() => computeBBoxes(data, seatLookup), [data, seatLookup]);
  const pitch = useMemo(() => avgSeatPitch(data.layout), [data.layout]);
  // Radius = pitch / 3 — vždy 33 % volné mezery mezi okraji kruhů, i s hover stroke (1.2 px).
  // Předtím (pitch × 0.42) zanechával jen ~1 px volného místa pro pitch < 12, sedadla se
  // vizuálně lepila i bez hard kolize. Audit 2026-05-19 (scripts/check-overlaps.mjs).
  const seatRadius = Math.max(2, Math.min(12, pitch / 3));

  const isLarge = data.seats.length > OVERVIEW_THRESHOLD;
  const [zoomedSector, setZoomedSector] = useState<string | null>(null);

  // Jeviště: použij uložené, jinak default nahoře (orientace pro sezení).
  const stage = data.layout.stage ?? { label: 'JEVIŠTĚ', position: 'top' as const };

  // Base viewBox: uložený, pokud je platný; jinak DOPOČÍTAT z reálných souřadnic
  // sedadel + padding + prostor na jeviště. Bez tohohle (viewBox=undefined nebo
  // ořezaný) buyer „neviděl celý sál" — spodní sektory se ořezávaly.
  // Kolo 8 / krok 9: přednost má výřez podle sedadel — uložený viewBox je plátno editoru (např. 0 0 1050 850)
  // a sál v něm na mobilu zabíral zlomek plochy (sedadla ~10 px). Uložený se použije jen bez sedadel.
  const baseViewBox = useMemo(() => {
    const stored = (data.layout.viewBox ?? '').trim().split(/\s+/).map(Number);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const b of bboxes) {
      minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
    }
    if (!Number.isFinite(minX)) {
      return stored.length === 4 && stored.every(Number.isFinite) && stored[2] > 0 && stored[3] > 0 ? data.layout.viewBox : '0 0 800 600';
    }
    const pad = Math.max(24, pitch * 1.5);
    const headTop = stage.position === 'top' || !stage.position ? 100 : 0;
    const headBottom = stage.position === 'bottom' ? 100 : 0;
    const x = minX - pad;
    const y = minY - pad - headTop;
    const w = (maxX - minX) + pad * 2;
    const h = (maxY - minY) + pad * 2 + headTop + headBottom;
    return `${x} ${y} ${w} ${h}`;
  }, [data.layout.viewBox, bboxes, pitch, stage.position]);

  // Effective viewBox: pokud zoomed, použij bbox sektoru s paddingem
  const effectiveViewBox = useMemo(() => {
    if (!zoomedSector) return baseViewBox;
    const b = bboxes.find((x) => x.name === zoomedSector);
    if (!b) return baseViewBox;
    const pad = pitch * 4;
    return `${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxY - b.minY + 2 * pad}`;
  }, [zoomedSector, bboxes, pitch, baseViewBox]);

  const showSeats = !isLarge || zoomedSector !== null;
  // Na úzkém displeji drž rozteč sedadel aspoň 32 px (pohodlné klepnutí) — plánek se pak posouvá ve svém rámu,
  // stránka do stran ne. Na desktopu je rám širší a nic se nemění.
  const vbWidth = Number((effectiveViewBox ?? '').split(/\s+/)[2] ?? 0);
  const minPlanPx = showSeats && pitch > 0 && vbWidth > 0 ? Math.round((vbWidth / pitch) * 32) : undefined;
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
          style={{ minHeight: 480, maxHeight: 720, minWidth: minPlanPx }}
          role="img"
          aria-label="Plán sálu"
        >
          <StageMarker viewBox={baseViewBox} stage={stage} field={data.layout.field} />

          {/* Overview mód: sektor jako polygon s labelem */}
          {!showSeats &&
            bboxes.map((b) => {
              const sector = data.layout.sectors.find((s) => s.name === b.name)!;
              const ttId = [...b.ttIds][0];
              const baseColor = sector.color ?? (ttId ? sectorColorForType(ttId, data) : '#64748b');
              const soldOut = b.availableSeats === 0;
              const dim = soldOut ? '#cbd5e1' : baseColor;
              const w = b.maxX - b.minX;
              const h = b.maxY - b.minY;
              const labelSize = Math.min(w, h) * 0.18;
              const hasSectorPhoto = !!sectorPhotos[b.name];
              return (
                <g key={b.name} style={{ cursor: soldOut ? 'not-allowed' : 'pointer' }}>
                  <rect
                    x={b.minX - 4}
                    y={b.minY - 4}
                    width={w + 8}
                    height={h + 8}
                    fill={dim}
                    fillOpacity={0.85}
                    stroke={hasSectorPhoto ? '#f59e0b' : '#fff'}
                    strokeWidth={hasSectorPhoto ? 3 : 2}
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
                    aria-label={`Sektor ${b.name}, dostupných ${b.availableSeats} z ${b.totalSeats} sedadel${hasSectorPhoto ? ', foto pohledu dostupné' : ''}`}
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
                  {hasSectorPhoto ? (
                    <g
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPreview({ seatId: '', sector: b.name, row: '', num: '' });
                      }}
                    >
                      <rect
                        x={b.maxX - 2}
                        y={b.minY - 18}
                        width={Math.max(labelSize * 1.8, 30)}
                        height={Math.max(labelSize * 0.9, 16)}
                        rx={3}
                        fill="#f59e0b"
                      />
                      <text
                        x={b.maxX + Math.max(labelSize * 0.9, 15)}
                        y={b.minY - 10}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fontSize={Math.max(labelSize * 0.7, 10)}
                        fill="#fff"
                        fontWeight="bold"
                        pointerEvents="none"
                      >
                        📷
                      </text>
                    </g>
                  ) : null}
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
                              : (sector.color ?? colorForType(seat.ttId, data));
                        const interactive = seat.status === 'available';
                        const hasViewPhoto = !!sectorPhotos[sector.name];
                        return (
                          <circle
                            key={seat.id}
                            cx={seatPos.x}
                            cy={seatPos.y}
                            r={seatRadius}
                            fill={fill}
                            stroke={
                              isSelected
                                ? '#047857'
                                : seat.acc && seat.status === 'available'
                                  ? '#16a34a'
                                  : hasViewPhoto
                                    ? '#f59e0b'
                                    : '#fff'
                            }
                            strokeWidth={
                              isSelected
                                ? Math.max(1, seatRadius * 0.25)
                                : seat.acc && seat.status === 'available'
                                  ? Math.max(1, seatRadius * 0.3)
                                  : hasViewPhoto
                                    ? Math.max(0.8, seatRadius * 0.2)
                                    : 0.5
                            }
                            style={{ cursor: interactive ? 'pointer' : 'not-allowed' }}
                            onClick={(e) => {
                              if (!interactive) return;
                              // Shift/Cmd/Ctrl + click = open view photo modal (pokud má);
                              // standard click = toggle selection
                              if (
                                hasViewPhoto &&
                                (e.shiftKey || e.ctrlKey || e.metaKey)
                              ) {
                                onPreview({
                                  seatId: seat.id,
                                  sector: sector.name,
                                  row: row.label,
                                  num: seatPos.num,
                                });
                                return;
                              }
                              onToggle(seat);
                            }}
                            role={interactive ? 'button' : undefined}
                            tabIndex={interactive ? 0 : -1}
                            onKeyDown={(e) => {
                              if (interactive && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                onToggle(seat);
                              }
                            }}
                            aria-label={`Sektor ${sector.name}, řada ${row.label}, sedadlo ${seatPos.num}, ${seat.status}${hasViewPhoto ? ', má foto pohledu' : ''}`}
                            data-has-view-photo={hasViewPhoto || undefined}
                          >
                            <title>
                              {sector.name} · řada {row.label} · sedadlo {seatPos.num}
                              {seat.acc ? ' · ♿' : ''}
                              {hasViewPhoto ? ' · 📷 Shift+klik = foto' : ''}
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

// Preferuje barvu sektoru z layoutu (nastavená adminem v builderu).
// Fallback na palette-by-index pro zpětnou kompatibilitu s layouts bez color.
function sectorColorForType(ttId: string, data: Data): string {
  const seat = data.seats.find((s) => s.ttId === ttId);
  if (seat) {
    const sector = data.layout.sectors.find((s) => s.name === seat.sector);
    if (sector?.color) return sector.color;
  }
  return colorForType(ttId, data);
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
