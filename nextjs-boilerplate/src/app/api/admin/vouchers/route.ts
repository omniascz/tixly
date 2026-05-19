/**
 * GET  /api/admin/vouchers       — list promoter's vouchers
 * POST /api/admin/vouchers       — create voucher (with random code)
 *
 * Body POST: { amountKc, eventId?, issuedToEmail?, expiresAt?, count? }
 *
 * count > 1: vytvoří batch unikátních kódů (např. pro plošnou kampaň).
 * Generuje 12-character alphanumeric kód (no ambiguous chars).
 */

import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

// No 0/O, 1/I/l, no curse-prone substrings
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Format jako XXXX-XXXX-XXXX pro čitelnost
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}`;
}

const createSchema = z.object({
  amountKc: z.number().int().min(50).max(50000),
  eventId: z.string().uuid().optional(),
  issuedToEmail: z.string().email().max(320).optional(),
  expiresAt: z.string().datetime().optional(),
  count: z.number().int().min(1).max(100).default(1),
});

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const r = await db().query(
    `SELECT id, code, event_id, amount_halire, balance_halire, currency,
            issued_to_email, expires_at, fully_used_at, created_at
     FROM marketing.gift_vouchers
     WHERE promoter_id = $1
     ORDER BY created_at DESC
     LIMIT 200`,
    [promoter.promoterId],
  );

  return NextResponse.json({ vouchers: r.rows });
}

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter || promoter.status !== 'active') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'BAD_INPUT', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const amountHalire = parsed.data.amountKc * 100;

  // Verify event ownership pokud poskytnut
  if (parsed.data.eventId) {
    const own = await db().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM catalog.events
       WHERE id = $1 AND promoter_id = $2`,
      [parsed.data.eventId, promoter.promoterId],
    );
    if (Number(own.rows[0]?.count ?? 0) === 0) {
      return NextResponse.json({ error: 'EVENT_NOT_OWNED' }, { status: 403 });
    }
  }

  const codes: string[] = [];
  for (let i = 0; i < parsed.data.count; i++) {
    let attempt = 0;
    while (attempt < 5) {
      const code = generateCode();
      try {
        await db().query(
          `INSERT INTO marketing.gift_vouchers
             (code, promoter_id, event_id, amount_halire, balance_halire,
              issued_to_email, issued_by_user, expires_at)
           VALUES ($1, $2, $3, $4, $4, $5, $6, $7::timestamptz)`,
          [
            code,
            promoter.promoterId,
            parsed.data.eventId ?? null,
            amountHalire,
            parsed.data.issuedToEmail ?? null,
            promoter.userId,
            parsed.data.expiresAt ?? null,
          ],
        );
        codes.push(code);
        break;
      } catch (err) {
        const e = err as { code?: string };
        if (e.code === '23505') {
          attempt += 1;
          continue;
        }
        throw err;
      }
    }
  }

  return NextResponse.json({ ok: true, codes });
}
