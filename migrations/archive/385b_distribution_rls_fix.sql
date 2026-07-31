-- Migration 385b: Fix RLS policies for event_distribution_partners
-- (385 partially applied up to statement 7; this completes it)

-- Drop any partially-created policies first
DROP POLICY IF EXISTS edp_promoter_select ON catalog.event_distribution_partners;
DROP POLICY IF EXISTS edp_promoter_insert ON catalog.event_distribution_partners;
DROP POLICY IF EXISTS edp_promoter_update ON catalog.event_distribution_partners;
DROP POLICY IF EXISTS edp_promoter_delete ON catalog.event_distribution_partners;

CREATE POLICY edp_promoter_select ON catalog.event_distribution_partners
  FOR SELECT USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
    )
  );

CREATE POLICY edp_promoter_insert ON catalog.event_distribution_partners
  FOR INSERT WITH CHECK (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
    )
  );

CREATE POLICY edp_promoter_update ON catalog.event_distribution_partners
  FOR UPDATE USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
    )
  );

CREATE POLICY edp_promoter_delete ON catalog.event_distribution_partners
  FOR DELETE USING (
    event_id IN (
      SELECT id FROM catalog.events
      WHERE promoter_id = current_setting('app.promoter_id', TRUE)::UUID
    )
  );

-- GAP 2: SEPA / payout method fields (idempotent)
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS payout_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'sepa_credit', 'wise'));

-- GAP 3: Promoter-owned venues (idempotent)
ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS promoter_id UUID REFERENCES platform.promoters(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_venues_promoter_id ON catalog.venues(promoter_id) WHERE promoter_id IS NOT NULL;
