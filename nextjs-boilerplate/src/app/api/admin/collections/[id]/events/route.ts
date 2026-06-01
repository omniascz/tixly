/**
 * POST/DELETE /api/admin/collections/[id]/events
 *
 * Add/remove events to/from collection.
 * Body: { eventId, displayOrder? }
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoterNonStaff } from '@/lib/admin-auth';
import { z } from 'zod';


const postSchema = z.object({
  eventId: z.string().uuid(),
  displayOrder: z.number().int().min(0).max(1000).optional(),
});

async function ensureCollectionOwner(collectionId: string, promoterId: string): Promise<boolean> {
  const r = await db().query(
    `SELECT 1 FROM catalog.event_collections
      WHERE id = $1 AND (promoter_id = $2 OR promoter_id IS NULL)`,
    [collectionId, promoterId],
  );
  return r.rows.length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  if (!(await ensureCollectionOwner(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY' }, { status: 422 });

  // Event ownership (own collection může mít jen vlastní eventy, platform collection cokoli)
  const cl = await db().query<{ promoter_id: string | null }>(
    `SELECT promoter_id FROM catalog.event_collections WHERE id = $1`,
    [params.id],
  );
  if (cl.rows[0].promoter_id !== null) {
    const own = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (own.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_OWN_EVENT' }, { status: 403 });
    }
  }

  await db().query(
    `INSERT INTO catalog.collection_events (collection_id, event_id, display_order)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [params.id, parsed.data.eventId, parsed.data.displayOrder ?? 100],
  );

  return NextResponse.json({ ok: true });

  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoterNonStaff(req, async (promoter) => {
  if (!(await ensureCollectionOwner(params.id, promoter.promoterId))) {
    return NextResponse.json({ error: 'NOT_OWNER' }, { status: 403 });
  }

  const eventId = new URL(req.url).searchParams.get('eventId');
  if (!eventId) return NextResponse.json({ error: 'EVENT_ID_REQUIRED' }, { status: 422 });

  await db().query(
    `DELETE FROM catalog.collection_events WHERE collection_id = $1 AND event_id = $2`,
    [params.id, eventId],
  );

  return NextResponse.json({ ok: true });

  });
}
