import { CatalogError } from '../lib/catalog-errors';
import type { CatalogDB } from './category.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RuleType =
  | 'peak_hours'
  | 'off_peak'
  | 'weekend'
  | 'weekday'
  | 'member'
  | 'group'
  | 'advance'
  | 'last_minute';

export type PriceModifierType = 'fixed' | 'percentage' | 'absolute';

export interface PricingRuleInput {
  name: string;
  ruleType: RuleType;
  priceModifierType: PriceModifierType;
  priceModifierValue: number; // halíře for absolute/fixed, basis points for percentage
  dayOfWeek?: number[] | null;
  timeFrom?: string | null;
  timeTo?: string | null;
  minQuantity?: number | null;
  advanceHoursMin?: number | null;
  advanceHoursMax?: number | null;
  isActive?: boolean;
  priority?: number;
}

export interface PricingRule {
  id: string;
  serviceId: string;
  name: string;
  ruleType: RuleType;
  priceModifierType: PriceModifierType;
  priceModifierValue: number;
  dayOfWeek: number[] | null;
  timeFrom: string | null;
  timeTo: string | null;
  minQuantity: number | null;
  advanceHoursMin: number | null;
  advanceHoursMax: number | null;
  isActive: boolean;
  priority: number;
}

export interface BookingParams {
  quantity?: number;
  dayOfWeek?: number; // 0=Sunday, 6=Saturday
  timeOfDay?: string; // HH:MM
  advanceHours?: number;
  isMember?: boolean;
}

export interface PriceCalculationResult {
  basePrice: number;
  finalPrice: number;
  appliedRules: Array<{ id: string; name: string; modifierType: PriceModifierType; modifierValue: number }>;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface PricingRuleRow {
  id: string;
  service_id: string;
  name: string;
  rule_type: RuleType;
  price_modifier_type: PriceModifierType;
  price_modifier_value: number;
  day_of_week: number[] | null;
  time_from: string | null;
  time_to: string | null;
  min_quantity: number | null;
  advance_hours_min: number | null;
  advance_hours_max: number | null;
  is_active: boolean;
  priority: number;
}

interface ServicePriceRow {
  price_hellers: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRule(row: PricingRuleRow): PricingRule {
  return {
    id: row.id,
    serviceId: row.service_id,
    name: row.name,
    ruleType: row.rule_type,
    priceModifierType: row.price_modifier_type,
    priceModifierValue: row.price_modifier_value,
    dayOfWeek: row.day_of_week,
    timeFrom: row.time_from,
    timeTo: row.time_to,
    minQuantity: row.min_quantity,
    advanceHoursMin: row.advance_hours_min,
    advanceHoursMax: row.advance_hours_max,
    isActive: row.is_active,
    priority: row.priority,
  };
}

function ruleMatches(rule: PricingRule, params: BookingParams): boolean {
  const { quantity = 1, dayOfWeek, timeOfDay, advanceHours, isMember = false } = params;

  // Check day_of_week constraint
  if (rule.dayOfWeek !== null && rule.dayOfWeek.length > 0 && dayOfWeek !== undefined) {
    if (!rule.dayOfWeek.includes(dayOfWeek)) {
      return false;
    }
  }

  // Check time range constraint
  if (rule.timeFrom !== null && rule.timeTo !== null && timeOfDay !== undefined) {
    if (timeOfDay < rule.timeFrom || timeOfDay > rule.timeTo) {
      return false;
    }
  }

  // Check minimum quantity for group pricing
  if (rule.minQuantity !== null && quantity < rule.minQuantity) {
    return false;
  }

  // Check advance hours for advance/last_minute rules
  if (rule.advanceHoursMin !== null && advanceHours !== undefined && advanceHours < rule.advanceHoursMin) {
    return false;
  }
  if (rule.advanceHoursMax !== null && advanceHours !== undefined && advanceHours > rule.advanceHoursMax) {
    return false;
  }

  // Member rule
  if (rule.ruleType === 'member' && !isMember) {
    return false;
  }

  // Weekend rule — if day_of_week not set, auto-detect
  if (rule.ruleType === 'weekend' && (rule.dayOfWeek === null || rule.dayOfWeek.length === 0)) {
    if (dayOfWeek !== undefined && dayOfWeek !== 0 && dayOfWeek !== 6) {
      return false;
    }
  }

  // Weekday rule — if day_of_week not set, auto-detect
  if (rule.ruleType === 'weekday' && (rule.dayOfWeek === null || rule.dayOfWeek.length === 0)) {
    if (dayOfWeek !== undefined && (dayOfWeek === 0 || dayOfWeek === 6)) {
      return false;
    }
  }

  return true;
}

function applyModifier(
  currentPrice: number,
  basePrice: number,
  modifierType: PriceModifierType,
  modifierValue: number,
): number {
  switch (modifierType) {
    case 'fixed':
      // Replace price entirely
      return modifierValue;
    case 'percentage':
      // basis points: 1000 = 10%, so multiply by (1 + value/10000)
      return Math.round(basePrice * (1 + modifierValue / 10000));
    case 'absolute':
      // Add/subtract from current price
      return currentPrice + modifierValue;
    default:
      return currentPrice;
  }
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function createPricingRule(
  serviceId: string,
  input: PricingRuleInput,
  db: CatalogDB,
): Promise<PricingRule> {
  const { rows } = await db.query<PricingRuleRow>(
    `INSERT INTO reservations.service_pricing_rules
       (service_id, name, rule_type, price_modifier_type, price_modifier_value,
        day_of_week, time_from, time_to, min_quantity, advance_hours_min,
        advance_hours_max, is_active, priority)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      serviceId,
      input.name,
      input.ruleType,
      input.priceModifierType,
      input.priceModifierValue,
      input.dayOfWeek ?? null,
      input.timeFrom ?? null,
      input.timeTo ?? null,
      input.minQuantity ?? null,
      input.advanceHoursMin ?? null,
      input.advanceHoursMax ?? null,
      input.isActive ?? true,
      input.priority ?? 0,
    ],
  );

  if (!rows[0]) {
    throw new CatalogError('PRICING_RULE_DUPLICATE');
  }

  return mapRule(rows[0]);
}

export async function listPricingRules(
  serviceId: string,
  db: CatalogDB,
): Promise<PricingRule[]> {
  const { rows } = await db.query<PricingRuleRow>(
    `SELECT * FROM reservations.service_pricing_rules
     WHERE service_id = $1 AND is_active = true
     ORDER BY priority DESC`,
    [serviceId],
  );

  return rows.map(mapRule);
}

export async function updatePricingRule(
  ruleId: string,
  input: Partial<PricingRuleInput>,
  db: CatalogDB,
): Promise<PricingRule> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  const fieldMap: Array<[keyof PricingRuleInput, string]> = [
    ['name', 'name'],
    ['ruleType', 'rule_type'],
    ['priceModifierType', 'price_modifier_type'],
    ['priceModifierValue', 'price_modifier_value'],
    ['dayOfWeek', 'day_of_week'],
    ['timeFrom', 'time_from'],
    ['timeTo', 'time_to'],
    ['minQuantity', 'min_quantity'],
    ['advanceHoursMin', 'advance_hours_min'],
    ['advanceHoursMax', 'advance_hours_max'],
    ['isActive', 'is_active'],
    ['priority', 'priority'],
  ];

  for (const [camel, snake] of fieldMap) {
    if (input[camel] !== undefined) {
      sets.push(`${snake} = $${idx}`);
      params.push(input[camel]);
      idx++;
    }
  }

  if (sets.length === 0) {
    const { rows } = await db.query<PricingRuleRow>(
      `SELECT * FROM reservations.service_pricing_rules WHERE id = $1`,
      [ruleId],
    );
    if (!rows[0]) throw new CatalogError('PRICING_RULE_NOT_FOUND');
    return mapRule(rows[0]);
  }

  params.push(ruleId);

  const { rows } = await db.query<PricingRuleRow>(
    `UPDATE reservations.service_pricing_rules
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new CatalogError('PRICING_RULE_NOT_FOUND');
  }

  return mapRule(rows[0]);
}

export async function deletePricingRule(
  ruleId: string,
  db: CatalogDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.service_pricing_rules WHERE id = $1`,
    [ruleId],
  );
}

/**
 * Calculate final price for a service booking.
 * Flow: query(service) → query(active rules) → pure computation
 *
 * Percentage modifier: finalPrice = basePrice * (1 + value/10000)
 * Absolute modifier: finalPrice = currentPrice + value
 * Fixed modifier: finalPrice = value (replaces)
 *
 * Rules applied in priority order (highest priority first).
 */
export async function calculatePrice(
  serviceId: string,
  bookingParams: BookingParams,
  db: CatalogDB,
): Promise<PriceCalculationResult> {
  // Query 1: get service base price
  const { rows: serviceRows } = await db.query<ServicePriceRow>(
    `SELECT price_hellers FROM reservations.services WHERE id = $1`,
    [serviceId],
  );

  if (!serviceRows[0]) {
    throw new CatalogError('SERVICE_NOT_FOUND');
  }

  const basePrice = serviceRows[0].price_hellers;

  // Query 2: get active rules ordered by priority DESC
  const { rows: ruleRows } = await db.query<PricingRuleRow>(
    `SELECT * FROM reservations.service_pricing_rules
     WHERE service_id = $1 AND is_active = true
     ORDER BY priority DESC`,
    [serviceId],
  );

  const rules = ruleRows.map(mapRule);
  const appliedRules: PriceCalculationResult['appliedRules'] = [];
  let finalPrice = basePrice;

  for (const rule of rules) {
    if (ruleMatches(rule, bookingParams)) {
      finalPrice = applyModifier(finalPrice, basePrice, rule.priceModifierType, rule.priceModifierValue);
      appliedRules.push({
        id: rule.id,
        name: rule.name,
        modifierType: rule.priceModifierType,
        modifierValue: rule.priceModifierValue,
      });
    }
  }

  return { basePrice, finalPrice, appliedRules };
}
