/**
 * Promo code handler — validate, calculate, and atomically record usage.
 *
 * Called during order creation (inside the order transaction) to apply
 * a promo code and return the discount amount.
 *
 * All monetary values are INTEGER haléře. Never float.
 */

// ---------------------------------------------------------------------------
// Assumed DB schema (verify against promo-codes module):
//
// Table: marketing.promo_codes
//   id                          UUID PRIMARY KEY
//   code                        TEXT UNIQUE NOT NULL  -- always uppercase
//   type                        TEXT NOT NULL         -- 'percentage' | 'fixed' | 'bogo' | 'free'
//   discount_value              INTEGER NOT NULL      -- percentage (0-100) or haléře for fixed
//   max_uses                    INTEGER               -- NULL = unlimited
//   uses_count                  INTEGER NOT NULL DEFAULT 0
//   max_uses_per_user           INTEGER               -- NULL = unlimited
//   valid_from                  TIMESTAMPTZ NOT NULL
//   valid_until                 TIMESTAMPTZ           -- NULL = no expiry
//   min_quantity                INTEGER NOT NULL DEFAULT 1
//   min_order_amount            INTEGER NOT NULL DEFAULT 0   -- haléře
//   applicable_ticket_type_ids  UUID[]                -- NULL = all types
//   applicable_event_ids        UUID[]                -- NULL = all events
//   active                      BOOLEAN NOT NULL DEFAULT true
//   created_by_organizer_id     UUID NOT NULL
//   created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
//
// Table: marketing.promo_code_usages
//   id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
//   promo_code_id    UUID NOT NULL   -- cross-schema ref, no FK
//   order_id         UUID NOT NULL   -- cross-schema ref, no FK
//   user_id          UUID NOT NULL   -- cross-schema ref, no FK
//   discount_halire  INTEGER NOT NULL CHECK (discount_halire >= 0)
//   created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
// ---------------------------------------------------------------------------

import { randomUUID } from 'crypto';

// ---------------------------------------------------------------------------
// DB adapter (same interface as ticket-issuer.ts)
// ---------------------------------------------------------------------------

export interface DbAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApplyPromoCodeInput {
  code: string;
  orderId: string;
  userId: string;
  eventId: string;
  orderTotalHalire: number;
  /** Optional: ticket type IDs in the order — used for scope validation */
  ticketTypeIds?: string[];
  /** Optional: quantities per ticket type — used for bogo calculation */
  orderItems?: Array<{ ticketTypeId: string; quantity: number; unitPriceHalire: number }>;
}

export interface PromoCodeResult {
  applied: boolean;
  discountHalire: number;
  newTotalHalire: number;
  promoCodeId: string | null;
  /** Human-readable Czech reason when applied = false */
  reason?: string;
  /** Machine-readable reason code when applied = false */
  reasonCode?:
    | 'CODE_NOT_FOUND'
    | 'CODE_INACTIVE'
    | 'CODE_NOT_YET_ACTIVE'
    | 'CODE_EXPIRED'
    | 'CODE_USED_UP'
    | 'PER_USER_LIMIT_EXCEEDED'
    | 'EVENT_NOT_ELIGIBLE'
    | 'TICKET_TYPE_NOT_ELIGIBLE'
    | 'MIN_ORDER_NOT_MET';
}

// ---------------------------------------------------------------------------
// Internal DB row type
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
// Discount calculation (pure, integer haléře only)
// ---------------------------------------------------------------------------

function computeDiscount(
  pc: PromoCodeRow,
  totalHalire: number,
  orderItems: Array<{ ticketTypeId: string; quantity: number; unitPriceHalire: number }>,
): number {
  const applicableItems =
    pc.applicable_ticket_type_ids === null
      ? orderItems
      : orderItems.filter((i) => pc.applicable_ticket_type_ids!.includes(i.ticketTypeId));

  switch (pc.type) {
    case 'percentage':
      return Math.floor((totalHalire * pc.discount_value) / 100);

    case 'fixed': {
      const applicableTotal = applicableItems.reduce(
        (sum, i) => sum + i.quantity * i.unitPriceHalire,
        0,
      );
      return Math.min(pc.discount_value, applicableTotal > 0 ? applicableTotal : totalHalire);
    }

    case 'bogo': {
      // Every 2 units of applicable items → 1 free at unit price
      let discountAmount = 0;
      for (const item of applicableItems) {
        const freePieces = Math.floor(item.quantity / 2);
        discountAmount += freePieces * item.unitPriceHalire;
      }
      return discountAmount;
    }

    case 'free': {
      // All applicable items are free
      const applicableTotal = applicableItems.reduce(
        (sum, i) => sum + i.quantity * i.unitPriceHalire,
        0,
      );
      return Math.min(applicableTotal > 0 ? applicableTotal : totalHalire, totalHalire);
    }
  }
}

// ---------------------------------------------------------------------------
// applyPromoCode — main exported function
// ---------------------------------------------------------------------------

/**
 * Validate + apply a promo code to an order.
 *
 * Must be called inside the order creation transaction for atomicity.
 * Uses SELECT … FOR UPDATE to prevent race conditions on uses_count.
 *
 * Returns applied=false (never throws) for invalid codes so the caller can
 * decide whether to hard-fail or proceed without a discount.
 */
export async function applyPromoCode(
  input: ApplyPromoCodeInput,
  db: DbAdapter,
): Promise<PromoCodeResult> {
  const upperCode = input.code.trim().toUpperCase();

  const orderItems = input.orderItems ?? [];
  const ticketTypeIds = input.ticketTypeIds ?? orderItems.map((i) => i.ticketTypeId);

  return db.transaction(async (tx) => {
    // Step 1 — lock the promo code row to prevent concurrent double-use
    const rows = await tx.query<PromoCodeRow>(
      `SELECT
         id, code, type, discount_value,
         max_uses, uses_count, max_uses_per_user,
         valid_from, valid_until,
         min_quantity, min_order_amount,
         applicable_ticket_type_ids, applicable_event_ids,
         active
       FROM marketing.promo_codes
       WHERE code = $1
       FOR UPDATE`,
      [upperCode],
    );

    if (rows.length === 0) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: `Promo kód „${upperCode}" nenalezen`,
        reasonCode: 'CODE_NOT_FOUND',
      };
    }

    const pc = rows[0];
    const now = new Date();

    // Step 2 — validate all conditions

    if (!pc.active) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: 'Promo kód není aktivní',
        reasonCode: 'CODE_INACTIVE',
      };
    }

    if (now < new Date(pc.valid_from)) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: 'Promo kód ještě není platný',
        reasonCode: 'CODE_NOT_YET_ACTIVE',
      };
    }

    if (pc.valid_until !== null && now > new Date(pc.valid_until)) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: 'Platnost promo kódu vypršela',
        reasonCode: 'CODE_EXPIRED',
      };
    }

    if (pc.max_uses !== null && pc.uses_count >= pc.max_uses) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: 'Promo kód dosáhl maximálního počtu použití',
        reasonCode: 'CODE_USED_UP',
      };
    }

    // Per-user limit — query outside the lock (read-only)
    if (pc.max_uses_per_user !== null) {
      const usageRows = await tx.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt
         FROM marketing.promo_code_usages
         WHERE promo_code_id = $1 AND user_id = $2`,
        [pc.id, input.userId],
      );
      const userUseCount = parseInt(usageRows[0]?.cnt ?? '0', 10);
      if (userUseCount >= pc.max_uses_per_user) {
        return {
          applied: false,
          discountHalire: 0,
          newTotalHalire: input.orderTotalHalire,
          promoCodeId: null,
          reason: 'Překročen limit použití tohoto kódu pro váš účet',
          reasonCode: 'PER_USER_LIMIT_EXCEEDED',
        };
      }
    }

    // Event scope check
    if (pc.applicable_event_ids !== null && !pc.applicable_event_ids.includes(input.eventId)) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: 'Promo kód nelze použít pro tuto akci',
        reasonCode: 'EVENT_NOT_ELIGIBLE',
      };
    }

    // Ticket type scope check
    if (pc.applicable_ticket_type_ids !== null && ticketTypeIds.length > 0) {
      const hasApplicable = ticketTypeIds.some((id) =>
        pc.applicable_ticket_type_ids!.includes(id),
      );
      if (!hasApplicable) {
        return {
          applied: false,
          discountHalire: 0,
          newTotalHalire: input.orderTotalHalire,
          promoCodeId: null,
          reason: 'Promo kód nelze použít pro žádný z vybraných typů vstupenek',
          reasonCode: 'TICKET_TYPE_NOT_ELIGIBLE',
        };
      }
    }

    // Minimum order amount
    if (input.orderTotalHalire < pc.min_order_amount) {
      return {
        applied: false,
        discountHalire: 0,
        newTotalHalire: input.orderTotalHalire,
        promoCodeId: null,
        reason: `Minimální výše objednávky pro uplatnění kódu je ${(pc.min_order_amount / 100).toFixed(2).replace('.', ',')} Kč`,
        reasonCode: 'MIN_ORDER_NOT_MET',
      };
    }

    // Step 3 — calculate discount (integer haléře only)
    const discountHalire = computeDiscount(pc, input.orderTotalHalire, orderItems);
    const newTotalHalire = Math.max(0, input.orderTotalHalire - discountHalire);

    // Step 4 — atomically increment uses_count
    await tx.execute(
      `UPDATE marketing.promo_codes
       SET uses_count = uses_count + 1
       WHERE id = $1`,
      [pc.id],
    );

    // Step 5 — record usage
    await tx.execute(
      `INSERT INTO marketing.promo_code_usages
         (id, promo_code_id, order_id, user_id, discount_halire, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [randomUUID(), pc.id, input.orderId, input.userId, discountHalire],
    );

    return {
      applied: true,
      discountHalire,
      newTotalHalire,
      promoCodeId: pc.id,
    };
  });
}
