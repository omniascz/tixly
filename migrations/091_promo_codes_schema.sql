-- =============================================================================
-- MIGRACE 091: Promo kódy — marketing.promo_codes + marketing.promo_code_usages
--              + sloupce discount_halire, promo_code_id v orders.orders
-- Datum: 2026-04-08
-- Modul: promo-codes + nextjs-boilerplate (S05)
-- Závislosti: 001_initial.sql (orders.orders), 013_faze3b_marketing.sql (marketing schema)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. marketing.promo_codes — hlavní tabulka promo kódů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.promo_codes (
  id                          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kód je vždy uppercase; UNIQUE zabraňuje duplicitám
  code                        TEXT          NOT NULL,
  -- Typ slevy
  type                        TEXT          NOT NULL
    CHECK (type IN ('percentage', 'fixed', 'bogo', 'free')),
  -- Hodnota slevy: procenta (0-100) nebo haléře (pro fixed)
  discount_value              INTEGER       NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  -- Globální limit použití; NULL = neomezeno
  max_uses                    INTEGER       CHECK (max_uses IS NULL OR max_uses > 0),
  -- Kolikrát byl kód použit (atomicky inkrementováno)
  uses_count                  INTEGER       NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  -- Limit na uživatele; NULL = neomezeno
  max_uses_per_user           INTEGER       CHECK (max_uses_per_user IS NULL OR max_uses_per_user > 0),
  -- Časové okno platnosti
  valid_from                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  valid_until                 TIMESTAMPTZ,  -- NULL = bez expirace
  -- Minimální podmínky pro uplatnění
  min_quantity                INTEGER       NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  min_order_amount            INTEGER       NOT NULL DEFAULT 0 CHECK (min_order_amount >= 0), -- haléře
  -- Omezení na konkrétní typy vstupenek / akce; NULL = platí pro vše
  applicable_ticket_type_ids  UUID[],
  applicable_event_ids        UUID[],
  -- Lze kombinovat s jinými kódy?
  stackable                   BOOLEAN       NOT NULL DEFAULT false,
  -- Aktivní / deaktivovaný (soft delete)
  active                      BOOLEAN       NOT NULL DEFAULT true,
  -- Organizátor, který kód vytvořil (cross-schema ref, bez FK)
  created_by_organizer_id     UUID          NOT NULL,
  created_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_promo_codes_code UNIQUE (code)
);

COMMENT ON TABLE marketing.promo_codes IS
  'Promo kódy pro slevy na vstupenky.
   Typy: percentage (% z celku), fixed (pevná částka v haléřích), bogo (2+1), free (zdarma).
   Atomická inkrementace uses_count zabraňuje race condition při souběžném uplatnění.';

COMMENT ON COLUMN marketing.promo_codes.discount_value IS
  'percentage: 0–100 (procent). fixed: haléře. bogo/free: 0 (nepoužito).';
COMMENT ON COLUMN marketing.promo_codes.applicable_event_ids IS
  'UUID[] akcí z catalog.events. NULL = platí pro všechny akce. Cross-schema, bez FK.';
COMMENT ON COLUMN marketing.promo_codes.applicable_ticket_type_ids IS
  'UUID[] typů vstupenek z catalog.ticket_types. NULL = platí pro všechny typy. Cross-schema, bez FK.';

-- Index pro rychlé vyhledání kódu (lookup při validaci)
CREATE INDEX IF NOT EXISTS idx_promo_codes_code
  ON marketing.promo_codes (code)
  WHERE active = true;

-- Index pro výpis kódů organizátora
CREATE INDEX IF NOT EXISTS idx_promo_codes_organizer
  ON marketing.promo_codes (created_by_organizer_id, created_at DESC);

CREATE TRIGGER trg_promo_codes_updated_at
  BEFORE UPDATE ON marketing.promo_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. marketing.promo_code_usages — auditní log použití kódů
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS marketing.promo_code_usages (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cross-schema refs — bez FK pro decoupling
  promo_code_id    UUID          NOT NULL,
  order_id         UUID          NOT NULL,
  user_id          UUID          NOT NULL,
  -- Výše slevy v haléřích pro tuto konkrétní objednávku
  discount_halire  INTEGER       NOT NULL CHECK (discount_halire >= 0),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketing.promo_code_usages IS
  'Auditní log každého použití promo kódu.
   Jeden řádek = jedna objednávka s uplatněným kódem.
   Používá se pro výpočet per-user limitu (max_uses_per_user).
   Cross-schema refs na marketing.promo_codes, orders.orders, identity.users.';

-- Index pro per-user limit check
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_code_user
  ON marketing.promo_code_usages (promo_code_id, user_id);

-- Index pro analytiku per objednávka
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_order
  ON marketing.promo_code_usages (order_id);

-- Index pro reporting per kód
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_promo_code
  ON marketing.promo_code_usages (promo_code_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. orders.orders — přidat sloupce pro evidenci slevy a použitého kódu
-- ---------------------------------------------------------------------------
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS discount_halire  INTEGER NOT NULL DEFAULT 0
    CHECK (discount_halire >= 0),
  ADD COLUMN IF NOT EXISTS promo_code_id    UUID;
  -- promo_code_id: cross-schema ref na marketing.promo_codes, bez FK

COMMENT ON COLUMN orders.orders.discount_halire IS
  'Výše slevy z promo kódu v haléřích. total_amount = subtotal - discount_halire.';
COMMENT ON COLUMN orders.orders.promo_code_id IS
  'UUID použitého promo kódu z marketing.promo_codes. NULL = žádný kód. Cross-schema, bez FK.';

CREATE INDEX IF NOT EXISTS idx_orders_promo_code_id
  ON orders.orders (promo_code_id)
  WHERE promo_code_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'marketing' AND table_name = 'promo_codes'
  ), 'CHYBA: marketing.promo_codes neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'marketing' AND table_name = 'promo_code_usages'
  ), 'CHYBA: marketing.promo_code_usages neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'orders'
      AND table_name = 'orders'
      AND column_name = 'discount_halire'
  ), 'CHYBA: orders.orders.discount_halire neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'orders'
      AND table_name = 'orders'
      AND column_name = 'promo_code_id'
  ), 'CHYBA: orders.orders.promo_code_id neexistuje';

  RAISE NOTICE 'Migrace 091 (promo_codes_schema) úspěšně ověřena.';
END;
$$;

COMMIT;
