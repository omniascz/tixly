import { randomUUID } from 'crypto';
import type { DbAdapter, FanRegistration } from '../lib/types.js';
import { checkAntiScalperRules } from '../lib/anti-scalper.js';

interface PresaleEventRow {
  id: string;
  event_id: string;
  promoter_id: string;
  registration_open: string;
  registration_close: string;
  selection_date: string;
  max_select_count: number;
  max_tickets_per_fan: number;
  status: string;
}

interface FanRegistrationRow {
  id: string;
  event_id: string;
  promoter_id: string;
  user_id: string;
  email: string;
  status: string;
  registered_at: string;
  selected_at: string | null;
  purchase_window_expires_at: string | null;
  purchased_at: string | null;
}

function mapRow(row: FanRegistrationRow): FanRegistration {
  return {
    id: row.id,
    eventId: row.event_id,
    promoterId: row.promoter_id,
    userId: row.user_id,
    email: row.email,
    status: row.status as FanRegistration['status'],
    registeredAt: row.registered_at,
    selectedAt: row.selected_at ?? undefined,
    purchaseWindowExpiresAt: row.purchase_window_expires_at ?? undefined,
    purchasedAt: row.purchased_at ?? undefined,
  };
}

export async function registerForPresale(
  eventId: string,
  userId: string,
  email: string,
  promoterId: string,
  db: DbAdapter,
): Promise<FanRegistration> {
  // Load presale event to verify registration is open
  const events = await db.query<PresaleEventRow>(
    `SELECT * FROM presale_events WHERE event_id = $1 AND promoter_id = $2`,
    [eventId, promoterId],
  );

  if (events.length === 0) {
    throw new Error('PRESALE_EVENT_NOT_FOUND');
  }

  const event = events[0];
  const now = new Date();
  const regOpen = new Date(event.registration_open);
  const regClose = new Date(event.registration_close);

  if (now < regOpen || now > regClose) {
    throw new Error('REGISTRATION_CLOSED');
  }

  // Check existing registrations for anti-scalper
  const existing = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM fan_registrations_v2 WHERE event_id = $1 AND user_id = $2`,
    [eventId, userId],
  );
  const existingCount = parseInt(existing[0]?.count ?? '0', 10);

  const antiScalperCheck = checkAntiScalperRules(userId, email, existingCount);
  if (!antiScalperCheck.passed) {
    throw new Error(antiScalperCheck.reason ?? 'ANTI_SCALPER_CHECK_FAILED');
  }

  const id = randomUUID();
  const registeredAt = new Date().toISOString();

  await db.execute(
    `INSERT INTO fan_registrations_v2 (id, event_id, promoter_id, user_id, email, status, registered_at)
     VALUES ($1, $2, $3, $4, $5, 'registered', $6)`,
    [id, eventId, promoterId, userId, email, registeredAt],
  );

  return {
    id,
    eventId,
    promoterId,
    userId,
    email,
    status: 'registered',
    registeredAt,
  };
}

export async function cancelRegistration(
  registrationId: string,
  userId: string,
  db: DbAdapter,
): Promise<void> {
  await db.execute(
    `UPDATE fan_registrations_v2 SET status = 'expired' WHERE id = $1 AND user_id = $2`,
    [registrationId, userId],
  );
}

export async function getRegistrationCount(
  eventId: string,
  db: DbAdapter,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM fan_registrations_v2 WHERE event_id = $1`,
    [eventId],
  );
  return parseInt(result[0]?.count ?? '0', 10);
}

export async function getFanRegistrationStatus(
  eventId: string,
  userId: string,
  db: DbAdapter,
): Promise<FanRegistration | null> {
  const rows = await db.query<FanRegistrationRow>(
    `SELECT * FROM fan_registrations_v2 WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
    [eventId, userId],
  );

  if (rows.length === 0) return null;
  return mapRow(rows[0]);
}
