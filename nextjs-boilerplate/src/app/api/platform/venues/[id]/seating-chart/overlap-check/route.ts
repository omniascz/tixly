/**
 * POST /api/platform/venues/[id]/seating-chart/overlap-check
 *
 * Server-side detekce překryvů sedadel v aktivním layoutu pro daný sál.
 * Identical algorithm jako scripts/check-overlaps.mjs (auto-mode):
 *   - radius = clamp(2, 12, pitch / 3) — matches SeatPicker.tsx
 *   - kolize = sedadla blíž než 2 × radius - 1 (kruhy překrývají)
 *   - warn = sedadla blíž než pitch × 0.85 (vizuálně se dotýkají)
 *
 * Auth: master admin only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


interface LayoutSeat {
  num: string;
  x?: number;
  y?: number;
}
interface LayoutRow {
  label: string;
  seats: LayoutSeat[];
}
interface LayoutSector {
  name: string;
  rows: LayoutRow[];
}
interface Layout {
  sectors: LayoutSector[];
  viewBox?: string;
}

interface SeatPoint {
  id: string;
  x: number;
  y: number;
  sector: string;
}

function computeMedianPitch(seats: SeatPoint[]): number {
  if (seats.length < 2) return 22;
  const distances: number[] = [];
  const sample =
    seats.length > 500
      ? seats.filter((_, i) => i % Math.ceil(seats.length / 500) === 0)
      : seats;
  for (const s of sample) {
    let nearest = Infinity;
    for (const other of seats) {
      if (other === s) continue;
      const d = Math.hypot(s.x - other.x, s.y - other.y);
      if (d > 0 && d < nearest) nearest = d;
      if (nearest < 1) break;
    }
    if (nearest < Infinity) distances.push(nearest);
  }
  distances.sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)] ?? 22;
}

interface OverlapPair {
  a: string;
  b: string;
  distance: number;
}

interface OverlapResult {
  chartId: string;
  chartName: string;
  totalSeats: number;
  totalSectors: number;
  pitch: number;
  radius: number;
  collisionThreshold: number;
  warningThreshold: number;
  collisions: number;
  warnings: number;
  topCollisionSectors: Array<{ pair: string; count: number }>;
  sampleCollisions: OverlapPair[];
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  return runAsPlatformAdmin(req, async (_admin) => {
  const chartRes = await db().query<{ id: string; name: string; layout: Layout }>(
    `SELECT id, name, layout FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [params.id],
  );
  if (chartRes.rows.length === 0) {
    return NextResponse.json({ error: 'No active chart for venue' }, { status: 404 });
  }
  const chart = chartRes.rows[0];

  // Sběr sedadel
  const seats: SeatPoint[] = [];
  for (const sector of chart.layout.sectors ?? []) {
    for (const row of sector.rows ?? []) {
      for (const seat of row.seats ?? []) {
        if (typeof seat.x !== 'number' || typeof seat.y !== 'number') continue;
        seats.push({
          id: `${sector.name}/${row.label}/${seat.num}`,
          x: seat.x,
          y: seat.y,
          sector: sector.name,
        });
      }
    }
  }

  const pitch = computeMedianPitch(seats);
  const radius = Math.max(2, Math.min(12, pitch / 3));
  const collisionThreshold = radius * 2 - 1;
  const warningThreshold = pitch * 0.85;

  // Spatial bucket detection
  const checkRadius = Math.max(collisionThreshold, warningThreshold);
  const bucketSize = checkRadius * 2;
  const buckets = new Map<string, SeatPoint[]>();
  const collisions: OverlapPair[] = [];
  let warnings = 0;
  const collisionsBySector = new Map<string, number>();

  for (const seat of seats) {
    const bx = Math.floor(seat.x / bucketSize);
    const by = Math.floor(seat.y / bucketSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${bx + dx},${by + dy}`;
        const neighbors = buckets.get(key);
        if (!neighbors) continue;
        for (const other of neighbors) {
          const dist = Math.hypot(seat.x - other.x, seat.y - other.y);
          if (dist < collisionThreshold) {
            collisions.push({ a: other.id, b: seat.id, distance: dist });
            const sectorKey =
              other.sector === seat.sector
                ? other.sector
                : `${other.sector} ↔ ${seat.sector}`;
            collisionsBySector.set(sectorKey, (collisionsBySector.get(sectorKey) ?? 0) + 1);
          } else if (dist < warningThreshold) {
            warnings++;
          }
        }
      }
    }
    const myKey = `${bx},${by}`;
    let bucket = buckets.get(myKey);
    if (!bucket) {
      bucket = [];
      buckets.set(myKey, bucket);
    }
    bucket.push(seat);
  }

  const topCollisionSectors = [...collisionsBySector.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([pair, count]) => ({ pair, count }));

  const totalSeats = seats.length;
  const totalSectors = chart.layout.sectors?.length ?? 0;

  const result: OverlapResult = {
    chartId: chart.id,
    chartName: chart.name,
    totalSeats,
    totalSectors,
    pitch: Number(pitch.toFixed(2)),
    radius: Number(radius.toFixed(2)),
    collisionThreshold: Number(collisionThreshold.toFixed(2)),
    warningThreshold: Number(warningThreshold.toFixed(2)),
    collisions: collisions.length,
    warnings,
    topCollisionSectors,
    sampleCollisions: collisions.slice(0, 20),
  };

  return NextResponse.json(result);

  });
}
