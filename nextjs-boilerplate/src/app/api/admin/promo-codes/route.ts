/**
 * GET /api/admin/promo-codes — seznam kódů promotéra
 * POST /api/admin/promo-codes — vytvoření kódu
 *
 * Auth: middleware ověří JWT, route requirePromoter().
 * Pro demo zjednodušujeme — typy: percentage (1-100), fixed (haléře).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';
import { runAsPromoter, runAsActivePromoter } from '@/lib/admin-auth';
import { z } from 'zod';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit/per-tenant';


interface PromoCodeRow {
  id: string;
  code: string;
  type: string;
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  valid_from: string;
  valid_until: string | null;
  active: boolean;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<PromoCodeRow>(
    `SELECT id, code, type, discount_value, max_uses, uses_count,
            valid_from, valid_until, active, created_at
     FROM marketing.promo_codes
     WHERE created_by_organizer_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [promoter.promoterId],
  );
  return NextResponse.json({
    codes: r.rows.map((row) => ({
      id: row.id,
      code: row.code,
      type: row.type,
      discountValue: row.discount_value,
      maxUses: row.max_uses,
      usesCount: row.uses_count,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      active: row.active,
      createdAt: row.created_at,
    })),
  });

  });
}

const createSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/i, 'kód: A–Z, 0–9, _, -'),
  type: z.enum(['percentage', 'fixed']),
  // pro percentage: 1-100; pro fixed: haléře
  discountValue: z.number().int().min(1),
  maxUses: z.number().int().min(1).max(100_000).nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const rl = checkRateLimit(`${promoter.promoterId}:promo-create`, {
    limit: 30,
    windowMs: 60_000,
  });
  const rlResp = rateLimitResponse(rl, 'promo-create');
  if (rlResp) return rlResp;

  const body: unknown = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const input = parsed.data;
  if (input.type === 'percentage' && (input.discountValue < 1 || input.discountValue > 100)) {
    return NextResponse.json(
      { error: 'percentage discount must be 1–100' },
      { status: 422 },
    );
  }

  try {
    const r = await db().query<{ id: string; code: string }>(
      `INSERT INTO marketing.promo_codes
         (code, type, discount_value, max_uses, valid_until,
          created_by_organizer_id, active)
       VALUES (UPPER($1), $2, $3, $4, $5, $6, TRUE)
       RETURNING id, code`,
      [
        input.code,
        input.type,
        input.discountValue,
        input.maxUses ?? null,
        input.validUntil ?? null,
        promoter.promoterId,
      ],
    );
    return NextResponse.json(
      { id: r.rows[0].id, code: r.rows[0].code },
      { status: 201 },
    );
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      return NextResponse.json({ error: 'CODE_ALREADY_EXISTS' }, { status: 409 });
    }
    console.error('[POST /api/admin/promo-codes]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  });
}
