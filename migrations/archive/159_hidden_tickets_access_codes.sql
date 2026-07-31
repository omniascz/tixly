-- =============================================================================
-- Migration 159: Hidden Tickets / Access Code Tickets
-- Feature #160: Ticket types visible only via secret link or access code
-- =============================================================================

-- Access codes: a code that unlocks one or more hidden ticket types
CREATE TABLE IF NOT EXISTS catalog.access_codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  code                TEXT NOT NULL,
  label               TEXT,                    -- internal label e.g. "Fan Club Presale"
  max_uses            INT,                     -- NULL = unlimited
  uses_count          INT NOT NULL DEFAULT 0,
  valid_from          TIMESTAMPTZ,
  valid_until         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, code)
);

-- Links access codes to the ticket types they unlock
CREATE TABLE IF NOT EXISTS catalog.access_code_ticket_types (
  access_code_id      UUID NOT NULL REFERENCES catalog.access_codes(id) ON DELETE CASCADE,
  ticket_type_id      UUID NOT NULL,
  PRIMARY KEY (access_code_id, ticket_type_id)
);

-- Add visibility column to ticket types (extend existing table)
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'hidden', 'access_code'));

CREATE INDEX idx_access_codes_event ON catalog.access_codes(event_id);
CREATE INDEX idx_access_codes_code ON catalog.access_codes(event_id, code);
