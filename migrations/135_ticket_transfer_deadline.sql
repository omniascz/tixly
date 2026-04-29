-- =============================================================================
-- Migration 135: Ticket Transfer Deadline — Prevent Speculation
-- Feature #37: Organizers can set transfer cutoff (1-31 days before event)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS transfers;

-- Transfer deadline configuration per event
CREATE TABLE transfers.transfer_deadlines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id       UUID NOT NULL,
  ticket_type_id    UUID REFERENCES catalogs.ticket_types(id),  -- NULL = all ticket types
  days_before_event INT NOT NULL CHECK (days_before_event BETWEEN 1 AND 31),
  deadline_datetime TIMESTAMPTZ,  -- Pre-calculated deadline for fast queries
  allow_transfers   BOOL NOT NULL DEFAULT true,  -- Can be used to disable all transfers
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, ticket_type_id)
);

-- Transfer attempt log (audit trail)
CREATE TABLE transfers.transfer_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id         UUID NOT NULL REFERENCES tickets.tickets(id),
  event_id          UUID NOT NULL REFERENCES catalog.events(id),
  from_user_id      UUID NOT NULL,
  to_user_id        UUID,  -- NULL if cancelled
  transfer_status   TEXT NOT NULL CHECK (transfer_status IN ('pending', 'completed', 'cancelled', 'deadline_exceeded')),
  transfer_error    TEXT,  -- e.g., 'DEADLINE_PASSED', 'NOT_ALLOWED'
  attempted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- Indexes
CREATE INDEX idx_transfer_deadlines_event ON transfers.transfer_deadlines(event_id);
CREATE INDEX idx_transfer_deadlines_promoter ON transfers.transfer_deadlines(promoter_id, event_id);
CREATE INDEX idx_transfer_log_ticket ON transfers.transfer_log(ticket_id);
CREATE INDEX idx_transfer_log_event ON transfers.transfer_log(event_id);
CREATE INDEX idx_transfer_log_attempted_at ON transfers.transfer_log(attempted_at);
