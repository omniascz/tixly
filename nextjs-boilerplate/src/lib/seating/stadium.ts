/**
 * Parametrický generátor stadionové „mísy" (bowl).
 *
 * Zadáš tribuny (Sever/Jih/Východ/Západ) kolem hřiště, každou jako rows × seatsPerRow,
 * volitelně s patry (tiers) a rohovými sektory (corners). Vygeneruje se plný Layout
 * se souřadnicemi sedadel — stejný tvar, jaký konzumuje VisualEditor / SeatPicker /
 * copy-layout-to-event-seats. Umožňuje realistický 50k+ stadion bez importu dat.
 */

export type StandSide = 'N' | 'S' | 'E' | 'W';

export interface StadiumStand {
  side: StandSide;
  name: string;
  rows: number;
  seatsPerRow: number;
  tiers?: number; // patra (default 1)
  color?: string;
}

export interface StadiumSpec {
  pitchLabel?: string;
  stands: StadiumStand[];
  corners?: boolean;
  cornerRows?: number;
  cornerSeatsPerRow?: number;
}

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
  color: string;
  rows: Row[];
}
interface Overlay {
  id: string;
  type: 'football_pitch';
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}
export interface StadiumLayout {
  viewBox: string;
  sectors: Sector[];
  overlays: Overlay[];
  totalSeats: number;
}

const PALETTE = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

// Geometrie ve viewBox jednotkách. Střed = 0,0; na konci se vše posune do kladných souřadnic.
const DX = 22; // rozestup sedadel
const DY = 24; // rozestup řad
const GAP = 46; // mezera hřiště → 1. řada
const TIER_GAP = 40; // mezera mezi patry

function colorFor(stand: StadiumStand, idx: number): string {
  return stand.color ?? PALETTE[idx % PALETTE.length];
}

function standLabel(name: string, tier: number, tiers: number): string {
  return tiers > 1 ? `${name} – ${tier + 1}. patro` : name;
}

/** Vygeneruje sektory pro jednu tribunu (včetně pater). phw/phh = půl-rozměry hřiště. */
function buildStand(stand: StadiumStand, colorIdx: number, phw: number, phh: number): Sector[] {
  const tiers = Math.max(1, stand.tiers ?? 1);
  const out: Sector[] = [];
  const color = colorFor(stand, colorIdx);

  for (let t = 0; t < tiers; t++) {
    const rows: Row[] = [];
    for (let r = 0; r < stand.rows; r++) {
      const depthIdx = t * stand.rows + r; // kumulativní řada napříč patry
      const seats: Seat[] = [];
      for (let i = 0; i < stand.seatsPerRow; i++) {
        let x = 0;
        let y = 0;
        const along = i * DX - ((stand.seatsPerRow - 1) * DX) / 2;
        const depth = GAP + depthIdx * DY + t * TIER_GAP;
        switch (stand.side) {
          case 'N':
            x = along;
            y = -phh - depth;
            break;
          case 'S':
            x = along;
            y = phh + depth;
            break;
          case 'E':
            x = phw + depth;
            y = along;
            break;
          case 'W':
            x = -phw - depth;
            y = along;
            break;
        }
        seats.push({ num: String(i + 1), x: Math.round(x), y: Math.round(y) });
      }
      rows.push({ label: String(r + 1), seats });
    }
    out.push({ name: standLabel(stand.name, t, tiers), color, rows });
  }
  return out;
}

/** Rohový sektor jako čtvrtoblouk mezi dvěma tribunami. */
function buildCorner(
  corner: 'NE' | 'NW' | 'SE' | 'SW',
  rows: number,
  seatsPerRow: number,
  color: string,
  phw: number,
  phh: number,
): Sector {
  // Střed oblouku = roh hřiště; úhly míří ven do daného kvadrantu (y je dolů).
  let cornerCx = 0;
  let cornerCy = 0;
  let a0 = 0;
  let a1 = 0;
  switch (corner) {
    case 'NE':
      cornerCx = phw; cornerCy = -phh; a0 = -90; a1 = 0; break;
    case 'NW':
      cornerCx = -phw; cornerCy = -phh; a0 = 180; a1 = 270; break;
    case 'SE':
      cornerCx = phw; cornerCy = phh; a0 = 0; a1 = 90; break;
    case 'SW':
      cornerCx = -phw; cornerCy = phh; a0 = 90; a1 = 180; break;
  }
  const outRows: Row[] = [];
  for (let r = 0; r < rows; r++) {
    const radius = GAP + r * DY;
    const seats: Seat[] = [];
    for (let i = 0; i < seatsPerRow; i++) {
      const t = seatsPerRow === 1 ? 0.5 : i / (seatsPerRow - 1);
      const ang = ((a0 + (a1 - a0) * t) * Math.PI) / 180;
      const x = cornerCx + radius * Math.cos(ang);
      const y = cornerCy + radius * Math.sin(ang);
      seats.push({ num: String(i + 1), x: Math.round(x), y: Math.round(y) });
    }
    outRows.push({ label: String(r + 1), seats });
  }
  return { name: `Roh ${corner}`, color, rows: outRows };
}

export function generateStadium(spec: StadiumSpec): StadiumLayout {
  // Hřiště velikostně odpovídá tribunám: šířka ~ N/S tribuna, výška ~ E/W tribuna.
  // Tím tribuny sednou přesně k hranám a nepřekrývají se; rohy vyplní kouty.
  const nsSeats = spec.stands.filter((s) => s.side === 'N' || s.side === 'S').map((s) => s.seatsPerRow);
  const ewSeats = spec.stands.filter((s) => s.side === 'E' || s.side === 'W').map((s) => s.seatsPerRow);
  const PHW = Math.max(320, ((nsSeats.length ? Math.max(...nsSeats) : 200) * DX) / 2);
  const PHH = Math.max(220, ((ewSeats.length ? Math.max(...ewSeats) : 120) * DX) / 2);

  const sectors: Sector[] = [];
  spec.stands.forEach((stand, idx) => {
    for (const s of buildStand(stand, idx, PHW, PHH)) sectors.push(s);
  });

  if (spec.corners) {
    const cr = Math.max(1, spec.cornerRows ?? 12);
    const csp = Math.max(1, spec.cornerSeatsPerRow ?? 14);
    const cornerColor = '#64748b';
    (['NW', 'NE', 'SE', 'SW'] as const).forEach((c) => {
      sectors.push(buildCorner(c, cr, csp, cornerColor, PHW, PHH));
    });
  }

  // Bounds ze všech sedadel + hřiště (střed 0,0).
  let minX = -PHW;
  let maxX = PHW;
  let minY = -PHH;
  let maxY = PHH;
  for (const sec of sectors) {
    for (const row of sec.rows) {
      for (const seat of row.seats) {
        if (seat.x < minX) minX = seat.x;
        if (seat.x > maxX) maxX = seat.x;
        if (seat.y < minY) minY = seat.y;
        if (seat.y > maxY) maxY = seat.y;
      }
    }
  }
  const pad = 60;
  // Posun tak, aby origin bylo 0 0 (jako ostatní layouty).
  const shiftX = -(minX - pad);
  const shiftY = -(minY - pad);
  for (const sec of sectors) {
    for (const row of sec.rows) {
      for (const seat of row.seats) {
        seat.x += shiftX;
        seat.y += shiftY;
      }
    }
  }
  const w = Math.round(maxX - minX + pad * 2);
  const h = Math.round(maxY - minY + pad * 2);

  const overlays: Overlay[] = [
    {
      id: 'pitch',
      type: 'football_pitch',
      x: Math.round(-PHW + shiftX),
      y: Math.round(-PHH + shiftY),
      width: Math.round(PHW * 2),
      height: Math.round(PHH * 2),
      label: spec.pitchLabel ?? 'HŘIŠTĚ',
    },
  ];

  const totalSeats = sectors.reduce(
    (a, s) => a + s.rows.reduce((x, r) => x + r.seats.length, 0),
    0,
  );

  return { viewBox: `0 0 ${w} ${h}`, sectors, overlays, totalSeats };
}
