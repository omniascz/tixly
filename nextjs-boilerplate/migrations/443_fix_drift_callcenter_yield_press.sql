-- 443 — fix schema-drift odhalený E2E dashboards walkem (admin GET endpointy 500).
--
-- (a) Chybějící tabulky: orders.phone_orders (call-center) a analytics.yield_rules
--     (demand-forecast) existovaly jen v kódu, nikdy nemigrované na prod ani na dev.
--     Sloupce odvozeny z INSERT/SELECT v příslušných routách. Bez RLS — konzistentní
--     s orders.* vzorem (guestlist_entries/foyer_orders/season_passes/press jsou taky
--     rls=false); přístup řízen v route přes WHERE promoter_id + ownership check.
-- (b) Prod drift: orders.press_accreditations chybí order_id + updated_at (lokál má).

-- ── (a1) Call-center phone orders ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders.phone_orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         uuid NOT NULL,
  event_id            uuid NOT NULL,
  ticket_type_id      uuid NOT NULL,
  quantity            integer NOT NULL,
  total_amount        integer NOT NULL,
  customer_name       text NOT NULL,
  customer_phone      text NOT NULL,
  customer_email      text,
  notes               text,
  pay_link_token      text NOT NULL,
  pay_link_expires_at timestamptz NOT NULL,
  created_by          uuid,
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_phone_orders_promoter ON orders.phone_orders (promoter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_phone_orders_event ON orders.phone_orders (event_id);

-- ── (a2) Demand-forecast yield rules ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics.yield_rules (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL,
  promoter_id        uuid NOT NULL,
  pct_threshold      numeric NOT NULL,
  action             text NOT NULL,
  price_delta_pct    numeric,
  notification_email text,
  is_active          boolean NOT NULL DEFAULT true,
  triggered_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_yield_rules_event ON analytics.yield_rules (event_id);

-- ── (b) Press accreditations drift ──────────────────────────────────────────
ALTER TABLE orders.press_accreditations ADD COLUMN IF NOT EXISTS order_id uuid;
ALTER TABLE orders.press_accreditations ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
