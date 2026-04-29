// =============================================================================
// Personalized push notifications — Feature #69
//
// On-sale alerts, last-minute nabídky, změna pořadu, info den před akcí.
// Propojení s event systémem a push-notification-copy modul.
//
// SCHEMA: notifications.* (migration 128)
// =============================================================================

export type NotificationType = 'on_sale' | 'last_minute' | 'schedule_change' | 'day_before';

export interface PushNotification {
  id: string;
  eventId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  deepLink?: string;                 // URL ke akci
  sent: boolean;
  sentAt: string | null;
  delivered: boolean;
  deliveredAt: string | null;
  opened: boolean;
  openedAt: string | null;
  createdAt: string;
}

export interface CreateNotificationInput {
  eventId: string;
  userIds: string[];                // batch send
  type: NotificationType;
  title: string;
  message: string;
  deepLink?: string;
}

export interface SendPushInput {
  userId: string;
  title: string;
  message: string;
  deepLink?: string;
}

export interface DbAdapter {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface PushProvider {
  /** Odešle push notifikaci. Vrátí true pokud úspěšné. */
  send(input: SendPushInput): Promise<boolean>;
}

interface NotificationRow {
  id: string;
  event_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  deep_link: string | null;
  sent: boolean;
  sent_at: string | null;
  delivered: boolean;
  delivered_at: string | null;
  opened: boolean;
  opened_at: string | null;
  created_at: string;
}

function mapNotification(row: NotificationRow): PushNotification {
  return {
    id: row.id,
    eventId: row.event_id,
    userId: row.user_id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    deepLink: row.deep_link || undefined,
    sent: row.sent,
    sentAt: row.sent_at,
    delivered: row.delivered,
    deliveredAt: row.delivered_at,
    opened: row.opened,
    openedAt: row.opened_at,
    createdAt: row.created_at,
  };
}

/**
 * Vytvoří push notifikace pro seznam uživatelů (batch).
 */
export async function createNotifications(
  input: CreateNotificationInput,
  db: DbAdapter,
): Promise<PushNotification[]> {
  if (input.userIds.length === 0) {
    throw new Error('VALIDATION_ERROR: at least one user required');
  }

  const notifications = input.userIds.map(userId => ({
    event_id: input.eventId,
    user_id: userId,
    type: input.type,
    title: input.title,
    message: input.message,
    deep_link: input.deepLink || null,
  }));

  const rows = await db.query<NotificationRow>(
    `INSERT INTO notifications.push_notifications
       (event_id, user_id, type, title, message, deep_link)
     SELECT * FROM UNNEST(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[]
     ) AS t(event_id, user_id, type, title, message, deep_link)
     RETURNING *`,
    [
      input.userIds.map(() => input.eventId),
      input.userIds,
      input.userIds.map(() => input.type),
      input.userIds.map(() => input.title),
      input.userIds.map(() => input.message),
      input.userIds.map(() => input.deepLink || null),
    ],
  );
  return rows.map(mapNotification);
}

/**
 * Odešle push notifikaci přes provider a markuje jako sent.
 */
export async function sendNotification(
  notificationId: string,
  provider: PushProvider,
  db: DbAdapter,
): Promise<PushNotification> {
  const notifs = await db.query<NotificationRow>(
    `SELECT * FROM notifications.push_notifications WHERE id = $1 AND sent = false`,
    [notificationId],
  );
  if (!notifs[0]) throw new Error('NOT_FOUND: Notification not found or already sent');

  const notif = notifs[0];
  const success = await provider.send({
    userId: notif.user_id,
    title: notif.title,
    message: notif.message,
    deepLink: notif.deep_link || undefined,
  });

  if (!success) {
    throw new Error('SEND_FAILED: Provider failed to send notification');
  }

  const rows = await db.query<NotificationRow>(
    `UPDATE notifications.push_notifications
     SET sent = true, sent_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [notificationId],
  );
  if (!rows[0]) throw new Error('INTERNAL_ERROR: update failed');
  return mapNotification(rows[0]);
}

/**
 * Markuje notifikaci jako delivered (webhook call).
 */
export async function markDelivered(notificationId: string, db: DbAdapter): Promise<PushNotification> {
  const rows = await db.query<NotificationRow>(
    `UPDATE notifications.push_notifications
     SET delivered = true, delivered_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [notificationId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Notification not found');
  return mapNotification(rows[0]);
}

/**
 * Markuje notifikaci jako opened (user click).
 */
export async function markOpened(notificationId: string, db: DbAdapter): Promise<PushNotification> {
  const rows = await db.query<NotificationRow>(
    `UPDATE notifications.push_notifications
     SET opened = true, opened_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [notificationId],
  );
  if (!rows[0]) throw new Error('NOT_FOUND: Notification not found');
  return mapNotification(rows[0]);
}

/**
 * Vrátí metriky pro notifikace určité akce.
 */
export async function getNotificationMetrics(
  eventId: string,
  db: DbAdapter,
): Promise<{ sent: number; delivered: number; opened: number; deliveryRate: number; openRate: number }> {
  const rows = await db.query<{ sent: number; delivered: number; opened: number }>(
    `SELECT
       SUM(CASE WHEN sent = true THEN 1 ELSE 0 END) as sent,
       SUM(CASE WHEN delivered = true THEN 1 ELSE 0 END) as delivered,
       SUM(CASE WHEN opened = true THEN 1 ELSE 0 END) as opened
     FROM notifications.push_notifications
     WHERE event_id = $1`,
    [eventId],
  );
  if (!rows[0]) return { sent: 0, delivered: 0, opened: 0, deliveryRate: 0, openRate: 0 };

  const sent = rows[0].sent || 0;
  const delivered = rows[0].delivered || 0;
  const opened = rows[0].opened || 0;

  return {
    sent,
    delivered,
    opened,
    deliveryRate: sent > 0 ? Math.round((delivered / sent) * 100) : 0,
    openRate: delivered > 0 ? Math.round((opened / delivered) * 100) : 0,
  };
}
