-- =============================================================================
-- Migration 143: Eventim XML/API Export
-- Feature #34: Export events in Eventim-compatible XML format for CZ distribution
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS eventim_export;

-- Export job: one per event, tracks the last export state
CREATE TABLE IF NOT EXISTS eventim_export.export_jobs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id         UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generating', 'done', 'failed', 'submitted')),
  xml_payload         TEXT,                   -- Generated XML (stored for audit/retry)
  eventim_event_id    TEXT,                   -- Eventim's external ID after submission
  error_message       TEXT,
  last_exported_at    TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique per event — one active export config per event
CREATE UNIQUE INDEX idx_eventim_export_event ON eventim_export.export_jobs(event_id)
  WHERE status NOT IN ('failed');

-- Export log: history of all export/submission attempts
CREATE TABLE IF NOT EXISTS eventim_export.export_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              UUID NOT NULL REFERENCES eventim_export.export_jobs(id),
  action              TEXT NOT NULL CHECK (action IN ('generate', 'validate', 'submit', 'update', 'cancel')),
  status              TEXT NOT NULL CHECK (status IN ('ok', 'error')),
  response_code       INT,
  message             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_eventim_export_log_job ON eventim_export.export_log(job_id);
