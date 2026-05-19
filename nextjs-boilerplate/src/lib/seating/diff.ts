/**
 * Diff helper pro seating charts. Porovnává dvě verze layoutu na úrovni
 * sektorů → řad → seats a vrací compact summary + per-seat changes (limited).
 *
 * Identita seat = `${sectorName}|${rowLabel}|${num}`.
 * Pohyb (move) detekujeme když seat se stejným ID má jiné x/y.
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
interface Layout {
  viewBox: string;
  sectors: Sector[];
}

export interface SeatChange {
  sector: string;
  row: string;
  num: string;
  kind: 'added' | 'removed' | 'moved' | 'accessibility-changed';
  from?: { x: number; y: number; accessibility?: boolean };
  to?: { x: number; y: number; accessibility?: boolean };
}

export interface DiffResult {
  identical: boolean;
  totals: {
    fromSeats: number;
    toSeats: number;
    added: number;
    removed: number;
    moved: number;
    accessibilityChanged: number;
  };
  sectors: {
    added: string[];
    removed: string[];
    renamed: { from: string; to: string }[];
    rowsByDelta: { name: string; rowDelta: number; seatDelta: number }[];
  };
  viewBoxChanged: boolean;
  fromViewBox: string;
  toViewBox: string;
  /** Up to 200 seat-level changes for UI display. Total counts are in `totals`. */
  sample: SeatChange[];
}

function indexSeats(layout: Layout): Map<string, Seat & { sector: string; row: string }> {
  const map = new Map<string, Seat & { sector: string; row: string }>();
  for (const s of layout.sectors) {
    for (const r of s.rows) {
      for (const seat of r.seats) {
        map.set(`${s.name}|${r.label}|${seat.num}`, { ...seat, sector: s.name, row: r.label });
      }
    }
  }
  return map;
}

function sectorSummary(layout: Layout): Map<string, { rows: number; seats: number }> {
  const m = new Map<string, { rows: number; seats: number }>();
  for (const s of layout.sectors) {
    let seats = 0;
    for (const r of s.rows) seats += r.seats.length;
    m.set(s.name, { rows: s.rows.length, seats });
  }
  return m;
}

export function diffLayouts(from: Layout, to: Layout): DiffResult {
  const fromIdx = indexSeats(from);
  const toIdx = indexSeats(to);

  const sample: SeatChange[] = [];
  let added = 0;
  let removed = 0;
  let moved = 0;
  let accChanged = 0;

  for (const [key, fromSeat] of fromIdx) {
    const toSeat = toIdx.get(key);
    if (!toSeat) {
      removed++;
      if (sample.length < 200) {
        sample.push({
          sector: fromSeat.sector,
          row: fromSeat.row,
          num: fromSeat.num,
          kind: 'removed',
          from: { x: fromSeat.x, y: fromSeat.y, accessibility: fromSeat.accessibility },
        });
      }
      continue;
    }
    const isMoved = fromSeat.x !== toSeat.x || fromSeat.y !== toSeat.y;
    const accDifferent = !!fromSeat.accessibility !== !!toSeat.accessibility;
    if (isMoved) {
      moved++;
      if (sample.length < 200) {
        sample.push({
          sector: fromSeat.sector,
          row: fromSeat.row,
          num: fromSeat.num,
          kind: 'moved',
          from: { x: fromSeat.x, y: fromSeat.y },
          to: { x: toSeat.x, y: toSeat.y },
        });
      }
    }
    if (accDifferent) {
      accChanged++;
      if (sample.length < 200) {
        sample.push({
          sector: fromSeat.sector,
          row: fromSeat.row,
          num: fromSeat.num,
          kind: 'accessibility-changed',
          from: { x: fromSeat.x, y: fromSeat.y, accessibility: fromSeat.accessibility },
          to: { x: toSeat.x, y: toSeat.y, accessibility: toSeat.accessibility },
        });
      }
    }
  }
  for (const [key, toSeat] of toIdx) {
    if (!fromIdx.has(key)) {
      added++;
      if (sample.length < 200) {
        sample.push({
          sector: toSeat.sector,
          row: toSeat.row,
          num: toSeat.num,
          kind: 'added',
          to: { x: toSeat.x, y: toSeat.y, accessibility: toSeat.accessibility },
        });
      }
    }
  }

  // Sector-level changes
  const fromSec = sectorSummary(from);
  const toSec = sectorSummary(to);
  const sectorsAdded: string[] = [];
  const sectorsRemoved: string[] = [];
  const rowsByDelta: { name: string; rowDelta: number; seatDelta: number }[] = [];
  for (const [name, summary] of toSec) {
    if (!fromSec.has(name)) sectorsAdded.push(name);
    else {
      const f = fromSec.get(name)!;
      if (f.rows !== summary.rows || f.seats !== summary.seats) {
        rowsByDelta.push({
          name,
          rowDelta: summary.rows - f.rows,
          seatDelta: summary.seats - f.seats,
        });
      }
    }
  }
  for (const [name] of fromSec) {
    if (!toSec.has(name)) sectorsRemoved.push(name);
  }
  // Heuristic rename: a removed sector + an added sector with identical seat count → likely rename.
  const renamed: { from: string; to: string }[] = [];
  for (const removedName of [...sectorsRemoved]) {
    const removedCount = fromSec.get(removedName)?.seats;
    const matchIdx = sectorsAdded.findIndex((n) => toSec.get(n)?.seats === removedCount);
    if (matchIdx >= 0) {
      renamed.push({ from: removedName, to: sectorsAdded[matchIdx] });
      sectorsRemoved.splice(sectorsRemoved.indexOf(removedName), 1);
      sectorsAdded.splice(matchIdx, 1);
    }
  }

  const fromTotal = fromIdx.size;
  const toTotal = toIdx.size;

  return {
    identical: added === 0 && removed === 0 && moved === 0 && accChanged === 0 && from.viewBox === to.viewBox,
    totals: {
      fromSeats: fromTotal,
      toSeats: toTotal,
      added,
      removed,
      moved,
      accessibilityChanged: accChanged,
    },
    sectors: {
      added: sectorsAdded,
      removed: sectorsRemoved,
      renamed,
      rowsByDelta,
    },
    viewBoxChanged: from.viewBox !== to.viewBox,
    fromViewBox: from.viewBox,
    toViewBox: to.viewBox,
    sample,
  };
}
