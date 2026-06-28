/**
 * GET /api/admin/artist-payouts — seznam výplat umělců (promoter scope)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const r = await runWithServiceContext(() =>
      db().query(
        `SELECT p.id, p.artist_name, p.artist_email, p.bank_iban,
                p.period_from, p.period_to,
                p.gross_royalties_halire, p.adjustments_halire, p.net_payout_halire,
                p.currency, p.status, p.paid_at, p.payout_method,
                p.external_ref, p.notes, p.created_at,
                a.event_id, e.title AS event_title
         FROM lineups.artist_payouts p
         JOIN lineups.royalty_agreements a ON a.id = p.agreement_id
         JOIN catalog.events e ON e.id = a.event_id
         WHERE p.promoter_id=$1
         ORDER BY p.created_at DESC
         LIMIT 200`,
        [ctx.promoterId],
      ),
    );
    return NextResponse.json({ payouts: r.rows });
  });
}
