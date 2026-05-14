/**
 * POST /api/buyer/vouchers/lookup
 *
 * Body: { code: string, eventId?: string, promoterId?: string }
 *
 * Veřejný endpoint pro buyer — ověří voucher kód v checkoutu PŘED submit.
 * Vrátí balance + scope (event/promoter restriction).
 *
 * Nevyhazuje voucher status z DB (neuvádí balance pro promoter-side fraud).
 * Pokud kód existuje ALE neplatí na daný event/promoter, vrátí 422.
 */

import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({
  code: z.string().min(8).max(40),
  eventId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'BAD_INPUT' }, { status: 422 });
  }

  const code = parsed.data.code.trim().toUpperCase();

  const r = await db().query<{
    id: string;
    balance_halire: number;
    amount_halire: number;
    currency: string;
    promoter_id: string | null;
    event_id: string | null;
    expires_at: string | null;
  }>(
    `SELECT id, balance_halire, amount_halire, currency, promoter_id, event_id, expires_at
     FROM marketing.gift_vouchers
     WHERE code = $1`,
    [code],
  );

  if (r.rows.length === 0) {
    return NextResponse.json({ error: 'INVALID_CODE' }, { status: 404 });
  }
  const v = r.rows[0]!;

  if (v.expires_at && new Date(v.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'EXPIRED', expiredAt: v.expires_at }, { status: 410 });
  }
  if (v.balance_halire === 0) {
    return NextResponse.json({ error: 'DEPLETED' }, { status: 410 });
  }

  // Scope check: pokud voucher má event_id, musí match
  if (v.event_id && parsed.data.eventId && v.event_id !== parsed.data.eventId) {
    return NextResponse.json(
      { error: 'WRONG_EVENT', message: 'Tento poukaz platí jen na jinou akci.' },
      { status: 422 },
    );
  }

  // Pokud má voucher promoter_id a buyer poslal eventId, ověř že event je
  // u toho samého promotéra.
  if (v.promoter_id && parsed.data.eventId) {
    const ev = await db().query<{ promoter_id: string }>(
      `SELECT promoter_id FROM catalog.events WHERE id = $1`,
      [parsed.data.eventId],
    );
    if (ev.rows.length === 0 || ev.rows[0]!.promoter_id !== v.promoter_id) {
      return NextResponse.json(
        { error: 'WRONG_PROMOTER', message: 'Tento poukaz platí jen na akce jiného pořadatele.' },
        { status: 422 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    code,
    balanceHalire: v.balance_halire,
    amountHalire: v.amount_halire,
    currency: v.currency,
    expiresAt: v.expires_at,
  });
}
