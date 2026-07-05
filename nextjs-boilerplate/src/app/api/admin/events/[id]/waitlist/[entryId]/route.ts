import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';
import { randomUUID } from 'crypto';

const patchSchema = z.object({
  status: z.enum(['converted', 'cancelled']),
});

async function ownsEvent(eventId: string, promoterId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false;
  const r = await db().query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM catalog.events WHERE id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );
  return Number(r.rows[0]?.count ?? 0) > 0;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; entryId: string } },
): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    if (!(await ownsEvent(params.id, promoter.promoterId))) {
      return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'BAD_INPUT', issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const entryRes = await db().query<{
      id: string;
      event_id: string;
      ticket_type_id: string | null;
      email: string;
      name: string | null;
      status: string;
    }>(
      `SELECT id, event_id, ticket_type_id, email, name, status
       FROM orders.waiting_list
       WHERE id = $1 AND event_id = $2`,
      [params.entryId, params.id],
    );
    if (entryRes.rows.length === 0) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }
    const entry = entryRes.rows[0];

    if (parsed.data.status === 'cancelled') {
      await db().query(
        `UPDATE orders.waiting_list SET status = 'cancelled' WHERE id = $1`,
        [params.entryId],
      );
      return NextResponse.json({ ok: true, status: 'cancelled' });
    }

    const ttRes = await db().query<{ id: string; currency: string; base_price: number }>(
      `SELECT id, currency, base_price FROM catalog.ticket_types
       WHERE event_id = $1 AND status = 'published'
       ORDER BY base_price ASC
       LIMIT 1`,
      [params.id],
    );

    const ttId = entry.ticket_type_id ?? ttRes.rows[0]?.id ?? null;
    const currency = ttRes.rows[0]?.currency ?? 'CZK';
    const basePrice = ttRes.rows[0]?.base_price ?? 0;

    const userRes = await db().query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at)
       VALUES (LOWER($1), $2, '!guest', NOW())
       ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW()
       RETURNING id`,
      [entry.email, entry.name ?? entry.email],
    );
    const userId = userRes.rows[0].id;

    const orderId = randomUUID();
    await db().query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          gopay_payment_id, payment_provider, idempotency_key,
          discount_halire, requires_age_verification,
          expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', $4, $5, 'cs',
               $6, 'walkin', $7,
               0, FALSE,
               NOW() + INTERVAL '45 minutes', NOW(), NOW())`,
      [
        orderId,
        userId,
        params.id,
        basePrice,
        currency,
        `walkin-${randomUUID().slice(0, 8)}`,
        randomUUID(),
      ],
    );

    if (ttId) {
      await db().query(
        `INSERT INTO orders.order_items
           (order_id, ticket_type_id, quantity, unit_price, total_price)
         VALUES ($1, $2, 1, $3, $3)`,
        [orderId, ttId, basePrice],
      );
    }

    await db().query(
      `UPDATE orders.waiting_list SET status = 'converted' WHERE id = $1`,
      [params.entryId],
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const checkoutUrl = `${appUrl}/cs/checkout?eventId=${params.id}&orderId=${orderId}`;

    return NextResponse.json({ ok: true, orderId, checkoutUrl });
  });
}
