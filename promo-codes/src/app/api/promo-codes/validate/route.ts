import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  PromoCodeNotFoundError,
  PromoCodeValidationError,
} from '../../../../types/promo-code.types';
import { validatePromoCodeRules, calculateDiscount } from '../../../../lib/promo-calculator';

// Resolved via DI container in production
declare function getDbAdapter(): import('../../../../services/promo-code.service').DbAdapter;

// ─── Zod schema ───────────────────────────────────────────────────────────────

const OrderItemSchema = z.object({
  ticket_type_id: z.string().min(1),
  event_id: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price: z.number().int().nonnegative(),
});

const ValidateRequestSchema = z.object({
  code: z.string().min(4).max(20).regex(/^[A-Z0-9]+$/i),
  order_items: z.array(OrderItemSchema).min(1),
  user_id: z.string().min(1),
});

// ─── POST /api/promo-codes/validate ──────────────────────────────────────────

/**
 * Validates and previews the discount for a promo code.
 * Does NOT increment uses_count — that happens in the order-completion flow.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Neplatné JSON tělo požadavku' }, { status: 400 });
  }

  const parsed = ValidateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Neplatný formát požadavku', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { code, order_items, user_id } = parsed.data;
  const upperCode = code.toUpperCase();

  try {
    const db = getDbAdapter();
    const promoCode = await db.findPromoCode(upperCode);
    if (!promoCode) {
      return NextResponse.json({ error: 'Promo kód nenalezen' }, { status: 404 });
    }

    const userUsesCount = await db.getPromoCodeUsesCount(promoCode.id, user_id);

    // Validate rules — throws typed errors on violation
    validatePromoCodeRules(promoCode, { code: upperCode, order_items, user_id }, userUsesCount, new Date());

    const result = calculateDiscount(promoCode, { code: upperCode, order_items, user_id });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PromoCodeNotFoundError) {
      return NextResponse.json({ error: 'Promo kód nenalezen' }, { status: 404 });
    }
    if (err instanceof PromoCodeValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : 'Interní chyba serveru';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
