import { SlotError } from '../lib/slot-errors';
import type { SlotDB } from './resource.service';
import type { AvailabilityRule, AvailabilityOverride } from './availability.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SlotStatus = 'available' | 'partial' | 'full' | 'closed' | 'cancelled';

export interface Slot {
  id: string;
  resourceId: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  priceHellers: number;
  status: SlotStatus;
  generatedFromRuleId: string | null;
  overrideId: string | null;
}

export interface SlotWithResource extends Slot {
  resource: {
    id: string;
    name: string;
    resourceType: string;
    promoterId: string;
  };
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface SlotRow {
  id: string;
  resource_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  booked_count: number;
  price_hellers: number;
  status: SlotStatus;
  generated_from_rule_id: string | null;
  override_id: string | null;
}

interface SlotWithResourceRow extends SlotRow {
  resource_name: string;
  resource_type: string;
  promoter_id: string;
}

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
  override_type: string;
  start_time: string | null;
  end_time: string | null;
  price_hellers: number | null;
  capacity_override: number | null;
  reason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSlot(row: SlotRow): Slot {
  return {
    id: row.id,
    resourceId: row.resource_id,
    slotDate: row.slot_date,
    startTime: row.start_time,
    endTime: row.end_time,
    capacity: row.capacity,
    bookedCount: row.booked_count,
    priceHellers: row.price_hellers,
    status: row.status,
    generatedFromRuleId: row.generated_from_rule_id,
    overrideId: row.override_id,
  };
}

/** Parse "HH:MM" or "HH:MM:SS" → total minutes from midnight */
function timeToMinutes(t: string): number {
  const parts = t.split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
}

/** Minutes from midnight → "HH:MM:SS" */
function minutesToTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
}

/** Get ISO date string day of week (0=Sunday … 6=Saturday) */
function getDayOfWeek(dateStr: string): number {
  // Parse as UTC to avoid timezone shifts
  const [y, mo, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function generateSlotsForDate(
  resourceId: string,
  date: string,
  db: SlotDB,
): Promise<Slot[]> {
  const dayOfWeek = getDayOfWeek(date);

  // Query 1: fetch rules matching this day
  const { rows: ruleRows } = await db.query<RuleRow>(
    `SELECT * FROM reservations.availability_rules
     WHERE resource_id = $1 AND day_of_week = $2 AND is_active = true`,
    [resourceId, dayOfWeek],
  );

  // Query 2: fetch overrides for this date
  const { rows: overrideRows } = await db.query<OverrideRow>(
    `SELECT * FROM reservations.availability_overrides
     WHERE resource_id = $1 AND override_date = $2`,
    [resourceId, date],
  );

  // Check if whole-day closed override exists
  const wholeDay = overrideRows.find(
    (o) => o.override_type === 'closed' && o.start_time === null,
  );
  if (wholeDay) {
    // No slots generated
    return [];
  }

  const generatedSlots: Array<{
    slotDate: string;
    startTime: string;
    endTime: string;
    capacity: number;
    priceHellers: number;
    ruleId: string;
    overrideId: string | null;
  }> = [];

  for (const rule of ruleRows) {
    const startMin = timeToMinutes(rule.start_time);
    const endMin = timeToMinutes(rule.end_time);
    const duration = rule.slot_duration_minutes;

    let current = startMin;
    while (current + duration <= endMin) {
      const slotStart = minutesToTime(current);
      const slotEnd = minutesToTime(current + duration);

      // Check for time-specific closed override
      const closedOverride = overrideRows.find(
        (o) =>
          o.override_type === 'closed' &&
          o.start_time !== null &&
          timeToMinutes(o.start_time) <= current &&
          current < timeToMinutes(o.end_time ?? '23:59'),
      );

      if (closedOverride) {
        current += duration;
        continue;
      }

      // Check for price override
      const priceOverride = overrideRows.find(
        (o) =>
          o.override_type === 'price_override' &&
          (o.start_time === null ||
            (timeToMinutes(o.start_time) <= current &&
              current < timeToMinutes(o.end_time ?? '23:59'))),
      );

      const priceHellers =
        priceOverride?.price_hellers !== null && priceOverride?.price_hellers !== undefined
          ? priceOverride.price_hellers
          : rule.price_hellers;

      generatedSlots.push({
        slotDate: date,
        startTime: slotStart,
        endTime: slotEnd,
        capacity: rule.max_advance_days, // capacity from resource; for simplicity use rule default
        priceHellers,
        ruleId: rule.id,
        overrideId: priceOverride?.id ?? null,
      });

      current += duration;
    }
  }

  if (generatedSlots.length === 0) {
    return [];
  }

  // Build bulk INSERT with ON CONFLICT DO NOTHING for idempotency
  const valuePlaceholders: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  for (const s of generatedSlots) {
    valuePlaceholders.push(
      `($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7})`,
    );
    params.push(
      resourceId,
      s.slotDate,
      s.startTime,
      s.endTime,
      1, // capacity default 1; will be updated from resource
      s.priceHellers,
      s.ruleId,
      s.overrideId,
    );
    idx += 8;
  }

  // Execute: bulk insert (does NOT increment index)
  await db.execute(
    `INSERT INTO reservations.slots
       (resource_id, slot_date, start_time, end_time, capacity, price_hellers,
        generated_from_rule_id, override_id, status)
     VALUES ${valuePlaceholders.join(', ')}
     ON CONFLICT (resource_id, slot_date, start_time) DO NOTHING`,
    params,
  );

  // Return the generated slot representations (without querying back for simplicity)
  return generatedSlots.map((s, i) => ({
    id: `generated-${i}`,
    resourceId,
    slotDate: s.slotDate,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: 1,
    bookedCount: 0,
    priceHellers: s.priceHellers,
    status: 'available' as SlotStatus,
    generatedFromRuleId: s.ruleId,
    overrideId: s.overrideId,
  }));
}

export async function generateSlotsForRange(
  resourceId: string,
  dateFrom: string,
  dateTo: string,
  db: SlotDB,
): Promise<Slot[]> {
  const [fy, fm, fd] = dateFrom.split('-').map(Number);
  const [ty, tm, td] = dateTo.split('-').map(Number);
  const from = new Date(Date.UTC(fy, fm - 1, fd));
  const to = new Date(Date.UTC(ty, tm - 1, td));

  if (from > to) {
    throw new SlotError('INVALID_DATE_RANGE');
  }

  const allSlots: Slot[] = [];
  const current = new Date(from);
  while (current <= to) {
    const dateStr = current.toISOString().slice(0, 10);
    const slots = await generateSlotsForDate(resourceId, dateStr, db);
    allSlots.push(...slots);
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return allSlots;
}

export async function getAvailableSlots(
  resourceId: string,
  dateFrom: string,
  dateTo: string,
  db: SlotDB,
): Promise<Slot[]> {
  const { rows } = await db.query<SlotRow>(
    `SELECT * FROM reservations.slots
     WHERE resource_id = $1
       AND status IN ('available', 'partial')
       AND slot_date BETWEEN $2 AND $3
     ORDER BY slot_date, start_time`,
    [resourceId, dateFrom, dateTo],
  );

  return rows.map(mapSlot);
}

export async function getSlot(
  slotId: string,
  db: SlotDB,
): Promise<SlotWithResource> {
  const { rows } = await db.query<SlotWithResourceRow>(
    `SELECT s.*, r.name AS resource_name, r.resource_type, r.promoter_id
     FROM reservations.slots s
     JOIN reservations.resources r ON r.id = s.resource_id
     WHERE s.id = $1`,
    [slotId],
  );

  if (!rows[0]) {
    throw new SlotError('SLOT_NOT_FOUND');
  }

  const row = rows[0];
  return {
    ...mapSlot(row),
    resource: {
      id: row.resource_id,
      name: row.resource_name,
      resourceType: row.resource_type,
      promoterId: row.promoter_id,
    },
  };
}

export async function closeSlot(
  slotId: string,
  reason: string,
  db: SlotDB,
): Promise<Slot> {
  const { rows } = await db.query<SlotRow>(
    `UPDATE reservations.slots
     SET status = 'closed'
     WHERE id = $1
     RETURNING *`,
    [slotId],
  );

  if (!rows[0]) {
    throw new SlotError('SLOT_NOT_FOUND');
  }

  return mapSlot(rows[0]);
}

export async function refreshSlotStatus(
  slotId: string,
  db: SlotDB,
): Promise<Slot> {
  // Query 1: get current slot data
  const { rows: slotRows } = await db.query<SlotRow>(
    `SELECT * FROM reservations.slots WHERE id = $1`,
    [slotId],
  );

  if (!slotRows[0]) {
    throw new SlotError('SLOT_NOT_FOUND');
  }

  const slot = slotRows[0];

  // Don't change closed/cancelled status
  if (slot.status === 'closed' || slot.status === 'cancelled') {
    return mapSlot(slot);
  }

  let newStatus: SlotStatus;
  if (slot.booked_count === 0) {
    newStatus = 'available';
  } else if (slot.booked_count >= slot.capacity) {
    newStatus = 'full';
  } else {
    newStatus = 'partial';
  }

  // Execute (does NOT increment): update status
  await db.execute(
    `UPDATE reservations.slots SET status = $1 WHERE id = $2`,
    [newStatus, slotId],
  );

  return mapSlot({ ...slot, status: newStatus });
}
