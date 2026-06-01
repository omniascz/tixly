/**
 * POST /api/buyer/resale/buy
 *
 * Body: { listingId: string, buyerEmail?, buyerName? }
 *
 * Demo resale buy (mock platba — bez GoPay redirectu pro demo):
 *   1. Auth: x-user-id (přihlášený) NEBO buyerEmail (guest, vytvoří user-a)
 *   2. Listing musí být status='active', not expired
 *   3. Seller ≠ buyer
 *   4. Pro demo: instant transfer ownership místo GoPay redirectu
 *      - listing.status='sold', sold_at=NOW(), buyer_id=userId
 *      - tickets.tickets.owner_id = buyer (transfer_count++)
 *      - vytvoříme novou objednávku se status='paid' a payment_provider='resale_demo'
 *      - increase transfer_count, log audit
 *   5. V produkci: vytvořit GoPay payment + escrow do confirmed delivery
 */

import { randomUUID } from 'crypto';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { reissueTicket, enqueueSellerPayout } from '@/lib/resale/reissue';


const schema = z.object({
  listingId: z.string().regex(/^[0-9a-f-]{36}$/i),
  buyerEmail: z.string().email().optional(),
  buyerName: z.string().min(1).max(120).optional(),
});

interface ListingRow {
  id: string;
  ticket_id: string;
  seller_id: string;
  ask_price: number;
  status: string;
  expires_at: string;
  event_id: string;
}

export async function POST(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;

  const headerUserId = req.headers.get('x-user-id');
  if (!headerUserId && !input.buyerEmail) {
    return NextResponse.json(
      { error: 'Buyer auth required (login or buyerEmail for guest)' },
      { status: 401 },
    );
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    const l = await client.query<ListingRow>(
      `SELECT l.id, l.ticket_id, l.seller_id, l.ask_price, l.status, l.expires_at,
              o.event_id
       FROM resale.resale_listings l
       JOIN tickets.tickets t ON t.id = l.ticket_id
       JOIN orders.orders o ON o.id = t.order_id
       WHERE l.id = $1
       FOR UPDATE`,
      [input.listingId],
    );
    if (l.rows.length === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
    }
    const listing = l.rows[0];
    if (listing.status !== 'active') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Listing status is "${listing.status}"` },
        { status: 409 },
      );
    }
    if (new Date(listing.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Listing expired' }, { status: 409 });
    }

    // Resolve buyerId — header user OR new guest
    let buyerId: string;
    if (headerUserId) {
      buyerId = headerUserId;
    } else {
      const userRes = await client.query<{ id: string }>(
        `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
         VALUES ($1, $2, '!guest', NOW(), NOW(), NOW())
         ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE
           SET updated_at = NOW()
         RETURNING id`,
        [input.buyerEmail!.toLowerCase(), input.buyerName ?? input.buyerEmail!],
      );
      buyerId = userRes.rows[0].id;
    }

    if (buyerId === listing.seller_id) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Cannot buy your own listing' }, { status: 409 });
    }

    // Create a fresh paid order for the buyer
    const newOrderId = randomUUID();
    await client.query(
      `INSERT INTO orders.orders
         (id, user_id, event_id, status, total_amount, currency, locale,
          payment_provider, gopay_payment_id, idempotency_key,
          discount_halire, requires_age_verification,
          expires_at, paid_at, created_at, updated_at)
       VALUES ($1, $2, $3, 'paid', $4, 'CZK', 'cs',
               'gopay', $5, $6,
               0, FALSE,
               NOW() + INTERVAL '15 minutes', NOW(), NOW(), NOW())`,
      [
        newOrderId,
        buyerId,
        listing.event_id,
        listing.ask_price,
        `resale-${listing.id}`,
        randomUUID(),
      ],
    );

    // Eventim-style re-issue: revoke original, mint new s novým TOTP
    let reissue;
    try {
      reissue = await reissueTicket({
        client,
        originalTicketId: listing.ticket_id,
        newOwnerId: buyerId,
        newOrderId,
        reason: 'resale_sale',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[resale/buy] reissueTicket failed:', msg);
      throw err;
    }

    // Mark listing sold + link na re-issued ticket
    await client.query(
      `UPDATE resale.resale_listings
       SET status = 'sold', sold_at = NOW(), buyer_id = $1, reissued_ticket_id = $2
       WHERE id = $3`,
      [buyerId, reissue.newTicketId, listing.id],
    );

    // Enqueue seller payout (4 dny default)
    let payout;
    try {
      payout = await enqueueSellerPayout({
        client,
        listingId: listing.id,
        sellerId: listing.seller_id,
        salePriceHalire: listing.ask_price,
        eventId: listing.event_id,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[resale/buy] enqueueSellerPayout failed:', msg);
      throw err;
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      listingId: listing.id,
      originalTicketId: listing.ticket_id,
      newTicketId: reissue.newTicketId,
      newOrderId,
      pricePaidHalire: listing.ask_price,
      sellerPayoutScheduledFor: payout.scheduledFor.toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/buyer/resale/buy]', msg, err);
    return NextResponse.json(
      { error: 'Internal server error', detail: msg },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  });
}
