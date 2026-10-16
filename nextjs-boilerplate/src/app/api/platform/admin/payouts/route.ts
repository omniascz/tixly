/**
 * GET /api/platform/admin/payouts?status=awaiting_manual_transfer — výplaty pořadatelům pro platform admina.
 * Kolo 7 (C-57): podklad pro ruční převod (IBAN, částka, VS) a potvrzení převodu.
 */
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPlatformAdmin } from '@/lib/platform-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async () => {
    const status = req.nextUrl.searchParams.get('status');
    const r = await db().query(
      `SELECT py.id, py.promoter_id, p.name AS promoter_name, p.iban, py.period_from, py.period_to,
              py.net_payout, py.platform_fees, py.currency, py.status, py.payout_provider,
              py.bank_reference, py.transfer_date::text AS transfer_date, py.paid_at, py.failure_reason,
              u.email AS confirmed_by_email
         FROM platform.payouts py
         JOIN platform.promoters p ON p.id = py.promoter_id
         LEFT JOIN identity.users u ON u.id = py.transfer_confirmed_by
        WHERE ($1::text IS NULL OR py.status = $1)
        ORDER BY (py.status = 'awaiting_manual_transfer') DESC, py.period_to DESC
        LIMIT 500`,
      [status],
    );
    return NextResponse.json({ payouts: r.rows });
  });
}
