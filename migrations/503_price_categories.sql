-- 503_price_categories.sql
--   Kolo 8 / krok 4 — slevové kategorie (plné, senior, student, ZTP, ZTP/P, doprovod ZTP/P, dítě, vlastní).
--
-- POUŽITO: catalog.ticket_types jako cenové zóny (ticket_types.zone, base_price = plná cena zóny), order_items,
--          tickets, marketing.promo_codes (applicable_ticket_type_ids = omezení na zóny).
-- NEPOUŽITO: catalog.discount_pricing_rules — sleva podle ověření uživatelského účtu (bez CRUD), ne kategorie
--          vybíraná u místa; nehodí se pro prodej, kde nárok prokazuje návštěvník u vstupu.
-- NOVĚ:    catalog.price_categories (šablona pořadatele: event_id NULL; kategorie termínu: event_id),
--          catalog.price_category_prices (cena kategorie v konkrétní zóně — pevná částka nebo procento z plné),
--          order_items/tickets.price_category_id + snapshot názvu a „ověřit průkaz", promo_codes.applicable_category_codes.
-- Idempotentní.

CREATE TABLE IF NOT EXISTS catalog.price_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
  code            text NOT NULL CHECK (code ~ '^[a-z0-9_-]{1,40}$'),
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  kind            text NOT NULL DEFAULT 'custom'
                  CHECK (kind IN ('full', 'senior', 'student', 'ztp', 'ztpp', 'ztpp_companion', 'child', 'custom')),
  -- výchozí cena v každé zóně: procento z plné ceny zóny (price_value = procenta × 100) nebo pevná částka (haléře)
  price_mode      text NOT NULL DEFAULT 'percent' CHECK (price_mode IN ('percent', 'fixed')),
  price_value     integer NOT NULL DEFAULT 10000 CHECK (price_value >= 0),
  requires_proof  boolean NOT NULL DEFAULT false,
  proof_label     text,
  limit_per_event integer CHECK (limit_per_event IS NULL OR limit_per_event >= 0),
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (price_mode <> 'percent' OR price_value <= 10000)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_categories_event_code ON catalog.price_categories (event_id, code) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_price_categories_template_code ON catalog.price_categories (promoter_id, code) WHERE event_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_categories_event ON catalog.price_categories (event_id);

CREATE TABLE IF NOT EXISTS catalog.price_category_prices (
  category_id    uuid NOT NULL REFERENCES catalog.price_categories(id) ON DELETE CASCADE,
  ticket_type_id uuid NOT NULL REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  promoter_id    uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  price_mode     text NOT NULL CHECK (price_mode IN ('percent', 'fixed')),
  price_value    integer NOT NULL CHECK (price_value >= 0),
  PRIMARY KEY (category_id, ticket_type_id),
  CHECK (price_mode <> 'percent' OR price_value <= 10000)
);

ALTER TABLE orders.order_items
  ADD COLUMN IF NOT EXISTS price_category_id uuid REFERENCES catalog.price_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_category_name text;
ALTER TABLE tickets.tickets
  ADD COLUMN IF NOT EXISTS price_category_id uuid REFERENCES catalog.price_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS price_category_name text,
  ADD COLUMN IF NOT EXISTS proof_required_label text;
COMMENT ON COLUMN tickets.tickets.proof_required_label IS 'Kolo 8: kategorie vyžaduje prokázat nárok u vstupu (např. „ZTP/P") — skener zobrazí „Ověřit průkaz".';

ALTER TABLE marketing.promo_codes ADD COLUMN IF NOT EXISTS applicable_category_codes text[];
-- telefon kupce (nákup míst / rezervace; pokladna hledá i podle telefonu — krok 5)
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS buyer_phone text;
COMMENT ON COLUMN marketing.promo_codes.applicable_category_codes IS 'Kolo 8: promo kód jen na tyto slevové kategorie (kódy), NULL = všechny.';

ALTER TABLE catalog.price_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.price_category_prices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_price_categories_scope ON catalog.price_categories;
CREATE POLICY p_price_categories_scope ON catalog.price_categories
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());
-- veřejný výběr kategorie u místa: kategorie publikovaného termínu (šablony ne)
DROP POLICY IF EXISTS p_price_categories_public_read ON catalog.price_categories;
CREATE POLICY p_price_categories_public_read ON catalog.price_categories
  FOR SELECT
  USING (event_id IS NOT NULL AND EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = price_categories.event_id AND e.status = 'published'));
DROP POLICY IF EXISTS p_price_category_prices_scope ON catalog.price_category_prices;
CREATE POLICY p_price_category_prices_scope ON catalog.price_category_prices
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());
DROP POLICY IF EXISTS p_price_category_prices_public_read ON catalog.price_category_prices;
CREATE POLICY p_price_category_prices_public_read ON catalog.price_category_prices
  FOR SELECT
  USING (EXISTS (SELECT 1 FROM catalog.price_categories c JOIN catalog.events e ON e.id = c.event_id
                  WHERE c.id = price_category_prices.category_id AND e.status = 'published'));

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.price_categories, catalog.price_category_prices TO tixly_app;
    REVOKE TRUNCATE ON catalog.price_categories, catalog.price_category_prices FROM tixly_app;
  END IF;
END $$;
