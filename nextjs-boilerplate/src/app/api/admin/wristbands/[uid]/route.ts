/**
 * GET    /api/admin/wristbands/[uid]            — info + last transactions
 * POST   /api/admin/wristbands/[uid]/topup      — přidat balance
 * POST   /api/admin/wristbands/[uid]/charge     — odečíst balance (vendor purchase)
 *
 * Tady je GET — ostatní v separate routes (Next.js folder structure).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface WristbandRow {
  uid: string;
  ticket_id: string;
  balance_halire: number;
  active: boolean;
  bound_at: string;
  blocked_at: string | null;
  block_reason: string | null;
  ticket_status: string;
  ticket_type_name: string;
  event_title: string;
  event_promoter_id: string;
  buyer_email: string;
}

interface TxRow {
  id: string;
  kind: string;
  amount_halire: number;
  balance_after: number;
  vendor_label: string | null;
  description: string | null;
  performed_at: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { uid: string } },
): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query<WristbandRow>(
    `SELECT w.uid, w.ticket_id, w.balance_halire, w.active, w.bound_at,
            w.blocked_at, w.block_reason,
            t.status AS ticket_status,
            tt.name AS ticket_type_name,
            e.title AS event_title,
            e.promoter_id AS event_promoter_id,
            u.email AS buyer_email
     FROM tickets.wristbands w
     JOIN tickets.tickets t ON t.id = w.ticket_id
     JOIN catalog.ticket_types tt ON tt.id = t.ticket_type_id
     JOIN orders.orders o ON o.id = t.order_id
     JOIN catalog.events e ON e.id = o.event_id
     JOIN identity.users u ON u.id = t.owner_id
     WHERE w.uid = $1`,
    [params.uid],
  );
  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'Wristband not found' }, { status: 404 });
  }
  const w = r.rows[0];
  if (w.event_promoter_id !== promoter.promoterId) {
    return NextResponse.json({ error: 'Wrong promoter' }, { status: 403 });
  }

  const tx = await db().query<TxRow>(
    `SELECT id, kind, amount_halire, balance_after, vendor_label, description, performed_at
     FROM tickets.wristband_transactions
     WHERE wristband_uid = $1
     ORDER BY performed_at DESC
     LIMIT 50`,
    [params.uid],
  );

  return NextResponse.json({
    uid: w.uid,
    ticketId: w.ticket_id,
    balanceHalire: w.balance_halire,
    active: w.active,
    boundAt: w.bound_at,
    blockedAt: w.blocked_at,
    blockReason: w.block_reason,
    ticket: {
      status: w.ticket_status,
      ticketTypeName: w.ticket_type_name,
      eventTitle: w.event_title,
      buyerEmail: w.buyer_email,
    },
    transactions: tx.rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      amountHalire: t.amount_halire,
      balanceAfter: t.balance_after,
      vendorLabel: t.vendor_label,
      description: t.description,
      performedAt: t.performed_at,
    })),
  });
}
