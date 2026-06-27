/**
 * GET /api/events/[id]/seats/preview.svg
 *
 * Statická SVG mapa sedadel — Ticketmaster seatmap.staticUrl ekvivalent.
 * Vrátí barevně rozlišenou mapu sektoru s dostupností sedadel.
 *
 * Query params:
 *   ?theme=light|dark  (default: light)
 *   ?labels=1          (zobrazí popisky sektorů, default: 1)
 *   ?size=sm|md|lg     (výstupní rozlišení: sm=800, md=1400, lg=2000px wide)
 *
 * CORS: * (pro partnery a agregátory)
 * Cache: 60s (sedadla se mění v reálném čase, ale obrázek stačí refreshovat 1×/min)
 *
 * Použití:
 *   <img src="/api/events/UUID/seats/preview.svg" alt="Mapa sálu" />
 *   fetch(event.seatmap.staticUrl) → SVG string
 */
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/rls-pool';

const SEAT_R = 5;          // radius sedadla v SVG
const STAGE_H = 50;        // výška jevistě

interface SeatRow { num: string; x: number; y: number; accessibility?: boolean }
interface LayoutRow { label: string; seats: SeatRow[] }
interface LayoutSector {
  name: string;
  color?: string;
  labelPosition?: { x: number; y: number };
  rows: LayoutRow[];
}
interface Layout {
  viewBox: string;
  sectors: LayoutSector[];
  stage?: { position: 'top' | 'bottom' | 'left' | 'right'; label: string };
}

const STATUS_COLORS: Record<string, Record<string, string>> = {
  light: {
    available: 'SECTOR',  // bude nahrazena barvou sektoru
    held:      '#F59E0B',
    sold:      '#D1D5DB',
    blocked:   '#E5E7EB',
    acc:       '#10B981',
  },
  dark: {
    available: 'SECTOR',
    held:      '#D97706',
    sold:      '#374151',
    blocked:   '#1F2937',
    acc:       '#059669',
  },
};

const BG = { light: '#FFFFFF', dark: '#111827' };
const TEXT = { light: '#111827', dark: '#F9FAFB' };
const STAGE_FILL = { light: '#E5E7EB', dark: '#374151' };
const STAGE_TEXT = { light: '#6B7280', dark: '#9CA3AF' };

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return new Response('Invalid id', { status: 422 });
  }

  const sp     = req.nextUrl.searchParams;
  const theme  = sp.get('theme') === 'dark' ? 'dark' : 'light';
  const labels = sp.get('labels') !== '0';
  const size   = sp.get('size') === 'lg' ? 2000 : sp.get('size') === 'sm' ? 800 : 1400;

  // 1) Layout
  const evRow = await db().query<{ venue_id: string }>(
    `SELECT venue_id FROM catalog.events WHERE id = $1 AND status = 'published'`,
    [params.id],
  );
  if (!evRow.rows[0]?.venue_id) {
    return new Response('Not found', { status: 404 });
  }

  const chartRow = await db().query<{ layout: Layout }>(
    `SELECT layout FROM catalog.venue_seating_charts
      WHERE venue_id = $1 AND active = true
      ORDER BY created_at DESC LIMIT 1`,
    [evRow.rows[0].venue_id],
  );
  if (!chartRow.rows[0]) {
    return new Response('No layout', { status: 404 });
  }
  const layout = chartRow.rows[0].layout;

  // 2) Stav sedadel
  const seatRows = await db().query<{ id: string; sector: string; row: string; seat_number: string; status: string; accessibility: boolean }>(
    `SELECT id, sector, row, seat_number,
            CASE WHEN status = 'held' AND hold_until <= NOW() THEN 'available' ELSE status END AS status,
            accessibility
       FROM catalog.event_seats
      WHERE event_id = $1`,
    [params.id],
  );

  // Build status lookup: sector+row+num → status
  const statusMap = new Map<string, { status: string; acc: boolean }>();
  for (const s of seatRows.rows) {
    statusMap.set(`${s.sector}:${s.row}:${s.seat_number}`, { status: s.status, acc: s.accessibility });
  }

  const colors = STATUS_COLORS[theme];
  const [, , vbW, vbH] = layout.viewBox.split(' ').map(Number);
  const scale = size / (vbW || 1400);
  const svgW = size;
  const svgH = Math.round((vbH || 900) * scale);

  // 3) Generuj SVG ────────────────────────────────────────────────────────────
  const parts: string[] = [];

  // Pozadí
  parts.push(`<rect width="${svgW}" height="${svgH}" fill="${BG[theme]}"/>`);

  // Jeviště
  if (layout.stage) {
    const isTop = layout.stage.position === 'top';
    const sy = isTop ? 4 * scale : svgH - (STAGE_H + 4) * scale;
    const sw = svgW * 0.6;
    const sx = (svgW - sw) / 2;
    const sh = STAGE_H * scale;
    parts.push(
      `<rect x="${sx.toFixed(1)}" y="${sy.toFixed(1)}" width="${sw.toFixed(1)}" height="${sh.toFixed(1)}" rx="${(sh * 0.15).toFixed(1)}" fill="${STAGE_FILL[theme]}"/>`,
      `<text x="${(sx + sw / 2).toFixed(1)}" y="${(sy + sh / 2 + 5 * scale).toFixed(1)}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${(13 * scale).toFixed(1)}" font-weight="600" fill="${STAGE_TEXT[theme]}">${layout.stage.label ?? 'JEVIŠTĚ'}</text>`,
    );
  }

  // Sektory + sedadla
  for (const sector of layout.sectors) {
    const sectorColor = sector.color ?? '#3B82F6';

    for (const rowObj of sector.rows) {
      for (const seat of rowObj.seats) {
        const key   = `${sector.name}:${rowObj.label}:${seat.num}`;
        const info  = statusMap.get(key);
        const status = info?.status ?? 'available';
        const isAcc  = info?.acc ?? seat.accessibility ?? false;

        let fill: string;
        if (isAcc && status === 'available') {
          fill = colors.acc;
        } else if (status === 'available') {
          fill = sectorColor;
        } else {
          fill = colors[status] ?? colors.sold;
        }

        const cx = (seat.x * scale).toFixed(1);
        const cy = (seat.y * scale).toFixed(1);
        const r  = (SEAT_R * scale).toFixed(1);
        parts.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${status === 'blocked' ? '0.3' : '1'}"/>`);
      }
    }

    // Sektor label
    if (labels && sector.labelPosition) {
      const lx = (sector.labelPosition.x * scale).toFixed(1);
      const ly = (sector.labelPosition.y * scale).toFixed(1);
      parts.push(
        `<text x="${lx}" y="${ly}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="${(11 * scale).toFixed(1)}" font-weight="700" fill="${sectorColor}" opacity="0.9">${sector.name}</text>`,
      );
    }
  }

  // Legenda
  const legendItems = [
    { color: '#6B7280', label: 'Dostupné' },
    { color: colors.held,  label: 'Rezervováno' },
    { color: colors.sold,  label: 'Prodáno' },
    { color: colors.acc,   label: 'Bezbariérové' },
  ];
  const li = 24 * scale;
  const lr = 5 * scale;
  const lx0 = svgW - 160 * scale;
  const ly0 = svgH - (legendItems.length * li + 10 * scale);
  for (let i = 0; i < legendItems.length; i++) {
    const item = legendItems[i];
    const lcy = ly0 + i * li + lr;
    parts.push(
      `<circle cx="${(lx0 + lr).toFixed(1)}" cy="${lcy.toFixed(1)}" r="${lr.toFixed(1)}" fill="${item.color}"/>`,
      `<text x="${(lx0 + lr * 2.5).toFixed(1)}" y="${(lcy + lr * 0.5).toFixed(1)}" font-family="system-ui,sans-serif" font-size="${(10 * scale).toFixed(1)}" fill="${TEXT[theme]}" opacity="0.7">${item.label}</text>`,
    );
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">
${parts.join('\n')}
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}
