-- Migration 128: Personalized push notifications (Feature #69)

CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE notifications.push_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID NOT NULL,              -- ref: catalog.events(id)
  user_id       UUID NOT NULL,              -- ref: users(id)
  type          TEXT NOT NULL CHECK (type IN ('on_sale', 'last_minute', 'schedule_change', 'day_before')),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  deep_link     TEXT,                       -- URL ke akci na mobilní app
  sent          BOOLEAN NOT NULL DEFAULT false,
  sent_at       TIMESTAMPTZ,
  delivered     BOOLEAN NOT NULL DEFAULT false,
  delivered_at  TIMESTAMPTZ,
  opened        BOOLEAN NOT NULL DEFAULT false,
  opened_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_event ON notifications.push_notifications (event_id);
CREATE INDEX idx_notifications_user ON notifications.push_notifications (user_id);
CREATE INDEX idx_notifications_unsent ON notifications.push_notifications (event_id)
  WHERE sent = false;
