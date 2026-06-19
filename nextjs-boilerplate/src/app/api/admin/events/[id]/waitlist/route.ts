import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

const actionSchema = z.object({
  action: z.enum(['offer_next', 'advance_expired']),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const r = await db().query<{
      id: string;
      event_id: string;
      ticket_type_id: string | null;
      email: string;
      name: string | null;
      position: number;
      status: string;
      created_at: string;
      offered_at: string | null;
      offer_expires_at: string | null;
    }>(
      `SELECT id, event_id, ticket_type_id, email, name, position, status,
              created_at, offered_at, offer_expires_at
       FROM orders.waiting_list
       WHERE event_id = $1
       ORDER BY position`,
      [params.id],
    );

    return NextResponse.json({ entries: r.rows });
  });
}

async function offerNext(eventId: string): Promise<{
  entry: Record<string, unknown> | null;
  expiresAt: string | null;
}> {
  const r = await db().query<{
    id: string;
    email: string;
    name: string | null;
    position: number;
    offer_expires_at: string;
  }>(
    `UPDATE orders.waiting_list
     SET status = 'offered',
         offered_at = NOW(),
         offer_expires_at = NOW() + INTERVAL '45 minutes'
     WHERE id = (
       SELECT id FROM orders.waiting_list
       WHERE event_id = $1 AND status = 'waiting'
       ORDER BY position ASC
       LIMIT 1
     )
     RETURNING id, email, name, position, offer_expires_at`,
    [eventId],
  );

  if (r.rows.length === 0) return { entry: null, expiresAt: null };
  const row = r.rows[0];
  return {
    entry: { id: row.id, email: row.email, name: row.name, position: row.position },
    expiresAt: row.offer_expires_at,
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    if (parsed.data.action === 'offer_next') {
      const result = await offerNext(params.id);
      return NextResponse.json(result);
    }

    const expired = await db().query<{ id: string }>(
      `UPDATE orders.waiting_list
       SET status = 'expired'
       WHERE event_id = $1 AND status = 'offered' AND offer_expires_at < NOW()
       RETURNING id`,
      [params.id],
    );

    const result = await offerNext(params.id);

    return NextResponse.json({
      expiredCount: expired.rows.length,
      ...result,
    });
  });
}
