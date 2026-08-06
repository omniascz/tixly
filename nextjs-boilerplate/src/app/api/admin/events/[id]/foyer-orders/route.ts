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
      items: unknown;
    }>(
      `SELECT fo.id, fo.pickup_qr_token, fo.status, fo.total_halire, fo.items, u.email AS buyer_email, fo.created_at
       FROM orders.foyer_orders fo
       LEFT JOIN orders.orders o ON o.id = fo.order_id
       LEFT JOIN identity.users u ON u.id = o.user_id
       WHERE fo.event_id = $1 AND fo.status = $2
       ORDER BY fo.created_at DESC
       LIMIT 200`,
      [params.id, status],
    );

    // R-23 / FINDINGS 131: orders.foyer_order_items NEEXISTUJE a nikdy neexistovala.
    // Skutecny navrh je DENORMALIZOVANY sloupec `items jsonb` primo na
    // orders.foyer_orders — doloženo commitem aa62538, ktery ze stejneho duvodu
    // odstranil zapisovou vetev v checkoutu ("schema drift orphan, trida 3").
    // Tohle je tataz drift na CTECI strane: dotaz padal na 42P01.
    // Tvar polozek ({item_name, quantity, unit_halire}) zustava, meni se jen zdroj.
    const itemsByOrder: Record<string, Array<{ item_name: string; quantity: number; unit_halire: number }>> = {};
    for (const row of orders.rows) {
      const raw = Array.isArray(row.items) ? row.items : [];
      itemsByOrder[row.id] = raw
        .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
        .map((x) => ({
          item_name: String(x.item_name ?? x.name ?? ''),
          quantity: Number(x.quantity ?? 0),
          unit_halire: Number(x.unit_halire ?? x.unit_price_halire ?? 0),
        }));
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
