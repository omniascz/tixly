-- Migration 272: platform.incidents + incident_updates
--
-- Status page (/cs/status) zobrazuje incidenty za posledních 14 dní.
-- Master admin publikuje incidenty z /platform/incidents.

CREATE TABLE IF NOT EXISTS platform.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'investigating', 'identified', 'monitoring', 'resolved'
  )),
  severity TEXT NOT NULL DEFAULT 'minor' CHECK (severity IN (
    'minor', 'major', 'critical'
  )),
  affected_services TEXT[] DEFAULT '{}'::text[],
  is_public BOOLEAN NOT NULL DEFAULT TRUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incidents_status
  ON platform.incidents (status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_incidents_public_recent
  ON platform.incidents (started_at DESC)
  WHERE is_public = TRUE;

CREATE TABLE IF NOT EXISTS platform.incident_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES platform.incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX IF NOT EXISTS idx_incident_updates_incident
  ON platform.incident_updates (incident_id, created_at DESC);
