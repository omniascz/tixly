-- =============================================================================
-- Migration 146: Flex Plans
-- Feature #41: Season-pass holders assemble custom bundles from event pools
--              e.g. "Pick 10 from 20 matches". Extension of season-passes.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS flex_plans;

-- Catalog: a promoter-defined bundle offer
CREATE TABLE IF NOT EXISTS flex_plans.flex_catalogs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  select_count        INT NOT NULL CHECK (select_count >= 1),  -- how many events buyer must pick
  price_hellers       INT NOT NULL CHECK (price_hellers >= 0),
  currency            TEXT NOT NULL DEFAULT 'CZK',
  valid_from          DATE,
  valid_until         DATE,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pool of events offered in a catalog
CREATE TABLE IF NOT EXISTS flex_plans.flex_catalog_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id          UUID NOT NULL REFERENCES flex_plans.flex_catalogs(id) ON DELETE CASCADE,
  event_id            UUID NOT NULL REFERENCES catalog.events(id),
  ticket_type_id      UUID,                   -- specific ticket type; NULL = any available
  display_order       INT NOT NULL DEFAULT 0,
  UNIQUE (catalog_id, event_id)
);

-- Issued plan: one per buyer purchase
CREATE TABLE IF NOT EXISTS flex_plans.flex_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id          UUID NOT NULL REFERENCES flex_plans.flex_catalogs(id),
  user_id             UUID NOT NULL,
  promoter_id         UUID NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending_selection'
                        CHECK (status IN ('pending_selection', 'active', 'expired', 'cancelled')),
  payment_id          TEXT,                   -- external payment reference
  price_paid_hellers  INT NOT NULL DEFAULT 0,
  selections_locked   BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Buyer's event selections for their flex plan
CREATE TABLE IF NOT EXISTS flex_plans.flex_plan_selections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             UUID NOT NULL REFERENCES flex_plans.flex_plans(id) ON DELETE CASCADE,
  catalog_event_id    UUID NOT NULL REFERENCES flex_plans.flex_catalog_events(id),
  ticket_id           UUID,                   -- linked ticket once issued
  selected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, catalog_event_id)          -- can't select the same event twice
);

-- Indexes
CREATE INDEX idx_flex_catalogs_promoter ON flex_plans.flex_catalogs(promoter_id);
CREATE INDEX idx_flex_catalog_events_catalog ON flex_plans.flex_catalog_events(catalog_id);
CREATE INDEX idx_flex_plans_user ON flex_plans.flex_plans(user_id);
CREATE INDEX idx_flex_plans_catalog ON flex_plans.flex_plans(catalog_id);
CREATE INDEX idx_flex_plan_selections_plan ON flex_plans.flex_plan_selections(plan_id);
