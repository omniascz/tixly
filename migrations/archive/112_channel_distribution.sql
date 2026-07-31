-- Migration 112: Multichannel distribuce (Feature #55)
-- Inventory sync s Goout a SMSticket jako distribuční kanály.
-- Pořadatel prodává přes více platforem z jednoho místa.

CREATE SCHEMA IF NOT EXISTS channels;

-- Registr externích distribučních kanálů
CREATE TABLE channels.channel_providers (
  id         TEXT PRIMARY KEY,           -- 'goout' | 'smsticket' | 'ticketportal'
  label      TEXT NOT NULL,
  base_url   TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO channels.channel_providers (id, label, base_url) VALUES
  ('goout',      'GoOut',      'https://api.goout.net/v1'),
  ('smsticket',  'SMSticket',  'https://api.smsticket.cz/v2');

-- Přiřazení kanálů ke konkrétním akcím promotéra
CREATE TABLE channels.event_channel_allocations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           UUID NOT NULL,              -- ref: catalog.events(id)
  promoter_id        UUID NOT NULL,              -- tenant
  channel_id         TEXT NOT NULL REFERENCES channels.channel_providers(id),
  allocated_qty      INTEGER NOT NULL CHECK (allocated_qty >= 0),
  sold_qty           INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  price_override_halire INTEGER,                 -- NULL = use default event price
  external_event_id  TEXT,                       -- ID akce na cizí platformě (po sync)
  status             TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'active', 'paused', 'closed')),
  last_synced_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, channel_id),
  CONSTRAINT allocated_gte_sold CHECK (allocated_qty >= sold_qty)
);

-- Log každého inventory sync (pro audit a debugging)
CREATE TABLE channels.sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id   UUID NOT NULL REFERENCES channels.event_channel_allocations(id),
  direction       TEXT NOT NULL CHECK (direction IN ('push', 'pull')),
  payload_hash    TEXT,                          -- SHA-256 payloadu (deduplikace)
  status          TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  error_message   TEXT,
  duration_ms     INTEGER,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexy
CREATE INDEX idx_eca_event      ON channels.event_channel_allocations (event_id);
CREATE INDEX idx_eca_promoter   ON channels.event_channel_allocations (promoter_id);
CREATE INDEX idx_eca_channel    ON channels.event_channel_allocations (channel_id);
CREATE INDEX idx_sync_log_alloc ON channels.sync_log (allocation_id);
