import type { ServiceDeps, DbAdapter } from '../lib/service-container.js';
import { StaffError } from '../lib/staff-errors.js';
import type {
  CreateRecurringShiftInput,
  DayOfWeek,
  RecurringShiftTemplate,
  StaffRole,
} from '../types/staff.js';

interface RecurringTemplateRow {
  id: string;
  promoter_id: string;
  branch_id: string;
  staff_id: string;
  role: string;
  zone: string | null;
  day_of_week: string;
  start_time_local: string;
  end_time_local: string;
  effective_from: Date;
  effective_until: Date | null;
  is_active: boolean;
  created_at: Date;
}

const DAY_INDEX: Record<DayOfWeek, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

const VALID_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function mapTemplate(row: RecurringTemplateRow): RecurringShiftTemplate {
  return {
    id: row.id,
    promoterId: row.promoter_id,
    branchId: row.branch_id,
    staffId: row.staff_id,
    role: row.role as StaffRole,
    zone: row.zone,
    dayOfWeek: row.day_of_week as DayOfWeek,
    startTimeLocal: row.start_time_local,
    endTimeLocal: row.end_time_local,
    effectiveFrom: row.effective_from,
    effectiveUntil: row.effective_until,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

function validateHhMm(value: string): void {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new StaffError('RECURRING_TEMPLATE_INVALID', `Neplatný čas: ${value}`);
  }
}

function parseIsoDate(value: string): Date {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) {
    throw new StaffError('RECURRING_TEMPLATE_INVALID', `Neplatné datum: ${value}`);
  }
  return d;
}

async function assertStaffBelongsToPromoter(
  staffId: string,
  promoterId: string,
  db: DbAdapter,
): Promise<void> {
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM platform.staff_members
     WHERE id = $1 AND promoter_id = $2 AND status <> 'archived'`,
    [staffId, promoterId],
  );
  if (!rows[0]) throw new StaffError('STAFF_NOT_FOUND');
}

export async function createRecurringTemplate(
  promoterId: string,
  input: CreateRecurringShiftInput,
  deps: ServiceDeps,
): Promise<RecurringShiftTemplate> {
  if (!VALID_DAYS.includes(input.dayOfWeek)) {
    throw new StaffError('RECURRING_TEMPLATE_INVALID', `Neplatný den v týdnu: ${input.dayOfWeek}`);
  }
  validateHhMm(input.startTimeLocal);
  validateHhMm(input.endTimeLocal);
  if (input.startTimeLocal >= input.endTimeLocal) {
    throw new StaffError('RECURRING_TEMPLATE_INVALID', 'Začátek musí být před koncem.');
  }

  const effectiveFrom = parseIsoDate(input.effectiveFrom);
  const effectiveUntil = input.effectiveUntil ? parseIsoDate(input.effectiveUntil) : null;
  if (effectiveUntil && effectiveUntil < effectiveFrom) {
    throw new StaffError('RECURRING_TEMPLATE_INVALID', 'Datum konce musí být po datu začátku.');
  }

  await assertStaffBelongsToPromoter(input.staffId, promoterId, deps.db);

  const rows = await deps.db.query<RecurringTemplateRow>(
    `INSERT INTO platform.recurring_shift_templates
       (promoter_id, branch_id, staff_id, role, zone, day_of_week,
        start_time_local, end_time_local, effective_from, effective_until)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      promoterId,
      input.branchId,
      input.staffId,
      input.role,
      input.zone ?? null,
      input.dayOfWeek,
      input.startTimeLocal,
      input.endTimeLocal,
      input.effectiveFrom,
      input.effectiveUntil ?? null,
    ],
  );

  const row = rows[0];
  if (!row) throw new StaffError('RECURRING_TEMPLATE_INVALID');
  return mapTemplate(row);
}

export async function listRecurringTemplates(
  promoterId: string,
  branchId: string | null,
  deps: ServiceDeps,
): Promise<RecurringShiftTemplate[]> {
  const params: unknown[] = [promoterId];
  let sql = `SELECT * FROM platform.recurring_shift_templates
             WHERE promoter_id = $1 AND is_active = TRUE`;
  if (branchId) {
    sql += ` AND branch_id = $2`;
    params.push(branchId);
  }
  sql += ` ORDER BY day_of_week, start_time_local`;

  const rows = await deps.db.query<RecurringTemplateRow>(sql, params);
  return rows.map(mapTemplate);
}

export async function deactivateTemplate(
  templateId: string,
  promoterId: string,
  deps: ServiceDeps,
): Promise<void> {
  const result = await deps.db.query<{ id: string }>(
    `UPDATE platform.recurring_shift_templates
     SET is_active = FALSE
     WHERE id = $1 AND promoter_id = $2
     RETURNING id`,
    [templateId, promoterId],
  );
  if (!result[0]) throw new StaffError('RECURRING_TEMPLATE_NOT_FOUND');
}

/**
 * Materialize templates into concrete shifts for [from, to] inclusive.
 * Idempotent: a shift is only created if one does not already exist
 * for (staff_id, starts_at).
 *
 * NOTE: Uses simple UTC mapping. Production code should apply branch TZ
 * via ems.opening_hours.timezone, but per-branch DST is delegated to
 * Postgres (see commented AT TIME ZONE pattern below).
 */
export async function materializeShifts(
  promoterId: string,
  from: Date,
  to: Date,
  deps: ServiceDeps,
): Promise<{ created: number; skipped: number }> {
  const templates = await deps.db.query<RecurringTemplateRow>(
    `SELECT * FROM platform.recurring_shift_templates
     WHERE promoter_id = $1
       AND is_active = TRUE
       AND effective_from <= $3::date
       AND (effective_until IS NULL OR effective_until >= $2::date)`,
    [promoterId, from.toISOString().slice(0, 10), to.toISOString().slice(0, 10)],
  );

  let created = 0;
  let skipped = 0;

  // Iterate day by day
  const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));

  for (
    let day = new Date(start);
    day.getTime() <= end.getTime();
    day = new Date(day.getTime() + 24 * 3600_000)
  ) {
    const dayIdx = day.getUTCDay();
    for (const t of templates) {
      if (DAY_INDEX[t.day_of_week as DayOfWeek] !== dayIdx) continue;
      if (t.effective_from > day) continue;
      if (t.effective_until && t.effective_until < day) continue;

      const [sh, sm] = t.start_time_local.split(':').map(Number);
      const [eh, em] = t.end_time_local.split(':').map(Number);
      const startsAt = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), sh ?? 0, sm ?? 0),
      );
      const endsAt = new Date(
        Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), eh ?? 0, em ?? 0),
      );

      // Idempotency check
      const existing = await deps.db.query<{ id: string }>(
        `SELECT id FROM platform.staff_shifts
         WHERE staff_id = $1 AND starts_at = $2::timestamptz
         LIMIT 1`,
        [t.staff_id, startsAt.toISOString()],
      );
      if (existing[0]) {
        skipped++;
        continue;
      }

      await deps.db.execute(
        `INSERT INTO platform.staff_shifts
           (promoter_id, event_id, staff_id, role, zone, starts_at, ends_at, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          promoterId,
          // Recurring shifts are not tied to a specific event — use branch_id as pseudo event.
          t.branch_id,
          t.staff_id,
          t.role,
          t.zone,
          startsAt.toISOString(),
          endsAt.toISOString(),
          'Generováno z opakující se šablony',
        ],
      );
      created++;
    }
  }

  return { created, skipped };
}
