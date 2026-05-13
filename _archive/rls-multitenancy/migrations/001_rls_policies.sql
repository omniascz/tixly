-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 001: Row Level Security policies
-- Tixly — multi-tenant data isolation
--
-- Mechanismus:
--   Před každým dotazem aplikace nastaví:
--     SET LOCAL app.current_promoter_id = '<uuid>'
--     SET LOCAL app.current_user_id     = '<uuid>'
--     SET LOCAL app.current_role        = 'promoter' | 'buyer' | 'admin' | 'service'
--   RLS policies čtou tyto proměnné a povolí/zamítnou přístup na úrovni řádku.
--
-- Role a přístup:
--   service  → full access (cron joby, migrační skripty)
--   admin    → full access (platform administrátor)
--   promoter → vidí jen svá data (organizer_id / promoter_id = current_promoter_id)
--   buyer    → vidí jen své objednávky a vstupenky (user_id = current_user_id)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA
-- ═══════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS platform;

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNKCE
-- ═══════════════════════════════════════════════════════════════════════════

-- Vrátí current_promoter_id jako UUID nebo NULL
-- TRUE v current_setting znamená "nevyhazuj error pokud proměnná neexistuje"
CREATE OR REPLACE FUNCTION platform.current_promoter_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_promoter_id', TRUE), '')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Vrátí current_user_id jako UUID nebo NULL
CREATE OR REPLACE FUNCTION platform.current_user_id()
RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.current_user_id', TRUE), '')::UUID;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Vrátí aktuální roli aplikace (service/admin/promoter/buyer)
-- Výchozí hodnota je 'buyer' pokud proměnná není nastavena
CREATE OR REPLACE FUNCTION platform.current_app_role()
RETURNS TEXT AS $$
  SELECT COALESCE(current_setting('app.current_role', TRUE), 'buyer');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Je aktuální role privilegovaná (admin nebo service)?
-- Privilegované role mají full access — RLS je neomezuje.
CREATE OR REPLACE FUNCTION platform.is_privileged()
RETURNS BOOLEAN AS $$
  SELECT platform.current_app_role() IN ('service', 'admin');
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- catalog.events — RLS
-- Hlavní tabulka eventů. organizer_id odkazuje na promotéra.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE catalog.events ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   admin/service → vše
--   promoter      → jen své eventy (organizer_id = current_promoter_id)
--   buyer         → jen publishované eventy (status = 'published')
CREATE POLICY events_select ON catalog.events
  FOR SELECT USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND organizer_id = platform.current_promoter_id()
    )
    OR status = 'published'
  );

-- INSERT:
--   admin/service → vše
--   promoter      → jen pod svým ID (organizer_id musí odpovídat)
CREATE POLICY events_insert ON catalog.events
  FOR INSERT WITH CHECK (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND organizer_id = platform.current_promoter_id()
    )
  );

-- UPDATE:
--   admin/service → vše
--   promoter      → jen své eventy
CREATE POLICY events_update ON catalog.events
  FOR UPDATE USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND organizer_id = platform.current_promoter_id()
    )
  );

-- DELETE: pouze admin/service (hard delete je destruktivní)
CREATE POLICY events_delete ON catalog.events
  FOR DELETE USING (platform.is_privileged());

-- ═══════════════════════════════════════════════════════════════════════════
-- catalog.ticket_types — RLS
-- Typy vstupenek jsou vázány na event — přístup přes event ownership.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE catalog.ticket_types ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   admin/service → vše
--   promoter      → typy vstupenek svých eventů
--   buyer         → typy vstupenek publishovaných eventů
CREATE POLICY ticket_types_select ON catalog.ticket_types
  FOR SELECT USING (
    platform.is_privileged()
    OR EXISTS (
      SELECT 1 FROM catalog.events e
      WHERE e.id = event_id
        AND (
          e.status = 'published'
          OR (
            platform.current_app_role() = 'promoter'
            AND e.organizer_id = platform.current_promoter_id()
          )
        )
    )
  );

-- INSERT: promotér může přidat typ jen ke svému eventu
CREATE POLICY ticket_types_insert ON catalog.ticket_types
  FOR INSERT WITH CHECK (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND EXISTS (
        SELECT 1 FROM catalog.events e
        WHERE e.id = event_id
          AND e.organizer_id = platform.current_promoter_id()
      )
    )
  );

-- UPDATE: promotér může měnit jen typy svých eventů
CREATE POLICY ticket_types_update ON catalog.ticket_types
  FOR UPDATE USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND EXISTS (
        SELECT 1 FROM catalog.events e
        WHERE e.id = event_id
          AND e.organizer_id = platform.current_promoter_id()
      )
    )
  );

-- DELETE: pouze admin/service
CREATE POLICY ticket_types_delete ON catalog.ticket_types
  FOR DELETE USING (platform.is_privileged());

-- ═══════════════════════════════════════════════════════════════════════════
-- orders.orders — RLS
-- Objednávky jsou viditelné promotérovi (přes promoter_id) i buyerovi (přes user_id).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders.orders ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   admin/service → vše
--   promoter      → objednávky svých eventů (promoter_id)
--   buyer         → vlastní objednávky (user_id)
CREATE POLICY orders_select ON orders.orders
  FOR SELECT USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND promoter_id = platform.current_promoter_id()
    )
    OR (
      platform.current_app_role() = 'buyer'
      AND user_id = platform.current_user_id()
    )
  );

-- INSERT:
--   admin/service → vše
--   buyer         → vlastní objednávky (user_id musí odpovídat)
--   Poznámka: promoter_id nastavuje aplikační vrstva při vytváření objednávky
CREATE POLICY orders_insert ON orders.orders
  FOR INSERT WITH CHECK (
    platform.is_privileged()
    OR user_id = platform.current_user_id()
  );

-- UPDATE:
--   admin/service → vše
--   promoter      → objednávky svých eventů (např. změna stavu)
--   buyer         → vlastní objednávky (např. zrušení)
CREATE POLICY orders_update ON orders.orders
  FOR UPDATE USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND promoter_id = platform.current_promoter_id()
    )
    OR (
      platform.current_app_role() = 'buyer'
      AND user_id = platform.current_user_id()
    )
  );

-- DELETE: pouze admin/service
CREATE POLICY orders_delete ON orders.orders
  FOR DELETE USING (platform.is_privileged());

-- ═══════════════════════════════════════════════════════════════════════════
-- tickets.tickets — RLS
-- Vstupenky jsou vázány na objednávku — přístup přes order ownership.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE tickets.tickets ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   admin/service → vše
--   promoter      → vstupenky objednávek svých eventů
--   buyer         → vlastní vstupenky
CREATE POLICY tickets_select ON tickets.tickets
  FOR SELECT USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND EXISTS (
        SELECT 1 FROM orders.orders o
        WHERE o.id = order_id
          AND o.promoter_id = platform.current_promoter_id()
      )
    )
    OR (
      platform.current_app_role() = 'buyer'
      AND EXISTS (
        SELECT 1 FROM orders.orders o
        WHERE o.id = order_id
          AND o.user_id = platform.current_user_id()
      )
    )
  );

-- INSERT: buyer vkládá vstupenky v rámci své objednávky
CREATE POLICY tickets_insert ON tickets.tickets
  FOR INSERT WITH CHECK (
    platform.is_privileged()
    OR EXISTS (
      SELECT 1 FROM orders.orders o
      WHERE o.id = order_id
        AND o.user_id = platform.current_user_id()
    )
  );

-- UPDATE: pouze admin/service (vstupenky se nemění, jen stornují přes service)
CREATE POLICY tickets_update ON tickets.tickets
  FOR UPDATE USING (platform.is_privileged());

-- DELETE: pouze admin/service
CREATE POLICY tickets_delete ON tickets.tickets
  FOR DELETE USING (platform.is_privileged());

-- ═══════════════════════════════════════════════════════════════════════════
-- catalog.venues — RLS
-- Venue může být public (viditelné všem) nebo privátní (jen owner promotér).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE catalog.venues ENABLE ROW LEVEL SECURITY;

-- SELECT:
--   admin/service     → vše
--   public venue      → viditelné všem (is_public = TRUE)
--   promoter          → vlastní venues (owner_promoter_id = current_promoter_id)
CREATE POLICY venues_select ON catalog.venues
  FOR SELECT USING (
    platform.is_privileged()
    OR COALESCE(is_public, FALSE) = TRUE
    OR (
      platform.current_app_role() = 'promoter'
      AND owner_promoter_id = platform.current_promoter_id()
    )
  );

-- INSERT: promotér vkládá jen pod svým ID
CREATE POLICY venues_insert ON catalog.venues
  FOR INSERT WITH CHECK (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND owner_promoter_id = platform.current_promoter_id()
    )
  );

-- UPDATE: promotér může měnit jen svá venues
CREATE POLICY venues_update ON catalog.venues
  FOR UPDATE USING (
    platform.is_privileged()
    OR (
      platform.current_app_role() = 'promoter'
      AND owner_promoter_id = platform.current_promoter_id()
    )
  );

-- DELETE: pouze admin/service
CREATE POLICY venues_delete ON catalog.venues
  FOR DELETE USING (platform.is_privileged());

COMMIT;
