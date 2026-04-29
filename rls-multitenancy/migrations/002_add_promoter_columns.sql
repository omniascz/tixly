-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002: Add promoter columns for RLS
-- Tixly — doplnění sloupců potřebných pro RLS policies
--
-- Tento migration přidává:
--   orders.orders.promoter_id         → pro RLS policy orders_select/update
--   catalog.venues.owner_promoter_id  → pro RLS policy venues_select/insert/update
--   catalog.venues.is_public          → pro venues_select (veřejná venue)
--
-- Spustit PŘED migrací 001 nebo po ní s FORCE (políčka jsou IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- orders.orders — přidat promoter_id
--
-- Slouží k rychlé identifikaci promotéra v RLS policies bez JOIN na events.
-- Hodnota se nastavuje při vytváření objednávky (service vrstva).
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS promoter_id UUID;

-- Index pro RLS policy performance (promoter vidí své objednávky)
-- Podmíněný index WHERE status — nejčastěji se filtruje dle aktivních objednávek
CREATE INDEX IF NOT EXISTS idx_orders_promoter_id
  ON orders.orders(promoter_id, status);

-- ═══════════════════════════════════════════════════════════════════════════
-- catalog.venues — přidat owner_promoter_id + is_public
--
-- owner_promoter_id → kdo vlastní toto venue (může být NULL = platformní venue)
-- is_public         → TRUE = viditelné všem buyerům i promotérům
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS owner_promoter_id UUID;

ALTER TABLE catalog.venues
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — většina venues je NULL (platformní/veřejné), index jen na privátní
CREATE INDEX IF NOT EXISTS idx_venues_owner
  ON catalog.venues(owner_promoter_id)
  WHERE owner_promoter_id IS NOT NULL;

COMMIT;
