/**
 * GET /api/admin/call-center/orders
 * Last 50 phone orders for the current promoter.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsActivePromoter } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
    const rows = await db().query<{
      id: string;
      buyer_email: string;
      buyer_name: string | null;
      total_amount: number;
      currency: string;
      status: string;
      phone_payment_link: string | null;
      created_at: string;
      event_name: string | null;
    }>(
      `SELECT o.id, o.buyer_email, o.buyer_name, o.total_amount, o.currency, o.status,
              o.phone_payment_link, o.created_at::text,
              e.name AS event_name
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
        WHERE o.order_source = 'phone'
          AND o.event_id IN (
            SELECT id FROM catalog.events WHERE promoter_id = $1
          )
        ORDER BY o.created_at DESC
        LIMIT 50`,
      [promoter.promoterId],
    );
    return NextResponse.json({ orders: rows.rows });
  });
}
