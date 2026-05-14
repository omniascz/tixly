-- Re-entry Rules — opt-in pro festivaly / open-air akce, kde návštěvník
-- vychází ven a vrací se zpět (jídlo, toaleta, doprovod).
--
-- events.reentry_allowed = FALSE (default) → klasický single-use scan
-- events.reentry_allowed = TRUE → scanner použije /api/admin/scanner/reentry,
--                                   sleduje currently_inside + scan_count

BEGIN;

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS reentry_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reentry_max_count INTEGER NOT NULL DEFAULT 3
    CHECK (reentry_max_count BETWEEN 1 AND 100);

ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS currently_inside BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_entry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_exit_at TIMESTAMPTZ;

COMMENT ON COLUMN catalog.events.reentry_allowed IS
  'TRUE → návštěvník může opakovaně vyjít a vrátit se. Scanner musí používat /scanner/reentry endpoint.';
COMMENT ON COLUMN tickets.tickets.scan_count IS
  'Počet entry scanů. Při single-use vždy 0→1. Při reentry až do events.reentry_max_count.';
COMMENT ON COLUMN tickets.tickets.currently_inside IS
  'TRUE = aktuálně uvnitř (entry bez následujícího exit). Slouží pro evakuační listy + reentry rules.';

CREATE TABLE tickets.scan_events (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     UUID         NOT NULL,
  event_id      UUID         NOT NULL,
  scan_type     TEXT         NOT NULL CHECK (scan_type IN ('entry', 'exit', 'reentry')),
  scanned_by_user_id UUID,
  gate_id       UUID,
  scanned_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  notes         TEXT
);

CREATE INDEX idx_scan_events_ticket
  ON tickets.scan_events (ticket_id, scanned_at DESC);

CREATE INDEX idx_scan_events_event_time
  ON tickets.scan_events (event_id, scanned_at DESC);

COMMENT ON TABLE tickets.scan_events IS
  'Time series scan log pro re-entry akce. Pro evakuaci: SELECT WHERE event_id + scan_type=entry AND ticket nemá pozdější exit.';

COMMIT;
