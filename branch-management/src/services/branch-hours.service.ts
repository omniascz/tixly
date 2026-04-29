import { BranchError } from '../lib/branch-errors';
import type { BranchDB } from './branch.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HoursInput {
  openTime: string;
  closeTime: string;
  isClosed?: boolean;
}

export interface BranchHours {
  id: string;
  branchId: string;
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface ClosureInput {
  closureDate: string;
  reason?: string | null;
  isPartial?: boolean;
  partialOpenFrom?: string | null;
  partialOpenUntil?: string | null;
}

export interface BranchClosure {
  id: string;
  branchId: string;
  closureDate: string;
  reason: string | null;
  isPartial: boolean;
  partialOpenFrom: string | null;
  partialOpenUntil: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface HoursRow {
  id: string;
  branch_id: string;
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface ClosureRow {
  id: string;
  branch_id: string;
  closure_date: string;
  reason: string | null;
  is_partial: boolean;
  partial_open_from: string | null;
  partial_open_until: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapHours(row: HoursRow): BranchHours {
  return {
    id: row.id,
    branchId: row.branch_id,
    dayOfWeek: row.day_of_week,
    openTime: row.open_time,
    closeTime: row.close_time,
    isClosed: row.is_closed,
  };
}

function mapClosure(row: ClosureRow): BranchClosure {
  return {
    id: row.id,
    branchId: row.branch_id,
    closureDate: row.closure_date,
    reason: row.reason,
    isPartial: row.is_partial,
    partialOpenFrom: row.partial_open_from,
    partialOpenUntil: row.partial_open_until,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Hours functions
// ---------------------------------------------------------------------------

export async function setHours(
  branchId: string,
  dayOfWeek: number,
  input: HoursInput,
  db: BranchDB,
): Promise<BranchHours> {
  const { rows } = await db.query<HoursRow>(
    `INSERT INTO reservations.branch_hours (branch_id, day_of_week, open_time, close_time, is_closed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (branch_id, day_of_week) DO UPDATE
       SET open_time = EXCLUDED.open_time,
           close_time = EXCLUDED.close_time,
           is_closed = EXCLUDED.is_closed
     RETURNING *`,
    [branchId, dayOfWeek, input.openTime, input.closeTime, input.isClosed ?? false],
  );

  if (!rows[0]) {
    throw new BranchError('HOURS_CONFLICT');
  }

  return mapHours(rows[0]);
}

export async function getHours(
  branchId: string,
  db: BranchDB,
): Promise<BranchHours[]> {
  const { rows } = await db.query<HoursRow>(
    `SELECT * FROM reservations.branch_hours
     WHERE branch_id = $1
     ORDER BY day_of_week ASC`,
    [branchId],
  );

  // Fill missing days with is_closed=true
  const result: BranchHours[] = [];
  const byDay = new Map(rows.map((r) => [r.day_of_week, r]));

  for (let day = 0; day <= 6; day++) {
    const row = byDay.get(day);
    if (row) {
      result.push(mapHours(row));
    } else {
      result.push({
        id: '',
        branchId,
        dayOfWeek: day,
        openTime: '00:00',
        closeTime: '00:00',
        isClosed: true,
      });
    }
  }

  return result;
}

export async function setWeeklyHours(
  branchId: string,
  hoursArray: Array<{ dayOfWeek: number; openTime: string; closeTime: string; isClosed?: boolean }>,
  db: BranchDB,
): Promise<BranchHours[]> {
  const results: BranchHours[] = [];

  for (const h of hoursArray) {
    const hours = await setHours(branchId, h.dayOfWeek, {
      openTime: h.openTime,
      closeTime: h.closeTime,
      isClosed: h.isClosed,
    }, db);
    results.push(hours);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Closure functions
// ---------------------------------------------------------------------------

export async function addClosure(
  branchId: string,
  input: ClosureInput,
  db: BranchDB,
): Promise<BranchClosure> {
  const { rows } = await db.query<ClosureRow>(
    `INSERT INTO reservations.branch_closures
       (branch_id, closure_date, reason, is_partial, partial_open_from, partial_open_until)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      branchId,
      input.closureDate,
      input.reason ?? null,
      input.isPartial ?? false,
      input.partialOpenFrom ?? null,
      input.partialOpenUntil ?? null,
    ],
  );

  if (!rows[0]) {
    throw new BranchError('CLOSURE_CONFLICT');
  }

  return mapClosure(rows[0]);
}

export async function removeClosure(
  closureId: string,
  db: BranchDB,
): Promise<void> {
  await db.execute(
    `DELETE FROM reservations.branch_closures WHERE id = $1`,
    [closureId],
  );
}

export async function getClosures(
  branchId: string,
  dateFrom: string,
  dateTo: string,
  db: BranchDB,
): Promise<BranchClosure[]> {
  const { rows } = await db.query<ClosureRow>(
    `SELECT * FROM reservations.branch_closures
     WHERE branch_id = $1 AND closure_date BETWEEN $2 AND $3
     ORDER BY closure_date ASC`,
    [branchId, dateFrom, dateTo],
  );

  return rows.map(mapClosure);
}

export async function isClosedOn(
  branchId: string,
  date: string,
  db: BranchDB,
): Promise<boolean> {
  // Query 1: check closure
  const { rows: closureRows } = await db.query<{ id: string; is_partial: boolean }>(
    `SELECT id, is_partial FROM reservations.branch_closures
     WHERE branch_id = $1 AND closure_date = $2`,
    [branchId, date],
  );

  if (closureRows[0] && !closureRows[0].is_partial) {
    return true;
  }

  // Query 2: check day_of_week
  const dateObj = new Date(date + 'T12:00:00Z');
  const dayOfWeek = dateObj.getUTCDay();

  const { rows: hoursRows } = await db.query<{ is_closed: boolean }>(
    `SELECT is_closed FROM reservations.branch_hours
     WHERE branch_id = $1 AND day_of_week = $2`,
    [branchId, dayOfWeek],
  );

  if (!hoursRows[0] || hoursRows[0].is_closed) {
    return true;
  }

  return false;
}
