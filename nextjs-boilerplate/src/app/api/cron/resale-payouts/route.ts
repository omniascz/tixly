/**
 * GET /api/cron/resale-payouts
 *
 * Eventim-style 4-day payout processor. Najde resale.seller_payouts
 * s scheduled_for <= now() a status IN (pending, eligible), provede payout.
 *
 * Skeleton: pro mock režim jen označí jako 'paid' s external_payout_id = 'mock-...'.
 * Production by routovala přes Fio / Wise / Stripe Connect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';


export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<Response> {
  return runWithServiceContext(async () => {

  const isVercelCron = req.headers.get('x-vercel-cron') !== null;
  const secret = req.headers.get('x-cron-secret');
  if (!isVercelCron && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const eligible = await db().query<{
    id: string;
    seller_id: string;
    payout_halire: number;
    currency: string;
    bank_iban: string | null;
  }>(
    `SELECT id, seller_id, payout_halire, currency, bank_iban
       FROM resale.seller_payouts
      WHERE status IN ('pending', 'eligible')
        AND scheduled_for <= now()
      ORDER BY scheduled_for
      LIMIT 100
      FOR UPDATE SKIP LOCKED`,
  );

  const results = {
    processed: 0,
    paid: 0,
    failed: 0,
    skipped_no_iban: 0,
  };

  const provider = process.env.PAYOUT_PROVIDER ?? 'mock';

  for (const payout of eligible.rows) {
    results.processed++;

    if (!payout.bank_iban) {
      await db().query(
        `UPDATE resale.seller_payouts
            SET status = 'failed',
                failure_reason = 'no_iban_on_seller_account',
                updated_at = now()
          WHERE id = $1`,
        [payout.id],
      );
      results.skipped_no_iban++;
      continue;
    }

    try {
      // Provider call — skeleton
      const externalPayoutId = provider === 'mock'
        ? `mock-payout-${payout.id.slice(0, 8)}-${Date.now()}`
        : await callPayoutProvider(provider, payout);

      await db().query(
        `UPDATE resale.seller_payouts
            SET status = 'paid', paid_at = now(),
                external_payout_id = $1, updated_at = now()
          WHERE id = $2`,
        [externalPayoutId, payout.id],
      );
      results.paid++;
    } catch (e) {
      await db().query(
        `UPDATE resale.seller_payouts
            SET status = 'failed',
                failure_reason = $1,
                updated_at = now()
          WHERE id = $2`,
        [(e as Error).message.slice(0, 500), payout.id],
      );
      results.failed++;
    }
  }

  return NextResponse.json({
    ok: true,
    runAt: new Date().toISOString(),
    ...results,
  });

  });
}

async function callPayoutProvider(
  provider: string,
  _payout: { id: string; bank_iban: string | null; payout_halire: number; currency: string },
): Promise<string> {
  if (provider === 'fio') {
    // SKELETON — production by routovala Fio Bank API
    throw new Error('FIO_PROVIDER_NOT_IMPLEMENTED');
  }
  if (provider === 'stripe_connect') {
    throw new Error('STRIPE_CONNECT_NOT_IMPLEMENTED');
  }
  throw new Error(`UNKNOWN_PROVIDER_${provider}`);
}
