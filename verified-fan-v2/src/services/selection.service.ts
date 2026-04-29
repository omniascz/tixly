import type { DbAdapter, FanRegistration } from '../lib/types.js';

interface PresaleEventRow {
  id: string;
  event_id: string;
  promoter_id: string;
  max_select_count: number;
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

/**
 * Fisher-Yates shuffle with injectable random function for testability.
 */
function fisherYatesShuffle<T>(array: T[], randomFn: () => number): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export async function conductSelection(
  presaleEventId: string,
  promoterId: string,
  db: DbAdapter,
  randomFn: () => number = Math.random,
): Promise<{ selected: number; total: number }> {
  const events = await db.query<PresaleEventRow>(
    `SELECT * FROM presale_events WHERE id = $1 AND promoter_id = $2`,
    [presaleEventId, promoterId],
  );

  if (events.length === 0) {
    throw new Error('PRESALE_EVENT_NOT_FOUND');
  }

  const event = events[0];

  const registrations = await db.query<FanRegistrationRow>(
    `SELECT * FROM fan_registrations_v2 WHERE event_id = $1 AND status = 'registered'`,
    [event.event_id],
  );

  const total = registrations.length;
  const shuffled = fisherYatesShuffle(registrations, randomFn);
  const toSelect = shuffled.slice(0, event.max_select_count);
  const selectedNow = toSelect.length;

  if (selectedNow === 0) {
    return { selected: 0, total };
  }

  const selectedAt = new Date().toISOString();
  const ids = toSelect.map((r) => r.id);

  // Update selected fans
  for (const id of ids) {
    await db.execute(
      `UPDATE fan_registrations_v2 SET status = 'selected', selected_at = $1 WHERE id = $2`,
      [selectedAt, id],
    );
  }

  // Mark not-selected fans
  await db.execute(
    `UPDATE fan_registrations_v2 SET status = 'not_selected' WHERE event_id = $1 AND status = 'registered'`,
    [event.event_id],
  );

  return { selected: selectedNow, total };
}

export async function openPurchaseWindow(
  registrationId: string,
  db: DbAdapter,
): Promise<FanRegistration> {
  const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

  await db.execute(
    `UPDATE fan_registrations_v2
     SET status = 'purchase_window_open', purchase_window_expires_at = $1
     WHERE id = $2`,
    [expiresAt, registrationId],
  );

  const rows = await db.query<FanRegistrationRow>(
    `SELECT * FROM fan_registrations_v2 WHERE id = $1`,
    [registrationId],
  );

  if (rows.length === 0) {
    throw new Error('REGISTRATION_NOT_FOUND');
  }

  return mapRow(rows[0]);
}

export async function openAllPurchaseWindows(
  presaleEventId: string,
  db: DbAdapter,
): Promise<number> {
  const events = await db.query<PresaleEventRow>(
    `SELECT * FROM presale_events WHERE id = $1`,
    [presaleEventId],
  );

  if (events.length === 0) {
    throw new Error('PRESALE_EVENT_NOT_FOUND');
  }

  const event = events[0];

  const selected = await db.query<FanRegistrationRow>(
    `SELECT * FROM fan_registrations_v2 WHERE event_id = $1 AND status = 'selected'`,
    [event.event_id],
  );

  let opened = 0;
  for (const reg of selected) {
    await openPurchaseWindow(reg.id, db);
    opened++;
  }

  return opened;
}
