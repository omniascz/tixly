-- Web Push Notifications — Schema
-- Ukládá Push Subscription objects (W3C Push API).
-- Po registraci v browseru klient pošle endpoint + p256dh + auth keys; server je
-- použije pro VAPID-podepsané push zprávy přes endpoint.

BEGIN;

CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE notifications.push_subscriptions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  endpoint        TEXT         NOT NULL,
  p256dh_key      TEXT         NOT NULL,
  auth_key        TEXT         NOT NULL,
  user_agent      TEXT,
  last_used_at    TIMESTAMPTZ,
  failure_count   INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (endpoint)
);

CREATE INDEX idx_push_subscriptions_user_id
  ON notifications.push_subscriptions (user_id);

CREATE INDEX idx_push_subscriptions_active
  ON notifications.push_subscriptions (user_id)
  WHERE failure_count < 3;

COMMENT ON COLUMN notifications.push_subscriptions.endpoint IS
  'Push service URL (FCM/APNs/Mozilla) — kam server posílá zprávu. Z PushSubscription.endpoint.';
COMMENT ON COLUMN notifications.push_subscriptions.p256dh_key IS
  'Base64url P-256 veřejný klíč klienta pro payload encryption.';
COMMENT ON COLUMN notifications.push_subscriptions.auth_key IS
  'Base64url auth secret (16 bytů) z PushSubscription.getKey(''auth'').';
COMMENT ON COLUMN notifications.push_subscriptions.failure_count IS
  'Počet po sobě jdoucích selhání. >=3 → subscription se přestane používat (čeká na unsubscribe).';

COMMIT;
