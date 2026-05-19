/**
 * Pure transformations on seating layouts.
 *
 * Each function returns a NEW layout — caller persists as new chart version.
 * Žádný transform nemodifikuje vstup in-place.
 */

interface Seat {
  num: string;
  x: number;
  y: number;
  accessibility?: boolean;
}
interface Row {
  label: string;
  seats: Seat[];
}
interface Sector {
  name: string;
  color?: string;
  rows: Row[];
}
export interface Stage {
  /** 'top' / 'bottom' / 'left' / 'right' = automatické umístění podle bounding boxu sektorů. */
  position: 'top' | 'bottom' | 'left' | 'right';
  label: string;
}
export interface Layout {
  viewBox: string;
  sectors: Sector[];
  stage?: Stage;
}

// ---------- Renumbering ----------

export type RenumberMode = 'numeric' | 'numeric-reverse' | 'alpha' | 'alpha-reverse' | 'custom';

export function renumberRows(
  layout: Layout,
  sectorName: string,
  mode: RenumberMode,
  options: { start?: number; customLabels?: string[] } = {},
): Layout {
  return {
    ...layout,
    sectors: layout.sectors.map((s) => {
      if (s.name !== sectorName) return s;
      const total = s.rows.length;
      return {
        ...s,
        rows: s.rows.map((row, idx) => ({
          ...row,
          label: computeLabel(idx, total, mode, options),
        })),
      };
    }),
  };
}

function computeLabel(
  idx: number,
  total: number,
  mode: RenumberMode,
  opts: { start?: number; customLabels?: string[] },
): string {
  const start = opts.start ?? 1;
  switch (mode) {
    case 'numeric':
      return String(start + idx);
    case 'numeric-reverse':
      return String(start + total - 1 - idx);
    case 'alpha':
      return alphaLabel(idx);
    case 'alpha-reverse':
      return alphaLabel(total - 1 - idx);
    case 'custom':
      return opts.customLabels?.[idx] ?? String(start + idx);
  }
}

function alphaLabel(idx: number): string {
  if (idx < 26) return String.fromCharCode(65 + idx);
  return (
    String.fromCharCode(65 + Math.floor(idx / 26) - 1) +
    String.fromCharCode(65 + (idx % 26))
  );
}

// ---------- Flatten ----------

/**
 * Sloučí všechny řady sektoru do JEDNÉ řady. Seats se seřadí (y ↑, x ↑) a volitelně přečíslují
 * sekvenčně 1-N. Užitečné pro sektory které jsou ve skutečnosti sloupec (boční balkon, gallery)
 * — ne 2D grid — kde row labely 1, 2, 3... jen zaplevelují UI.
 *
 * Default `rowLabel = ''` (prázdný řetězec) → preview komponenty label skryjí.
 */
export function flattenSector(
  layout: Layout,
  sectorName: string,
  options: { rowLabel?: string; renumberSeats?: boolean } = {},
): Layout {
  const idx = layout.sectors.findIndex((s) => s.name === sectorName);
  if (idx < 0) return layout;
  const sector = layout.sectors[idx];
  const all: Seat[] = [];
  for (const row of sector.rows) {
    for (const seat of row.seats) all.push(seat);
  }
  all.sort((a, b) => a.y - b.y || a.x - b.x);
  const seats = options.renumberSeats
    ? all.map((s, i) => ({ ...s, num: String(i + 1) }))
    : all;
  const rowLabel = options.rowLabel ?? '';
  return {
    ...layout,
    sectors: layout.sectors.map((s, i) =>
      i === idx ? { ...s, rows: [{ label: rowLabel, seats }] } : s,
    ),
  };
}

// ---------- Stage / podium ----------

/**
 * Nastaví podium/jeviště v layoutu. `stage = null` smaže.
 *
 * Konkrétní souřadnice (kde se vykreslí obdélník) se počítají na render-time z bounding boxu
 * sektorů — jednoduchá orientace `top|bottom|left|right` stačí, label je text uvnitř.
 */
export function setStage(layout: Layout, stage: Stage | null): Layout {
  if (stage === null) {
    const next = { ...layout };
    delete next.stage;
    return next;
  }
  return { ...layout, stage };
}

// ---------- Sector rename ----------

export function renameSector(layout: Layout, from: string, to: string): Layout {
  return {
    ...layout,
    sectors: layout.sectors.map((s) =>
      s.name === from ? { ...s, name: to } : s,
    ),
  };
}

// ---------- Spatial clustering (Union-Find based proximity) ----------

interface FlatSeat {
  x: number;
  y: number;
  rowLabel: string;
  seat: Seat;
}

function flatten(sector: Sector): FlatSeat[] {
  const out: FlatSeat[] = [];
  for (const row of sector.rows) {
    for (const seat of row.seats) {
      out.push({ x: seat.x, y: seat.y, rowLabel: row.label, seat });
    }
  }
  return out;
}

/**
 * Cluster seats by proximity (anisotropic Chebyshev). Two seats jsou neighbors pokud
 * `|dx| ≤ xMaxDist` A `|dy| ≤ yMaxDist`. Two seats jsou ve stejném clusteru pokud existuje
 * řetězec sousedů.
 *
 * Anisotropic je důležité pro divadelní balkony: vertikální Y-gap mezi top a curving částí
 * stejného balkonu může být 200+ px (záměrná mezera v půdorysu), ale horizontálně sektor
 * pořád zůstává v úzkém X-pásmu. Symetrický euklidovský práh by tyto sektory rozsekal.
 *
 * Defaults zvolené pro typické divadlo / koncertní sál:
 *   xMaxDist = 150 — pokrývá seat spacing (~40-50) + uličku (~80-100), ale ne split mezi balkony (300+)
 *   yMaxDist = 250 — pokrývá row spacing (~47-57) + Y-gap mezi částmi sektoru
 *
 * Pokud zavoláš jen s jedním argumentem, použije se symetricky (yMax = xMax) pro backwards compat.
 *
 * Output: array clusterů (každý cluster = pole indexů do `seats`).
 */
export function spatialCluster(
  seats: { x: number; y: number }[],
  xMaxDist: number,
  yMaxDist?: number,
): number[][] {
  const yMax = yMaxDist ?? xMaxDist;
  const n = seats.length;
  if (n === 0) return [];
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[i] !== root) {
      const next = parent[i];
      parent[i] = root;
      i = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < n; i++) {
    const si = seats[i];
    for (let j = i + 1; j < n; j++) {
      const sj = seats[j];
      const dx = Math.abs(si.x - sj.x);
      const dy = Math.abs(si.y - sj.y);
      if (dx <= xMaxDist && dy <= yMax) union(i, j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(i);
  }
  return [...groups.values()];
}

// ---------- Sector split by spatial clusters ----------

export interface SplitSuggestion {
  count: number;
  clusters: { seatCount: number; minX: number; maxX: number; minY: number; maxY: number }[];
}

/**
 * Detekuje kolik prostorových clusterů by sektor vytvořilo při daném prahu.
 * Použij pro UI náhled před skutečným splitem.
 */
export function suggestSplit(
  layout: Layout,
  sectorName: string,
  xMaxDist: number,
  yMaxDist?: number,
): SplitSuggestion | null {
  const sector = layout.sectors.find((s) => s.name === sectorName);
  if (!sector) return null;
  const flat = flatten(sector);
  const clusters = spatialCluster(flat, xMaxDist, yMaxDist);
  return {
    count: clusters.length,
    clusters: clusters.map((idxs) => {
      const seats = idxs.map((i) => flat[i]);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const s of seats) {
        if (s.x < minX) minX = s.x;
        if (s.x > maxX) maxX = s.x;
        if (s.y < minY) minY = s.y;
        if (s.y > maxY) maxY = s.y;
      }
      return { seatCount: seats.length, minX, maxX, minY, maxY };
    }).sort((a, b) => b.seatCount - a.seatCount),
  };
}

/**
 * Split sektoru podle prostorových clusterů.
 *
 * `names` (nepovinné) přejmenuje cluster i-tý cluster (sorted by seat count desc).
 * Pokud chybí, použijí se "${sectorName} #1", "${sectorName} #2" atd.
 *
 * Y-clustering řad probíhá per-cluster znovu (řady mohou mít různé Y-rozsahy v každém clusteru).
 */
export function splitSectorBySpatial(
  layout: Layout,
  sectorName: string,
  xMaxDist: number,
  options: { yMaxDist?: number; names?: string[]; rowYTolerance?: number } = {},
): Layout {
  const idx = layout.sectors.findIndex((s) => s.name === sectorName);
  if (idx < 0) return layout;
  const sector = layout.sectors[idx];
  const flat = flatten(sector);
  const clusters = spatialCluster(flat, xMaxDist, options.yMaxDist);
  if (clusters.length <= 1) return layout;

  // Sort clusters by seat count desc (largest first), so naming is stable.
  clusters.sort((a, b) => b.length - a.length);

  const yTol = options.rowYTolerance ?? 15;
  const newSectors: Sector[] = clusters.map((seatIdxs, ci) => {
    const seatsIn = seatIdxs.map((i) => flat[i]);
    // Re-cluster by Y to form rows.
    seatsIn.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: Row[] = [];
    let currentY = -Infinity;
    let currentRow: Row | null = null;
    for (const s of seatsIn) {
      if (Math.abs(s.y - currentY) > yTol) {
        currentRow = { label: String(rows.length + 1), seats: [] };
        rows.push(currentRow);
        currentY = s.y;
      }
      currentRow!.seats.push(s.seat);
    }
    for (const r of rows) r.seats.sort((a, b) => a.x - b.x);
    return {
      name: options.names?.[ci] ?? `${sectorName} #${ci + 1}`,
      color: sector.color,
      rows,
    };
  });

  return {
    ...layout,
    sectors: [
      ...layout.sectors.slice(0, idx),
      ...newSectors,
      ...layout.sectors.slice(idx + 1),
    ],
  };
}

// ---------- Auto-suggestions ----------

export interface AutoSuggestion {
  kind: 'alpha-rows' | 'splittable-sector' | 'column-sector';
  sectorName: string;
  description: string;
  /** Operation to apply, ready-to-go with sensible defaults. */
  op:
    | { type: 'renumber'; mode: RenumberMode }
    | { type: 'split'; xMaxDist: number; yMaxDist: number; suggestedClusters: number }
    | { type: 'flatten'; renumberSeats: boolean };
}

const DEFAULT_X_THRESHOLD = 150;
const DEFAULT_Y_THRESHOLD = 250;

export function analyzeForSuggestions(layout: Layout): AutoSuggestion[] {
  const out: AutoSuggestion[] = [];
  for (const sector of layout.sectors) {
    // (1) Detekuj alfanumerické řady → navrhni numeric
    if (sector.rows.length > 0 && sector.rows.every((r) => /^[A-Z]+$/.test(r.label))) {
      out.push({
        kind: 'alpha-rows',
        sectorName: sector.name,
        description:
          `Sektor "${sector.name}" má řady ${sector.rows[0].label}–${sector.rows[sector.rows.length - 1].label} ` +
          `(alfanumerické). V ČR je obvyklé číslovat 1–${sector.rows.length}.`,
        op: { type: 'renumber', mode: 'numeric' },
      });
    }
    // (2) Detekuj sektory které jsou ve skutečnosti více prostorových clusterů
    const flat = flatten(sector);
    if (flat.length >= 4) {
      const clusters = spatialCluster(flat, DEFAULT_X_THRESHOLD, DEFAULT_Y_THRESHOLD);
      if (clusters.length > 1) {
        out.push({
          kind: 'splittable-sector',
          sectorName: sector.name,
          description:
            `Sektor "${sector.name}" obsahuje ${clusters.length} prostorově oddělených clusterů ` +
            `(${flat.length} seats celkem). Pravděpodobně fyzicky oddělené balkony / podlaží.`,
          op: {
            type: 'split',
            xMaxDist: DEFAULT_X_THRESHOLD,
            yMaxDist: DEFAULT_Y_THRESHOLD,
            suggestedClusters: clusters.length,
          },
        });
      }
    }
    // (3) Detekuj column-shaped sektory (vertikální sloupec, ne 2D grid)
    // Podmínka: ≥5 řad a průměr ≤2 seats/řada → typický boční balkon nebo gallery.
    if (sector.rows.length >= 5 && flat.length / sector.rows.length <= 2.0) {
      out.push({
        kind: 'column-sector',
        sectorName: sector.name,
        description:
          `Sektor "${sector.name}" má ${sector.rows.length} řad ale jen ${flat.length} seats (průměr ` +
          `${(flat.length / sector.rows.length).toFixed(1)} per řada). Vypadá to jako vertikální sloupec ` +
          `— row labely 1,2,3… nedávají smysl, raději sekvenčně 1-${flat.length}.`,
        op: { type: 'flatten', renumberSeats: true },
      });
    }
  }
  return out;
}
