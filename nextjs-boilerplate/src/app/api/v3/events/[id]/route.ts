/**
 * GET /api/v3/events/:id
 *
 * Eventbrite-style event detail s expansions:
 *   ?expand=ticket_classes,attendees,venue
 *
 * Auth: Bearer (OAuth access_token nebo API key).
 * Scope: read_events
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithPromoterContext } from '@/lib/db/rls-pool';
import { requireApiAuth, rateLimitCheck } from '@/lib/oauth/guard';

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }): Promise<Response> {
  const params = await props.params;
  const auth = await requireApiAuth(req, 'read_events');
  if (!auth.ok) return auth.response;
  const ctx = auth.ctx;

  const rl = await rateLimitCheck(ctx, `/api/v3/events/${params.id}`, 'GET');
  if (!rl.ok) return rl.response;

  // Kontext z API tokenu → promoter RLS scope (queries vidí vlastní akce + published).
  if (!ctx.promoterId) return NextResponse.json({ error: 'no_promoter_scope' }, { status: 403 });
  return runWithPromoterContext(ctx.promoterId, async () => {
  const expand = (new URL(req.url).searchParams.get('expand') ?? '').split(',').filter(Boolean);

  // Load event — scoped to caller's promoter
  const eventRes = await db().query<{
    id: string;
    title: string;
    description: string | null;
    slug: string | null;
    date_start: string;
    date_end: string | null;
    status: string;
    venue_id: string | null;
    category: string | null;
    cover_image_url: string | null;
    currency: string;
    promoter_id: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, title, description, slug, date_start::text, date_end::text,
            status, venue_id, category, cover_image_url, currency, promoter_id,
            created_at::text, updated_at::text
       FROM catalog.events
      WHERE id = $1
        AND (promoter_id = $2 OR status = 'published')`,
    [params.id, ctx.promoterId],
  );

  if (eventRes.rows.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const event = eventRes.rows[0];

  const result: Record<string, unknown> = {
    id: event.id,
    name: { text: event.title },
    description: event.description,
    url: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/cs/events/${event.slug ?? event.id}`,
    start: { local: event.date_start, utc: event.date_start },
    end: event.date_end ? { local: event.date_end, utc: event.date_end } : null,
    status: event.status,
    currency: event.currency,
    logo_url: event.cover_image_url,
    category_id: event.category,
    organization_id: event.promoter_id,
    venue_id: event.venue_id,
    created: event.created_at,
    changed: event.updated_at,
  };

  // Expansions
  if (expand.includes('ticket_classes')) {
    const tt = await db().query(
      `SELECT id, name, description, base_price AS cost, currency,
              total_qty AS quantity_total, remaining_qty AS quantity_remaining,
              CASE WHEN base_price = 0 THEN true ELSE false END AS free,
              visibility
         FROM catalog.ticket_types WHERE event_id = $1 ORDER BY base_price`,
      [params.id],
    );
    result.ticket_classes = tt.rows;
  }

  if (expand.includes('venue') && event.venue_id) {
    const v = await db().query(
      `SELECT id, name, address, city, country_code AS country, latitude, longitude
         FROM catalog.venues WHERE id = $1`,
      [event.venue_id],
    );
    result.venue = v.rows[0] ?? null;
  }

  if (expand.includes('attendees') && ctx.scopes.includes('read_attendees')) {
    const att = await db().query(
      `SELECT t.id AS attendee_id, t.status,
              COALESCE(ai.first_name, u.first_name) AS first_name,
              COALESCE(ai.last_name, u.last_name) AS last_name,
              COALESCE(ai.email, u.email) AS email,
              t.created_at::text AS created
         FROM tickets.tickets t
         JOIN orders.orders o ON o.id = t.order_id
         JOIN identity.users u ON u.id = o.user_id
    LEFT JOIN tickets.attendee_info ai ON ai.ticket_id = t.id
        WHERE o.event_id = $1
        LIMIT 200`,
      [params.id],
    );
    result.attendees = att.rows;
  }

  return NextResponse.json(result);
  });
}
