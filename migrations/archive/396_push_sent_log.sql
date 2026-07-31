-- Migration 396: Push notification sent log (deduplication)

CREATE TABLE IF NOT EXISTS notifications.push_sent_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id           UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id          UUID REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id          UUID REFERENCES orders.orders(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL  -- 'reminder_24h' | 'reminder_4h' | 'onsale_alert' | 'abandoned_cart'
);

-- Partial unique indexes (not possible inline in CREATE TABLE)
CREATE UNIQUE INDEX IF NOT EXISTS push_sent_log_unique_event
  ON notifications.push_sent_log (user_id, event_id, notification_type)
  WHERE order_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS push_sent_log_unique_order
  ON notifications.push_sent_log (user_id, order_id, notification_type)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS push_sent_log_user_idx  ON notifications.push_sent_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS push_sent_log_event_idx ON notifications.push_sent_log (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_sent_log_cleanup_idx ON notifications.push_sent_log (created_at);

-- Ensure notification_preferences has push_enabled + abandoned_cart columns
ALTER TABLE identity.notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS abandoned_cart  BOOLEAN NOT NULL DEFAULT TRUE;
