-- Migration 427: RFM customer segmentation scores cache
-- Stores pre-computed Recency/Frequency/Monetary scores per promoter+user pair.
-- Recomputed on-demand via POST /api/admin/crm/rfm/compute.

BEGIN;

CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS marketing.rfm_scores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  email            text NOT NULL,
  name             text,
  recency_days     int NOT NULL,
  frequency        int NOT NULL,
  monetary_halire  bigint NOT NULL,
  r_score          int NOT NULL CHECK (r_score BETWEEN 1 AND 5),
  f_score          int NOT NULL CHECK (f_score BETWEEN 1 AND 5),
  m_score          int NOT NULL CHECK (m_score BETWEEN 1 AND 5),
  rfm_total        int NOT NULL GENERATED ALWAYS AS (r_score + f_score + m_score) STORED,
  segment          text NOT NULL CHECK (segment IN ('A','B','C','D')),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (promoter_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rfm_promoter_segment  ON marketing.rfm_scores(promoter_id, segment);
CREATE INDEX IF NOT EXISTS idx_rfm_promoter_monetary ON marketing.rfm_scores(promoter_id, monetary_halire DESC);

ALTER TABLE marketing.rfm_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY rfm_promoter_isolation ON marketing.rfm_scores
  USING (promoter_id::text = current_setting('app.current_promoter_id', true));

CREATE POLICY rfm_platform_admin ON marketing.rfm_scores
  USING (current_setting('app.is_platform_admin', true) = 'true');

COMMIT;
