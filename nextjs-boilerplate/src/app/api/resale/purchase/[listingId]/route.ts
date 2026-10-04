/**
 * POST /api/resale/purchase/[listingId]
 * Buyer initiates resale purchase → reserves listing → creates pending order → returns payment URL.
 * Ticket transfer completes in /api/internal/resale/complete-transfer after payment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { saleBlockedResponse } from '@/lib/sales/cutoff';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { listingId: string } },
): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const b = await req.json() as {
      payment_method?: string;
      holder_name?: string;
      holder_email?: string;
      return_url?: string;
    };

    return runWithServiceContext(async () => {
      // Lock listing atomically; join to get event info
      const listingR = await db().query(
        `SELECT l.*,
                o.event_id,
                e.title AS event_title
         FROM resale.resale_listings l
         JOIN tickets.tickets t ON t.id = l.ticket_id
         JOIN orders.orders   o ON o.id = t.order_id
         JOIN catalog.events  e ON e.id = o.event_id
         WHERE l.id=$1 AND l.status='active'
           AND (l.expires_at IS NULL OR l.expires_at > NOW())
         FOR UPDATE SKIP LOCKED`,
        [params.listingId],
      );

      if (listingR.rows.length === 0) {
        return NextResponse.json({ error: 'Listing not available' }, { status: 409 });
      }

      const listing = listingR.rows[0] as {
        id: string;
        ticket_id: string;
        seller_id: string;
        event_id: string;
        event_title: string;
        ticket_type_name: string;
        seat_label: string | null;
        ask_price: number;
        platform_fee_halire: number;
        seller_payout_halire: number;
      };

      if (listing.seller_id === userId) {
        return NextResponse.json({ error: 'You cannot buy your own listing' }, { status: 409 });
      }

      // Kolo 7 (C-29): nákup z přeprodeje je nákup kupce — po uzávěrce online prodeje ne.
      const salesClosed = await saleBlockedResponse(db(), listing.event_id, 'online');
      if (salesClosed) return salesClosed;

      const reservedUntil = new Date(Date.now() + 15 * 60 * 1000);

      // Create pending order
      // `expires_at` je na orders.orders NOT NULL bez defaultu a INSERT ho
      // neuváděl → 23502 při KAŽDÉM nákupu z resale (doloženo reálným během
      // proti klonu prod schématu). Hodnota = `reservedUntil`, tedy TÁŽ, kterou
      // hned pod tím dostává rezervace listingu — pending objednávka tak expiruje
      // právě když padá rezervace, což je zjevný záměr toho výpočtu na :62.
      const orderR = await db().query(
        `INSERT INTO orders.orders
           (user_id, event_id, total_amount, status, resale_listing_id, expires_at)
         VALUES ($1,$2,$3,'pending',$4,$5)
         RETURNING id`,
        [userId, listing.event_id, listing.ask_price, params.listingId, reservedUntil],
      );

      const orderId = orderR.rows[0].id as string;

      // Reserve listing
      await db().query(
        `UPDATE resale.resale_listings
         SET status='reserved', reserved_until=$1, buyer_id=$2, buyer_order_id=$3
         WHERE id=$4`,
        [reservedUntil.toISOString(), userId, orderId, params.listingId],
      );

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

      let paymentUrl: string | null = null;

      let paymentError: string | null = null;
      try {
        const payR = await fetch(`${appUrl}/api/checkout/pay`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: req.headers.get('cookie') ?? '',
          },
          body: JSON.stringify({
            orderId,
            amount: listing.ask_price,
            currency: 'CZK',
            description: `Resale: ${listing.event_title} — ${listing.ticket_type_name}${listing.seat_label ? ` (${listing.seat_label})` : ''}`,
            paymentMethod: b.payment_method ?? 'gopay',
            returnUrl: b.return_url ?? `${appUrl}/order/${orderId}/confirmation`,
          }),
        });
        if (payR.ok) {
          const pd = await payR.json() as { payment_url?: string; gateway_url?: string };
          paymentUrl = pd.payment_url ?? pd.gateway_url ?? null;
        }
      } catch (err) {
        // Objednavka UZ JE zalozena a inventar drzi — proto se tady nepada.
        // Ale duvod selhani se driv zahodil uplne: zadny log, zadne pole
        // v odpovedi. UI videlo jen chybejici payment_url a nevedelo proc.
        // (R-24, trida "polknuta chyba" — tady NENI uspech, ktery nenastal,
        // je to ztracena pricina.)
        paymentError = (err as Error).message.slice(0, 160);
        console.error('[resale/purchase] payment init selhal, objednavka zustava:',
          orderId, err);
      }

      return NextResponse.json({
        order_id: orderId,
        payment_ok: paymentError === null,
        payment_error: paymentError,
        listing_id: params.listingId,
        reserved_until: reservedUntil.toISOString(),
        payment_url: paymentUrl,
        amount_halire: listing.ask_price,
      }, { status: 201 });
    });
  });
}
