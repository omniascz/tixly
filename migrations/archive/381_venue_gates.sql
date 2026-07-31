-- Migration 381: Fyzické brány/vstupy sálu + bezbariérová pravidla
--
-- Přidává:
--   catalog.venue_gates           - fyzické vstupy (Brána A, Vstup sever, …)
--   event_seats.recommended_gate  - doporučená brána pro dané sedadlo
--   event_zones.accessible_gate_*  - bezbariérové pravidlo per-zóna

-- 1) Fyzické vstupy sálu ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog.venue_gates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id        UUID NOT NULL REFERENCES catalog.venues(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,            -- 'A', 'B', 'Gate 3', 'North'
  label           TEXT NOT NULL,            -- 'Brána A', 'Vstup sever'
  description     TEXT,                     -- 'Boční vstup, 2. patro'
  is_accessible   BOOLEAN NOT NULL DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (venue_id, code)
);

-- RLS: Promotér vidí brány svých venues; platform admin vše
ALTER TABLE catalog.venue_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY venue_gates_select ON catalog.venue_gates FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM catalog.venues v
     WHERE v.id = venue_id
       AND (
         current_setting('app.promoter_id', true) = v.promoter_id::text
         OR current_setting('app.is_platform_admin', true) = 'true'
         OR current_setting('app.is_service', true) = 'true'
       )
  )
);
CREATE POLICY venue_gates_write ON catalog.venue_gates FOR ALL USING (
  EXISTS (
    SELECT 1 FROM catalog.venues v
     WHERE v.id = venue_id
       AND (
         current_setting('app.is_platform_admin', true) = 'true'
         OR current_setting('app.is_service', true) = 'true'
       )
  )
);

-- 2) Doporučená brána na sedadlech (bulk update přes admin) ─────────────────
ALTER TABLE catalog.event_seats
  ADD COLUMN IF NOT EXISTS recommended_gate_id UUID REFERENCES catalog.venue_gates(id) ON DELETE SET NULL;

ALTER TABLE catalog.venue_seating_charts
  ADD COLUMN IF NOT EXISTS default_gate_id UUID REFERENCES catalog.venue_gates(id) ON DELETE SET NULL;

-- 3) Bezbariérové vstupní pravidlo per-zóna ─────────────────────────────────
ALTER TABLE catalog.event_zones
  ADD COLUMN IF NOT EXISTS accessible_gate_id   UUID REFERENCES catalog.venue_gates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS accessible_gate_notes TEXT;

-- 4) Index pro rychlé dotazy ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_venue_gates_venue ON catalog.venue_gates(venue_id);
CREATE INDEX IF NOT EXISTS idx_event_seats_gate  ON catalog.event_seats(recommended_gate_id) WHERE recommended_gate_id IS NOT NULL;

-- 5) Granty pro tixly_app ────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.venue_gates TO tixly_app;
