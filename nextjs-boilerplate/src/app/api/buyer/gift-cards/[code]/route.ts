/**
 * GET /api/buyer/gift-cards/[code] — ověření gift karty (veřejný endpoint, kód je tajemstvím)
 * Vrátí zbývající hodnotu, měnu, datum expirace, stav aktivní.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db, runWithServiceContext } from '@/lib/db/rls-pool';

export async function GET(
  _req: NextRequest,
  { params }: { params: { code: string } },
): Promise<Response> {
  const code = params.code.trim().toUpperCase();
  if (!code || code.length < 4) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }

  return runWithServiceContext(async () => {
    const r = await db().query<{
      remaining_value_halire: string;
      currency: string;
      expires_at: string | null;
      is_active: boolean;
    }>(
      `SELECT remaining_value_halire, currency, expires_at::text, is_active
         FROM platform.gift_cards
        WHERE code = $1`,
      [code],
    );

    if (r.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    const gc = r.rows[0];
    const isExpired =
      gc.expires_at !== null && new Date(gc.expires_at).getTime() < Date.now();

    return NextResponse.json({
      remainingValue: parseInt(gc.remaining_value_halire, 10),
      currency: gc.currency,
      expiresAt: gc.expires_at,
      isActive: gc.is_active && !isExpired,
    });
  });
}
