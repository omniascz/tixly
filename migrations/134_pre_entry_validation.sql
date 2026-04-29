-- =============================================================================
-- Migration 134: Pre-Entry Check Mode — Dry-Run Validation Without Logging
-- Feature #36: Validate tickets before gates open, prevent congestion
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS validation;

-- Pre-entry validation checks (dry-run, no scan log written)
CREATE TABLE validation.pre_entry_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  ticket_id         UUID NOT NULL REFERENCES tickets.tickets(id),
  check_time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_valid          BOOL NOT NULL,
  validation_error  TEXT,  -- e.g. 'TICKET_REFUNDED', 'WRONG_EVENT', NULL if valid
  staff_email       TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, ticket_id, check_time)
);

-- Event pre-entry settings
CREATE TABLE validation.event_entry_modes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id) UNIQUE,
  promoter_id       UUID NOT NULL,
  pre_entry_mode    BOOL NOT NULL DEFAULT false,
  pre_entry_start   TIMESTAMPTZ,  -- When pre-entry mode starts
  pre_entry_end     TIMESTAMPTZ,  -- When normal scanning starts
  allow_batch_check BOOL NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Batch pre-entry validation results
CREATE TABLE validation.batch_checks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  staff_email       TEXT NOT NULL,
  total_checked     INT NOT NULL DEFAULT 0,
  valid_count       INT NOT NULL DEFAULT 0,
  invalid_count     INT NOT NULL DEFAULT 0,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  batch_duration_ms INT  -- Duration of batch check in milliseconds
);

-- Indexes
CREATE INDEX idx_pre_entry_checks_event ON validation.pre_entry_checks(event_id);
CREATE INDEX idx_pre_entry_checks_ticket ON validation.pre_entry_checks(ticket_id);
CREATE INDEX idx_pre_entry_checks_time ON validation.pre_entry_checks(checked_at);
CREATE INDEX idx_event_entry_modes_event ON validation.event_entry_modes(event_id);
CREATE INDEX idx_batch_checks_event ON validation.batch_checks(event_id);
