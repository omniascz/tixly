import type { DbAdapter } from '../lib/types.js';

interface FanRegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  purchase_window_expires_at: string | null;
}

export async function verifyPurchaseWindow(
  eventId: string,
  userId: string,
  db: DbAdapter,
): Promise<{ valid: boolean; expiresAt?: string; reason?: string }> {
  const rows = await db.query<FanRegistrationRow>(
    `SELECT * FROM fan_registrations_v2 WHERE event_id = $1 AND user_id = $2 LIMIT 1`,
    [eventId, userId],
  );

  if (rows.length === 0) {
    return { valid: false, reason: 'NO_REGISTRATION' };
  }

  const reg = rows[0];

  if (reg.status !== 'purchase_window_open') {
    if (reg.purchase_window_expires_at) {
      return { valid: false, reason: 'WINDOW_EXPIRED' };
    }
    return { valid: false, reason: 'NO_PURCHASE_WINDOW' };
  }

  const expiresAt = reg.purchase_window_expires_at;
  if (!expiresAt) {
    return { valid: false, reason: 'NO_PURCHASE_WINDOW' };
  }

  const now = new Date();
  const expiry = new Date(expiresAt);

  if (now > expiry) {
    // Expire the window
    await db.execute(
      `UPDATE fan_registrations_v2 SET status = 'expired' WHERE id = $1`,
      [reg.id],
    );
    return { valid: false, reason: 'WINDOW_EXPIRED', expiresAt };
  }

  return { valid: true, expiresAt };
}

export async function markTicketPurchased(
  registrationId: string,
  db: DbAdapter,
): Promise<void> {
  const purchasedAt = new Date().toISOString();
  await db.execute(
    `UPDATE fan_registrations_v2 SET status = 'purchased', purchased_at = $1 WHERE id = $2`,
    [purchasedAt, registrationId],
  );
}

export async function expireStaleWindows(db: DbAdapter): Promise<number> {
  const now = new Date().toISOString();

  const stale = await db.query<{ id: string }>(
    `SELECT id FROM fan_registrations_v2
     WHERE status = 'purchase_window_open'
       AND purchase_window_expires_at < $1`,
    [now],
  );

  for (const row of stale) {
    await db.execute(
      `UPDATE fan_registrations_v2 SET status = 'expired' WHERE id = $1`,
      [row.id],
    );
  }

  return stale.length;
}
