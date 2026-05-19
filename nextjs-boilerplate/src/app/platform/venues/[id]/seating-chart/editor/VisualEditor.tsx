'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { straightRow, arcRow, rowLabel, type Point, type SeatPosition } from './geometry';

const PALETTE = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#ef4444', '#14b8a6'];

interface Seat extends SeatPosition {
  accessibility?: boolean;
  blocked?: boolean;
}

interface Row {
  label: string;
  seats: Seat[];
}

interface Sector {
  name: string;
  color: string;
  rows: Row[];
  /** Volitelná pozice sector-name labelu (X, Y v viewBox souřadnicích).
   *  Když chybí, vykreslí se nad bounding box sektoru. */
  labelPosition?: { x: number; y: number };
}

export interface Stage {
  position: 'top' | 'bottom' | 'left' | 'right';
  label: string;
}

export interface Layout {
  viewBox: string;
  sectors: Sector[];
  stage?: Stage;
}

type Tool = 'select' | 'row-straight' | 'row-arc' | 'pan';

interface Props {
  initialLayout: Layout | null;
  chartName: string;
  onSave: (name: string, layout: Layout) => Promise<void>;
}

const DEFAULT_VIEWBOX = '0 0 1200 900';

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
    w: parts[2] ?? 1200,
    h: parts[3] ?? 900,
  };
}

function vbToString(vb: ViewBox): string {
  return `${vb.x} ${vb.y} ${vb.w} ${vb.h}`;
}

export function VisualEditor({ initialLayout, chartName: initialName, onSave }: Props) {
  const [tool, setTool] = useState<Tool>('select');
  const [sectors, setSectors] = useState<Sector[]>(initialLayout?.sectors ?? []);
  const [originalViewBox] = useState<string>(initialLayout?.viewBox ?? DEFAULT_VIEWBOX);
  const [vb, setVb] = useState<ViewBox>(() => parseViewBox(initialLayout?.viewBox ?? DEFAULT_VIEWBOX));
  // Stage z importu/sector tools — editor ho zobrazuje ale nemění (úprava přes /seating-chart/tools).
  const [stage] = useState<Stage | undefined>(initialLayout?.stage);
  const [fullscreen, setFullscreen] = useState(false);
  const [chartName, setChartName] = useState(initialName);
  const [activeSectorIdx, setActiveSectorIdx] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [floorPlanUrl, setFloorPlanUrl] = useState('');
  // Pan tool state — for hold-and-drag panning of viewBox.
  const panRef = useRef<{ startClientX: number; startClientY: number; vbX: number; vbY: number } | null>(null);

  // Tool-specific transient state
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);

  // Sector-label drag state. Drží i pre-drag snapshot sectors pro správné undo.
  const [draggingLabel, setDraggingLabel] = useState<{
    sectorIdx: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    origSectors: Sector[];
  } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // History (undo/redo)
  const [history, setHistory] = useState<Sector[][]>([]);
  const [redoStack, setRedoStack] = useState<Sector[][]>([]);

  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Display toggles — defaultně ON aby editor vypadal stejně jako read-only preview.
  // Pro mega charts (Camp Nou class) můžeš seat numbers vypnout pro výkon.
  const [showRowLabels, setShowRowLabels] = useState(true);
  const [showSeatNums, setShowSeatNums] = useState(true);

  // Wheel-zoom (anchored at cursor) — passive:false to actually preventDefault page scroll.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setVb((prev) => {
        const newW = prev.w / factor;
        const newH = prev.h / factor;
        // Clamp zoom relative to original size
        const orig = parseViewBox(originalViewBox);
        const ratio = orig.w / newW;
        if (ratio < 0.05 || ratio > 50) return prev;
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
  }, [originalViewBox]);

  // ESC = exit fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  function resetView() {
    setVb(parseViewBox(originalViewBox));
  }
  function zoomBy(factor: number) {
    setVb((prev) => ({
      x: prev.x + (prev.w - prev.w / factor) / 2,
      y: prev.y + (prev.h - prev.h / factor) / 2,
      w: prev.w / factor,
      h: prev.h / factor,
    }));
  }

  // pushHistory používá functional update aby zachytil aktuální `sectors` z React queue
  // (closure-captured `sectors` může být stale když pushHistory voláme rychle za sebou).
  function pushHistory(next: Sector[]) {
    setSectors((prev) => {
      setHistory((h) => [...h.slice(-49), prev]);
      setRedoStack([]);
      return next;
    });
  }

  function undo() {
    setHistory((h) => {
      if (h.length === 0) return h;
      const last = h[h.length - 1];
      setSectors((prev) => {
        setRedoStack((r) => [prev, ...r].slice(0, 50));
        return last;
      });
      return h.slice(0, -1);
    });
  }

  function redo() {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[0];
      setSectors((prev) => {
        setHistory((h) => [...h, prev]);
        return next;
      });
      return r.slice(1);
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedSeats.size > 0) {
          e.preventDefault();
          deleteSelected();
        }
      } else if (e.key === 'Escape') {
        setPendingPoints([]);
        setSelectedSeats(new Set());
      } else if (e.key === '1') setTool('select');
      else if (e.key === '2') setTool('row-straight');
      else if (e.key === '3') setTool('row-arc');
      else if (e.key === '4') setTool('pan');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeats, sectors, history, redoStack]);

  function svgPoint(e: { clientX: number; clientY: number }): Point {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = ctm.inverse();
    const local = pt.matrixTransform(inv);
    return { x: Math.round(local.x), y: Math.round(local.y) };
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    const p = svgPoint(e);
    if (tool === 'row-straight') {
      const next = [...pendingPoints, p];
      if (next.length === 2) {
        // Prompt seat count + sector
        const countStr = window.prompt('Kolik sedadel v této řadě?', '20');
        if (countStr) {
          const count = Number.parseInt(countStr, 10);
          if (!Number.isNaN(count) && count > 0 && count <= 200) {
            addRow(straightRow(next[0], next[1], count));
          }
        }
        setPendingPoints([]);
      } else {
        setPendingPoints(next);
      }
    } else if (tool === 'row-arc') {
      const next = [...pendingPoints, p];
      if (next.length === 3) {
        const countStr = window.prompt('Kolik sedadel v této řadě?', '30');
        if (countStr) {
          const count = Number.parseInt(countStr, 10);
          if (!Number.isNaN(count) && count > 0 && count <= 200) {
            addRow(arcRow(next[0], next[1], next[2], count));
          }
        }
        setPendingPoints([]);
      } else {
        setPendingPoints(next);
      }
    } else if (tool === 'select') {
      // Click on empty space → deselect
      setSelectedSeats(new Set());
    }
  }

  function addRow(seats: SeatPosition[]) {
    const next = [...sectors];
    let secIdx = activeSectorIdx;
    if (secIdx === null || secIdx >= next.length) {
      // Auto-create sector
      const name = window.prompt(
        `Nový sektor — název:`,
        `Sektor ${String.fromCharCode(65 + next.length)}`,
      );
      if (!name) return;
      next.push({ name, color: PALETTE[next.length % PALETTE.length], rows: [] });
      secIdx = next.length - 1;
      setActiveSectorIdx(secIdx);
    }
    const sector = next[secIdx];
    const newSector: Sector = {
      ...sector,
      rows: [...sector.rows, { label: rowLabel(sector.rows.length), seats }],
    };
    next[secIdx] = newSector;
    pushHistory(next);
  }

  function seatId(secName: string, rowLabel: string, num: string): string {
    return `${secName}|${rowLabel}|${num}`;
  }

  function toggleSeatSelection(id: string, multi: boolean) {
    const next = new Set(multi ? selectedSeats : []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedSeats(next);
  }

  function deleteSelected() {
    if (selectedSeats.size === 0) return;
    const next = sectors.map((s) => ({
      ...s,
      rows: s.rows
        .map((r) => ({
          ...r,
          seats: r.seats.filter((seat) => !selectedSeats.has(seatId(s.name, r.label, seat.num))),
        }))
        .filter((r) => r.seats.length > 0),
    }));
    pushHistory(next);
    setSelectedSeats(new Set());
  }

  function toggleAccessibility() {
    if (selectedSeats.size === 0) return;
    const next = sectors.map((s) => ({
      ...s,
      rows: s.rows.map((r) => ({
        ...r,
        seats: r.seats.map((seat) =>
          selectedSeats.has(seatId(s.name, r.label, seat.num))
            ? { ...seat, accessibility: !seat.accessibility }
            : seat,
        ),
      })),
    }));
    pushHistory(next);
  }

  function renameSector(idx: number) {
    const cur = sectors[idx];
    const name = window.prompt(`Přejmenovat sektor`, cur.name);
    if (!name || name === cur.name) return;
    const next = [...sectors];
    next[idx] = { ...cur, name };
    pushHistory(next);
  }

  function recolorSector(idx: number, color: string) {
    const next = [...sectors];
    next[idx] = { ...next[idx], color };
    pushHistory(next);
  }

  function deleteSector(idx: number) {
    if (!window.confirm(`Smazat sektor "${sectors[idx].name}" a všechna jeho sedadla?`)) return;
    pushHistory(sectors.filter((_, i) => i !== idx));
    if (activeSectorIdx === idx) setActiveSectorIdx(null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      // Pro save použijeme original viewBox (parsovaný z importu / posledního save), nebo
      // auto-compute pokud žádný není. Aktuální `vb` může být různě zoomnutý/pannutý — to ukládat
      // by zkreslilo výsledek pro buyera.
      let finalViewBox = originalViewBox;
      const isDefault = originalViewBox === DEFAULT_VIEWBOX;
      if (isDefault) {
        let maxX = 1000;
        let maxY = 800;
        for (const s of sectors) {
          for (const r of s.rows) {
            for (const seat of r.seats) {
              if (seat.x > maxX) maxX = seat.x;
              if (seat.y > maxY) maxY = seat.y;
            }
          }
        }
        finalViewBox = `0 0 ${Math.ceil(maxX + 50)} ${Math.ceil(maxY + 50)}`;
      }
      await onSave(chartName, { viewBox: finalViewBox, sectors, stage });
      setFeedback('Layout uložen.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const totalSeats = useMemo(
    () => sectors.reduce((acc, s) => acc + s.rows.reduce((a, r) => a + r.seats.length, 0), 0),
    [sectors],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
        <Input
          value={chartName}
          onChange={(e) => setChartName(e.target.value)}
          placeholder="Název layoutu"
          className="max-w-xs"
        />
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')}>
          ↖ Select <kbd>1</kbd>
        </ToolButton>
        <ToolButton active={tool === 'row-straight'} onClick={() => { setTool('row-straight'); setPendingPoints([]); }}>
          ─ Řada <kbd>2</kbd>
        </ToolButton>
        <ToolButton active={tool === 'row-arc'} onClick={() => { setTool('row-arc'); setPendingPoints([]); }}>
          ⌒ Oblouk <kbd>3</kbd>
        </ToolButton>
        <ToolButton active={tool === 'pan'} onClick={() => setTool('pan')}>
          ✋ Pan <kbd>4</kbd>
        </ToolButton>
        <div className="ml-2 h-6 w-px bg-border" />
        <Button variant="outline" size="sm" onClick={undo} disabled={history.length === 0}>
          ↶ Undo
        </Button>
        <Button variant="outline" size="sm" onClick={redo} disabled={redoStack.length === 0}>
          ↷ Redo
        </Button>
        <div className="ml-2 h-6 w-px bg-border" />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showRowLabels}
            onChange={(e) => setShowRowLabels(e.target.checked)}
          />
          Řady
        </label>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={showSeatNums}
            onChange={(e) => setShowSeatNums(e.target.checked)}
          />
          Čísla seat
        </label>
        <div className="ml-2 h-6 w-px bg-border" />
        {selectedSeats.size > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">
              Vybráno {selectedSeats.size} sedadel
            </span>
            <Button variant="outline" size="sm" onClick={toggleAccessibility}>
              ♿ Accessibility
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteSelected}>
              🗑 Smazat
            </Button>
          </>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-muted-foreground tabular-nums">{totalSeats} sedadel</span>
          <div className="ml-2 h-6 w-px bg-border" />
          <button
            type="button"
            onClick={() => zoomBy(1.4)}
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
            title="Přiblížit"
          >＋</button>
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.4)}
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
            title="Oddálit"
          >－</button>
          <button
            type="button"
            onClick={resetView}
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
            title="Reset"
          >⟲</button>
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
            title={fullscreen ? 'Zavřít fullscreen (Esc)' : 'Fullscreen'}
          >{fullscreen ? '✕' : '⛶'}</button>
          <div className="ml-2 h-6 w-px bg-border" />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Ukládám…' : 'Uložit layout'}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          {error}
        </div>
      ) : null}
      {feedback ? (
        <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {feedback}
        </div>
      ) : null}

      <div className={fullscreen ? 'fixed inset-0 z-50 flex flex-col bg-background p-4' : 'grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]'}>
        <Card className={fullscreen ? 'flex flex-1 flex-col' : ''}>
          <CardContent className={fullscreen ? 'flex flex-1 flex-col p-2' : 'p-2'}>
            <ToolHints tool={tool} pendingCount={pendingPoints.length} />
            <svg
              ref={svgRef}
              viewBox={vbToString(vb)}
              className="block w-full bg-slate-50"
              style={{
                minHeight: fullscreen ? '100%' : 500,
                flex: fullscreen ? 1 : undefined,
                touchAction: 'none',
                cursor: panRef.current
                  ? 'grabbing'
                  : tool === 'pan'
                    ? 'grab'
                    : draggingLabel
                      ? 'grabbing'
                      : tool === 'select'
                        ? 'default'
                        : 'crosshair',
              }}
              onMouseDown={(e) => {
                if (tool === 'pan' && e.button === 0) {
                  panRef.current = {
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    vbX: vb.x,
                    vbY: vb.y,
                  };
                }
              }}
              onClick={(e) => {
                if (draggingLabel) return; // ignore clicks while dragging label
                if (tool === 'pan') return; // pan tool doesn't place anything
                handleSvgClick(e);
              }}
              onMouseMove={(e) => {
                if (panRef.current) {
                  const svg = svgRef.current;
                  if (!svg) return;
                  const rect = svg.getBoundingClientRect();
                  const dx = ((e.clientX - panRef.current.startClientX) / rect.width) * vb.w;
                  const dy = ((e.clientY - panRef.current.startClientY) / rect.height) * vb.h;
                  setVb((prev) => ({ ...prev, x: panRef.current!.vbX - dx, y: panRef.current!.vbY - dy }));
                  return;
                }
                if (!draggingLabel) return;
                const p = svgPoint(e);
                setSectors((prev) =>
                  prev.map((s, i) =>
                    i === draggingLabel.sectorIdx ? { ...s, labelPosition: { x: p.x, y: p.y } } : s,
                  ),
                );
              }}
              onMouseUp={() => {
                if (panRef.current) {
                  panRef.current = null;
                  return;
                }
                if (!draggingLabel) return;
                // Push PRE-drag snapshot do history (sectors v current stavu = post-drag).
                // pushHistory(sectors) by zaznamenal post-drag jako historii → undo by nic neudělalo.
                setHistory((h) => [...h.slice(-49), draggingLabel.origSectors]);
                setRedoStack([]);
                setDraggingLabel(null);
              }}
              onMouseLeave={() => {
                if (panRef.current) panRef.current = null;
                if (draggingLabel) setDraggingLabel(null);
              }}
              role="application"
              aria-label="Seating chart editor canvas"
            >
              {floorPlanUrl ? (
                <image href={floorPlanUrl} x="0" y="0" width="1200" opacity="0.3" />
              ) : null}

              {/* Pending points (drawing in progress) */}
              {pendingPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={6} fill="#f59e0b" stroke="#fff" strokeWidth={2} />
              ))}
              {tool === 'row-straight' && pendingPoints.length === 1 ? (
                <text x={pendingPoints[0].x + 15} y={pendingPoints[0].y - 5} fontSize="14" fill="#666">
                  Klikni na konec řady
                </text>
              ) : null}
              {tool === 'row-arc' && pendingPoints.length === 1 ? (
                <text x={pendingPoints[0].x + 15} y={pendingPoints[0].y - 5} fontSize="14" fill="#666">
                  Klikni na vrchol oblouku
                </text>
              ) : null}
              {tool === 'row-arc' && pendingPoints.length === 2 ? (
                <text x={pendingPoints[1].x + 15} y={pendingPoints[1].y - 5} fontSize="14" fill="#666">
                  Klikni na konec oblouku
                </text>
              ) : null}
              {tool === 'row-arc' && pendingPoints.length === 2 ? (
                <line
                  x1={pendingPoints[0].x}
                  y1={pendingPoints[0].y}
                  x2={pendingPoints[1].x}
                  y2={pendingPoints[1].y}
                  stroke="#f59e0b"
                  strokeDasharray="4 2"
                />
              ) : null}

              {/* Render sectors */}
              {sectors.map((sector) =>
                sector.rows.map((row) => {
                  const first = row.seats[0];
                  const last = row.seats[row.seats.length - 1];
                  return (
                    <g key={`${sector.name}-${row.label}`}>
                      {showRowLabels && first && (
                        <text
                          x={first.x - 26}
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
                      {showRowLabels && last && last !== first && (
                        <text
                          x={last.x + 26}
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
                      {row.seats.map((seat) => {
                        const id = seatId(sector.name, row.label, seat.num);
                        const isSelected = selectedSeats.has(id);
                        const r = isSelected ? 16 : 14; // 1:1 s preview
                        return (
                          <g key={id}>
                            <circle
                              cx={seat.x}
                              cy={seat.y}
                              r={r}
                              fill={seat.blocked ? '#94a3b8' : sector.color}
                              stroke={isSelected ? '#000' : seat.accessibility ? '#dc2626' : '#fff'}
                              strokeWidth={isSelected ? 2 : 1}
                              onClick={(e) => {
                                if (tool === 'select') {
                                  e.stopPropagation();
                                  toggleSeatSelection(id, e.shiftKey || e.metaKey || e.ctrlKey);
                                }
                              }}
                              style={{ cursor: tool === 'select' ? 'pointer' : 'crosshair' }}
                            >
                              <title>
                                {sector.name} · řada {row.label} · sedadlo {seat.num}
                                {seat.accessibility ? ' · ♿' : ''}
                              </title>
                            </circle>
                            {showSeatNums && (
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
                            )}
                          </g>
                        );
                      })}
                    </g>
                  );
                }),
              )}

              {/* Sector name labels — drag to reposition */}
              {sectors.map((sector, sIdx) => {
                if (!sector.rows.length) return null;
                let minX = Infinity, maxX = -Infinity, minY = Infinity;
                for (const row of sector.rows) {
                  for (const seat of row.seats) {
                    if (seat.x < minX) minX = seat.x;
                    if (seat.x > maxX) maxX = seat.x;
                    if (seat.y < minY) minY = seat.y;
                  }
                }
                if (!isFinite(minX)) return null;
                const lx = sector.labelPosition?.x ?? (minX + maxX) / 2;
                const ly = sector.labelPosition?.y ?? minY - 30;
                const isDragging = draggingLabel?.sectorIdx === sIdx;
                return (
                  <g
                    key={`label-${sector.name}-${sIdx}`}
                    style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingLabel({
                        sectorIdx: sIdx,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: lx,
                        origY: ly,
                        origSectors: sectors, // snapshot pre-drag pro correct undo
                      });
                    }}
                  >
                    {/* Invisible larger hit area */}
                    <rect
                      x={lx - 80}
                      y={ly - 12}
                      width={160}
                      height={24}
                      fill="transparent"
                    />
                    <text
                      x={lx}
                      y={ly}
                      fontSize="32"
                      fontWeight="700"
                      fill={sector.color}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{ textTransform: 'uppercase', letterSpacing: '2px', userSelect: 'none' }}
                      pointerEvents="none"
                    >
                      {sector.name}
                    </text>
                  </g>
                );
              })}

              {/* Stage / podium rendering */}
              {stage && (() => {
                let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
                for (const sector of sectors) {
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
                const margin = 60;
                let rx = 0, ry = 0, rw = 0, rh = 0;
                switch (stage.position) {
                  case 'top':
                    rw = w * 0.5; rh = h * 0.07;
                    rx = cx - rw / 2; ry = gMinY - margin - rh;
                    break;
                  case 'bottom':
                    rw = w * 0.5; rh = h * 0.07;
                    rx = cx - rw / 2; ry = gMaxY + margin;
                    break;
                  case 'left':
                    rw = w * 0.07; rh = h * 0.5;
                    rx = gMinX - margin - rw; ry = cy - rh / 2;
                    break;
                  case 'right':
                    rw = w * 0.07; rh = h * 0.5;
                    rx = gMaxX + margin; ry = cy - rh / 2;
                    break;
                }
                const fontSize = Math.min(rh * 0.5, rw * 0.15, 80);
                return (
                  <g pointerEvents="none">
                    <rect x={rx} y={ry} width={rw} height={rh} rx={Math.min(rw, rh) * 0.15} fill="#1e293b" opacity={0.9} />
                    <text x={rx + rw / 2} y={ry + rh / 2} fontSize={fontSize} fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="700" style={{ letterSpacing: '4px' }}>
                      {stage.label}
                    </text>
                  </g>
                );
              })()}
            </svg>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sektory ({sectors.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {sectors.map((s, i) => {
                const seatCount = s.rows.reduce((a, r) => a + r.seats.length, 0);
                return (
                  <div
                    key={i}
                    className={`rounded-md border p-2 ${
                      activeSectorIdx === i ? 'border-primary bg-primary/5' : 'bg-card'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => recolorSector(i, e.target.value)}
                        className="h-6 w-8 rounded border"
                      />
                      <span
                        className="flex-1 cursor-pointer truncate text-sm font-medium"
                        onClick={() => setActiveSectorIdx(i)}
                        onDoubleClick={() => renameSector(i)}
                        title="Klik = aktivní pro nové řady · dvojklik = přejmenovat"
                      >
                        {s.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteSector(i)}
                        className="text-xs text-rose-700 hover:underline"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {s.rows.length} řad · {seatCount} sedadel
                      {activeSectorIdx === i ? ' · aktivní' : ''}
                    </div>
                  </div>
                );
              })}
              {sectors.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Žádné sektory. Vyber tool „Řada" nebo „Oblouk" a klikni na canvas.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Floor plan (volitelné)</CardTitle>
            </CardHeader>
            <CardContent>
              <Input
                type="url"
                placeholder="https://… PNG/JPG sálu"
                value={floorPlanUrl}
                onChange={(e) => setFloorPlanUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Půjde za sedadla jako šablona. Upload na Cloudinary/S3 a vlož URL.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Klávesové zkratky</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <div><kbd>1</kbd>–<kbd>4</kbd> Tool</div>
              <div><kbd>Ctrl/Cmd+Z</kbd> Undo</div>
              <div><kbd>Ctrl/Cmd+Y</kbd> Redo</div>
              <div><kbd>Del</kbd> Smazat výběr</div>
              <div><kbd>Esc</kbd> Zrušit operaci</div>
              <div><kbd>Shift+Click</kbd> Multi-select</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground'
          : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
      }
    >
      {children}
    </button>
  );
}

function ToolHints({ tool, pendingCount }: { tool: Tool; pendingCount: number }) {
  if (tool === 'select') {
    return (
      <div className="mb-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
        <strong>Select:</strong> klikni na sedadlo pro výběr · Shift+klik = multi · Del smaže
      </div>
    );
  }
  if (tool === 'row-straight') {
    return (
      <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
        <strong>Řada:</strong>{' '}
        {pendingCount === 0 ? 'Klikni na začátek řady' : 'Klikni na konec řady → zadej počet sedadel'}
      </div>
    );
  }
  if (tool === 'row-arc') {
    return (
      <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
        <strong>Oblouk:</strong>{' '}
        {pendingCount === 0
          ? 'Klikni na začátek'
          : pendingCount === 1
            ? 'Klikni na vrchol oblouku (mezi)'
            : 'Klikni na konec → zadej počet sedadel'}
      </div>
    );
  }
  return null;
}
