import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
    }

    const owns = await db().query(
      `SELECT 1 FROM catalog.events WHERE id = $1 AND promoter_id = $2 LIMIT 1`,
      [params.id, promoter.promoterId],
    );
    if (owns.rows.length === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = await db().query<{
      id: string;
      claim_token: string;
      recipient_email: string;
      recipient_name: string | null;
      gift_message: string | null;
      claimed_at: string | null;
      claimed_event_title: string | null;
      claimed_event_date: string | null;
      expires_at: string;
      created_at: string;
      buyer_email: string;
    }>(
      `SELECT gc.id, gc.claim_token::text,
              gc.recipient_email, gc.recipient_name, gc.gift_message,
              gc.claimed_at::text,
              ce.title AS claimed_event_title,
              ce.date_start::text AS claimed_event_date,
              gc.expires_at::text,
              gc.created_at::text,
              u.email AS buyer_email
         FROM orders.gift_claims gc
         JOIN orders.orders o ON o.id = gc.order_id
         JOIN identity.users u ON u.id = o.user_id
         LEFT JOIN catalog.events ce ON ce.id = gc.claimed_event_id
        WHERE (gc.event_id = $1 OR gc.claimed_event_id = $1)
        ORDER BY gc.created_at DESC
        LIMIT 500`,
      [params.id],
    );

    return NextResponse.json({ gifts: result.rows });
  });
}
