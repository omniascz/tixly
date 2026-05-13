import { PortalError } from '../lib/portal-errors';
import { PortalDB } from './profile.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WaitlistStatus = 'waiting' | 'notified' | 'booked' | 'expired' | 'cancelled';

export interface WaitlistEntry {
  id: string;
  slotId: string;
  userId: string;
  promoterId: string;
  quantity: number;
  status: WaitlistStatus;
  notifiedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WaitlistPosition {
  position: number;
  entry: WaitlistEntry;
}

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface WaitlistRow {
  id: string;
  slot_id: string;
  user_id: string;
  promoter_id: string;
  quantity: number;
  status: WaitlistStatus;
  notified_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface CountRow {
  count: number;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapEntry(row: WaitlistRow): WaitlistEntry {
  return {
    id: row.id,
    slotId: row.slot_id,
    userId: row.user_id,
    promoterId: row.promoter_id,
    quantity: Number(row.quantity),
    status: row.status,
    notifiedAt: row.notified_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export async function joinWaitlist(
  slotId: string,
  userId: string,
  promoterId: string,
  quantity: number,
  db: PortalDB,
): Promise<WaitlistEntry> {
  // Check for duplicate
  const { rows: existing } = await db.query<WaitlistRow>(
    `SELECT * FROM reservations.waitlist_entries
     WHERE slot_id = $1 AND user_id = $2 AND status NOT IN ('cancelled','expired')`,
    [slotId, userId],
  );

  if (existing[0]) {
    throw new PortalError('WAITLIST_DUPLICATE');
  }

  await db.execute(
    `INSERT INTO reservations.waitlist_entries
       (slot_id, user_id, promoter_id, quantity)
     VALUES ($1,$2,$3,$4)`,
    [slotId, userId, promoterId, quantity],
  );

  const { rows } = await db.query<WaitlistRow>(
    `SELECT * FROM reservations.waitlist_entries
     WHERE slot_id = $1 AND user_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [slotId, userId],
  );

  if (!rows[0]) {
    throw new PortalError('WAITLIST_ENTRY_NOT_FOUND');
  }

  return mapEntry(rows[0]);
}

export async function leaveWaitlist(
  slotId: string,
  userId: string,
  db: PortalDB,
): Promise<void> {
  await db.execute(
    `UPDATE reservations.waitlist_entries
     SET status = 'cancelled'
     WHERE slot_id = $1 AND user_id = $2`,
    [slotId, userId],
  );
}

export async function getWaitlistPosition(
  slotId: string,
  userId: string,
  db: PortalDB,
): Promise<{ position: number }> {
  const { rows } = await db.query<CountRow>(
    `SELECT COUNT(*) AS count
     FROM reservations.waitlist_entries we
     WHERE we.slot_id = $1
       AND we.status = 'waiting'
       AND we.created_at <= (
         SELECT created_at FROM reservations.waitlist_entries
         WHERE slot_id = $1 AND user_id = $2 AND status = 'waiting'
       )`,
    [slotId, userId],
  );

  return { position: Number(rows[0]?.count ?? 0) };
}

export async function notifyNextInWaitlist(
  slotId: string,
  _quantity: number,
  db: PortalDB,
): Promise<{ userId: string } | null> {
  // Query 1: find first waiting entry
  const { rows } = await db.query<WaitlistRow>(
    `SELECT * FROM reservations.waitlist_entries
     WHERE slot_id = $1 AND status = 'waiting'
     ORDER BY created_at ASC LIMIT 1`,
    [slotId],
  );

  const entry = rows[0];
  if (!entry) {
    return null;
  }

  // execute: update status (does NOT increment index)
  await db.execute(
    `UPDATE reservations.waitlist_entries
     SET status = 'notified', notified_at = NOW(), expires_at = NOW() + INTERVAL '2 hours'
     WHERE id = $1`,
    [entry.id],
  );

  return { userId: entry.user_id };
}

export async function processWaitlistExpiry(db: PortalDB): Promise<number> {
  const { rows } = await db.query<CountRow>(
    `UPDATE reservations.waitlist_entries
     SET status = 'expired'
     WHERE status = 'notified' AND expires_at < NOW()
     RETURNING id`,
    [],
  );

  return rows.length;
}

export async function getWaitlistForSlot(
  slotId: string,
  db: PortalDB,
): Promise<WaitlistEntry[]> {
  const { rows } = await db.query<WaitlistRow>(
    `SELECT * FROM reservations.waitlist_entries
     WHERE slot_id = $1 AND status = 'waiting'
     ORDER BY created_at ASC`,
    [slotId],
  );

  return rows.map(mapEntry);
}
