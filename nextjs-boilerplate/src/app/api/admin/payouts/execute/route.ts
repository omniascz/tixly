/**
 * POST /api/admin/payouts/execute
 *
 * Manual trigger: platform admin spustí execution vybrané výplaty.
 * Používá stejný executor jako cron.
 *
 * Body: { payoutId: string }
 *
 * Auth: platform admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { executePayout } from '@/lib/payouts/executor';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const userId = req.headers.get('x-user-id');
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Platform admin check
  const adminRes = await db().query<{ is_platform_admin: boolean }>(
    `SELECT is_platform_admin FROM identity.users WHERE id = $1`,
    [userId],
  );
  if (!adminRes.rows[0]?.is_platform_admin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { payoutId?: string };
  if (!body.payoutId) return NextResponse.json({ error: 'payoutId required' }, { status: 400 });

  const payoutRes = await db().query<{
    payout_id: string;
    promoter_id: string;
    net_payout: number;
    currency: string;
    retry_count: number;
    promoter_name: string;
    iban: string | null;
    swift_bic: string | null;
    payout_method: string | null;
    payout_currency: string | null;
    wise_recipient_id: number | null;
    paypal_payout_email: string | null;
  }>(
    `SELECT
       py.id AS payout_id, py.promoter_id, py.net_payout, py.currency, py.retry_count,
       p.name AS promoter_name, p.iban, p.swift_bic, p.payout_method,
       p.payout_currency, p.wise_recipient_id, p.paypal_payout_email
     FROM platform.payouts py
     JOIN platform.promoters p ON p.id = py.promoter_id
     WHERE py.id = $1 AND py.status IN ('pending', 'failed')`,
    [body.payoutId],
  );

  if (payoutRes.rows.length === 0) {
    return NextResponse.json({ error: 'Payout not found or not executable' }, { status: 404 });
  }

  const result = await executePayout(payoutRes.rows[0]);
  return NextResponse.json({ ok: true, ...result });
}
