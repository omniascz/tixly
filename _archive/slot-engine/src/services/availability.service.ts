import { SlotError } from '../lib/slot-errors';
import type { SlotDB } from './resource.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OverrideType = 'closed' | 'open' | 'price_override' | 'capacity_override';

export interface RuleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes?: number;
  maxAdvanceDays?: number;
  priceHellers?: number;
  isActive?: boolean;
  validFrom?: string;
  validUntil?: string;
}

export interface RuleUpdateInput {
  startTime?: string;
  endTime?: string;
  slotDurationMinutes?: number;
  maxAdvanceDays?: number;
  priceHellers?: number;
  isActive?: boolean;
  validFrom?: string;
  validUntil?: string;
}

export interface OverrideInput {
  overrideDate: string;
  overrideType: OverrideType;
  startTime?: string;
  endTime?: string;
  priceHellers?: number;
  capacityOverride?: number;
  reason?: string;
}

export interface AvailabilityRule {
  id: string;
  resourceId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  maxAdvanceDays: number;
  priceHellers: number;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
}

export interface AvailabilityOverride {
  id: string;
  resourceId: string;
  overrideDate: string;
  overrideType: OverrideType;
  startTime: string | null;
  endTime: string | null;
  priceHellers: number | null;
  capacityOverride: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface RuleRow {
  id: string;
  resource_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_duration_minutes: number;
  max_advance_days: number;
  price_hellers: number;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
}

interface OverrideRow {
  id: string;
  resource_id: string;
  override_date: string;
  override_type: OverrideType;
  start_time: string | null;
  end_time: string | null;
  price_hellers: number | null;
  capacity_override: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRule(row: RuleRow): AvailabilityRule {
  return {
    id: row.id,
    resourceId: row.resource_id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
    slotDurationMinutes: row.slot_duration_minutes,
    maxAdvanceDays: row.max_advance_days,
    priceHellers: row.price_hellers,
    isActive: row.is_active,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  };
}

function mapOverride(row: OverrideRow): AvailabilityOverride {
  return {
    id: row.id,
    resourceId: row.resource_id,
    overrideDate: row.override_date,
    overrideType: row.override_type,
    startTime: row.start_time,
    endTime: row.end_time,
    priceHellers: row.price_hellers,
    capacityOverride: row.capacity_override,
    reason: row.reason,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function addRule(
  resourceId: string,
  input: RuleInput,
  db: SlotDB,
): Promise<AvailabilityRule> {
  const { rows } = await db.query<RuleRow>(
    `INSERT INTO reservations.availability_rules
       (resource_id, day_of_week, start_time, end_time, slot_duration_minutes,
        max_advance_days, price_hellers, is_active, valid_from, valid_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      resourceId,
      input.dayOfWeek,
      input.startTime,
      input.endTime,
      input.slotDurationMinutes ?? 60,
      input.maxAdvanceDays ?? 30,
      input.priceHellers ?? 0,
      input.isActive ?? true,
      input.validFrom ?? null,
      input.validUntil ?? null,
    ],
  );

  if (!rows[0]) {
    throw new SlotError('RULE_CONFLICT');
  }

  return mapRule(rows[0]);
}

export async function getRules(
  resourceId: string,
  db: SlotDB,
): Promise<AvailabilityRule[]> {
  const { rows } = await db.query<RuleRow>(
    `SELECT * FROM reservations.availability_rules
     WHERE resource_id = $1 AND is_active = true
     ORDER BY day_of_week, start_time`,
    [resourceId],
  );

  return rows.map(mapRule);
}

export async function updateRule(
  ruleId: string,
  input: RuleUpdateInput,
  db: SlotDB,
): Promise<AvailabilityRule> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.startTime !== undefined) {
    sets.push(`start_time = $${idx}`);
    params.push(input.startTime);
    idx++;
  }
  if (input.endTime !== undefined) {
    sets.push(`end_time = $${idx}`);
    params.push(input.endTime);
    idx++;
  }
  if (input.slotDurationMinutes !== undefined) {
    sets.push(`slot_duration_minutes = $${idx}`);
    params.push(input.slotDurationMinutes);
    idx++;
  }
  if (input.maxAdvanceDays !== undefined) {
    sets.push(`max_advance_days = $${idx}`);
    params.push(input.maxAdvanceDays);
    idx++;
  }
  if (input.priceHellers !== undefined) {
    sets.push(`price_hellers = $${idx}`);
    params.push(input.priceHellers);
    idx++;
  }
  if (input.isActive !== undefined) {
    sets.push(`is_active = $${idx}`);
    params.push(input.isActive);
    idx++;
  }
  if (input.validFrom !== undefined) {
    sets.push(`valid_from = $${idx}`);
    params.push(input.validFrom);
    idx++;
  }
  if (input.validUntil !== undefined) {
    sets.push(`valid_until = $${idx}`);
    params.push(input.validUntil);
    idx++;
  }

  params.push(ruleId);

  const { rows } = await db.query<RuleRow>(
    `UPDATE reservations.availability_rules
     SET ${sets.join(', ')}
     WHERE id = $${idx}
     RETURNING *`,
    params,
  );

  if (!rows[0]) {
    throw new SlotError('RULE_NOT_FOUND');
  }

  return mapRule(rows[0]);
}

export async function deleteRule(
  ruleId: string,
  db: SlotDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.availability_rules WHERE id = $1`,
    [ruleId],
  );
}

export async function addOverride(
  resourceId: string,
  input: OverrideInput,
  db: SlotDB,
): Promise<AvailabilityOverride> {
  const { rows } = await db.query<OverrideRow>(
    `INSERT INTO reservations.availability_overrides
       (resource_id, override_date, override_type, start_time, end_time,
        price_hellers, capacity_override, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      resourceId,
      input.overrideDate,
      input.overrideType,
      input.startTime ?? null,
      input.endTime ?? null,
      input.priceHellers ?? null,
      input.capacityOverride ?? null,
      input.reason ?? null,
    ],
  );

  if (!rows[0]) {
    throw new SlotError('RULE_CONFLICT');
  }

  return mapOverride(rows[0]);
}

export async function getOverrides(
  resourceId: string,
  dateFrom: string,
  dateTo: string,
  db: SlotDB,
): Promise<AvailabilityOverride[]> {
  const { rows } = await db.query<OverrideRow>(
    `SELECT * FROM reservations.availability_overrides
     WHERE resource_id = $1
       AND override_date BETWEEN $2 AND $3
     ORDER BY override_date, start_time`,
    [resourceId, dateFrom, dateTo],
  );

  return rows.map(mapOverride);
}

export async function deleteOverride(
  overrideId: string,
  db: SlotDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.availability_overrides WHERE id = $1`,
    [overrideId],
  );
}
