-- Migration 123: SMS opt-in flow (Feature #180)

CREATE SCHEMA IF NOT EXISTS sms_marketing;

CREATE TABLE sms_marketing.sms_optins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL UNIQUE,         -- ref: orders.orders(id)
  buyer_id       UUID NOT NULL,                -- ref: users(id)
  event_id       UUID NOT NULL,                -- ref: catalog.events(id)
  phone_number   TEXT NOT NULL,                -- normalizované +420...
  language       TEXT NOT NULL DEFAULT 'cs'
                   CHECK (language IN ('cs', 'en', 'de')),
  opted          BOOLEAN NOT NULL DEFAULT false,
  opted_at       TIMESTAMPTZ,                  -- kdy se přihlásil
  synced         BOOLEAN NOT NULL DEFAULT false,  -- odesláno do bulkgate?
  synced_at      TIMESTAMPTZ,                  -- kdy se synchronizoval
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_optins_event   ON sms_marketing.sms_optins (event_id);
CREATE INDEX idx_optins_pending ON sms_marketing.sms_optins (opted, synced)
  WHERE opted = true AND synced = false;
CREATE INDEX idx_optins_synced  ON sms_marketing.sms_optins (synced_at DESC)
  WHERE synced = true;
