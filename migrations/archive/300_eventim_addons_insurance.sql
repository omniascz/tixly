-- 300_eventim_addons_insurance.sql
-- Eventim Parity Fáze E4 — REVIDOVÁNO:
--
-- Cross-sell add-ons (merch/F&B/parking/hotel) Tixly už má KOMPLET:
--   - public.checkout_addons (migrace ≤ 269, plus event_bundle_addons)
--   - /api/admin/events/[id]/addons + /[addonId] + public /api/events/[id]/addons
--   - /admin/events/[id]/addons UI
-- Při původním pokusu jsem vytvořil paralelní catalog.event_addons + orders.order_addons,
-- DROPnuto. Tahle migrace teď dodává **jen insurance** vrstvu.
--
-- Insurance — Tixly měl jen archivovanou implementaci. Aktivujem:
--   1. catalog.insurance_plans (nový katalog provider plans)
--   2. orders.order_insurance.plan_id link (existing tabulka, jen alter)
--   3. Seed 2 default plans (Allianz Standard + Premium)

BEGIN;

-- ============================================================
-- Insurance plans katalog
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.insurance_plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            text NOT NULL,              -- "Standard", "Premium"
  provider        text NOT NULL,              -- "Allianz", "AXA", "ERV"
  description     text,
  -- Pricing: pct of subtotal nebo fixní
  price_pct       numeric(5,2),
  price_flat_halire integer,
  -- Coverage
  covers_illness  boolean NOT NULL DEFAULT true,
  covers_cancellation boolean NOT NULL DEFAULT true,
  covers_transport_strike boolean NOT NULL DEFAULT false,
  covers_weather  boolean NOT NULL DEFAULT false,
  coverage_url    text,
  is_active       boolean NOT NULL DEFAULT true,
  display_order   integer NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (price_pct IS NOT NULL OR price_flat_halire IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_insurance_plans_active
  ON catalog.insurance_plans(is_active, display_order);

COMMENT ON TABLE catalog.insurance_plans IS
  'Insurance plans (provider-managed nebo promoter-custom). Per order checkbox v checkoutu.';

-- Seed: 2 default plans
INSERT INTO catalog.insurance_plans
  (promoter_id, name, provider, description, price_pct, covers_illness, covers_cancellation,
   covers_transport_strike, covers_weather, is_active, display_order)
VALUES
  (NULL, 'Standard', 'Allianz', 'Pokrývá nemoc + nepředvídatelné zrušení', 5.0,
    true, true, false, false, true, 100),
  (NULL, 'Premium', 'Allianz', 'Plné krytí včetně dopravy a počasí', 9.5,
    true, true, true, true, true, 200)
ON CONFLICT DO NOTHING;

-- ============================================================
-- Link existing orders.order_insurance → catalog.insurance_plans
-- (orders.order_insurance existuje z archived insurance modulu)
-- ============================================================
ALTER TABLE orders.order_insurance
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES catalog.insurance_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_order_insurance_plan
  ON orders.order_insurance(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_insurance_policy_ref
  ON orders.order_insurance(policy_ref) WHERE policy_ref IS NOT NULL;

INSERT INTO public.schema_migrations (filename)
VALUES ('300_eventim_addons_insurance.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
