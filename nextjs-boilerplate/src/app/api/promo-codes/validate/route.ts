/**
 * POST /api/promo-codes/validate
 *
 * Validates a promo code for a given order without committing usage.
 * Called from the checkout UI when the customer types a code.
 * Actual redemption (incrementing uses_count + inserting usage row)
 * happens in applyPromoCode() during order creation.
 *
 * Body:
 *   { code: string, eventId: string, ticketTypeIds?: string[], totalHalire: number }
 *
 * Response (valid):
 *   { valid: true, code, discountType, discountValue, discountHalire, newTotalHalire }
 *
 * Response (invalid):
 *   { valid: false, reason: 'CODE_NOT_FOUND' | 'CODE_EXPIRED' | 'CODE_USED_UP' |
 *                            'CODE_NOT_YET_ACTIVE' | 'CODE_INACTIVE' |
 *                            'EVENT_NOT_ELIGIBLE' | 'TICKET_TYPE_NOT_ELIGIBLE' |
 *                            'MIN_ORDER_NOT_MET' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/rls-pool';

// ---------------------------------------------------------------------------
// DB row type — mirrors marketing.promo_codes table
// (created by promo-codes migration; schema: marketing)
// ---------------------------------------------------------------------------

interface PromoCodeRow {
  id: string;
  code: string;
  type: 'percentage' | 'fixed' | 'bogo' | 'free';
  discount_value: number;
  max_uses: number | null;
  uses_count: number;
  max_uses_per_user: number | null;
  valid_from: Date;
  valid_until: Date | null;
  min_quantity: number;
  min_order_amount: number;
  applicable_ticket_type_ids: string[] | null;
  applicable_event_ids: string[] | null;
  active: boolean;
}

// ---------------------------------------------------------------------------
// Discount calculation helpers (pure, integer halíře only)
// ---------------------------------------------------------------------------

function calcDiscountHalire(
  type: PromoCodeRow['type'],
  discountValue: number,
  totalHalire: number,
  ticketTypeIds: string[],
  applicableTicketTypeIds: string[] | null,
  unitPrices: Map<string, number>,
): number {
  switch (type) {
    case 'percentage':
      return Math.floor((totalHalire * discountValue) / 100);

    case 'fixed':
      return Math.min(discountValue, totalHalire);

    case 'bogo': {
      // Cannot determine free tickets without quantity; treat as 0 in preview
      // The full calculation runs in applyPromoCode with item-level data
      return 0;
    }

    case 'free': {
      // All applicable items become free — without quantity data, return 0
      // applyPromoCode handles the real calculation
      if (applicableTicketTypeIds === null) {
        return totalHalire;
      }
      // Return totalHalire as approximation when applicable types are requested
      const requestedApplicable = ticketTypeIds.filter((id) =>
        applicableTicketTypeIds.includes(id),
      );
      if (requestedApplicable.length === 0) return 0;
      // Sum prices of applicable types from provided unitPrices map
      let applicableTotal = 0;
      for (const id of requestedApplicable) {
        applicableTotal += unitPrices.get(id) ?? 0;
      }
      return Math.min(applicableTotal, totalHalire);
    }
  }
}

// ---------------------------------------------------------------------------
// Validation reasons (machine-readable)
// ---------------------------------------------------------------------------

type ValidationReason =
  | 'CODE_NOT_FOUND'
  | 'CODE_EXPIRED'
  | 'CODE_NOT_YET_ACTIVE'
  | 'CODE_USED_UP'
  | 'CODE_INACTIVE'
  | 'EVENT_NOT_ELIGIBLE'
  | 'TICKET_TYPE_NOT_ELIGIBLE'
  | 'MIN_ORDER_NOT_MET';

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { valid: false, reason: 'CODE_NOT_FOUND', message: 'Neplatné tělo požadavku' },
      { status: 400 },
    );
  }

  const parsed = body as Record<string, unknown>;
  const code = typeof parsed.code === 'string' ? parsed.code.trim().toUpperCase() : null;
  const eventId = typeof parsed.eventId === 'string' ? parsed.eventId : null;
  const totalHalire = typeof parsed.totalHalire === 'number' ? parsed.totalHalire : null;
  const ticketTypeIds: string[] =
    Array.isArray(parsed.ticketTypeIds)
      ? (parsed.ticketTypeIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];

  if (!code || !eventId || totalHalire === null || !Number.isInteger(totalHalire)) {
    return NextResponse.json(
      {
        valid: false,
        reason: 'CODE_NOT_FOUND' as ValidationReason,
        message: 'Chybí povinné parametry: code, eventId, totalHalire',
      },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      { valid: false, reason: 'CODE_NOT_FOUND', message: 'Interní chyba serveru' },
      { status: 500 },
    );
  }

  
  try {
    // Look up the promo code
    const rows = await db().query<PromoCodeRow>(
      `SELECT
         id, code, type, discount_value,
         max_uses, uses_count, max_uses_per_user,
         valid_from, valid_until,
         min_quantity, min_order_amount,
         applicable_ticket_type_ids, applicable_event_ids,
         active
       FROM marketing.promo_codes
       WHERE code = $1`,
      [code],
    );

    if (rows.rowCount === 0) {
      return NextResponse.json(
        { valid: false, reason: 'CODE_NOT_FOUND' as ValidationReason, message: 'Promo kód nenalezen' },
        { status: 200 },
      );
    }

    const pc = rows.rows[0];
    const now = new Date();

    // Active check
    if (!pc.active) {
      return NextResponse.json(
        { valid: false, reason: 'CODE_INACTIVE' as ValidationReason, message: 'Promo kód není aktivní' },
        { status: 200 },
      );
    }

    // Temporal window
    if (now < new Date(pc.valid_from)) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'CODE_NOT_YET_ACTIVE' as ValidationReason,
          message: 'Promo kód ještě není platný',
        },
        { status: 200 },
      );
    }

    if (pc.valid_until !== null && now > new Date(pc.valid_until)) {
      return NextResponse.json(
        { valid: false, reason: 'CODE_EXPIRED' as ValidationReason, message: 'Platnost promo kódu vypršela' },
        { status: 200 },
      );
    }

    // Global usage cap
    if (pc.max_uses !== null && pc.uses_count >= pc.max_uses) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'CODE_USED_UP' as ValidationReason,
          message: 'Promo kód dosáhl maximálního počtu použití',
        },
        { status: 200 },
      );
    }

    // Event scope check
    if (pc.applicable_event_ids !== null && !pc.applicable_event_ids.includes(eventId)) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'EVENT_NOT_ELIGIBLE' as ValidationReason,
          message: 'Promo kód nelze použít pro tuto akci',
        },
        { status: 200 },
      );
    }

    // Ticket type scope check (only when ticketTypeIds provided and code is scoped)
    if (
      pc.applicable_ticket_type_ids !== null &&
      ticketTypeIds.length > 0
    ) {
      const hasApplicable = ticketTypeIds.some((id) =>
        pc.applicable_ticket_type_ids!.includes(id),
      );
      if (!hasApplicable) {
        return NextResponse.json(
          {
            valid: false,
            reason: 'TICKET_TYPE_NOT_ELIGIBLE' as ValidationReason,
            message: 'Promo kód nelze použít pro žádný z vybraných typů vstupenek',
          },
          { status: 200 },
        );
      }
    }

    // Minimum order amount
    if (totalHalire < pc.min_order_amount) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'MIN_ORDER_NOT_MET' as ValidationReason,
          message: `Minimální výše objednávky pro uplatnění kódu je ${(pc.min_order_amount / 100).toFixed(2).replace('.', ',')} Kč`,
        },
        { status: 200 },
      );
    }

    // Calculate discount
    const discountHalire = calcDiscountHalire(
      pc.type,
      pc.discount_value,
      totalHalire,
      ticketTypeIds,
      pc.applicable_ticket_type_ids,
      new Map(), // no unit prices in this endpoint — bogo/free scoped use 0 approximation
    );
    const newTotalHalire = Math.max(0, totalHalire - discountHalire);

    return NextResponse.json(
      {
        valid: true,
        code: pc.code,
        discountType: pc.type,
        discountValue: pc.discount_value,
        discountHalire,
        newTotalHalire,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/promo-codes/validate] Error:', err);
    return NextResponse.json(
      { valid: false, reason: 'CODE_NOT_FOUND', message: 'Interní chyba serveru' },
      { status: 500 },
    );
  }
}
