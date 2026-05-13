-- =============================================================================
-- 088 — ai-fraud-detection
-- Detection run ledger for forensics + admin lookup
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS risk;

CREATE TABLE IF NOT EXISTS risk.detection_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type   TEXT NOT NULL CHECK (subject_type IN ('order', 'user', 'device')),
  subject_id     TEXT NOT NULL,
  total_score    INTEGER NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  recommendation TEXT NOT NULL CHECK (recommendation IN ('allow', 'review', 'block')),
  signals        JSONB NOT NULL,
  ran_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detection_runs_subject
  ON risk.detection_runs (subject_type, subject_id, ran_at DESC);

CREATE INDEX IF NOT EXISTS idx_detection_runs_recommendation
  ON risk.detection_runs (recommendation, ran_at DESC);
