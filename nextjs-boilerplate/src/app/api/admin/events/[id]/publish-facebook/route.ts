/**
 * POST /api/admin/events/[id]/publish-facebook
 *
 * Body: { pageId: string }   (UUID napojené marketing.facebook_pages)
 *
 * Publish event jako FB Event na danou page. Idempotent — pokud už existuje
 * record v catalog.event_fb_publishes, vrátí stejný fb_event_id (žádný
 * duplicate publish).
 *
 * Volá Graph SDK createPageEvent. V mock módu vrátí fake fb_event_id.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { decryptSecret } from '@/lib/crypto';
import { createPageEvent, isMockMode } from '@/lib/facebook/graph';


const schema = z.object({
  pageId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }

  // Načteme event + page + verify ownership
  const evRes = await db().query<{
    id: string;
    promoter_id: string;
    title: string;
    description: string | null;
    date_start: string;
    date_end: string | null;
    venue_name: string | null;
    venue_city: string | null;
    cover_image_url: string | null;
  }>(
    `SELECT e.id, e.promoter_id, e.title, e.description,
            e.date_start::text, e.date_end::text,
            v.name AS venue_name, v.city AS venue_city,
            e.cover_image_url
     FROM catalog.events e
     LEFT JOIN catalog.venues v ON v.id = e.venue_id
     WHERE e.id = $1`,
    [params.id],
  );
  if (evRes.rows.length === 0) {
    return NextResponse.json({ error: 'EVENT_NOT_FOUND' }, { status: 404 });
  }
  const event = evRes.rows[0];
  if (event.promoter_id !== promoter.promoterId) {
    return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
  }

  const pageRes = await db().query<{
    id: string;
    fb_page_id: string;
    access_token_encrypted: Buffer;
    is_mock: boolean;
  }>(
    `SELECT id, fb_page_id, access_token_encrypted, is_mock
     FROM marketing.facebook_pages
     WHERE id = $1 AND promoter_id = $2 AND disconnected_at IS NULL`,
    [parsed.data.pageId, promoter.promoterId],
  );
  if (pageRes.rows.length === 0) {
    return NextResponse.json(
      { error: 'PAGE_NOT_CONNECTED' },
      { status: 404 },
    );
  }
  const page = pageRes.rows[0];

  // Idempotent — pokud už máme published záznam, vrátíme ho.
  const existingRes = await db().query<{
    id: string;
    fb_event_id: string;
    status: string;
    published_at: string;
  }>(
    `SELECT id, fb_event_id, status, published_at::text
     FROM catalog.event_fb_publishes
     WHERE event_id = $1 AND fb_page_id = $2 AND status = 'published'`,
    [event.id, page.id],
  );
  if (existingRes.rows.length > 0) {
    const e = existingRes.rows[0];
    return NextResponse.json({
      ok: true,
      alreadyPublished: true,
      fbEventId: e.fb_event_id,
      permalinkUrl: `https://facebook.com/events/${e.fb_event_id}`,
      publishedAt: e.published_at,
    });
  }

  // Call Graph API (mock nebo real)
  try {
    const accessToken = decryptSecret(page.access_token_encrypted.toString('base64'));
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const ticketUrl = `${appUrl}/cs/events/${event.id}?utm_source=facebook&utm_medium=event`;

    const result = await createPageEvent({
      pageId: page.fb_page_id,
      pageAccessToken: accessToken,
      name: event.title,
      description: event.description ?? '',
      startTime: event.date_start,
      endTime: event.date_end ?? undefined,
      venueName: event.venue_name ?? undefined,
      cityName: event.venue_city ?? undefined,
      ticketUrl,
      coverPictureUrl: event.cover_image_url ?? undefined,
    });

    await db().query(
      `INSERT INTO catalog.event_fb_publishes
         (event_id, fb_page_id, fb_event_id, status, is_mock)
       VALUES ($1, $2, $3, 'published', $4)`,
      [event.id, page.id, result.fbEventId, result.isMock],
    );

    return NextResponse.json({
      ok: true,
      alreadyPublished: false,
      fbEventId: result.fbEventId,
      permalinkUrl: result.permalinkUrl,
      isMock: result.isMock,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[FB publish]', msg);
    // Log failure
    await db().query(
      `INSERT INTO catalog.event_fb_publishes
         (event_id, fb_page_id, fb_event_id, status, last_error, is_mock)
       VALUES ($1, $2, $3, 'failed', $4, $5)
       ON CONFLICT (event_id, fb_page_id) DO UPDATE
         SET status = 'failed', last_error = EXCLUDED.last_error, updated_at = now()`,
      [event.id, page.id, `error-${Date.now()}`, msg, isMockMode()],
    );
    return NextResponse.json(
      { error: 'PUBLISH_FAILED', message: msg },
      { status: 500 },
    );
  }

  });
}

// GET — list existing publishes pro tento event (status indikátor v UI)
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (_promoter) => {
  const r = await db().query<{
    id: string;
    fb_event_id: string;
    fb_page_id: string;
    page_name: string;
    status: string;
    published_at: string;
    is_mock: boolean;
  }>(
    `SELECT p.id, p.fb_event_id, p.fb_page_id, fp.page_name,
            p.status, p.published_at::text, p.is_mock
     FROM catalog.event_fb_publishes p
     JOIN marketing.facebook_pages fp ON fp.id = p.fb_page_id
     WHERE p.event_id = $1
     ORDER BY p.published_at DESC`,
    [params.id],
  );
  return NextResponse.json({
    publishes: r.rows.map((p) => ({
      id: p.id,
      fbEventId: p.fb_event_id,
      pageName: p.page_name,
      status: p.status,
      publishedAt: p.published_at,
      permalinkUrl: `https://facebook.com/events/${p.fb_event_id}`,
      isMock: p.is_mock,
    })),
  });

  });
}
