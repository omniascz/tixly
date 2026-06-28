-- Migration 385: Distribution network + SEPA payouts + Promoter-owned venues
--
-- GAP 1: Publish API / distribuční síť
--   events.distribution_enabled — promotér zahrne akci do distribuční sítě
--   event_distribution_partners — per-partner alokace a provize
--
-- GAP 2: Mezinárodní payouty
--   promoters.swift_bic   — SWIFT/BIC kód pro mezinárodní SEPA/Wire převody
--   promoters.payout_method — bank_transfer | sepa_credit | wise
--
-- GAP 3: Promotér-editovatelné sály
--   venues.promoter_id — pokud nastaveno, pouze tento promotér (+ platform admin) může editovat

-- ── GAP 1 ────────────────────────────────────────────────────────────────────

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS distribution_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog.events.distribution_enabled IS
  'TRUE = akce je viditelná a prodejná přes registrované distribuční partnery (resellers, ticketshopy).';

CREATE TABLE IF NOT EXISTS catalog.event_distribution_partners (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id               UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  partner_id             UUID NOT NULL REFERENCES platform.reseller_partners(id) ON DELETE CASCADE,
  allocation_qty         INTEGER CHECK (allocation_qty > 0),
  commission_override_pct NUMERIC(5,2) CHECK (commission_override_pct BETWEEN 0 AND 100),
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, partner_id)
);

CREATE INDEX IF NOT EXISTS idx_edp_event_id  ON catalog.event_distribution_partners(event_id);
CREATE INDEX IF NOT EXISTS idx_edp_partner_id ON catalog.event_distribution_partners(partner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.event_distribution_partners TO tixly_app;

-- RLS pro event_distribution_partners: promotér spravuje jen své akce
ALTER TABLE catalog.event_distribution_partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY edp_promoter_select ON catalog.event_distribution_partners
  FOR SELECT USING (
    event_id IN (
      SELECT id FROM catalog.events WHERE promoter_id = (
        SELECT promoter_id FROM platform.promoters
        WHERE user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY edp_promoter_insert ON catalog.event_distribution_partners
  FOR INSERT WITH CHECK (
    event_id IN (
      SELECT id FROM catalog.events WHERE promoter_id = (
        SELECT promoter_id FROM platform.promoters
        WHERE user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY edp_promoter_update ON catalog.event_distribution_partners
  FOR UPDATE USING (
    event_id IN (
      SELECT id FROM catalog.events WHERE promoter_id = (
        SELECT promoter_id FROM platform.promoters
        WHERE user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

CREATE POLICY edp_promoter_delete ON catalog.event_distribution_partners
  FOR DELETE USING (
    event_id IN (
      SELECT id FROM catalog.events WHERE promoter_id = (
        SELECT promoter_id FROM platform.promoters
        WHERE user_id = (NULLIF(current_setting('app.user_id', true), ''))::uuid
      )
    )
  );

-- ── GAP 2 ────────────────────────────────────────────────────────────────────

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS swift_bic TEXT,
  ADD COLUMN IF NOT EXISTS payout_method TEXT NOT NULL DEFAULT 'bank_transfer'
    CHECK (payout_method IN ('bank_transfer', 'sepa_credit', 'wise'));

COMMENT ON COLUMN platform.promoters.swift_bic IS
  'SWIFT/BIC kód banky pro SEPA Credit Transfer nebo mezinárodní wire. Vyžadováno pro payout_method=sepa_credit.';
COMMENT ON COLUMN platform.promoters.payout_method IS
  'Preferovaný způsob výplaty: bank_transfer (FIO, CZ/SK only), sepa_credit (EU SEPA), wise (globální).';

-- ── GAP 3 ────────────────────────────────────────────────────────────────────

ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS promoter_id UUID REFERENCES platform.promoters(id) ON DELETE SET NULL;

COMMENT ON COLUMN catalog.venues.promoter_id IS
  'Pokud nastaveno: soukromý sál patřící konkrétnímu promotérovi. Může editovat schema svého sálu bez schválení adminem.
   NULL = sdílený sál v katalogu, editovatelný pouze platform adminivem.';

CREATE INDEX IF NOT EXISTS idx_venues_promoter_id ON catalog.venues(promoter_id) WHERE promoter_id IS NOT NULL;
