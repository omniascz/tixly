BEGIN;

CREATE TABLE IF NOT EXISTS catalog.commemorative_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE UNIQUE,
  quote           TEXT,
  theme_color     TEXT NOT NULL DEFAULT '#1a1a2e',
  accent_color    TEXT NOT NULL DEFAULT '#e2b96f',
  custom_message  TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS commemorative_sent_at TIMESTAMPTZ;

COMMIT;
