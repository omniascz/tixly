/**
 * GET /api/admin/fraud-queue?decision=review|block&from=...&to=...
 *
 * List flagged orders pro promoter manual review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const decision = req.nextUrl.searchParams.get('decision') ?? 'review';
  if (!['review', 'block', 'allow'].includes(decision)) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 422 });
  }

  const r = await db().query<{
    id: string;
    status: string;
    total_amount: number;
    currency: string;
    created_at: string;
    buyer_email: string;
    buyer_name: string | null;
    event_title: string;
    fraud_score: number;
    fraud_signals: { topReasons?: string[]; probability?: number };
  }>(
    `SELECT o.id, o.status, o.total_amount, o.currency, o.created_at,
            u.email AS buyer_email, u.name AS buyer_name,
            e.title AS event_title,
            o.fraud_score, o.fraud_signals
     FROM orders.orders o
     JOIN identity.users u ON u.id = o.user_id
     JOIN catalog.events e ON e.id = o.event_id
     WHERE e.promoter_id = $1
       AND o.fraud_decision = $2
       AND o.created_at > NOW() - INTERVAL '30 days'
     ORDER BY o.fraud_score DESC, o.created_at DESC
     LIMIT 100`,
    [promoter.promoterId, decision],
  );
  return NextResponse.json({ orders: r.rows });
}
