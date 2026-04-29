-- =============================================================================
-- Migration 156: Cross-Platform Scanner
-- Feature #183: Validate tickets from other platforms (Ticketportal, GoOut, Eventim)
--              Import guest list CSV → offline validation at the gate
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS cross_scanner;

-- Imported guest list: one list per event per source platform
CREATE TABLE IF NOT EXISTS cross_scanner.guest_lists (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  source_platform     TEXT NOT NULL CHECK (source_platform IN ('ticketportal', 'goout', 'eventim', 'manual', 'other')),
  file_name           TEXT NOT NULL,
  ticket_count        INT NOT NULL DEFAULT 0,
  imported_by         UUID NOT NULL,
  imported_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes               TEXT
);

-- Imported tickets: each row from the CSV
CREATE TABLE IF NOT EXISTS cross_scanner.imported_tickets (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_list_id       UUID NOT NULL REFERENCES cross_scanner.guest_lists(id) ON DELETE CASCADE,
  external_ticket_id  TEXT NOT NULL,          -- ID from source platform
  qr_code             TEXT NOT NULL UNIQUE,   -- the barcode/QR value to scan
  holder_name         TEXT,
  seat_info           TEXT,
  ticket_type         TEXT,
  scanned_at          TIMESTAMPTZ,            -- NULL = not yet scanned
  scanned_by_staff_id UUID,
  scan_result         TEXT CHECK (scan_result IN ('valid', 'duplicate', 'not_found'))
);

CREATE INDEX idx_imported_tickets_list ON cross_scanner.imported_tickets(guest_list_id);
CREATE INDEX idx_imported_tickets_qr ON cross_scanner.imported_tickets(qr_code);
CREATE INDEX idx_imported_tickets_external ON cross_scanner.imported_tickets(external_ticket_id);
CREATE INDEX idx_guest_lists_event ON cross_scanner.guest_lists(event_id);
