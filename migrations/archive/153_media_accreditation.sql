-- =============================================================================
-- Migration 153: Mediální akreditace systém
-- Feature #191: Press/media accreditation with approval workflow and zone QR
--              Online request → promoter approval/reject → zone-specific QR
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS accreditation;

-- Accreditation requests
CREATE TABLE IF NOT EXISTS accreditation.accreditation_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  requester_name      TEXT NOT NULL,
  requester_email     TEXT NOT NULL,
  organization        TEXT NOT NULL,          -- media outlet / outlet name
  media_type          TEXT NOT NULL CHECK (media_type IN ('press', 'photo', 'tv', 'radio', 'online', 'podcast', 'other')),
  requested_zones     TEXT[] NOT NULL DEFAULT '{}',  -- zone IDs requested
  purpose             TEXT,                   -- brief description of coverage
  portfolio_url       TEXT,                   -- links to previous work
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  reviewed_by         UUID,                   -- promoter staff who approved/rejected
  review_notes        TEXT,                   -- internal notes
  approved_zones      TEXT[] NOT NULL DEFAULT '{}',  -- may be subset of requested
  qr_code_payload     TEXT,                   -- generated zone-specific QR payload
  qr_issued_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Scan log: track where each accredited person went
CREATE TABLE IF NOT EXISTS accreditation.accreditation_scans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accreditation_id    UUID NOT NULL REFERENCES accreditation.accreditation_requests(id),
  zone_id             TEXT NOT NULL,
  gate_id             TEXT,
  scanned_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result              TEXT NOT NULL CHECK (result IN ('allowed', 'denied')),
  deny_reason         TEXT
);

CREATE INDEX idx_accreditation_event ON accreditation.accreditation_requests(event_id);
CREATE INDEX idx_accreditation_email ON accreditation.accreditation_requests(requester_email);
CREATE INDEX idx_accreditation_status ON accreditation.accreditation_requests(status);
CREATE INDEX idx_accreditation_scans_acc ON accreditation.accreditation_scans(accreditation_id);
