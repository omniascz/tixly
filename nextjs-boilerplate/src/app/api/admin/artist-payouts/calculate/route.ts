/**
 * POST /api/admin/artist-payouts/calculate
 * Spočítá nevyplacené royalty za zvolené období a vytvoří payout dávky.
 *
 * Body:
 *   periodFrom: string (ISO date)
 *   periodTo: string (ISO date)
 *   agreementIds?: string[]  — omezení na konkrétní smlouvy (default: všechny aktivní)
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';
import { runAsPromoter } from '@/lib/admin-auth';
import { computePayoutTotal } from '@/lib/royalties/compute';
import type { RoyaltyAgreement } from '@/lib/royalties/compute';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (ctx) => {
    const b = await req.json() as {
      periodFrom?: string;
      periodTo?: string;
      agreementIds?: string[];
    };

    const periodFrom = b.periodFrom ? new Date(b.periodFrom) : new Date(Date.now() - 30 * 86400_000);
    const periodTo   = b.periodTo   ? new Date(b.periodTo)   : new Date();

    if (isNaN(periodFrom.getTime()) || isNaN(periodTo.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }

    // Načíst aktivní smlouvy + součty z ledgeru za období
    const agreeR = await runWithServiceContext(() =>
      db().query(
        `SELECT a.id, a.event_id, a.artist_name, a.artist_email,
                a.bank_iban, a.bank_bic, a.currency,
                a.royalty_type, a.percent_rate, a.flat_amount_halire,
                a.per_ticket_halire, a.min_guarantee_halire, a.cap_halire,
                COALESCE(SUM(l.royalty_amount_halire), 0)::int AS ledger_sum
         FROM lineups.royalty_agreements a
         LEFT JOIN lineups.royalty_ledger l
           ON l.agreement_id = a.id
           AND l.created_at >= $2
           AND l.created_at < $3
         WHERE a.promoter_id = $1
           AND a.status = 'active'
           ${b.agreementIds && b.agreementIds.length > 0 ? `AND a.id = ANY($4::uuid[])` : ''}
         GROUP BY a.id`,
        b.agreementIds && b.agreementIds.length > 0
          ? [ctx.promoterId, periodFrom.toISOString(), periodTo.toISOString(), b.agreementIds]
          : [ctx.promoterId, periodFrom.toISOString(), periodTo.toISOString()],
      ),
    );

    if (agreeR.rows.length === 0) {
      return NextResponse.json({ created: 0, payouts: [] });
    }

    const created: object[] = [];

    for (const row of agreeR.rows as Array<RoyaltyAgreement & {
      id: string; event_id: string; artist_name: string; artist_email: string | null;
      bank_iban: string | null; bank_bic: string | null; currency: string | null;
      ledger_sum: number;
    }>) {
      const netHalire = computePayoutTotal(row, row.ledger_sum);
      if (netHalire <= 0) continue; // nic k vyplacení

      const ins = await runWithServiceContext(() =>
        db().query(
          `INSERT INTO lineups.artist_payouts
             (agreement_id, promoter_id, artist_name, artist_email,
              bank_iban, bank_bic, period_from, period_to,
              gross_royalties_halire, net_payout_halire,
              currency, status, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
           RETURNING id, artist_name, net_payout_halire, currency`,
          [
            row.id, ctx.promoterId, row.artist_name,
            row.artist_email ?? null, row.bank_iban ?? null, row.bank_bic ?? null,
            periodFrom.toISOString(), periodTo.toISOString(),
            row.ledger_sum, netHalire,
            row.currency ?? 'CZK', ctx.userId,
          ],
        ),
      );
      created.push(ins.rows[0]);
    }

    return NextResponse.json({ created: created.length, payouts: created });
  });
}
