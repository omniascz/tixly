-- Migration 410: Dynamic pricing (AI) — automatické ceny dle poptávky
--
-- Architektura:
--   pricing.dynamic_pricing_rules  — pravidla per event (trigger → price adjustment)
--   pricing.price_adjustment_log   — audit log každé změny ceny
--   catalog.ticket_types           — +3 sloupce: dp_enabled, dp_min, dp_max
--                                    (base_price a dynamic_price_minor existují)
--   catalog.events                 — +1 sloupec: dynamic_pricing_enabled
--
-- Engine (src/lib/pricing/dynamic-engine.ts) počítá demand_score a aplikuje pravidla.
-- Aktuální cena = dynamic_price_minor (pokud != NULL) JINAK base_price.
-- Engine zapisuje do dynamic_price_minor + dynamic_price_updated_at (existují od starší mig).
-- Cron nebo manuální trigger: POST /api/internal/pricing/recalculate
-- AI suggestion:             POST /api/admin/events/[id]/dynamic-pricing/suggest

-- ─── Pravidla ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing.dynamic_pricing_rules (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid         NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     uuid         NOT NULL REFERENCES platform.promoters(id),
  rule_type       text         NOT NULL
                               CHECK (rule_type IN (
                                 'capacity_threshold',
                                 'time_decay',
                                 'last_minute',
                                 'early_bird',
                                 'velocity_surge'
                               )),
  trigger_condition jsonb      NOT NULL DEFAULT '{}',
  price_adjustment  jsonb      NOT NULL DEFAULT '{}',
  applies_to        text       NOT NULL DEFAULT 'all',
  max_price_multiplier numeric(4,2) NOT NULL DEFAULT 2.00,
  min_price_multiplier numeric(4,2) NOT NULL DEFAULT 0.50,
  priority          smallint   NOT NULL DEFAULT 1,
  is_active         boolean    NOT NULL DEFAULT true,
  applied_count     int        NOT NULL DEFAULT 0,
  last_applied_at   timestamptz,
  ai_generated      boolean    NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dp_rules_event    ON pricing.dynamic_pricing_rules (event_id);
CREATE INDEX IF NOT EXISTS idx_dp_rules_promoter ON pricing.dynamic_pricing_rules (promoter_id);

-- ─── Audit log ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pricing.price_adjustment_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          uuid         NOT NULL REFERENCES catalog.events(id),
  ticket_type_id    uuid         NOT NULL REFERENCES catalog.ticket_types(id),
  rule_id           uuid         REFERENCES pricing.dynamic_pricing_rules(id),
  old_price_halire  int          NOT NULL,
  new_price_halire  int          NOT NULL,
  price_diff_pct    numeric(6,2) NOT NULL,
  trigger_reason    text         NOT NULL,
  demand_score      numeric(5,4),
  capacity_pct      numeric(5,4),
  velocity_24h      int,
  hours_to_event    int,
  applied_at        timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dp_log_event      ON pricing.price_adjustment_log (event_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS idx_dp_log_tt         ON pricing.price_adjustment_log (ticket_type_id);

-- ─── Rozšíření catalog.ticket_types ─────────────────────────────────────────
-- base_price a dynamic_price_minor/updated_at/signals existují od starší migrace.

ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dp_min_halire           int,
  ADD COLUMN IF NOT EXISTS dp_max_halire           int;

-- ─── Rozšíření catalog.events ───────────────────────────────────────────────

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS dynamic_pricing_enabled boolean NOT NULL DEFAULT false;

COMMENT ON TABLE  pricing.dynamic_pricing_rules IS
  'Pravidla pro automatické úpravy ceny dle poptávky';
COMMENT ON COLUMN catalog.ticket_types.dynamic_pricing_enabled IS
  'DP aktivní pro tento typ; engine zapisuje do dynamic_price_minor';
