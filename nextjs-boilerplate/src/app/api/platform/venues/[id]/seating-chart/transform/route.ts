/**
 * GET  /api/platform/venues/[id]/seating-chart/transform — analyze active layout, return suggestions
 * POST /api/platform/venues/[id]/seating-chart/transform — apply transformation, save as new version
 *
 * Operations supported (POST body):
 *   { op: 'renumber', sectorName, mode, start?, customLabels? }
 *   { op: 'split-spatial', sectorName, maxDist, names? }
 *   { op: 'rename-sector', from, to }
 *
 * Each successful POST creates a new active chart version with source='transform'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { logAction, extractRequestContext } from '@/lib/audit/log';
import { requirePlatformAdmin } from '@/lib/platform-auth';
import {
  renumberRows, renameSector, splitSectorBySpatial, flattenSector, setStage,
  suggestSplit, analyzeForSuggestions,
  type Layout,
} from '@/lib/seating/transforms';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const opSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('renumber'),
    sectorName: z.string().min(1).max(100),
    mode: z.enum(['numeric', 'numeric-reverse', 'alpha', 'alpha-reverse', 'custom']),
    start: z.number().int().min(0).max(10_000).optional(),
    customLabels: z.array(z.string().min(1).max(20)).max(500).optional(),
  }),
  z.object({
    op: z.literal('split-spatial'),
    sectorName: z.string().min(1).max(100),
    xMaxDist: z.number().min(1).max(10_000).default(150),
    yMaxDist: z.number().min(1).max(10_000).default(250),
    names: z.array(z.string().min(1).max(100)).max(20).optional(),
  }),
  z.object({
    op: z.literal('rename-sector'),
    from: z.string().min(1).max(100),
    to: z.string().min(1).max(100),
  }),
  z.object({
    op: z.literal('flatten'),
    sectorName: z.string().min(1).max(100),
    rowLabel: z.string().max(20).default(''),
    renumberSeats: z.boolean().default(true),
  }),
  z.object({
    op: z.literal('set-stage'),
    stage: z
      .object({
        position: z.enum(['top', 'bottom', 'left', 'right']),
        label: z.string().min(1).max(50),
      })
      .nullable(),
  }),
]);

const bodySchema = z.object({
  operations: z.array(opSchema).min(1).max(20),
  dryRun: z.boolean().default(false),
});

interface ChartRow {
  id: string;
  name: string;
  layout: Layout;
  total_seats: number;
}

async function loadActive(venueId: string): Promise<ChartRow | null> {
  const r = await db().query<ChartRow>(
    `SELECT id, name, layout, total_seats FROM catalog.venue_seating_charts
      WHERE venue_id = $1 AND active = true
      ORDER BY created_at DESC LIMIT 1`,
    [venueId],
  );
  return r.rows[0] ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const chart = await loadActive(params.id);
  if (!chart) return NextResponse.json({ chart: null, suggestions: [] });

  const suggestions = analyzeForSuggestions(chart.layout);

  // Pro každý "splittable-sector" navíc zjistíme detail clusterů (kolik seats v každém)
  const splitDetails: Record<string, ReturnType<typeof suggestSplit>> = {};
  for (const s of suggestions) {
    if (s.kind === 'splittable-sector' && s.op.type === 'split') {
      splitDetails[s.sectorName] = suggestSplit(
        chart.layout,
        s.sectorName,
        s.op.xMaxDist,
        s.op.yMaxDist,
      );
    }
  }

  const sectorSummary = chart.layout.sectors.map((s) => {
    let seats = 0;
    for (const r of s.rows) seats += r.seats.length;
    return {
      name: s.name,
      color: s.color,
      rowCount: s.rows.length,
      seatCount: seats,
      rowLabels: s.rows.map((r) => r.label).slice(0, 30),
    };
  });

  return NextResponse.json({
    chart: { id: chart.id, name: chart.name, totalSeats: chart.total_seats },
    sectors: sectorSummary,
    stage: chart.layout.stage ?? null,
    suggestions,
    splitDetails,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const chart = await loadActive(params.id);
  if (!chart) return NextResponse.json({ error: 'No active chart' }, { status: 404 });

  // Apply each operation in sequence (compose).
  let layout = chart.layout;
  const log: string[] = [];
  for (const op of parsed.data.operations) {
    if (op.op === 'renumber') {
      layout = renumberRows(layout, op.sectorName, op.mode, {
        start: op.start,
        customLabels: op.customLabels,
      });
      log.push(`renumber("${op.sectorName}", ${op.mode}${op.start ? `, start=${op.start}` : ''})`);
    } else if (op.op === 'split-spatial') {
      layout = splitSectorBySpatial(layout, op.sectorName, op.xMaxDist, {
        yMaxDist: op.yMaxDist,
        names: op.names,
      });
      log.push(`split-spatial("${op.sectorName}", xMax=${op.xMaxDist}, yMax=${op.yMaxDist})`);
    } else if (op.op === 'rename-sector') {
      layout = renameSector(layout, op.from, op.to);
      log.push(`rename-sector("${op.from}" → "${op.to}")`);
    } else if (op.op === 'flatten') {
      layout = flattenSector(layout, op.sectorName, {
        rowLabel: op.rowLabel,
        renumberSeats: op.renumberSeats,
      });
      log.push(`flatten("${op.sectorName}"${op.renumberSeats ? ', renumber' : ''})`);
    } else if (op.op === 'set-stage') {
      layout = setStage(layout, op.stage);
      log.push(op.stage ? `set-stage(${op.stage.position}, "${op.stage.label}")` : 'remove-stage');
    }
  }

  // Recompute total seats.
  let totalSeats = 0;
  for (const s of layout.sectors) for (const r of s.rows) totalSeats += r.seats.length;

  if (parsed.data.dryRun) {
    return NextResponse.json({
      dryRun: true,
      log,
      preview: {
        totalSeats,
        sectors: layout.sectors.map((s) => {
          let seats = 0;
          for (const r of s.rows) seats += r.seats.length;
          return { name: s.name, color: s.color, rowCount: s.rows.length, seatCount: seats };
        }),
      },
    });
  }

  // Persist as new active version.
  const client = await db().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE catalog.venue_seating_charts SET active = false WHERE venue_id = $1`,
      [params.id],
    );
    const r = await client.query<{ id: string }>(
      `INSERT INTO catalog.venue_seating_charts
         (venue_id, name, layout, total_seats, active, created_by_user_id, source, notes)
       VALUES ($1, $2, $3::jsonb, $4, true, $5, 'transform', $6)
       RETURNING id`,
      [
        params.id,
        chart.name,
        JSON.stringify(layout),
        totalSeats,
        admin.userId,
        log.join('; '),
      ],
    );
    // Auto-update venue.capacity podle chartu (transform může změnit počet seats — split nemění,
    // flatten taky ne, ale buď defenzivní pro budoucí ops které mohou).
    await client.query(
      `UPDATE catalog.venues
          SET capacity = $1, last_modified_by_user_id = $2, last_modified_at = NOW()
        WHERE id = $3`,
      [totalSeats, admin.userId, params.id],
    );
    await client.query('COMMIT');

    const ctx = extractRequestContext(req);
    void logAction({
      actorUserId: admin.userId,
      actorRole: 'platform_admin',
      action: 'venue.seating_chart.transform',
      targetType: 'venue',
      targetId: params.id,
      metadata: { newChartId: r.rows[0].id, operations: parsed.data.operations, totalSeats },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return NextResponse.json({
      id: r.rows[0].id,
      totalSeats,
      log,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seating-chart transform]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
