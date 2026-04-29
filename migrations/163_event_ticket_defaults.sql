-- =============================================================================
-- Migration 163: Default Ticket Settings per Event
-- Feature #177: Promoter sets event-level defaults applied to all ticket types
-- =============================================================================

CREATE TABLE IF NOT EXISTS catalog.event_ticket_defaults (
  event_id            UUID PRIMARY KEY REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  min_age             INT CHECK (min_age >= 0 AND min_age <= 120),
  max_per_order       INT CHECK (max_per_order >= 1),
  inactive_message    TEXT,                    -- shown when ticket type not on sale
  sale_start_offset_minutes INT,              -- auto sale_start = event_start - N minutes
  sale_end_offset_minutes   INT,              -- auto sale_end = event_start - N minutes
  require_name        BOOLEAN NOT NULL DEFAULT false,
  require_dob         BOOLEAN NOT NULL DEFAULT false,
  transfer_allowed    BOOLEAN NOT NULL DEFAULT true,
  resale_allowed      BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
