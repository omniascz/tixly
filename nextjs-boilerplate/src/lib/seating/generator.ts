/**
 * Kolo 8 / krok 2 — generátor sekcí plánku a operace nad výběrem (čisté funkce, sdílí editor i testy).
 *
 * Tvar layoutu = venue_seating_charts.layout: sectors[{name, color, rows[{label, seats[{num, x, y, type?, note?, zone?}]}]}].
 * Identita místa = sekce + řada + místo (seatKey); duplicitu nelze uložit (layout-schema.ts).
 */

export type SeatType = 'standard' | 'wheelchair' | 'companion' | 'unsellable' | 'restricted';

export interface GenSeat {
  num: string;
  x: number;
  y: number;
  accessibility?: boolean;
  blocked?: boolean;
  type?: SeatType;
  note?: string;
  zone?: string;
}
export interface GenRow { label: string; seats: GenSeat[] }
export interface GenSector { name: string; color?: string; rows: GenRow[]; labelPosition?: { x: number; y: number } }

export interface SectionSpec {
  name: string;
  color?: string;
  rows: number;
  seatsPerRow: number;
  /** Označení řad: čísla (výchozí) nebo písmena. */
  rowLabels?: 'number' | 'letter';
  /** První označení řady (např. „1", „5", „A", „C"). */
  rowStart?: string;
  rowOrder?: 'asc' | 'desc';
  /** asc = zleva 1..n, desc = zleva n..1, odd-even = vlevo liché sestupně ke středu, vpravo sudé vzestupně. */
  seatNumbering?: 'asc' | 'desc' | 'odd-even';
  seatStart?: number;
  /** Ulička PO zadaném počtu míst (1-based), např. [5, 15]. */
  aisleAfter?: number[];
  /** Šířka uličky v počtu míst (výchozí 1). */
  aisleGap?: number;
  /** Posun každé druhé řady vodorovně (šachovnicové řazení). */
  rowOffset?: number;
  origin?: { x: number; y: number };
  spacing?: number;
}

export const seatKey = (sector: string, row: string, num: string): string => `${sector}|${row}|${num}`;

function rowLabelList(spec: SectionSpec): string[] {
  const n = spec.rows;
  const letters = spec.rowLabels === 'letter' || (spec.rowStart !== undefined && /^[A-Za-z]$/.test(spec.rowStart));
  const desc = spec.rowOrder === 'desc';
  if (letters) {
    const startCode = (spec.rowStart ?? (desc ? String.fromCharCode(64 + n) : 'A')).toUpperCase().charCodeAt(0);
    return Array.from({ length: n }, (_, i) => String.fromCharCode(desc ? startCode - i : startCode + i));
  }
  const start = spec.rowStart !== undefined ? Number(spec.rowStart) : desc ? n : 1;
  return Array.from({ length: n }, (_, i) => String(desc ? start - i : start + i));
}

function seatNumberList(spec: SectionSpec): string[] {
  const n = spec.seatsPerRow;
  const start = spec.seatStart ?? 1;
  if (spec.seatNumbering === 'odd-even') {
    const odd = Array.from({ length: Math.ceil(n / 2) }, (_, i) => start + 2 * i);
    const even = Array.from({ length: Math.floor(n / 2) }, (_, i) => start + 1 + 2 * i);
    return [...odd.reverse(), ...even].map(String);
  }
  const asc = Array.from({ length: n }, (_, i) => String(start + i));
  return spec.seatNumbering === 'desc' ? asc.reverse() : asc;
}

export function generateSection(spec: SectionSpec): GenSector {
  const spacing = spec.spacing ?? 30;
  const origin = spec.origin ?? { x: 50, y: 100 };
  const gap = spec.aisleGap ?? 1;
  const aisles = [...(spec.aisleAfter ?? [])].filter((a) => a > 0 && a < spec.seatsPerRow).sort((a, b) => a - b);
  const nums = seatNumberList(spec);
  const rows = rowLabelList(spec).map((label, r) => ({
    label,
    seats: nums.map((num, i) => {
      const aislesBefore = aisles.filter((a) => a <= i).length;
      return {
        num,
        x: origin.x + i * spacing + aislesBefore * gap * spacing + (r % 2 === 1 ? spec.rowOffset ?? 0 : 0),
        y: origin.y + r * spacing,
      };
    }),
  }));
  return { name: spec.name, ...(spec.color ? { color: spec.color } : {}), rows };
}

export function seatCount(sectors: GenSector[]): number {
  return sectors.reduce((a, s) => a + s.rows.reduce((b, r) => b + r.seats.length, 0), 0);
}

/** Duplicitní označení místa (sekce + řada + místo) — lidsky čitelné. */
export function duplicateSeatLabels(sectors: GenSector[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const s of sectors) {
    for (const r of s.rows) {
      for (const seat of r.seats) {
        const k = seatKey(s.name.trim(), r.label.trim(), seat.num.trim());
        if (seen.has(k)) dup.add(`${s.name} / řada ${r.label} / místo ${seat.num}`);
        seen.add(k);
      }
    }
  }
  return [...dup];
}

/** Přečísluje vybraná místa: v každé řadě podle pozice zleva, od `start` s krokem `step`. */
export function renumberSeats(sectors: GenSector[], selected: Set<string>, opts: { start: number; step: number; rightToLeft?: boolean }): GenSector[] {
  return sectors.map((s) => ({
    ...s,
    rows: s.rows.map((r) => {
      const picked = r.seats
        .map((seat, idx) => ({ seat, idx }))
        .filter(({ seat }) => selected.has(seatKey(s.name, r.label, seat.num)))
        .sort((a, b) => (opts.rightToLeft ? b.seat.x - a.seat.x : a.seat.x - b.seat.x));
      if (picked.length === 0) return r;
      const newNum = new Map<number, string>(picked.map(({ idx }, i) => [idx, String(opts.start + i * opts.step)]));
      return { ...r, seats: r.seats.map((seat, idx) => (newNum.has(idx) ? { ...seat, num: newNum.get(idx)! } : seat)) };
    }),
  }));
}

function nextLabel(label: string): string {
  if (/^\d+$/.test(label)) return String(Number(label) + 1);
  if (/^[A-Ya-y]$/.test(label)) return String.fromCharCode(label.charCodeAt(0) + 1);
  return `${label}'`;
}

/** Zkopíruje řady sekce: každá kopie dostane další volné označení a posun `dy` od zdrojové řady. */
export function copyRows(sectors: GenSector[], sectorName: string, rowLabels: string[], dy: number): GenSector[] {
  return sectors.map((s) => {
    if (s.name !== sectorName) return s;
    const rows = [...s.rows];
    const used = new Set(rows.map((r) => r.label));
    let label = rows.length > 0 ? rows[rows.length - 1].label : '0';
    for (const src of s.rows.filter((r) => rowLabels.includes(r.label))) {
      do { label = nextLabel(label); } while (used.has(label));
      used.add(label);
      rows.push({ label, seats: src.seats.map((seat) => ({ ...seat, y: seat.y + dy })) });
    }
    return { ...s, rows };
  });
}

/** Nastaví typ (a poznámku) vybraným místům; wheelchair zapíná i dosavadní příznak accessibility. */
export function setSeatType(sectors: GenSector[], selected: Set<string>, type: SeatType, note?: string): GenSector[] {
  return mapSelected(sectors, selected, (seat) => ({
    ...seat,
    type,
    accessibility: type === 'wheelchair',
    ...(type === 'restricted' ? { note: note ?? seat.note ?? '' } : { note: undefined }),
  }));
}

/** Přiřadí cenovou zónu (id) vybraným místům; null zónu odebere. */
export function setSeatZone(sectors: GenSector[], selected: Set<string>, zoneId: string | null): GenSector[] {
  return mapSelected(sectors, selected, (seat) => ({ ...seat, zone: zoneId ?? undefined }));
}

function mapSelected(sectors: GenSector[], selected: Set<string>, f: (s: GenSeat) => GenSeat): GenSector[] {
  return sectors.map((s) => ({
    ...s,
    rows: s.rows.map((r) => ({ ...r, seats: r.seats.map((seat) => (selected.has(seatKey(s.name, r.label, seat.num)) ? f(seat) : seat)) })),
  }));
}
