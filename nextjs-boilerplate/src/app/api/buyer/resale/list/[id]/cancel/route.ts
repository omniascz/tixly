/**
 * POST /api/buyer/resale/list/[id]/cancel
 *
 * Stáhne aktivní listing. Ověří, že žadatel je seller — jen ověřená identita z middleware
 * (x-user-id), nebo host s UUID objednávky, ze které vstupenka inzerátu pochází (capability
 * stránky potvrzení objednávky). Kolo 4: cesta přes `ownerEmail` z těla odstraněna
 * (kdokoli se znalostí e-mailu prodejce stáhl jeho inzerát).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


interface ListingRow {
  id: string;
  seller_id: string;
  status: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  return runWithServiceContext(async () => {

  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 422 });
  }

  let userId = req.headers.get('x-user-id');
  if (!userId) {
    const body = (await req.json().catch(() => ({}))) as { orderId?: unknown };
    const orderId = typeof body.orderId === 'string' && /^[0-9a-f-]{36}$/i.test(body.orderId) ? body.orderId : null;
    if (orderId) {
      const o = await db().query<{ user_id: string }>(
        `SELECT o.user_id FROM orders.orders o
           JOIN tickets.tickets t ON t.order_id = o.id
           JOIN resale.resale_listings l ON l.ticket_id = t.id AND l.seller_id = o.user_id
          WHERE o.id = $1 AND l.id = $2`,
        [orderId, params.id],
      );
      userId = o.rows[0]?.user_id ?? null;
    }
  }
  if (!userId) {
    return NextResponse.json({ error: 'Auth required' }, { status: 401 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<ListingRow>(
      `SELECT id, seller_id, status FROM resale.resale_listings
       WHERE id = $1 FOR UPDATE`,
      [params.id],
    );
    if (r.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    const listing = r.rows[0];
    if (listing.seller_id !== userId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Not the seller' }, { status: 403 });
    }
    if (listing.status !== 'active') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Listing status is "${listing.status}", cannot cancel` },
        { status: 409 },
      );
    }
    await client.query(
      `UPDATE resale.resale_listings
       SET status = 'cancelled', cancelled_at = NOW()
       WHERE id = $1`,
      [params.id],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, listingId: params.id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/buyer/resale/list/[id]/cancel]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }

  });
}
