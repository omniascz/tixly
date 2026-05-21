/**
 * GET/POST/DELETE /api/admin/events/[id]/wallet-modules
 *
 * Enhanced Wallet Content Modules — Apple Music playlist, mapa venue,
 * parking info, počasí, merch links etc. zobrazované na lock-screen pass.
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
  moduleType: z.enum([
    'apple_music_playlist', 'venue_map', 'parking_info', 'weather_link',
    'merch_link', 'gate_instructions', 'food_menu', 'transportation',
    'before_event_info', 'after_event_info', 'custom',
  ]),
  title: z.string().min(2).max(200),
  content: z.string().max(2000).optional(),
  linkUrl: z.string().url().optional(),
  icon: z.string().max(100).optional(),
  publishAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
  displayOrder: z.number().int().min(0).max(1000).default(100),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id: eventId } = await params;

  const r = await db().query(
    `SELECT wcm.*
       FROM tickets.wallet_content_modules wcm
       JOIN catalog.events e ON e.id = wcm.event_id
      WHERE wcm.event_id = $1 AND e.promoter_id = $2
   ORDER BY wcm.display_order, wcm.created_at`,
    [eventId, promoter.promoterId],
  );

  return NextResponse.json({ modules: r.rows });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  // Ownership
  const own = await db().query(
    `SELECT 1, date_start FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoter.promoterId],
  );
  if (own.rows.length === 0) return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });

  const d = parsed.data;
  const r = await db().query<{ id: string }>(
    `INSERT INTO tickets.wallet_content_modules
       (event_id, module_type, title, content, link_url, icon,
        publish_at, expires_at, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8::timestamptz, $9)
     RETURNING id`,
    [
      eventId, d.moduleType, d.title,
      d.content ?? null, d.linkUrl ?? null, d.icon ?? null,
      d.publishAt ?? null, d.expiresAt ?? null, d.displayOrder,
    ],
  );

  return NextResponse.json({ id: r.rows[0].id }, { status: 201 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.role === 'staff') {
    return NextResponse.json({ error: 'ADMIN_OR_OWNER_ONLY' }, { status: 403 });
  }
  const { id: eventId } = await params;
  const moduleId = new URL(req.url).searchParams.get('moduleId');
  if (!moduleId) return NextResponse.json({ error: 'MODULE_ID_REQUIRED' }, { status: 422 });

  const r = await db().query(
    `DELETE FROM tickets.wallet_content_modules wcm
      USING catalog.events e
      WHERE wcm.id = $1 AND wcm.event_id = e.id
        AND e.id = $2 AND e.promoter_id = $3
    RETURNING wcm.id`,
    [moduleId, eventId, promoter.promoterId],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
