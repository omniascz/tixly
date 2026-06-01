/**
 * GET/PUT /api/admin/dashboards/[key]
 *
 * Custom dashboard layout per user. Layout = react-grid-layout format.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { z } from 'zod';


const layoutSchema = z.object({
  widgets: z.array(z.object({
    i: z.string(),                            // widget id (matches dashboard_widgets.id)
    x: z.number().int().min(0).max(20),
    y: z.number().int().min(0).max(200),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(12),
    config: z.record(z.string(), z.unknown()).optional(),
  })),
});

export async function GET(
  req: NextRequest,
  { params }: { params: { key: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<{ layout_data: { widgets: unknown[] } }>(
    `SELECT layout_data FROM platform.dashboard_layouts
      WHERE user_id = $1 AND dashboard_key = $2`,
    [promoter.userId, params.key],
  );

  // Vrátí uloženou layout nebo default (predefined per dashboard_key)
  if (r.rows.length > 0) {
    return NextResponse.json({ layout: r.rows[0].layout_data, isCustom: true });
  }

  const defaults: Record<string, { widgets: { i: string; x: number; y: number; w: number; h: number }[] }> = {
    main: {
      widgets: [
        { i: 'sales_today', x: 0, y: 0, w: 4, h: 2 },
        { i: 'live_feed', x: 4, y: 0, w: 4, h: 4 },
        { i: 'upcoming_events', x: 8, y: 0, w: 4, h: 4 },
        { i: 'pricemaster', x: 0, y: 2, w: 4, h: 2 },
        { i: 'top_events', x: 0, y: 4, w: 8, h: 3 },
        { i: 'ad_performance', x: 8, y: 4, w: 4, h: 3 },
      ],
    },
  };

  return NextResponse.json({
    layout: defaults[params.key] ?? { widgets: [] },
    isCustom: false,
  });

  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: { key: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = layoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  await db().query(
    `INSERT INTO platform.dashboard_layouts (user_id, promoter_id, dashboard_key, layout_data)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (user_id, dashboard_key)
     DO UPDATE SET layout_data = EXCLUDED.layout_data, updated_at = now()`,
    [promoter.userId, promoter.promoterId, params.key, JSON.stringify(parsed.data)],
  );

  return NextResponse.json({ ok: true });

  });
}
