'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { duplicateSeatLabels, type SeatType } from '@/lib/seating/generator';
import { straightRow, arcRow, bezierRow, bezierPath, rowLabel, type Point, type SeatPosition } from './geometry';
import { SEAT_TYPE_LABEL, TheatreTools, type Underlay, type Zone } from './TheatreTools';

const PALETTE = ['#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#ef4444', '#14b8a6'];

interface Seat extends SeatPosition {
  accessibility?: boolean;
  blocked?: boolean;
  /** Kolo 8: typ místa, poznámka (omezený výhled) a cenová zóna (id z layout.zones). */
  type?: SeatType;
  note?: string;
  zone?: string;
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
  /** Volná geometrie jeviště. Když je vyplněná, editor ji použije místo auto-výpočtu
   *  z bounding boxu (přetažení / rotace / změna velikosti). Zpětně kompatibilní. */
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rotation?: number;
}

interface OverlayElement {
  id: string;
  type: 'football_pitch' | 'tennis_court' | 'bar' | 'stage_icon' | 'entrance' | 'stairs';
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}

export interface Layout {
  viewBox: string;
  sectors: Sector[];
  stage?: Stage;
  overlays?: OverlayElement[];
  floorPlanUrl?: string;
  /** Kolo 8: cenové zóny (legenda) a nastavení podkladu. */
  zones?: Zone[];
  underlay?: Underlay;
}

type Tool = 'select' | 'row-straight' | 'row-arc' | 'row-bezier' | 'pan' | 'overlay';

interface StageBox {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  cx: number;
  cy: number;
}

/** Aktivní myší gesto (drag). Držíme v ref aby nebylo stale během mousemove. */
type Gesture =
  | { kind: 'seats'; startPt: Point; snapshot: Sector[]; primaryOrig: Point; selectedIds: Set<string>; lastOffset: { dx: number; dy: number } | null }
  | { kind: 'marquee'; startPt: Point; additive: boolean; baseSelection: Set<string>; last: Point }
  | { kind: 'stage-move'; startPt: Point; orig: StageBox }
  | { kind: 'stage-resize'; startPt: Point; orig: StageBox }
  | { kind: 'stage-rotate'; center: Point };

interface Guide {
  kind: 'v' | 'h';
  pos: number;
}

const OVERLAY_DEFAULTS: Record<OverlayElement['type'], { width: number; height: number; label: string }> = {
  football_pitch: { width: 200, height: 130, label: 'Hřiště' },
  tennis_court:   { width: 150, height: 70,  label: 'Tenisový kurt' },
  bar:            { width: 60,  height: 40,  label: 'Bar' },
  stage_icon:     { width: 80,  height: 50,  label: 'Pódium' },
  entrance:       { width: 30,  height: 30,  label: 'Vstup' },
  stairs:         { width: 30,  height: 40,  label: 'Schody' },
};

/** Prahová vzdálenost pro přichycení (snap) při tažení sedadel — ve viewBox jednotkách. */
const SNAP_THRESHOLD = 8;

/** Nad tímto počtem sedadel kreslíme seat vrstvu do <canvas> místo SVG (mega stadiony). */
const CANVAS_THRESHOLD = 2000;

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
  // Stage je nyní editovatelné přímo na plátně (přetáhnout / otočit / zvětšit).
  const [stage, setStage] = useState<Stage | undefined>(initialLayout?.stage);
  const [selectedStage, setSelectedStage] = useState(false);
  const [overlays, setOverlays] = useState<OverlayElement[]>(initialLayout?.overlays ?? []);
  const [selectedOverlayType, setSelectedOverlayType] = useState<OverlayElement['type']>('football_pitch');
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [chartName, setChartName] = useState(initialName);
  const [activeSectorIdx, setActiveSectorIdx] = useState<number | null>(null);
  const [selectedSeats, setSelectedSeats] = useState<Set<string>>(new Set());
  const [floorPlanUrl, setFloorPlanUrl] = useState(initialLayout?.floorPlanUrl ?? '');
  const [underlayLoading, setUnderlayLoading] = useState(false);
  const [zones, setZones] = useState<Zone[]>(initialLayout?.zones ?? []);
  const [underlay, setUnderlay] = useState<Underlay>(initialLayout?.underlay ?? { opacity: 0.3, scale: 1, x: 0, y: 0 });
  const zoneColor = useMemo(() => new Map(zones.map((z) => [z.id, z.color])), [zones]);
  /** Barva místa: neprodejné šedé, jinak barva cenové zóny, jinak barva sekce. */
  const seatFill = (seat: Seat, sectorColor: string): string =>
    seat.blocked || seat.type === 'unsellable' ? '#94a3b8' : (seat.zone && zoneColor.get(seat.zone)) || sectorColor;
  const seatStroke = (seat: Seat): string =>
    seat.type === 'wheelchair' || seat.accessibility ? '#dc2626' : seat.type === 'companion' ? '#f97316' : seat.type === 'restricted' ? '#000000' : '#ffffff';
  // Pan tool state — for hold-and-drag panning of viewBox.
  const panRef = useRef<{ startClientX: number; startClientY: number; vbX: number; vbY: number } | null>(null);

  // Tool-specific transient state
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  // Inline zadání počtu sedadel (nahrazuje window.prompt).
  const [pendingRow, setPendingRow] = useState<{ kind: 'straight' | 'arc' | 'bezier'; points: Point[] } | null>(null);
  const [countInput, setCountInput] = useState('20');

  // Drag gesture (seats / marquee / stage) — v ref proti stale closure.
  const gestureRef = useRef<Gesture | null>(null);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
  const [snapEnabled, setSnapEnabled] = useState(true);

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
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
        e.preventDefault();
        redo();
      } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (selectedSeats.size > 0) {
          e.preventDefault();
          deleteSelected();
        } else if (selectedStage) {
          e.preventDefault();
          setStage(undefined);
          setSelectedStage(false);
        }
      } else if (e.key === 'Escape') {
        setPendingPoints([]);
        setPendingRow(null);
        setSelectedSeats(new Set());
        setSelectedStage(false);
      } else if (!typing && e.key === '1') setTool('select');
      else if (!typing && e.key === '2') setTool('row-straight');
      else if (!typing && e.key === '3') setTool('row-arc');
      else if (!typing && e.key === '4') setTool('pan');
      else if (!typing && e.key === '5') setTool('overlay');
      else if (!typing && e.key === '6') { setTool('row-bezier'); setPendingPoints([]); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeats, selectedStage, sectors, history, redoStack]);

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

  /** Vyřeší geometrii jeviště — explicitní, nebo auto z bounding boxu (legacy). */
  function resolveStageBox(s: Stage): StageBox {
    if (s.x != null && s.y != null && s.w != null && s.h != null) {
      return { x: s.x, y: s.y, w: s.w, h: s.h, rotation: s.rotation ?? 0, cx: s.x + s.w / 2, cy: s.y + s.h / 2 };
    }
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
    if (!isFinite(gMinX)) {
      const o = parseViewBox(originalViewBox);
      const w = Math.round(o.w * 0.5), h = 60, x = Math.round(o.x + o.w * 0.25), y = Math.round(o.y + 20);
      return { x, y, w, h, rotation: 0, cx: x + w / 2, cy: y + h / 2 };
    }
    const w0 = gMaxX - gMinX, h0 = gMaxY - gMinY;
    const cx0 = (gMinX + gMaxX) / 2, cy0 = (gMinY + gMaxY) / 2, margin = 60;
    let x = 0, y = 0, w = 0, h = 0;
    switch (s.position) {
      case 'top':    w = w0 * 0.5; h = Math.max(40, h0 * 0.07); x = cx0 - w / 2; y = gMinY - margin - h; break;
      case 'bottom': w = w0 * 0.5; h = Math.max(40, h0 * 0.07); x = cx0 - w / 2; y = gMaxY + margin; break;
      case 'left':   w = Math.max(40, w0 * 0.07); h = h0 * 0.5; x = gMinX - margin - w; y = cy0 - h / 2; break;
      case 'right':  w = Math.max(40, w0 * 0.07); h = h0 * 0.5; x = gMaxX + margin; y = cy0 - h / 2; break;
    }
    return { x, y, w, h, rotation: 0, cx: x + w / 2, cy: y + h / 2 };
  }

  /** Přichycení taženého sedadla na X/Y ostatních sedadel + vodicí čáry. */
  function computeSnap(primaryOrig: Point, dx: number, dy: number, selectedIds: Set<string>): { dx: number; dy: number; guides: Guide[] } {
    if (!snapEnabled) return { dx, dy, guides: [] };
    const px = primaryOrig.x + dx, py = primaryOrig.y + dy;
    let bestVx: number | null = null, bestVdist = SNAP_THRESHOLD;
    let bestHy: number | null = null, bestHdist = SNAP_THRESHOLD;
    for (const s of sectors) {
      for (const r of s.rows) {
        for (const seat of r.seats) {
          if (selectedIds.has(seatId(s.name, r.label, seat.num))) continue;
          const ddx = Math.abs(seat.x - px);
          if (ddx < bestVdist) { bestVdist = ddx; bestVx = seat.x; }
          const ddy = Math.abs(seat.y - py);
          if (ddy < bestHdist) { bestHdist = ddy; bestHy = seat.y; }
        }
      }
    }
    const g: Guide[] = [];
    let adjDx = dx, adjDy = dy;
    if (bestVx != null) { adjDx = dx + (bestVx - px); g.push({ kind: 'v', pos: bestVx }); }
    if (bestHy != null) { adjDy = dy + (bestHy - py); g.push({ kind: 'h', pos: bestHy }); }
    return { dx: adjDx, dy: adjDy, guides: g };
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (pendingRow) return; // čeká se na zadání počtu sedadel
    const p = svgPoint(e);
    if (tool === 'row-straight') {
      const next = [...pendingPoints, p];
      if (next.length === 2) {
        setPendingRow({ kind: 'straight', points: next });
        setCountInput('20');
      } else {
        setPendingPoints(next);
      }
    } else if (tool === 'row-arc') {
      const next = [...pendingPoints, p];
      if (next.length === 3) {
        setPendingRow({ kind: 'arc', points: next });
        setCountInput('30');
      } else {
        setPendingPoints(next);
      }
    } else if (tool === 'row-bezier') {
      // Flow: P0 (start), P3 (end), P1 (ctrl near start), P2 (ctrl near end) → create
      const next = [...pendingPoints, p];
      if (next.length === 4) {
        setPendingRow({ kind: 'bezier', points: next });
        setCountInput('25');
      } else {
        setPendingPoints(next);
      }
    } else if (tool === 'overlay') {
      const defaults = OVERLAY_DEFAULTS[selectedOverlayType];
      const newOverlay: OverlayElement = {
        id: Math.random().toString(36).slice(2),
        type: selectedOverlayType,
        x: p.x - defaults.width / 2,
        y: p.y - defaults.height / 2,
        width: defaults.width,
        height: defaults.height,
        label: defaults.label,
      };
      setOverlays((prev) => [...prev, newOverlay]);
    }
    // 'select' → deselect řeší marquee mouseUp (žádná akce zde)
  }

  function confirmPendingRow() {
    if (!pendingRow) return;
    const n = Number.parseInt(countInput, 10);
    if (Number.isNaN(n) || n < 1 || n > 200) {
      setError('Zadej počet sedadel 1–200.');
      return;
    }
    const pts = pendingRow.points;
    if (pendingRow.kind === 'straight') addRow(straightRow(pts[0], pts[1], n));
    else if (pendingRow.kind === 'arc') addRow(arcRow(pts[0], pts[1], pts[2], n));
    else addRow(bezierRow(pts[0], pts[2], pts[3], pts[1], n));
    setPendingRow(null);
    setPendingPoints([]);
    setError(null);
  }

  function cancelPendingRow() {
    setPendingRow(null);
    setPendingPoints([]);
  }

  function addRow(seats: SeatPosition[]) {
    const next = [...sectors];
    let secIdx = activeSectorIdx;
    if (secIdx === null || secIdx >= next.length) {
      // Auto-vytvoření sektoru bez promptu — obsluha ho může přejmenovat v panelu.
      const name = `Sektor ${String.fromCharCode(65 + next.length)}`;
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

  function seatId(secName: string, rLabel: string, num: string): string {
    return `${secName}|${rLabel}|${num}`;
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

  /** Inline přejmenování sektoru (bez promptu) — jeden history záznam na změnu. */
  function commitSectorName(idx: number, name: string) {
    const cur = sectors[idx];
    const trimmed = name.trim();
    if (!cur || !trimmed || trimmed === cur.name) return;
    const next = [...sectors];
    next[idx] = { ...cur, name: trimmed };
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

  function addOrSelectStage() {
    setTool('select');
    if (!stage) {
      const o = parseViewBox(originalViewBox);
      setStage({
        position: 'top',
        label: 'JEVIŠTĚ',
        x: Math.round(o.x + o.w * 0.25),
        y: Math.round(o.y + 20),
        w: Math.round(o.w * 0.5),
        h: 60,
        rotation: 0,
      });
    }
    setSelectedStage(true);
    setSelectedSeats(new Set());
    setSelectedOverlayId(null);
  }

  async function onUnderlayFile(file: File) {
    setError(null);
    setUnderlayLoading(true);
    try {
      const { fileToUnderlayDataUrl } = await import('@/lib/seating/pdf-to-image');
      const dataUrl = await fileToUnderlayDataUrl(file);
      setFloorPlanUrl(dataUrl);
      setFeedback('Podklad nahrán — obkresli sedadla přes něj a ulož.');
    } catch (e) {
      setError((e as Error).message || 'Nepodařilo se načíst podklad.');
    } finally {
      setUnderlayLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setFeedback(null);
    // Kolo 8: duplicitní označení místa (sekce + řada + místo) nejde uložit — server to odmítne taky.
    const dups = duplicateSeatLabels(sectors);
    if (dups.length > 0) {
      setError(`Duplicitní označení míst: ${dups.slice(0, 10).join('; ')}${dups.length > 10 ? ' …' : ''}`);
      setSaving(false);
      return;
    }
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
        // Zahrň i jeviště a objekty, ať se nic neořízne.
        if (stage) {
          const b = resolveStageBox(stage);
          if (b.x + b.w > maxX) maxX = b.x + b.w;
          if (b.y + b.h > maxY) maxY = b.y + b.h;
        }
        for (const o of overlays) {
          if (o.x + o.width > maxX) maxX = o.x + o.width;
          if (o.y + o.height > maxY) maxY = o.y + o.height;
        }
        finalViewBox = `0 0 ${Math.ceil(maxX + 50)} ${Math.ceil(maxY + 50)}`;
      }
      await onSave(chartName, {
        viewBox: finalViewBox,
        sectors,
        stage,
        overlays: overlays.length > 0 ? overlays : undefined,
        floorPlanUrl: floorPlanUrl || undefined,
        zones: zones.length > 0 ? zones : undefined,
        underlay: floorPlanUrl ? underlay : undefined,
      });
      // Kolo 12: místa bez cenové zóny se v termínech neprodávají — dřív se na to přišlo až u zakládání termínu
      const noZone = sectors.flatMap((sec) => sec.rows.flatMap((row) => row.seats)).filter((st) => !st.zone && st.type !== 'unsellable' && !st.blocked).length;
      setFeedback(noZone > 0
        ? `Plánek uložen. Pozor: ${noZone} míst nemá cenovou zónu a v termínech se nebudou prodávat — vyberte je a v části „Cenové zóny" klikněte na „Přiřadit výběru".`
        : 'Plánek uložen.');
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

  // Mega charty (stadiony) kreslíme do canvasu — desítky tisíc SVG kroužků = paint storm.
  const useCanvas = totalSeats > CANVAS_THRESHOLD;

  // Hit-test sedadla pod bodem (vb souřadnice) — v canvas módu nejsou DOM sedadla.
  function findSeatAt(p: Point): { id: string; orig: Point } | null {
    const R2 = 16 * 16;
    let best: { id: string; orig: Point } | null = null;
    let bestD = R2;
    for (const s of sectors) {
      for (const r of s.rows) {
        for (const seat of r.seats) {
          const dx = seat.x - p.x;
          const dy = seat.y - p.y;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = { id: seatId(s.name, r.label, seat.num), orig: { x: seat.x, y: seat.y } };
          }
        }
      }
    }
    return best;
  }

  // Canvas render seat vrstvy s viewport cullingem (zvládne 50k+).
  useEffect(() => {
    if (!useCanvas) return;
    const canvas = canvasRef.current;
    const svg = svgRef.current;
    if (!canvas || !svg) return;
    let raf = 0;
    const draw = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
      const offX = (rect.width - vb.w * scale) / 2;
      const offY = (rect.height - vb.h * scale) / 2;
      const seatR = Math.max(1, 13 * scale);
      const showNums = showSeatNums && seatR > 9;
      const stroke = seatR > 3;
      if (showNums) {
        ctx.font = `${Math.round(seatR)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
      }
      for (const sector of sectors) {
        for (const row of sector.rows) {
          for (const seat of row.seats) {
            const id = seatId(sector.name, row.label, seat.num);
            const sel = selectedSeats.has(id);
            const odx = sel && dragOffset ? dragOffset.dx : 0;
            const ody = sel && dragOffset ? dragOffset.dy : 0;
            const sx = offX + (seat.x + odx - vb.x) * scale;
            const sy = offY + (seat.y + ody - vb.y) * scale;
            if (sx < -seatR || sx > rect.width + seatR || sy < -seatR || sy > rect.height + seatR) continue;
            ctx.beginPath();
            ctx.arc(sx, sy, seatR, 0, Math.PI * 2);
            ctx.fillStyle = sel ? '#10b981' : seatFill(seat, sector.color);
            ctx.fill();
            if (stroke) {
              ctx.lineWidth = sel ? 2 : 1;
              ctx.strokeStyle = sel ? '#000000' : seatStroke(seat);
              ctx.stroke();
            }
            if (showNums) {
              ctx.fillStyle = '#ffffff';
              ctx.fillText(seat.num, sx, sy);
            }
          }
        }
      }
    };
    raf = requestAnimationFrame(draw);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(draw);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [useCanvas, sectors, vb, selectedSeats, dragOffset, showSeatNums, fullscreen]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-2">
        <Input
          value={chartName}
          onChange={(e) => setChartName(e.target.value)}
          placeholder="Název plánku"
          className="max-w-xs"
        />
        <ToolButton active={tool === 'select'} onClick={() => setTool('select')}>
          ↖ Výběr <kbd>1</kbd>
        </ToolButton>
        <ToolButton active={tool === 'row-straight'} onClick={() => { setTool('row-straight'); setPendingPoints([]); }}>
          ─ Řada <kbd>2</kbd>
        </ToolButton>
        <ToolButton active={tool === 'row-arc'} onClick={() => { setTool('row-arc'); setPendingPoints([]); }}>
          ⌒ Oblouk <kbd>3</kbd>
        </ToolButton>
        <ToolButton active={tool === 'pan'} onClick={() => setTool('pan')}>
          ✋ Posun <kbd>4</kbd>
        </ToolButton>
        <ToolButton active={tool === 'overlay'} onClick={() => { setTool('overlay'); setPendingPoints([]); }}>
          🏟 Objekty <kbd>5</kbd>
        </ToolButton>
        <ToolButton active={tool === 'row-bezier'} onClick={() => { setTool('row-bezier'); setPendingPoints([]); }}>
          〜 Křivka <kbd>6</kbd>
        </ToolButton>
        <button
          type="button"
          onClick={addOrSelectStage}
          className={
            selectedStage
              ? 'rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white'
              : 'rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted'
          }
          title={stage ? 'Vybrat jeviště (pak přetáhni/otoč/zvětši)' : 'Přidat jeviště'}
        >
          🎭 Jeviště
        </button>
        {tool === 'overlay' ? (
          <>
            <div className="ml-1 h-6 w-px bg-border" />
            {(Object.keys(OVERLAY_DEFAULTS) as OverlayElement['type'][]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSelectedOverlayType(t)}
                className={
                  selectedOverlayType === t
                    ? 'rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white'
                    : 'rounded-md border bg-background px-2 py-1 text-xs font-medium hover:bg-muted'
                }
              >
                {t === 'football_pitch' ? '⚽ Hřiště'
                  : t === 'tennis_court' ? '🎾 Kurt'
                  : t === 'bar' ? '🍺 Bar'
                  : t === 'stage_icon' ? '🎤 Pódium'
                  : t === 'entrance' ? '🚪 Vstup'
                  : '🪜 Schody'}
              </button>
            ))}
          </>
        ) : null}
        <div className="ml-2 h-6 w-px bg-border" />
        <Button variant="outline" size="sm" onClick={undo} disabled={history.length === 0}>
          ↶ Vrátit
        </Button>
        <Button variant="outline" size="sm" onClick={redo} disabled={redoStack.length === 0}>
          ↷ Znovu
        </Button>
        <div className="ml-2 h-6 w-px bg-border" />
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(e) => setSnapEnabled(e.target.checked)}
          />
          🧲 Přichytávání
        </label>
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
          Čísla míst
        </label>
        <div className="ml-2 h-6 w-px bg-border" />
        {selectedSeats.size > 0 ? (
          <>
            <span className="text-xs text-muted-foreground">
              Vybráno {selectedSeats.size} sedadel
            </span>
            <Button variant="outline" size="sm" onClick={toggleAccessibility}>
              ♿ Pro vozíčkáře
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteSelected}>
              🗑 Smazat
            </Button>
          </>
        ) : null}
        {selectedStage && stage ? (
          <>
            <span className="text-xs text-muted-foreground">Jeviště vybráno</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setStage(undefined); setSelectedStage(false); }}
            >
              🗑 Smazat jeviště
            </Button>
          </>
        ) : null}
        {selectedOverlayId !== null ? (
          <>
            <span className="text-xs text-muted-foreground">Objekt vybrán</span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setOverlays((prev) => prev.filter((o) => o.id !== selectedOverlayId));
                setSelectedOverlayId(null);
              }}
            >
              🗑 Smazat objekt
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
            title="Původní pohled"
          >⟲</button>
          <button
            type="button"
            onClick={() => setFullscreen(!fullscreen)}
            className="rounded border bg-background px-2 py-1 text-xs hover:bg-accent"
            title={fullscreen ? 'Zavřít celou obrazovku (Esc)' : 'Na celou obrazovku'}
          >{fullscreen ? '✕' : '⛶'}</button>
          <div className="ml-2 h-6 w-px bg-border" />
          <Button onClick={save} disabled={saving}>
            {saving ? 'Ukládám…' : 'Uložit plánek'}
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
            {pendingRow ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <span className="font-medium">Počet sedadel v řadě:</span>
                <input
                  autoFocus
                  type="number"
                  min={1}
                  max={200}
                  value={countInput}
                  onChange={(e) => setCountInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); confirmPendingRow(); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelPendingRow(); }
                  }}
                  className="w-24 rounded border border-amber-300 bg-white px-2 py-1"
                />
                <Button size="sm" onClick={confirmPendingRow}>Přidat řadu</Button>
                <button type="button" onClick={cancelPendingRow} className="text-xs underline">Zrušit</button>
              </div>
            ) : (
              <ToolHints tool={tool} pendingCount={pendingPoints.length} />
            )}
            <div
              className={
                useCanvas
                  ? fullscreen ? 'relative flex flex-1 flex-col bg-slate-50' : 'relative bg-slate-50'
                  : fullscreen ? 'relative flex flex-1 flex-col' : 'relative'
              }
            >
            {useCanvas ? (
              <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 z-0" />
            ) : null}
            <svg
              ref={svgRef}
              viewBox={vbToString(vb)}
              className={`relative z-10 block w-full ${useCanvas ? '' : 'bg-slate-50'}`}
              style={{
                minHeight: fullscreen ? '100%' : 500,
                flex: fullscreen ? 1 : undefined,
                touchAction: 'none',
                cursor: panRef.current
                  ? 'grabbing'
                  : tool === 'pan'
                    ? 'grab'
                    : draggingLabel || gestureRef.current
                      ? 'grabbing'
                      : tool === 'select'
                        ? 'default'
                        : tool === 'row-bezier'
                          ? 'cell'
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
                  return;
                }
                // Select tool: v canvas módu nejdřív hit-test sedadla (nemají DOM),
                // jinak press na prázdno = start marquee (rámečkový výběr).
                if (tool === 'select' && e.button === 0 && !pendingRow) {
                  const p = svgPoint(e);
                  if (useCanvas) {
                    const hit = findSeatAt(p);
                    if (hit) {
                      const multi = e.shiftKey || e.metaKey || e.ctrlKey;
                      let ids: Set<string>;
                      if (selectedSeats.has(hit.id)) ids = new Set(selectedSeats);
                      else if (multi) { ids = new Set(selectedSeats); ids.add(hit.id); }
                      else ids = new Set([hit.id]);
                      setSelectedSeats(ids);
                      setSelectedStage(false);
                      setSelectedOverlayId(null);
                      gestureRef.current = {
                        kind: 'seats',
                        startPt: p,
                        snapshot: sectors,
                        primaryOrig: hit.orig,
                        selectedIds: ids,
                        lastOffset: null,
                      };
                      return;
                    }
                  }
                  gestureRef.current = {
                    kind: 'marquee',
                    startPt: p,
                    additive: e.shiftKey || e.metaKey || e.ctrlKey,
                    baseSelection: new Set(selectedSeats),
                    last: p,
                  };
                  setMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
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
                const g = gestureRef.current;
                if (g) {
                  const p = svgPoint(e);
                  if (g.kind === 'seats') {
                    const rawDx = p.x - g.startPt.x;
                    const rawDy = p.y - g.startPt.y;
                    const snap = computeSnap(g.primaryOrig, rawDx, rawDy, g.selectedIds);
                    g.lastOffset = { dx: snap.dx, dy: snap.dy };
                    setDragOffset({ dx: snap.dx, dy: snap.dy });
                    setGuides(snap.guides);
                  } else if (g.kind === 'marquee') {
                    g.last = p;
                    setMarquee((m) => (m ? { ...m, x1: p.x, y1: p.y } : m));
                  } else if (g.kind === 'stage-move') {
                    const dx = p.x - g.startPt.x, dy = p.y - g.startPt.y;
                    setStage((s) => (s ? { ...s, x: Math.round(g.orig.x + dx), y: Math.round(g.orig.y + dy), w: g.orig.w, h: g.orig.h, rotation: g.orig.rotation } : s));
                  } else if (g.kind === 'stage-resize') {
                    const nw = Math.max(20, Math.round(g.orig.w + (p.x - g.startPt.x)));
                    const nh = Math.max(12, Math.round(g.orig.h + (p.y - g.startPt.y)));
                    setStage((s) => (s ? { ...s, x: g.orig.x, y: g.orig.y, w: nw, h: nh, rotation: g.orig.rotation } : s));
                  } else if (g.kind === 'stage-rotate') {
                    const ang = Math.atan2(p.y - g.center.y, p.x - g.center.x) * 180 / Math.PI + 90;
                    setStage((s) => (s ? { ...s, rotation: Math.round(ang) } : s));
                  }
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
                const g = gestureRef.current;
                if (g) {
                  if (g.kind === 'seats') {
                    const off = g.lastOffset;
                    if (off && (off.dx !== 0 || off.dy !== 0)) {
                      const ids = g.selectedIds;
                      const next = sectors.map((s) => ({
                        ...s,
                        rows: s.rows.map((r) => ({
                          ...r,
                          seats: r.seats.map((seat) =>
                            ids.has(seatId(s.name, r.label, seat.num))
                              ? { ...seat, x: Math.round(seat.x + off.dx), y: Math.round(seat.y + off.dy) }
                              : seat,
                          ),
                        })),
                      }));
                      setHistory((h) => [...h.slice(-49), g.snapshot]);
                      setRedoStack([]);
                      setSectors(next);
                    }
                  } else if (g.kind === 'marquee') {
                    const last = g.last;
                    const minX = Math.min(g.startPt.x, last.x), maxX = Math.max(g.startPt.x, last.x);
                    const minY = Math.min(g.startPt.y, last.y), maxY = Math.max(g.startPt.y, last.y);
                    const moved = (maxX - minX) > 3 || (maxY - minY) > 3;
                    if (moved) {
                      const hits = new Set<string>(g.additive ? Array.from(g.baseSelection) : []);
                      for (const s of sectors) {
                        for (const r of s.rows) {
                          for (const seat of r.seats) {
                            if (seat.x >= minX && seat.x <= maxX && seat.y >= minY && seat.y <= maxY) {
                              hits.add(seatId(s.name, r.label, seat.num));
                            }
                          }
                        }
                      }
                      setSelectedSeats(hits);
                      setSelectedStage(false);
                      setSelectedOverlayId(null);
                    } else if (!g.additive) {
                      // Prostý klik do prázdna = odznačit.
                      setSelectedSeats(new Set());
                      setSelectedStage(false);
                      setSelectedOverlayId(null);
                    }
                  }
                  gestureRef.current = null;
                  setDragOffset(null);
                  setGuides([]);
                  setMarquee(null);
                  return;
                }
                if (!draggingLabel) return;
                // Push PRE-drag snapshot do history (sectors v current stavu = post-drag).
                setHistory((h) => [...h.slice(-49), draggingLabel.origSectors]);
                setRedoStack([]);
                setDraggingLabel(null);
              }}
              onMouseLeave={() => {
                if (panRef.current) panRef.current = null;
                if (gestureRef.current) {
                  gestureRef.current = null;
                  setDragOffset(null);
                  setGuides([]);
                  setMarquee(null);
                }
                if (draggingLabel) setDraggingLabel(null);
              }}
              role="application"
              aria-label="Plátno editoru plánku sálu"
            >
              {floorPlanUrl ? (
                <image
                  href={floorPlanUrl}
                  x={underlay.x}
                  y={underlay.y}
                  width={1200 * underlay.scale}
                  opacity={underlay.opacity}
                  pointerEvents="none"
                  data-testid="chart-underlay"
                />
              ) : null}

              {/* Snapping guide lines */}
              {guides.map((gd, i) =>
                gd.kind === 'v' ? (
                  <line key={`g${i}`} x1={gd.pos} y1={vb.y} x2={gd.pos} y2={vb.y + vb.h} stroke="#ec4899" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />
                ) : (
                  <line key={`g${i}`} x1={vb.x} y1={gd.pos} x2={vb.x + vb.w} y2={gd.pos} stroke="#ec4899" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none" />
                ),
              )}

              {/* Marquee selection box */}
              {marquee ? (
                <rect
                  x={Math.min(marquee.x0, marquee.x1)}
                  y={Math.min(marquee.y0, marquee.y1)}
                  width={Math.abs(marquee.x1 - marquee.x0)}
                  height={Math.abs(marquee.y1 - marquee.y0)}
                  fill="#6C47FF22"
                  stroke="#6C47FF"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  pointerEvents="none"
                />
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

              {/* Bezier tool preview */}
              {tool === 'row-bezier' && pendingPoints.length >= 2 ? (
                <line
                  x1={pendingPoints[0].x}
                  y1={pendingPoints[0].y}
                  x2={pendingPoints[1].x}
                  y2={pendingPoints[1].y}
                  stroke="#3b82f6"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                />
              ) : null}
              {tool === 'row-bezier' && pendingPoints.length >= 3 ? (
                <path
                  d={bezierPath(
                    pendingPoints[0],
                    pendingPoints[2],
                    pendingPoints.length >= 4 ? pendingPoints[3] : pendingPoints[1],
                    pendingPoints[1],
                  )}
                  fill="none"
                  stroke="#3b82f6"
                  strokeDasharray="5 3"
                  strokeWidth={2}
                />
              ) : null}
              {tool === 'row-bezier' && pendingPoints.length >= 3 ? (
                <line
                  x1={pendingPoints[0].x}
                  y1={pendingPoints[0].y}
                  x2={pendingPoints[2].x}
                  y2={pendingPoints[2].y}
                  stroke="#93c5fd"
                  strokeDasharray="2 3"
                  strokeWidth={1}
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
                      {!useCanvas && row.seats.map((seat) => {
                        const id = seatId(sector.name, row.label, seat.num);
                        const isSelected = selectedSeats.has(id);
                        const r = isSelected ? 16 : 14; // 1:1 s preview
                        const off = isSelected && dragOffset ? dragOffset : null;
                        const cx = seat.x + (off ? off.dx : 0);
                        const cy = seat.y + (off ? off.dy : 0);
                        return (
                          <g key={id}>
                            <circle
                              cx={cx}
                              cy={cy}
                              r={r}
                              fill={seatFill(seat, sector.color)}
                              stroke={isSelected ? '#000' : seatStroke(seat)}
                              strokeWidth={isSelected ? 2 : seat.type && seat.type !== 'standard' ? 3 : 1}
                              strokeDasharray={seat.type === 'restricted' ? '3 2' : undefined}
                              data-seat-type={seat.type ?? 'standard'}
                              onMouseDown={(e) => {
                                if (tool !== 'select' || e.button !== 0) return;
                                e.stopPropagation();
                                const multi = e.shiftKey || e.metaKey || e.ctrlKey;
                                let ids: Set<string>;
                                if (selectedSeats.has(id)) {
                                  ids = new Set(selectedSeats); // drag celý existující výběr
                                } else if (multi) {
                                  ids = new Set(selectedSeats);
                                  ids.add(id);
                                } else {
                                  ids = new Set([id]);
                                }
                                setSelectedSeats(ids);
                                setSelectedStage(false);
                                setSelectedOverlayId(null);
                                gestureRef.current = {
                                  kind: 'seats',
                                  startPt: svgPoint(e),
                                  snapshot: sectors,
                                  primaryOrig: { x: seat.x, y: seat.y },
                                  selectedIds: ids,
                                  lastOffset: null,
                                };
                              }}
                              onClick={(e) => {
                                // Zabraň bublání na svg (deselect). Výběr se řeší v onMouseDown.
                                if (tool === 'select') e.stopPropagation();
                              }}
                              style={{ cursor: tool === 'select' ? 'move' : 'crosshair' }}
                            >
                              <title>{`${sector.name} · řada ${row.label} · sedadlo ${seat.num}${seat.type && seat.type !== 'standard' ? ` · ${SEAT_TYPE_LABEL[seat.type]}` : seat.accessibility ? ' · ♿' : ''}${seat.note ? ` (${seat.note})` : ''}${seat.zone ? ` · ${zones.find((z) => z.id === seat.zone)?.name ?? ''}` : ''}`}</title>
                            </circle>
                            {showSeatNums && (
                              <text
                                x={cx}
                                y={cy}
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

              {/* Overlay elements */}
              {overlays.map((ov) => {
                const isSelectedOv = selectedOverlayId === ov.id;
                return (
                  <g
                    key={ov.id}
                    style={{ cursor: tool === 'select' ? 'pointer' : 'default' }}
                    onMouseDown={(e) => {
                      if (tool === 'select') e.stopPropagation();
                    }}
                    onClick={(e) => {
                      if (tool === 'select') {
                        e.stopPropagation();
                        setSelectedOverlayId(isSelectedOv ? null : ov.id);
                        setSelectedSeats(new Set());
                        setSelectedStage(false);
                      }
                    }}
                  >
                    {isSelectedOv ? (
                      <rect
                        x={ov.x - 3}
                        y={ov.y - 3}
                        width={ov.width + 6}
                        height={ov.height + 6}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        strokeDasharray="6 3"
                        rx={4}
                      />
                    ) : null}
                    {ov.type === 'football_pitch' ? (
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#16a34a" rx={4} />
                        {/* Halfway line */}
                        <line x1={ov.x + ov.width / 2} y1={ov.y + 5} x2={ov.x + ov.width / 2} y2={ov.y + ov.height - 5} stroke="white" strokeWidth={1.5} />
                        {/* Center circle */}
                        <circle cx={ov.x + ov.width / 2} cy={ov.y + ov.height / 2} r={ov.height * 0.18} fill="none" stroke="white" strokeWidth={1.5} />
                        {/* Penalty box left */}
                        <rect x={ov.x + 5} y={ov.y + ov.height * 0.2} width={ov.width * 0.15} height={ov.height * 0.6} fill="none" stroke="white" strokeWidth={1.2} />
                        {/* Penalty box right */}
                        <rect x={ov.x + ov.width - 5 - ov.width * 0.15} y={ov.y + ov.height * 0.2} width={ov.width * 0.15} height={ov.height * 0.6} fill="none" stroke="white" strokeWidth={1.2} />
                        {/* Outer border */}
                        <rect x={ov.x + 5} y={ov.y + 5} width={ov.width - 10} height={ov.height - 10} fill="none" stroke="white" strokeWidth={1.5} />
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(14, ov.height * 0.12)} fill="white" fontWeight="700" pointerEvents="none">
                          {ov.label}
                        </text>
                      </g>
                    ) : ov.type === 'tennis_court' ? (
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#1d4ed8" rx={4} />
                        {/* Net line */}
                        <line x1={ov.x + ov.width / 2} y1={ov.y + 4} x2={ov.x + ov.width / 2} y2={ov.y + ov.height - 4} stroke="white" strokeWidth={2} />
                        {/* Service boxes */}
                        <line x1={ov.x + ov.width * 0.15} y1={ov.y + ov.height / 2} x2={ov.x + ov.width * 0.85} y2={ov.y + ov.height / 2} stroke="white" strokeWidth={1} />
                        <rect x={ov.x + 4} y={ov.y + 4} width={ov.width - 8} height={ov.height - 8} fill="none" stroke="white" strokeWidth={1.2} />
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(12, ov.height * 0.15)} fill="white" fontWeight="700" pointerEvents="none">
                          {ov.label}
                        </text>
                      </g>
                    ) : ov.type === 'bar' ? (
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#92400e" rx={4} />
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(13, ov.height * 0.3)} fill="white" fontWeight="700" pointerEvents="none">
                          🍺 {ov.label}
                        </text>
                      </g>
                    ) : ov.type === 'entrance' ? (
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#16a34a" rx={ov.width * 0.3} />
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(11, ov.width * 0.28)} fill="white" fontWeight="700" pointerEvents="none">
                          🚪
                        </text>
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height + 12} textAnchor="middle" fontSize={10} fill="#333" pointerEvents="none">
                          {ov.label}
                        </text>
                      </g>
                    ) : ov.type === 'stairs' ? (
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#94a3b8" rx={3} />
                        {/* Step lines */}
                        {Array.from({ length: 4 }, (_, i) => (
                          <line
                            key={i}
                            x1={ov.x + 2}
                            y1={ov.y + (ov.height / 5) * (i + 1)}
                            x2={ov.x + ov.width - 2}
                            y2={ov.y + (ov.height / 5) * (i + 1)}
                            stroke="white"
                            strokeWidth={1.5}
                          />
                        ))}
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height + 12} textAnchor="middle" fontSize={10} fill="#333" pointerEvents="none">
                          {ov.label}
                        </text>
                      </g>
                    ) : (
                      /* stage_icon */
                      <g>
                        <rect x={ov.x} y={ov.y} width={ov.width} height={ov.height} fill="#1e1b4b" rx={4} />
                        <text x={ov.x + ov.width / 2} y={ov.y + ov.height / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.min(13, ov.height * 0.28)} fill="white" fontWeight="700" pointerEvents="none">
                          🎤 {ov.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Stage / podium — přetahovatelné, otočitelné, zvětšitelné */}
              {stage ? (() => {
                const box = resolveStageBox(stage);
                const { x, y, w, h, rotation, cx, cy } = box;
                const fontSize = Math.min(h * 0.5, w * 0.15, 80);
                const showHandles = selectedStage && tool === 'select';
                return (
                  <g transform={`rotate(${rotation} ${cx} ${cy})`}>
                    {showHandles ? (
                      <rect x={x - 4} y={y - 4} width={w + 8} height={h + 8} fill="none" stroke="#6C47FF" strokeWidth={2} strokeDasharray="6 3" rx={4} />
                    ) : null}
                    <rect
                      x={x} y={y} width={w} height={h}
                      rx={Math.min(w, h) * 0.15}
                      fill="#1e293b"
                      opacity={0.9}
                      style={{ cursor: tool === 'select' ? 'move' : 'default' }}
                      onMouseDown={(e) => {
                        if (tool !== 'select' || e.button !== 0) return;
                        e.stopPropagation();
                        setSelectedStage(true);
                        setSelectedSeats(new Set());
                        setSelectedOverlayId(null);
                        gestureRef.current = { kind: 'stage-move', startPt: svgPoint(e), orig: box };
                      }}
                      onClick={(e) => { if (tool === 'select') e.stopPropagation(); }}
                    />
                    <text x={cx} y={cy} fontSize={fontSize} fill="white" textAnchor="middle" dominantBaseline="middle" fontWeight="700" style={{ letterSpacing: '4px' }} pointerEvents="none">
                      {stage.label}
                    </text>
                    {showHandles ? (
                      <>
                        {/* resize handle — pravý dolní roh */}
                        <rect
                          x={x + w - 7} y={y + h - 7} width={14} height={14}
                          fill="#6C47FF" stroke="#fff" strokeWidth={1.5}
                          style={{ cursor: 'nwse-resize' }}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            gestureRef.current = { kind: 'stage-resize', startPt: svgPoint(e), orig: box };
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {/* rotate handle — nad středem */}
                        <line x1={cx} y1={y} x2={cx} y2={y - 28} stroke="#6C47FF" strokeWidth={1.5} />
                        <circle
                          cx={cx} cy={y - 28} r={8}
                          fill="#6C47FF" stroke="#fff" strokeWidth={1.5}
                          style={{ cursor: 'grab' }}
                          onMouseDown={(e) => {
                            if (e.button !== 0) return;
                            e.stopPropagation();
                            gestureRef.current = { kind: 'stage-rotate', center: { x: cx, y: cy } };
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </>
                    ) : null}
                  </g>
                );
              })() : null}
            </svg>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <TheatreTools
            sectors={sectors}
            selected={selectedSeats}
            zones={zones}
            setZones={setZones}
            underlay={underlay}
            setUnderlay={setUnderlay}
            hasUnderlay={!!floorPlanUrl}
            apply={(next) => pushHistory(next as Sector[])}
            notify={(m) => setFeedback(m)}
          />
          {zones.length > 0 ? (
            <div className="flex flex-wrap gap-3 rounded-md border p-2 text-xs" data-testid="chart-legend">
              {zones.map((z) => (
                <span key={z.id} className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-full" style={{ background: z.color }} />{z.name}
                </span>
              ))}
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-red-600" />vozíčkář</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-orange-500" />doprovod</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full bg-slate-400" />neprodejné</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-black" />omezený výhled</span>
            </div>
          ) : null}
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
                      <input
                        key={`name-${i}-${s.name}`}
                        defaultValue={s.name}
                        onFocus={() => setActiveSectorIdx(i)}
                        onBlur={(e) => commitSectorName(i, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                        }}
                        className="flex-1 rounded border bg-background px-1 py-0.5 text-sm font-medium"
                        title="Klik = aktivní pro nové řady · uprav text = přejmenovat"
                      />
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
              <CardTitle className="text-sm">Podklad / plánek (volitelné)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-2 text-xs font-medium text-primary hover:bg-primary/10">
                📄 {underlayLoading ? 'Zpracovávám…' : 'Nahrát obrázek / PDF plánu'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
                  className="hidden"
                  disabled={underlayLoading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUnderlayFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
              <Input
                type="text"
                placeholder="…nebo vlož URL plánu"
                value={floorPlanUrl.startsWith('data:') ? '' : floorPlanUrl}
                onChange={(e) => setFloorPlanUrl(e.target.value)}
                disabled={floorPlanUrl.startsWith('data:')}
              />
              {floorPlanUrl ? (
                <button
                  type="button"
                  onClick={() => setFloorPlanUrl('')}
                  className="text-xs text-rose-700 hover:underline"
                >
                  ✕ Odebrat podklad
                </button>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Zobrazí se pod sedadly jako předloha k obkreslení. Uloží se spolu s plánkem.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Jak na to</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              <div><strong>Posunout sedadlo:</strong> Výběr → chyť a táhni</div>
              <div><strong>Vybrat víc:</strong> táhni rámeček přes sedadla</div>
              <div><strong>Jeviště:</strong> tlačítko 🎭 → chyť tělo (posun), roh (velikost), kolečko nahoře (rotace)</div>
              <div className="pt-1"><kbd>1</kbd>–<kbd>6</kbd> nástroje · <kbd>Ctrl+Z</kbd> vrátit · <kbd>Del</kbd> smazat · <kbd>Esc</kbd> zrušit · <kbd>Shift+klik</kbd> vybrat víc</div>
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
  if (tool === 'overlay') {
    return (
      <div className="mb-2 rounded-md bg-violet-50 px-3 py-1.5 text-xs text-violet-900">
        <strong>Objekty:</strong> klikni na plátno pro vložení objektu. V režimu Výběr pak klikni na objekt pro výběr a smazání.
      </div>
    );
  }
  if (tool === 'select') {
    return (
      <div className="mb-2 rounded-md bg-muted/50 px-3 py-1.5 text-xs">
        <strong>Výběr:</strong> chyť a táhni sedadlo · rámeček přes sedadla = hromadný výběr · Shift+klik = přidat · Del smaže
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
  if (tool === 'row-bezier') {
    const steps = [
      'Klikni na ZAČÁTEK křivky',
      'Klikni na KONEC křivky',
      'Klikni na 1. řídicí bod (tvaruje začátek)',
      'Klikni na 2. řídicí bod (tvaruje konec) → zadej počet sedadel',
    ];
    return (
      <div className="mb-2 rounded-md bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
        <strong>Křivka ({pendingCount}/4):</strong> {steps[pendingCount] ?? ''}
      </div>
    );
  }
  return null;
}
