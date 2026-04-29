// =============================================================================
// Resale Rules Service — Artist-Controlled Resale Configuration
// Feature #38: Per-event granular resale rules: allow/block, price cap, max transfers
//
// Relationship to existing resale-listing.service:
//   - resale-listing uses a hardcoded 1.10x (110%) cap (EU Directive 2019/771)
//   - This service allows per-event overrides: artist can set tighter cap or block entirely
//   - resale-listing will check these rules before accepting new listings
// =============================================================================

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
}

export interface ResaleRules {
  id: string;
  eventId: string;
  promoterId: string;
  resaleAllowed: boolean;
  priceCappct: number | null;       // % of face value; null = use platform default (110%)
  maxTransfersPerTicket: number | null;  // null = unlimited
  requireIdMatch: boolean;
  blockReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResaleRulesOverride {
  id: string;
  resaleRuleId: string;
  ticketTypeId: string;
  resaleAllowed: boolean | null;
  priceCappct: number | null;
  maxTransfersPerTicket: number | null;
}

export interface SetResaleRulesInput {
  resaleAllowed?: boolean;
  priceCappct?: number | null;
  maxTransfersPerTicket?: number | null;
  requireIdMatch?: boolean;
  blockReason?: string | null;
}

interface RulesRow {
  id: string;
  event_id: string;
  promoter_id: string;
  resale_allowed: boolean;
  price_cap_pct: string | null;
  max_transfers_per_ticket: number | null;
  require_id_match: boolean;
  block_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface OverrideRow {
  id: string;
  resale_rule_id: string;
  ticket_type_id: string;
  resale_allowed: boolean | null;
  price_cap_pct: string | null;
  max_transfers_per_ticket: number | null;
}

function mapRules(r: RulesRow): ResaleRules {
  return {
    id: r.id,
    eventId: r.event_id,
    promoterId: r.promoter_id,
    resaleAllowed: r.resale_allowed,
    priceCappct: r.price_cap_pct !== null ? parseFloat(r.price_cap_pct) : null,
    maxTransfersPerTicket: r.max_transfers_per_ticket,
    requireIdMatch: r.require_id_match,
    blockReason: r.block_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapOverride(r: OverrideRow): ResaleRulesOverride {
  return {
    id: r.id,
    resaleRuleId: r.resale_rule_id,
    ticketTypeId: r.ticket_type_id,
    resaleAllowed: r.resale_allowed,
    priceCappct: r.price_cap_pct !== null ? parseFloat(r.price_cap_pct) : null,
    maxTransfersPerTicket: r.max_transfers_per_ticket,
  };
}

/** Platform default price cap: 110% of face value (EU Directive 2019/771) */
export const PLATFORM_DEFAULT_CAP_PCT = 110.0;

/**
 * Set (upsert) resale rules for an event.
 */
export async function setResaleRules(
  eventId: string,
  promoterId: string,
  input: SetResaleRulesInput,
  db: DbAdapter,
): Promise<ResaleRules> {
  // Validate price cap
  if (input.priceCappct !== undefined && input.priceCappct !== null) {
    if (input.priceCappct > PLATFORM_DEFAULT_CAP_PCT) {
      throw new Error(`VALIDATION_ERROR: price cap cannot exceed platform maximum of ${PLATFORM_DEFAULT_CAP_PCT}%`);
    }
    if (input.priceCappct <= 0) {
      throw new Error('VALIDATION_ERROR: price cap must be positive');
    }
  }

  if (input.maxTransfersPerTicket !== undefined && input.maxTransfersPerTicket !== null) {
    if (input.maxTransfersPerTicket < 1) {
      throw new Error('VALIDATION_ERROR: maxTransfersPerTicket must be at least 1');
    }
  }

  const rows = await db.query<RulesRow>(
    `INSERT INTO resale.resale_rules
       (event_id, promoter_id, resale_allowed, price_cap_pct, max_transfers_per_ticket, require_id_match, block_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO UPDATE SET
       resale_allowed = EXCLUDED.resale_allowed,
       price_cap_pct = EXCLUDED.price_cap_pct,
       max_transfers_per_ticket = EXCLUDED.max_transfers_per_ticket,
       require_id_match = EXCLUDED.require_id_match,
       block_reason = EXCLUDED.block_reason,
       updated_at = NOW()
     RETURNING *`,
    [
      eventId,
      promoterId,
      input.resaleAllowed ?? true,
      input.priceCappct ?? null,
      input.maxTransfersPerTicket ?? null,
      input.requireIdMatch ?? false,
      input.blockReason ?? null,
    ],
  );

  return mapRules(rows[0]);
}

/**
 * Get resale rules for an event.
 */
export async function getResaleRules(
  eventId: string,
  db: DbAdapter,
): Promise<ResaleRules | null> {
  const rows = await db.query<RulesRow>(
    `SELECT * FROM resale.resale_rules WHERE event_id = $1`,
    [eventId],
  );
  return rows[0] ? mapRules(rows[0]) : null;
}

/**
 * Check if a resale listing is allowed for a given ticket.
 * Returns the effective rules (event-level or ticket-type override).
 */
export async function checkResaleAllowed(
  eventId: string,
  ticketTypeId: string,
  transferCount: number,
  askPriceHellers: number,
  faceValueHellers: number,
  db: DbAdapter,
): Promise<{ allowed: boolean; reason: string | null; effectiveCapPct: number }> {
  const rules = await getResaleRules(eventId, db);

  // No custom rules = platform defaults apply (resale allowed, 110% cap)
  if (!rules) {
    const capPct = PLATFORM_DEFAULT_CAP_PCT;
    const maxAllowed = Math.floor(faceValueHellers * (capPct / 100));
    if (askPriceHellers > maxAllowed) {
      return { allowed: false, reason: `PRICE_CAP_EXCEEDED: max ${capPct}% of face value`, effectiveCapPct: capPct };
    }
    return { allowed: true, reason: null, effectiveCapPct: capPct };
  }

  if (!rules.resaleAllowed) {
    return { allowed: false, reason: rules.blockReason ?? 'RESALE_BLOCKED', effectiveCapPct: 0 };
  }

  // Check ticket-type override
  const overrideRows = await db.query<OverrideRow>(
    `SELECT * FROM resale.resale_rules_overrides
     WHERE resale_rule_id = $1 AND ticket_type_id = $2`,
    [rules.id, ticketTypeId],
  );

  const override = overrideRows[0] ? mapOverride(overrideRows[0]) : null;

  // Resolve effective values (override → event-rule → platform default)
  const effectiveAllowed = override?.resaleAllowed ?? rules.resaleAllowed;
  const effectiveCapPct = override?.priceCappct ?? rules.priceCappct ?? PLATFORM_DEFAULT_CAP_PCT;
  const effectiveMaxTransfers = override?.maxTransfersPerTicket ?? rules.maxTransfersPerTicket;

  if (!effectiveAllowed) {
    return { allowed: false, reason: rules.blockReason ?? 'RESALE_BLOCKED', effectiveCapPct: 0 };
  }

  if (effectiveMaxTransfers !== null && transferCount >= effectiveMaxTransfers) {
    return {
      allowed: false,
      reason: `MAX_TRANSFERS_EXCEEDED: max ${effectiveMaxTransfers} transfers per ticket`,
      effectiveCapPct,
    };
  }

  const maxAllowed = Math.floor(faceValueHellers * (effectiveCapPct / 100));
  if (askPriceHellers > maxAllowed) {
    return {
      allowed: false,
      reason: `PRICE_CAP_EXCEEDED: max ${effectiveCapPct}% of face value`,
      effectiveCapPct,
    };
  }

  return { allowed: true, reason: null, effectiveCapPct };
}

/**
 * Set a per-ticket-type override for resale rules.
 */
export async function setTicketTypeOverride(
  eventId: string,
  ticketTypeId: string,
  override: Omit<ResaleRulesOverride, 'id' | 'resaleRuleId'>,
  db: DbAdapter,
): Promise<ResaleRulesOverride> {
  const rules = await getResaleRules(eventId, db);
  if (!rules) throw new Error('RULES_NOT_FOUND: set event-level rules first');

  const rows = await db.query<OverrideRow>(
    `INSERT INTO resale.resale_rules_overrides
       (resale_rule_id, ticket_type_id, resale_allowed, price_cap_pct, max_transfers_per_ticket)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (resale_rule_id, ticket_type_id) DO UPDATE SET
       resale_allowed = EXCLUDED.resale_allowed,
       price_cap_pct = EXCLUDED.price_cap_pct,
       max_transfers_per_ticket = EXCLUDED.max_transfers_per_ticket
     RETURNING *`,
    [
      rules.id,
      ticketTypeId,
      override.resaleAllowed ?? null,
      override.priceCappct ?? null,
      override.maxTransfersPerTicket ?? null,
    ],
  );

  return mapOverride(rows[0]);
}
