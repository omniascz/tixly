import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runWithServiceContext } from '@/lib/db/rls-pool';
import { z } from 'zod';

const bodySchema = z.object({
  response: z.enum(['accepted', 'exchange_requested', 'refund_requested']),
});

interface ResponseRow {
  id: string;
  order_id: string;
  user_id: string;
}

export async function POST(req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const announcementId = params.token;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { response } = parsed.data;

  return runWithServiceContext(async () => {
    const existing = await db().query<ResponseRow>(
      `SELECT id, order_id, user_id
       FROM communications.announcement_responses
       WHERE announcement_id = $1
       LIMIT 1`,
      [announcementId],
    );

    if (existing.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const row = existing.rows[0];

    await db().query(
      `UPDATE communications.announcement_responses
       SET response = $1, responded_at = NOW()
       WHERE announcement_id = $2`,
      [response, announcementId],
    );

    if (response === 'refund_requested') {
      await db().query(
        `UPDATE orders.orders
         SET status = 'refund_requested'
         WHERE id = $1`,
        [row.order_id],
      );
    }

    return NextResponse.json({ ok: true });
  });
}
