/**
 * GET /api/v1/buyer/orders — seznam objednávek přihlášeného kupce pro mobilní appku
 * (mobile/app/orders/index.tsx). Kolo 4: routa neexistovala (404), seznam v appce byl vždy chyba.
 *
 * Auth: Bearer access token (middleware → x-user-id). Čte se pod RLS kontextem kupce,
 * takže cizí objednávky nejsou vidět ani při chybě v podmínce.
 */
import { NextRequest, NextResponse } from 'next/server';
import { runAsUser } from '@/lib/auth';
import { db } from '@/lib/db/rls-pool';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const r = await db().query<{
      id: string;
      status: string;
      total_amount: number;
      currency: string;
      created_at: string;
      event_title: string | null;
      event_date: string | null;
      item_count: number;
    }>(
      `SELECT o.id, o.status, o.total_amount, o.currency, o.created_at::text AS created_at,
              e.title AS event_title, e.date_start::text AS event_date,
              COALESCE((SELECT SUM(oi.quantity) FROM orders.order_items oi WHERE oi.order_id = o.id), 0)::int AS item_count
         FROM orders.orders o
         LEFT JOIN catalog.events e ON e.id = o.event_id
        WHERE o.user_id = $1
        ORDER BY o.created_at DESC
        LIMIT 100`,
      [userId],
    );
    return NextResponse.json({
      orders: r.rows.map((o) => ({
        id: o.id,
        status: o.status,
        totalAmount: o.total_amount,
        currency: o.currency,
        createdAt: o.created_at,
        eventTitle: o.event_title,
        eventDate: o.event_date,
        itemCount: o.item_count,
      })),
    });
  });
}
