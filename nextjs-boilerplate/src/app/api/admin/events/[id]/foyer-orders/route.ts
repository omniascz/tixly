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

    const url = new URL(req.url);
    const status = url.searchParams.get('status') ?? 'pending';

    const orders = await db().query<{
      id: string;
      pickup_qr_token: string;
      status: string;
      total_halire: number;
      buyer_email: string | null;
      created_at: string;
    }>(
      `SELECT id, pickup_qr_token, status, total_halire, buyer_email, created_at
       FROM orders.foyer_orders
       WHERE event_id = $1 AND status = $2
       ORDER BY created_at DESC
       LIMIT 200`,
      [params.id, status],
    );

    const orderIds = orders.rows.map((o) => o.id);
    const itemsByOrder: Record<string, Array<{ item_name: string; quantity: number; unit_halire: number }>> = {};

    if (orderIds.length > 0) {
      const itemsResult = await db().query<{
        foyer_order_id: string;
        item_name: string;
        quantity: number;
        unit_halire: number;
      }>(
        `SELECT foyer_order_id, item_name, quantity, unit_halire
         FROM orders.foyer_order_items
         WHERE foyer_order_id = ANY($1::uuid[])`,
        [orderIds],
      );
      for (const item of itemsResult.rows) {
        itemsByOrder[item.foyer_order_id] = itemsByOrder[item.foyer_order_id] ?? [];
        itemsByOrder[item.foyer_order_id].push({
          item_name: item.item_name,
          quantity: item.quantity,
          unit_halire: item.unit_halire,
        });
      }
    }

    return NextResponse.json({
      orders: orders.rows.map((o) => ({
        id: o.id,
        pickupQrToken: o.pickup_qr_token,
        status: o.status,
        totalHalire: o.total_halire,
        buyerEmail: o.buyer_email,
        createdAt: o.created_at,
        items: itemsByOrder[o.id] ?? [],
      })),
    });
  });
}
