/**
 * GET  /api/platform/venues/[id]/seating-chart — get active layout (master admin)
 * POST /api/platform/venues/[id]/seating-chart — import/replace layout (master admin only)
 *
 * Sály jsou platform-level resource. Pouze master admin může editovat seating charts.
 * Promotéři jen čtou přes /api/admin/venues/[id]/seating-chart pro účely zobrazení v event editoru.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logAction, extractRequestContext } from '@/lib/audit/log';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


const seatSchema = z.object({
  num: z.string().min(1).max(10),
  x: z.number(),
  y: z.number(),
  accessibility: z.boolean().optional(),
});

const rowSchema = z.object({
  // Empty label is OK — flatten transform používá '' když je sektor jednořadý sloupec.
  label: z.string().max(10),
  seats: z.array(seatSchema).min(1).max(500),
});

const sectorSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  rows: z.array(rowSchema).min(1).max(500),
  labelPosition: z.object({ x: z.number(), y: z.number() }).optional(),
});

const stageSchema = z.object({
  position: z.enum(['top', 'bottom', 'left', 'right']),
  label: z.string().min(1).max(50),
  // Volná geometrie jeviště — když je vyplněná, editor/preview ji použije místo
  // auto-výpočtu z bounding boxu sedadel (umožňuje přetáhnout/otočit/zvětšit jeviště).
  // Zpětně kompatibilní: staré charty mají jen position+label.
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  rotation: z.number().optional(),
});

const overlaySchema = z.object({
  id: z.string().min(1).max(40),
  type: z.enum(['football_pitch', 'tennis_court', 'bar', 'stage_icon', 'entrance', 'stairs']),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  label: z.string().max(100).optional(),
});

// Volitelná "builder" specifikace (skupiny řad) — uloží se s layoutem, aby šel
// jednoduchý builder znovu otevřít a editovat bez ztráty zadání.
const builderGroupSchema = z.object({
  from: z.number().int().min(1).max(500),
  to: z.number().int().min(1).max(500),
  seats: z.number().int().min(1).max(200),
  aisleAfter: z.number().int().min(0).max(200).optional(),
});
const builderSchema = z.object({
  stage: z.enum(['top', 'bottom', 'none']),
  sectors: z.array(
    z.object({
      name: z.string().min(1).max(100),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      groups: z.array(builderGroupSchema).min(1).max(100),
      rowLabelFormat: z.enum(['number', 'letter']).optional(),
      placement: z.enum(['front', 'left', 'right']).optional(),
    }),
  ).min(1).max(50),
});

const layoutSchema = z.object({
  viewBox: z.string().regex(/^[\d\s.-]+$/).default('0 0 1000 800'),
  sectors: z.array(sectorSchema).min(1).max(200),
  stage: stageSchema.optional(),
  builder: builderSchema.optional(),
  // Objekty (hřiště/bar/vstupy…) — dřív je editor posílal, ale schema je zahazovalo. Nyní persistujeme.
  overlays: z.array(overlaySchema).max(200).optional(),
  // Podkladový plánek — buď URL, nebo nahraný zmenšený obrázek jako data URL (JPEG ~stovky kB).
  floorPlanUrl: z.string().max(3_000_000).optional(),
});

const postSchema = z.object({
  name: z.string().min(1).max(100).default('Default'),
  layout: layoutSchema,
  notes: z.string().max(1000).optional(),
  source: z.enum(['editor', 'grid', 'json']).default('editor'),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const r = await db().query<{
    id: string;
    name: string;
    layout: unknown;
    total_seats: number;
    created_at: string;
  }>(
    `SELECT id, name, layout, total_seats, created_at FROM catalog.venue_seating_charts
     WHERE venue_id = $1 AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [params.id],
  );
  if (!r.rows.length) return NextResponse.json({ chart: null });
  return NextResponse.json({ chart: r.rows[0] });

  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const totalSeats = parsed.data.layout.sectors.reduce(
    (acc, s) => acc + s.rows.reduce((a, r) => a + r.seats.length, 0),
    0,
  );
  if (totalSeats > 200_000) {
    return NextResponse.json({ error: 'TOO_MANY_SEATS', max: 200_000 }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1`,
      [params.id],
    );
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.venue_seating_charts
         (venue_id, name, layout, total_seats, active, created_by_user_id, notes, source)
       VALUES ($1, $2, $3::jsonb, $4, true, $5, $6, $7)
       RETURNING id`,
      [
        params.id, parsed.data.name, JSON.stringify(parsed.data.layout), totalSeats,
        admin.userId, parsed.data.notes ?? null, parsed.data.source,
      ],
    );
    // Auto-update venue.capacity podle chartu — kapacita seated sálu = počet sedadel.
    await client.query(
      `UPDATE catalog.venues
          SET capacity = $1,
              last_modified_by_user_id = $2,
              last_modified_at = NOW()
        WHERE id = $3`,
      [totalSeats, admin.userId, params.id],
    );
    await client.query('COMMIT');

    const reqCtx = extractRequestContext(req);
    void logAction({
      actorUserId: admin.userId,
      actorRole: 'platform_admin',
      action: 'venue.seating_chart.replace',
      targetType: 'venue',
      targetId: params.id,
      metadata: { chartId: r.rows[0].id, name: parsed.data.name, totalSeats },
      ip: reqCtx.ip,
      userAgent: reqCtx.userAgent,
    });

    return NextResponse.json({ id: r.rows[0].id, totalSeats }, { status: 201 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[platform seating-chart import]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
