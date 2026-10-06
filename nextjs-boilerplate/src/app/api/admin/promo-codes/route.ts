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
  applicable_category_codes: string[] | null;
  applicable_ticket_type_ids: string[] | null;
  applicable_event_ids: string[] | null;
  zone_names: string[] | null;
  event_names: string[] | null;
  category_names: string[] | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
  const r = await db().query<PromoCodeRow>(
    `SELECT id, code, type, discount_value, max_uses, uses_count,
            valid_from, valid_until, active, created_at,
            applicable_category_codes, applicable_ticket_type_ids, applicable_event_ids,
            -- kolo 9: názvy zón a termínů pro přehled omezení v administraci
            (SELECT array_agg(COALESCE(tt.zone, tt.name) ORDER BY tt.base_price DESC) FROM catalog.ticket_types tt
              WHERE tt.id = ANY(promo_codes.applicable_ticket_type_ids)) AS zone_names,
            (SELECT array_agg(e.title || ' ' || to_char(e.date_start AT TIME ZONE 'Europe/Prague', 'DD.MM.YYYY HH24:MI') ORDER BY e.date_start)
               FROM catalog.events e WHERE e.id = ANY(promo_codes.applicable_event_ids)) AS event_names,
            -- kolo 12: názvy slevových kategorií (v přehledu se dřív ukazoval kód, např. „senior")
            (SELECT array_agg(DISTINCT pc.name) FROM catalog.price_categories pc
              WHERE pc.promoter_id = promo_codes.created_by_organizer_id AND pc.code = ANY(promo_codes.applicable_category_codes)) AS category_names
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
      applicableCategoryCodes: row.applicable_category_codes ?? [],
      applicableTicketTypeIds: row.applicable_ticket_type_ids ?? [],
      applicableEventIds: row.applicable_event_ids ?? [],
      zoneNames: row.zone_names ?? [],
      eventNames: row.event_names ?? [],
      categoryNames: row.category_names ?? [],
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
  // Kolo 8 / krok 4: omezení na slevové kategorie (kódy), zóny (typy vstupenek) a termíny
  applicableCategoryCodes: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).max(20).optional(),
  applicableTicketTypeIds: z.array(z.string().uuid()).max(50).optional(),
  applicableEventIds: z.array(z.string().uuid()).max(50).optional(),
});

export async function POST(req: NextRequest): Promise<Response> {
  return runAsActivePromoter(req, async (promoter) => {
  const rl = await checkRateLimit(`${promoter.promoterId}:promo-create`, {
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

  // Kolo 9: omezení smí odkazovat jen na vlastní termíny a jejich zóny (typy vstupenek)
  const evIds = input.applicableEventIds ?? [];
  const ttIds = input.applicableTicketTypeIds ?? [];
  if (evIds.length || ttIds.length) {
    const own = (await db().query<{ ev: number; tt: number }>(
      `SELECT (SELECT COUNT(*) FROM catalog.events WHERE id = ANY($1::uuid[]) AND promoter_id = $3)::int AS ev,
              (SELECT COUNT(*) FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id
                WHERE tt.id = ANY($2::uuid[]) AND e.promoter_id = $3)::int AS tt`,
      [evIds, ttIds, promoter.promoterId],
    )).rows[0];
    if (own.ev !== new Set(evIds).size || own.tt !== new Set(ttIds).size) {
      return NextResponse.json({ error: 'RESTRICTION_NOT_OWNED', message: 'Omezení odkazuje na cizí termín nebo zónu.' }, { status: 422 });
    }
  }

  try {
    const r = await db().query<{ id: string; code: string }>(
      `INSERT INTO marketing.promo_codes
         (code, type, discount_value, max_uses, valid_until,
          created_by_organizer_id, active, applicable_category_codes, applicable_ticket_type_ids, applicable_event_ids)
       VALUES (UPPER($1), $2, $3, $4, $5, $6, TRUE, $7, $8, $9)
       RETURNING id, code`,
      [
        input.code,
        input.type,
        input.discountValue,
        input.maxUses ?? null,
        input.validUntil ?? null,
        promoter.promoterId,
        input.applicableCategoryCodes?.length ? input.applicableCategoryCodes : null,
        input.applicableTicketTypeIds?.length ? input.applicableTicketTypeIds : null,
        input.applicableEventIds?.length ? input.applicableEventIds : null,
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
