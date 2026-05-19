/**
 * POST   /api/buyer/push/subscribe   — registruje nebo aktualizuje push subscription
 * DELETE /api/buyer/push/subscribe   — smaže subscription podle endpoint
 *
 * Body POST: { endpoint, keys: { p256dh, auth } }
 *   (přesně formát PushSubscription.toJSON() z W3C Push API)
 *
 * Body DELETE: { endpoint }
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const postSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(10).max(200),
    auth: z.string().min(10).max(100),
  }),
});

const deleteSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT', issues: parsed.error.issues }, { status: 422 });
  }

  const ua = req.headers.get('user-agent')?.slice(0, 500) ?? null;

  // Upsert podle endpoint (UNIQUE constraint).
  const r = await db().query<{ id: string }>(
    `INSERT INTO notifications.push_subscriptions
       (user_id, endpoint, p256dh_key, auth_key, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint)
     DO UPDATE SET
       user_id = EXCLUDED.user_id,
       p256dh_key = EXCLUDED.p256dh_key,
       auth_key = EXCLUDED.auth_key,
       user_agent = EXCLUDED.user_agent,
       failure_count = 0,
       updated_at = NOW()
     RETURNING id`,
    [userId, parsed.data.endpoint, parsed.data.keys.p256dh, parsed.data.keys.auth, ua],
  );

  return NextResponse.json({ ok: true, id: r.rows[0]?.id });
}

export async function DELETE(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  const r = await db().query<{ id: string }>(
    `DELETE FROM notifications.push_subscriptions
     WHERE endpoint = $1 AND user_id = $2
     RETURNING id`,
    [parsed.data.endpoint, userId],
  );

  return NextResponse.json({ ok: true, deleted: r.rows.length });
}
