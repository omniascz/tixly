/**
 * GET /api/v3/organizations/:id/events
 *
 * Eventbrite-style organization (= promoter) events list.
 * Scope: read_events.
 * Pagination: ?continuation=<cursor>&page_size=N
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const auth = await requireApiAuth(req, 'read_events');
  if (!auth.ok) return auth.response;

  const rl = await rateLimitCheck(auth.ctx, `/api/v3/organizations/${params.id}/events`, 'GET');
  if (!rl.ok) return rl.response;

  const url = new URL(req.url);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size') ?? '20')));
  const cursor = url.searchParams.get('continuation');
  const status = url.searchParams.get('status'); // 'published', 'draft', etc.

  // Access control: caller must be member of this promoter
  if (auth.ctx.promoterId !== params.id) {
    // Allow public read pro published events
    if (status !== 'published') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
  }

  const conditions: string[] = [`promoter_id = $1`];
  const args: unknown[] = [params.id];

  if (status) {
    args.push(status);
    conditions.push(`status = $${args.length}`);
  } else if (auth.ctx.promoterId !== params.id) {
    conditions.push(`status = 'published'`);
  }

  if (cursor) {
    args.push(cursor);
    conditions.push(`created_at < $${args.length}::timestamptz`);
  }

  args.push(pageSize + 1);
  const r = await db().query<{
    id: string; title: string; date_start: string;
    status: string; cover_image_url: string | null;
    created_at: string; currency: string;
  }>(
    `SELECT id, title, date_start::text, status, cover_image_url, created_at::text, currency
       FROM catalog.events
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${args.length}`,
    args,
  );

  const hasMore = r.rows.length > pageSize;
  const events = (hasMore ? r.rows.slice(0, pageSize) : r.rows).map((e) => ({
    id: e.id,
    name: { text: e.title },
    start: { local: e.date_start, utc: e.date_start },
    status: e.status,
    logo_url: e.cover_image_url,
    currency: e.currency,
    created: e.created_at,
  }));

  return NextResponse.json({
    events,
    pagination: {
      page_size: pageSize,
      has_more_items: hasMore,
      continuation: hasMore ? r.rows[pageSize - 1].created_at : null,
    },
  });
}
