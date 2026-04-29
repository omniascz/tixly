'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface SeatLayout {
  viewBox: string;
  sectors: {
    name: string;
    color?: string;
    labelPosition?: { x: number; y: number };
    rows: {
      label: string;
      seats: { num: string; x: number; y: number; accessibility?: boolean }[];
    }[];
  }[];
  stage?: { position: 'top' | 'bottom' | 'left' | 'right'; label: string };
}

const SEAT_R = 14;
const ZOOM_STEP = 1.4;
const MIN_ZOOM = 0.05; // dovoluje hodně oddálit pro velké stadiony
const MAX_ZOOM = 20;

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function parseViewBox(vb: string): ViewBox {
  const parts = vb.trim().split(/\s+/).map(Number);
  return {
    x: parts[0] ?? 0,
    y: parts[1] ?? 0,
    w: parts[2] ?? 1000,
    h: parts[3] ?? 1000,
  };
}

function vbToString(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

export function VenueLayoutPreview({
  venueId,
  maxHeight = 500,
}: {
  venueId: string;
  maxHeight?: number;
}) {
  const [layout, setLayout] = useState<SeatLayout | null | undefined>(undefined);
  const [name, setName] = useState<string>('');
  const [totalSeats, setTotalSeats] = useState<number>(0);

  const initialVb = useMemo(
    () => (layout ? parseViewBox(layout.viewBox) : { x: 0, y: 0, w: 1000, h: 1000 }),
    [layout],
  );
  const [vb, setVb] = useState<ViewBox>(initialVb);
  const [fullscreen, setFullscreen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; vbX: number; vbY: number } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/platform/venues/${venueId}/seating-chart`);
        if (!res.ok) {
          setLayout(null);
          return;
        }
        const j = (await res.json()) as {
          chart: { name: string; total_seats: number; layout: SeatLayout } | null;
        };
        if (j.chart) {
          setLayout(j.chart.layout);
          setName(j.chart.name);
          setTotalSeats(j.chart.total_seats);
        } else {
          setLayout(null);
        }
      } catch {
        setLayout(null);
      }
    })();
  }, [venueId]);

  // Reset viewBox when layout loads.
  useEffect(() => {
    if (layout) setVb(parseViewBox(layout.viewBox));
  }, [layout]);

  // ESC to exit fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  // React's onWheel je v moderním React/Chrome passive listener, takže preventDefault() neblokuje scroll
  // stránky. Musíme se navěsit ručně s passive:false.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const initial = parseViewBox(layout.viewBox);
      setVb((prev) => {
        const newW = prev.w / factor;
        const newH = prev.h / factor;
        const ratio = initial.w / newW;
        if (ratio < MIN_ZOOM || ratio > MAX_ZOOM) return prev;
        const rect = svg.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        const cursorVbX = prev.x + px * prev.w;
        const cursorVbY = prev.y + py * prev.h;
        return {
          x: cursorVbX - px * newW,
          y: cursorVbY - py * newH,
          w: newW,
          h: newH,
        };
      });
    };
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [layout]);

  function zoomAt(factor: number, clientX?: number, clientY?: number) {
    if (!layout) return;
    const initial = parseViewBox(layout.viewBox);
    const newW = vb.w / factor;
    const newH = vb.h / factor;
    // clamp by zoom levels (relative to initial viewport)
    const ratio = initial.w / newW;
    if (ratio < MIN_ZOOM || ratio > MAX_ZOOM) return;

    let newX = vb.x + (vb.w - newW) / 2;
    let newY = vb.y + (vb.h - newH) / 2;

    // If we have a cursor anchor, keep that point stationary.
    const svg = svgRef.current;
    if (svg && clientX != null && clientY != null) {
      const rect = svg.getBoundingClientRect();
      const px = (clientX - rect.left) / rect.width;
      const py = (clientY - rect.top) / rect.height;
      const cursorVbX = vb.x + px * vb.w;
      const cursorVbY = vb.y + py * vb.h;
      newX = cursorVbX - px * newW;
      newY = cursorVbY - py * newH;
    }
    setVb({ x: newX, y: newY, w: newW, h: newH });
  }

  function reset() {
    if (layout) setVb(parseViewBox(layout.viewBox));
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vbX: vb.x, vbY: vb.y };
  }

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * vb.w;
    const dy = ((e.clientY - d.startY) / rect.height) * vb.h;
    setVb((prev) => ({ ...prev, x: d.vbX - dx, y: d.vbY - dy }));
  }

  function onMouseUp() {
    dragRef.current = null;
  }

  if (layout === undefined) {
    return <p className="text-xs text-muted-foreground">Načítám náhled…</p>;
  }
  if (layout === null) {
    return null;
  }

  const zoomPct = Math.round((initialVb.w / vb.w) * 100);
  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-background p-4'
    : 'space-y-2';
  const svgWrapClass = fullscreen
    ? 'flex-1 overflow-hidden rounded-md border bg-white'
    : 'overflow-hidden rounded-md border bg-white';
  const svgStyle: React.CSSProperties = fullscreen
    ? { width: '100%', height: '100%', display: 'block', touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' }
    : { maxHeight, width: '100%', display: 'block', touchAction: 'none', cursor: dragRef.current ? 'grabbing' : 'grab' };

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between gap-3 text-xs">
        <div>
          <strong>{name}</strong>{' '}
          <span className="text-muted-foreground">
            · {totalSeats.toLocaleString('cs-CZ')} sedadel · {layout.sectors.length} sektorů
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomAt(ZOOM_STEP)}
            className="rounded border bg-background px-2 py-1 hover:bg-accent"
            title="Přiblížit"
          >
            ＋
          </button>
          <button
            type="button"
            onClick={() => zoomAt(1 / ZOOM_STEP)}
            className="rounded border bg-background px-2 py-1 hover:bg-accent"
            title="Oddálit"
          >
            －
          </button>
          <span className="px-1 tabular-nums">{zoomPct}%</span>
          <button
            type="button"
            onClick={reset}
            className="rounded border bg-background px-2 py-1 hover:bg-accent"
            title="Reset"
          >
            ⟲
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="rounded border bg-background px-2 py-1 hover:bg-accent"
            title={fullscreen ? 'Zavřít fullscreen (Esc)' : 'Fullscreen'}
          >
            {fullscreen ? '✕' : '⛶'}
          </button>
        </div>
      </div>

      <div className={svgWrapClass}>
        <svg
          ref={svgRef}
          viewBox={vbToString(vb)}
          style={svgStyle}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {(() => {
            // Compute overall bounding box of seats for stage placement.
            if (!layout.stage) return null;
            let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
            for (const sector of layout.sectors) {
              for (const row of sector.rows) {
                for (const seat of row.seats) {
                  if (seat.x < gMinX) gMinX = seat.x;
                  if (seat.x > gMaxX) gMaxX = seat.x;
                  if (seat.y < gMinY) gMinY = seat.y;
                  if (seat.y > gMaxY) gMaxY = seat.y;
                }
              }
            }
            if (!isFinite(gMinX)) return null;
            const w = gMaxX - gMinX;
            const h = gMaxY - gMinY;
            const cx = (gMinX + gMaxX) / 2;
            const cy = (gMinY + gMaxY) / 2;
            const margin = SEAT_R * 4;
            let rectX = 0, rectY = 0, rectW = 0, rectH = 0;
            switch (layout.stage.position) {
              case 'top':
                rectW = w * 0.5; rectH = h * 0.07;
                rectX = cx - rectW / 2; rectY = gMinY - margin - rectH;
                break;
              case 'bottom':
                rectW = w * 0.5; rectH = h * 0.07;
                rectX = cx - rectW / 2; rectY = gMaxY + margin;
                break;
              case 'left':
                rectW = w * 0.07; rectH = h * 0.5;
                rectX = gMinX - margin - rectW; rectY = cy - rectH / 2;
                break;
              case 'right':
                rectW = w * 0.07; rectH = h * 0.5;
                rectX = gMaxX + margin; rectY = cy - rectH / 2;
                break;
            }
            const fontSize = Math.min(rectH * 0.5, rectW * 0.15, 80);
            return (
              <g pointerEvents="none">
                <rect
                  x={rectX}
                  y={rectY}
                  width={rectW}
                  height={rectH}
                  rx={Math.min(rectW, rectH) * 0.15}
                  fill="#1e293b"
                  opacity={0.9}
                />
                <text
                  x={rectX + rectW / 2}
                  y={rectY + rectH / 2}
                  fontSize={fontSize}
                  fill="white"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontWeight="700"
                  style={{ letterSpacing: '4px' }}
                >
                  {layout.stage.label}
                </text>
              </g>
            );
          })()}
          {layout.sectors.map((sector) => {
            // Compute sector bounding box for centered label.
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (const row of sector.rows) {
              for (const seat of row.seats) {
                if (seat.x < minX) minX = seat.x;
                if (seat.x > maxX) maxX = seat.x;
                if (seat.y < minY) minY = seat.y;
                if (seat.y > maxY) maxY = seat.y;
              }
            }
            // Honor explicit labelPosition (set via drag in visual editor) if present.
            const labelX = sector.labelPosition?.x ?? (minX + maxX) / 2;
            const labelY = sector.labelPosition?.y ?? (minY - SEAT_R - 25);
            const showLabel = isFinite(minX) && !sector.name.startsWith('#');
            return (
              <g key={sector.name}>
                {showLabel && (
                  <text
                    x={labelX}
                    y={labelY}
                    fontSize="32"
                    fontWeight="700"
                    fill={sector.color ?? '#1e293b'}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    pointerEvents="none"
                    style={{ textTransform: 'uppercase', letterSpacing: '2px' }}
                  >
                    {sector.name}
                  </text>
                )}
                {sector.rows.map((row) => {
                const first = row.seats[0];
                const last = row.seats[row.seats.length - 1];
                return (
                  <g key={`${sector.name}-${row.label}`}>
                    {first && (
                      <text
                        x={first.x - SEAT_R - 12}
                        y={first.y}
                        fontSize="20"
                        fill="#666"
                        textAnchor="end"
                        dominantBaseline="middle"
                        fontWeight="600"
                        pointerEvents="none"
                      >
                        {row.label}
                      </text>
                    )}
                    {last && last !== first && (
                      <text
                        x={last.x + SEAT_R + 12}
                        y={last.y}
                        fontSize="20"
                        fill="#666"
                        textAnchor="start"
                        dominantBaseline="middle"
                        fontWeight="600"
                        pointerEvents="none"
                      >
                        {row.label}
                      </text>
                    )}
                    {row.seats.map((seat) => (
                      <g key={`${row.label}-${seat.num}-${seat.x}`}>
                        <circle
                          cx={seat.x}
                          cy={seat.y}
                          r={SEAT_R}
                          fill={sector.color ?? '#3b82f6'}
                          stroke="white"
                          strokeWidth={1}
                        />
                        <text
                          x={seat.x}
                          y={seat.y}
                          fontSize="11"
                          fill="white"
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontWeight="600"
                          pointerEvents="none"
                        >
                          {seat.num}
                        </text>
                      </g>
                    ))}
                  </g>
                );
              })}
            </g>
          );
          })}
        </svg>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-muted-foreground">
        <div className="flex flex-wrap gap-3">
          {layout.sectors.map((s) => {
            let count = 0;
            for (const r of s.rows) count += r.seats.length;
            return (
              <span key={s.name} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded"
                  style={{ background: s.color ?? '#3b82f6' }}
                />
                <strong className="text-foreground">{s.name}</strong>
                <span>· {count}</span>
              </span>
            );
          })}
        </div>
        <span className="text-[10px]">
          🖱 kolečko = zoom · drag = pan · Esc = zavřít fullscreen
        </span>
      </div>
    </div>
  );
}
