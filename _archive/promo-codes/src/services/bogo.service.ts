// =============================================================================
// BOGO Service — Buy-One-Get-One Promo Rules
// Feature #162: Conditional quantity discount rules
//
// Examples:
//   Buy 2 tickets → 1 free  (trigger_qty=2, free_qty=1, discount_pct=null → 100% off)
//   Buy 3 → pay for 2       (trigger_qty=3, free_qty=1, discount_pct=null)
//   Buy 4 → 25% off all     (trigger_qty=4, free_qty=4, discount_pct=25)
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface BogoRule {
  id: string;
  promoterId: string;
  eventId: string;
  name: string;
  description: string | null;
  triggerQty: number;
  freeQty: number;
  maxFreeTickets: number | null;
  appliesToTicketTypeIds: string[];
  discountPct: number | null;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
}

export interface BogoApplyResult {
  ruleId: string;
  ruleName: string;
  paidQty: number;
  freeQtyGranted: number;
  discountHellers: number;
}

interface RuleRow {
  id: string;
  promoter_id: string;
  event_id: string;
  name: string;
  description: string | null;
  trigger_qty: number;
  free_qty: number;
  max_free_tickets: number | null;
  applies_to_ticket_type_ids: string[];
  discount_pct: string | null;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  created_at: string;
}

function mapRule(r: RuleRow): BogoRule {
  return {
    id: r.id,
    promoterId: r.promoter_id,
    eventId: r.event_id,
    name: r.name,
    description: r.description,
    triggerQty: r.trigger_qty,
    freeQty: r.free_qty,
    maxFreeTickets: r.max_free_tickets,
    appliesToTicketTypeIds: r.applies_to_ticket_type_ids,
    discountPct: r.discount_pct !== null ? parseFloat(r.discount_pct) : null,
    isActive: r.is_active,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    createdAt: r.created_at,
  };
}

/**
 * Create a BOGO rule.
 */
export async function createBogoRule(
  input: {
    promoterId: string;
    eventId: string;
    name: string;
    description?: string;
    triggerQty: number;
    freeQty: number;
    maxFreeTickets?: number;
    appliesToTicketTypeIds?: string[];
    discountPct?: number;
    validFrom?: string;
    validUntil?: string;
  },
  db: DbAdapter,
): Promise<BogoRule> {
  if (!input.name.trim()) throw new Error('VALIDATION_ERROR: name is required');
  if (input.triggerQty < 1) throw new Error('VALIDATION_ERROR: triggerQty must be >= 1');
  if (input.freeQty < 1) throw new Error('VALIDATION_ERROR: freeQty must be >= 1');
  if (input.discountPct !== undefined && (input.discountPct <= 0 || input.discountPct > 100)) {
    throw new Error('VALIDATION_ERROR: discountPct must be between 0 and 100');
  }

  const rows = await db.query<RuleRow>(
    `INSERT INTO promo.bogo_rules
       (promoter_id, event_id, name, description, trigger_qty, free_qty,
        max_free_tickets, applies_to_ticket_type_ids, discount_pct, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      input.promoterId,
      input.eventId,
      input.name,
      input.description ?? null,
      input.triggerQty,
      input.freeQty,
      input.maxFreeTickets ?? null,
      input.appliesToTicketTypeIds ?? [],
      input.discountPct ?? null,
      input.validFrom ?? null,
      input.validUntil ?? null,
    ],
  );

  return mapRule(rows[0]);
}

/**
 * Calculate BOGO discount for a cart.
 * Returns the best applicable rule result (most savings).
 */
export function calculateBogoDiscount(
  rule: BogoRule,
  cartItems: Array<{ ticketTypeId: string; qty: number; unitPriceHellers: number }>,
): BogoApplyResult | null {
  // Filter items to those the rule applies to
  const eligible = rule.appliesToTicketTypeIds.length === 0
    ? cartItems
    : cartItems.filter((item) => rule.appliesToTicketTypeIds.includes(item.ticketTypeId));

  const totalQty = eligible.reduce((sum, item) => sum + item.qty, 0);

  if (totalQty < rule.triggerQty) return null;

  // How many free tickets: floor(totalQty / triggerQty) * freeQty
  const groups = Math.floor(totalQty / rule.triggerQty);
  let freeQty = groups * rule.freeQty;

  if (rule.maxFreeTickets !== null) {
    freeQty = Math.min(freeQty, rule.maxFreeTickets);
  }

  if (freeQty === 0) return null;

  // Expand each cart item into individual unit prices, then sort ascending
  // (give away the cheapest free tickets, maximizing savings for buyer)
  const unitPrices: number[] = [];
  for (const item of eligible) {
    for (let q = 0; q < item.qty; q++) {
      unitPrices.push(item.unitPriceHellers);
    }
  }
  unitPrices.sort((a, b) => a - b);

  const discountPct = rule.discountPct ?? 100;

  let discountHellers = 0;
  for (let i = 0; i < freeQty && i < unitPrices.length; i++) {
    discountHellers += Math.round((unitPrices[i] * discountPct) / 100);
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    paidQty: totalQty,
    freeQtyGranted: freeQty,
    discountHellers,
  };
}

/**
 * Apply BOGO rules to an order. Returns the best (largest) discount.
 * Logs the usage.
 */
export async function applyBogoRules(
  eventId: string,
  orderId: string,
  cartItems: Array<{ ticketTypeId: string; qty: number; unitPriceHellers: number }>,
  db: DbAdapter,
): Promise<BogoApplyResult | null> {
  const rules = await db.query<RuleRow>(
    `SELECT * FROM promo.bogo_rules
     WHERE event_id = $1
       AND is_active = true
       AND (valid_from IS NULL OR valid_from <= NOW())
       AND (valid_until IS NULL OR valid_until >= NOW())`,
    [eventId],
  );

  let bestResult: BogoApplyResult | null = null;

  for (const ruleRow of rules) {
    const result = calculateBogoDiscount(mapRule(ruleRow), cartItems);
    if (result && (!bestResult || result.discountHellers > bestResult.discountHellers)) {
      bestResult = result;
    }
  }

  if (bestResult) {
    await db.execute(
      `INSERT INTO promo.bogo_usages (rule_id, order_id, paid_qty, free_qty_granted, discount_hellers)
       VALUES ($1, $2, $3, $4, $5)`,
      [bestResult.ruleId, orderId, bestResult.paidQty, bestResult.freeQtyGranted, bestResult.discountHellers],
    );
  }

  return bestResult;
}

/**
 * List BOGO rules for an event.
 */
export async function listBogoRules(
  eventId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<BogoRule[]> {
  const rows = await db.query<RuleRow>(
    `SELECT * FROM promo.bogo_rules
     WHERE event_id = $1 AND promoter_id = $2
     ORDER BY created_at DESC`,
    [eventId, promoterId],
  );
  return rows.map(mapRule);
}

/**
 * Deactivate a BOGO rule.
 */
export async function deactivateBogoRule(
  ruleId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `UPDATE promo.bogo_rules SET is_active = false WHERE id = $1 AND promoter_id = $2 RETURNING id`,
    [ruleId, promoterId],
  );
  if (!rows[0]) throw new Error('RULE_NOT_FOUND');
}
