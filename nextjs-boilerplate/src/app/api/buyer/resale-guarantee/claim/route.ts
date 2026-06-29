/**
 * POST /api/buyer/resale-guarantee/claim
 *
 * Buyer nahlásí, že resale vstupenka je neplatná — vytvoří guarantee claim.
 * Body: { listingId: string; reason: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsUser } from '@/lib/auth';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const schema = z.object({
  listingId: z.string().uuid(),
  reason: z.string().min(10).max(1000),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsUser(req, async (userId) => {
    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'VALIDATION_ERROR', issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const { listingId, reason } = parsed.data;

    // Verify listing exists and was bought by this user
    const listingRes = await runWithServiceContext(() =>
      db().query<{ id: string; buyer_order_id: string | null; guarantee_enabled: boolean }>(
        `SELECT id, buyer_order_id, guarantee_enabled
         FROM orders.resale_listings
         WHERE id = $1 AND buyer_user_id = $2 AND status = 'sold'`,
        [listingId, userId],
      ),
    );

    if (listingRes.rows.length === 0) {
      return NextResponse.json(
        { error: 'LISTING_NOT_FOUND', message: 'Listing nenalezen nebo není vaší objednávkou.' },
        { status: 404 },
      );
    }

    const listing = listingRes.rows[0];

    if (!listing.guarantee_enabled) {
      return NextResponse.json(
        { error: 'GUARANTEE_NOT_ENABLED', message: 'Tento listing nemá aktivní Fan Guarantee.' },
        { status: 400 },
      );
    }

    if (!listing.buyer_order_id) {
      return NextResponse.json(
        { error: 'ORDER_NOT_FOUND', message: 'Nepodařilo se najít objednávku.' },
        { status: 400 },
      );
    }

    // Check for existing pending/approved claim
    const existingRes = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `SELECT id FROM orders.resale_guarantee_claims
         WHERE resale_listing_id = $1 AND status IN ('pending', 'approved')`,
        [listingId],
      ),
    );

    if (existingRes.rows.length > 0) {
      return NextResponse.json(
        { error: 'CLAIM_ALREADY_EXISTS', message: 'Pro tento listing již existuje aktivní claim.' },
        { status: 409 },
      );
    }

    const claimRes = await runWithServiceContext(() =>
      db().query<{ id: string }>(
        `INSERT INTO orders.resale_guarantee_claims
           (resale_listing_id, buyer_order_id, reporter_user_id, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [listingId, listing.buyer_order_id, userId, reason],
      ),
    );

    return NextResponse.json({ claimId: claimRes.rows[0].id }, { status: 201 });
  });
}
