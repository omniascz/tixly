/**
 * GET   /api/admin/chargebacks       — list disputes pro promotéra
 * PATCH /api/admin/chargebacks/:id   — mark evidence submitted / status update
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoterNonStaff } from '@/lib/admin-auth';


export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoterNonStaff(req, async (promoter) => {
  const statusFilter = req.nextUrl.searchParams.get('status');
  const args: unknown[] = [promoter.promoterId];
  let statusClause = '';
  if (statusFilter) {
    args.push(statusFilter);
    statusClause = ` AND cb.status = $${args.length}`;
  }

  const r = await db().query<{
    id: string;
    order_id: string;
    stripe_dispute_id: string | null;
    amount_halire: number;
    reason: string | null;
    status: string;
    holdback_applied: boolean;
    evidence_submitted_at: string | null;
    closed_at: string | null;
    created_at: string;
    event_title: string | null;
    buyer_email: string | null;
  }>(
    `SELECT cb.id, cb.order_id, cb.stripe_dispute_id, cb.amount_halire, cb.reason,
            cb.status, cb.holdback_applied, cb.evidence_submitted_at, cb.closed_at,
            cb.created_at,
            e.title AS event_title,
            u.email AS buyer_email
     FROM orders.chargebacks cb
     LEFT JOIN orders.orders o ON o.id = cb.order_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     LEFT JOIN identity.users u ON u.id = o.user_id
     WHERE cb.promoter_id = $1 ${statusClause}
     ORDER BY cb.created_at DESC
     LIMIT 200`,
    args,
  );

  // Summary counts per status
  const counts = await db().query<{ status: string; count: string }>(
    `SELECT status, COUNT(*)::text AS count
     FROM orders.chargebacks WHERE promoter_id = $1
     GROUP BY status`,
    [promoter.promoterId],
  );

  return NextResponse.json({
    chargebacks: r.rows,
    counts: Object.fromEntries(counts.rows.map((c) => [c.status, Number(c.count)])),
  });

  });
}
