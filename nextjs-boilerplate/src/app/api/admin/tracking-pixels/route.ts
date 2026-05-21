/**
 * GET/POST /api/admin/tracking-pixels
 *
 * Promotér si vloží Meta Pixel / Google Ads / TikTok pixel
 * pro per-event nebo promoter-wide tracking.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  eventId: z.string().uuid().nullable().optional(),
  platform: z.enum(['meta', 'google_ads', 'google_analytics', 'tiktok', 'linkedin', 'twitter', 'custom']),
  pixelId: z.string().min(2).max(200),
  config: z.record(z.string(), z.unknown()).optional(),
  eventsTracked: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const eventId = new URL(req.url).searchParams.get('eventId');

  const args: unknown[] = [promoter.promoterId];
  let where = 'promoter_id = $1';
  if (eventId) {
    args.push(eventId);
    where += ` AND (event_id = $2 OR event_id IS NULL)`;
  }

  const r = await db().query(
    `SELECT id, event_id, platform, pixel_id, config, events_tracked, is_active, created_at::text
       FROM marketing.tracking_pixels
      WHERE ${where}
   ORDER BY created_at DESC`,
    args,
  );

  return NextResponse.json({ pixels: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  // Verify event ownership if scoped
  if (parsed.data.eventId) {
    const own = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const r = await db().query<{ id: string }>(
    `INSERT INTO marketing.tracking_pixels
       (promoter_id, event_id, platform, pixel_id, config, events_tracked)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING id`,
    [
      promoter.promoterId, parsed.data.eventId ?? null,
      parsed.data.platform, parsed.data.pixelId,
      parsed.data.config ? JSON.stringify(parsed.data.config) : null,
      parsed.data.eventsTracked ?? ['ViewContent', 'AddToCart', 'Purchase'],
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}
