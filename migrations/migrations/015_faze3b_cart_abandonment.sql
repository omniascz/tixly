-- =============================================================================
-- MIGRACE 015: Rozšíření orders schématu pro cart-abandonment modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\cart-abandonment\
-- Tabulky: orders.abandoned_carts
-- Umístění v orders schema (ne nové schema) — košík je součást order flow
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- orders.abandoned_carts — snapshoty košíku pro abandoned cart recovery
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders.abandoned_carts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id         UUID        NOT NULL,
  -- cross-schema ref na catalog.events — bez FK
  event_id        UUID        NOT NULL,
  -- Položky košíku jako JSONB (denormalizace pro rychlý přístup)
  -- Struktura: [{ ticketTypeId, ticketTypeName, quantity, unitPrice }]
  items           JSONB       NOT NULL DEFAULT '[]',
  -- Celková hodnota košíku v halířích (pro A/B analýzu)
  total_amount    INTEGER     NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  status          TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'abandoned', 'recovered', 'converted')),
    -- active:    košík aktivně upravovaný (posledních 5 min)
    -- abandoned: uživatel opustil bez nákupu (trigger: X min nečinnosti)
    -- recovered: klikl na recovery link z emailu
    -- converted: dokončil nákup (může přijít i bez recovery emailu)
  -- A/B test varianta pro timing recovery emailu
  ab_variant      CHAR(1)     NOT NULL DEFAULT 'A'
    CHECK (ab_variant IN ('A', 'B')),
    -- A: email po 15 minutách
    -- B: email po 60 minutách (FNV-1a hash userId % 2)
  -- Recovery JWT token (nastaveno při odeslání recovery emailu)
  recovery_token  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Kdy byl email odeslán (pro A/B analýzu čekací doby)
  email_sent_at   TIMESTAMPTZ,
  -- Kdy uživatel klikl na recovery link
  recovered_at    TIMESTAMPTZ,
  -- Kdy proběhla konverze (nákup dokončen)
  converted_at    TIMESTAMPTZ,

  -- Jeden aktivní/abandoned/recovered košík per user+event
  -- (converted košíky jsou zachovány pro historii a A/B analýzu)
  CONSTRAINT uq_abandoned_cart_user_event UNIQUE (user_id, event_id)
);

COMMENT ON TABLE orders.abandoned_carts IS
  'Snapshoty opuštěných košíků. Jeden záznam per (user_id, event_id) — upsert při každé změně.
   A/B test: varianta A = email po 15 min, B = email po 60 min.
   Variantu určuje FNV-1a hash userId % 2 — deterministické per uživatel, konzistentní napříč session.';

COMMENT ON COLUMN orders.abandoned_carts.items IS
  'Denormalizovaný snapshot položek: [{ ticketTypeId, ticketTypeName, quantity, unitPrice }].
   unitPrice v halířích (INTEGER). Neaktualizuje se po opuštění — zachovává historický snapshot.';

COMMENT ON COLUMN orders.abandoned_carts.recovery_token IS
  'HS256 JWT token (TTL 7 dní) pro single-use recovery link.
   Invalidován po prvním použití (Redis: SET NX klíč tixly:cart:recovery:{userId}:{eventId}).';

-- Cron job: hledá active košíky ready pro abandonment email
-- (updated_at < NOW() - INTERVAL X dle ab_variant)
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_active
  ON orders.abandoned_carts(updated_at ASC, ab_variant)
  WHERE status = 'active';

-- Cron job: hledá abandoned košíky bez odeslaného emailu
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email_pending
  ON orders.abandoned_carts(updated_at ASC)
  WHERE status = 'abandoned' AND email_sent_at IS NULL;

-- A/B analytics: konverzní rate per varianta
CREATE INDEX IF NOT EXISTS idx_abandoned_carts_ab_analytics
  ON orders.abandoned_carts(ab_variant, status, created_at DESC);

CREATE TRIGGER trg_abandoned_carts_updated_at
  BEFORE UPDATE ON orders.abandoned_carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'orders' AND table_name = 'abandoned_carts'
  ), 'CHYBA: orders.abandoned_carts neexistuje';
  RAISE NOTICE 'Migrace 015 (cart-abandonment) úspěšně ověřena.';
END;
$$;

COMMIT;
