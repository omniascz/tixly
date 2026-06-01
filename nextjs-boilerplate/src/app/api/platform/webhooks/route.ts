/**
 * GET /api/platform/webhooks
 *
 * Master admin debug viewer pro payment webhooks (GoPay/Stripe).
 * Filtry: ?orderId, ?eventType, ?provider, ?limit (max 200), ?offset.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';


interface WebhookRow {
  id: string;
  order_id: string;
  event_type: string;
  gopay_status: string | null;
  amount: number | null;
  raw_payload: unknown;
  created_at: string;
  payment_provider: string;
  order_status: string;
  order_total: number;
  buyer_email: string;
  event_title: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (_admin) => {
  const url = new URL(req.url);
  const orderId = url.searchParams.get('orderId');
  const eventType = url.searchParams.get('eventType');
  const provider = url.searchParams.get('provider');
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const wheres: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (orderId && /^[0-9a-f-]{36}$/i.test(orderId)) {
    wheres.push(`pe.order_id = $${i++}`);
    params.push(orderId);
  }
  if (eventType) {
    wheres.push(`pe.event_type = $${i++}`);
    params.push(eventType);
  }
  if (provider) {
    wheres.push(`pe.payment_provider = $${i++}`);
    params.push(provider);
  }
  const whereClause = wheres.length > 0 ? 'WHERE ' + wheres.join(' AND ') : '';
  params.push(limit, offset);

  const r = await db().query<WebhookRow>(
    `SELECT pe.id::text, pe.order_id, pe.event_type, pe.gopay_status, pe.amount,
            pe.raw_payload, pe.created_at, pe.payment_provider,
            o.status AS order_status, o.total_amount AS order_total,
            u.email AS buyer_email,
            e.title AS event_title
     FROM orders.payment_events pe
     JOIN orders.orders o ON o.id = pe.order_id
     LEFT JOIN identity.users u ON u.id = o.user_id
     LEFT JOIN catalog.events e ON e.id = o.event_id
     ${whereClause}
     ORDER BY pe.created_at DESC
     LIMIT $${i++} OFFSET $${i++}`,
    params,
  );

  return NextResponse.json({
    items: r.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      eventType: row.event_type,
      gopayStatus: row.gopay_status,
      amountHalire: row.amount,
      rawPayload: row.raw_payload,
      createdAt: row.created_at,
      paymentProvider: row.payment_provider,
      order: {
        status: row.order_status,
        totalHalire: row.order_total,
        buyerEmail: row.buyer_email,
        eventTitle: row.event_title,
      },
    })),
  });

  });
}
