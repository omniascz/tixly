-- =============================================================================
-- MIGRACE 010: Schéma pro buyer-blacklist modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\buyer-blacklist\
-- Tabulky: blacklist.blacklist_entries, blacklist.appeals
-- Bezpečnost: checkBan vrací NULL pro anonymizaci (anti-enumeration)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS blacklist;

-- ---------------------------------------------------------------------------
-- blacklist.blacklist_entries — záznamy banů (platform-wide i per-promotér)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blacklist.blacklist_entries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users — bez FK
  user_id         UUID        NOT NULL,
  -- Email kopírujeme pro případ že uživatel smaže účet (GDPR soft delete)
  email           TEXT,
  -- NULL pro platform scope (viditelný všem promotérům)
  -- UUID promotéra pro per-promoter scope
  promoter_id     UUID,
  scope           TEXT        NOT NULL
    CHECK (scope IN ('platform', 'promoter')),
  reason          TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'appealing', 'lifted')),
  -- cross-schema ref na identity.users (admin nebo promoter staff) — bez FK
  banned_by       UUID        NOT NULL,
  banned_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at       TIMESTAMPTZ,
  lifted_by       UUID,
  notes           TEXT,       -- interní poznámky (viditelné jen adminu)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Logická konzistence
  CONSTRAINT chk_blacklist_promoter_scope
    CHECK (
      (scope = 'platform' AND promoter_id IS NULL)
      OR (scope = 'promoter' AND promoter_id IS NOT NULL)
    ),
  CONSTRAINT chk_blacklist_lifted_consistency
    CHECK (
      (status = 'lifted' AND lifted_at IS NOT NULL AND lifted_by IS NOT NULL)
      OR (status != 'lifted')
    )
);

COMMENT ON TABLE blacklist.blacklist_entries IS
  'Záznamy banů uživatelů. Platform scope = ban napříč celou platformou.
   Promoter scope = ban pouze pro konkrétního promotéra.
   checkBan vrací NULL i pro neexistující záznamy (anti-enumeration).';

COMMENT ON COLUMN blacklist.blacklist_entries.email IS
  'Kopie e-mailu uživatele při banu — umožňuje detekci i po GDPR soft delete účtu.';

-- Unikátní aktivní ban per user + scope:
--   platform: max jeden aktivní platform ban
--   promoter: max jeden aktivní ban per promoter
CREATE UNIQUE INDEX IF NOT EXISTS uq_blacklist_active_platform
  ON blacklist.blacklist_entries(user_id)
  WHERE scope = 'platform' AND status IN ('active', 'appealing');

CREATE UNIQUE INDEX IF NOT EXISTS uq_blacklist_active_promoter
  ON blacklist.blacklist_entries(user_id, promoter_id)
  WHERE scope = 'promoter' AND status IN ('active', 'appealing');

-- Index pro checkBan (nejčastější operace — volá se při každé platbě)
CREATE INDEX IF NOT EXISTS idx_blacklist_check
  ON blacklist.blacklist_entries(user_id, status, scope);

CREATE INDEX IF NOT EXISTS idx_blacklist_promoter
  ON blacklist.blacklist_entries(promoter_id, status)
  WHERE promoter_id IS NOT NULL;

CREATE TRIGGER trg_blacklist_updated_at
  BEFORE UPDATE ON blacklist.blacklist_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- blacklist.appeals — odvolání uživatele proti banu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS blacklist.appeals (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  blacklist_entry_id    UUID        NOT NULL UNIQUE
    REFERENCES blacklist.blacklist_entries(id) ON DELETE CASCADE,
  -- cross-schema ref na identity.users — bez FK
  user_id               UUID        NOT NULL,
  -- Zpráva od uživatele (proč by měl být ban zrušen)
  message               TEXT        NOT NULL,
  -- Výsledek review (NULL = čeká na review)
  decision              TEXT
    CHECK (decision IS NULL OR decision IN ('approved', 'rejected')),
  -- cross-schema ref na identity.users (admin) — bez FK
  reviewed_by           UUID,
  reviewed_at           TIMESTAMPTZ,
  admin_notes           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_appeal_review_consistency
    CHECK (
      (decision IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      OR (decision IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL)
    )
);

COMMENT ON TABLE blacklist.appeals IS
  'Odvolání uživatele proti banu. Maximálně jedno odvolání per záznam (UNIQUE blacklist_entry_id).
   Schválené odvolání automaticky volá liftBan v service vrstvě.';

-- Index pro admin review queue
CREATE INDEX IF NOT EXISTS idx_appeals_pending
  ON blacklist.appeals(created_at ASC)
  WHERE decision IS NULL;

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'blacklist' AND table_name = 'blacklist_entries'),
    'CHYBA: blacklist.blacklist_entries neexistuje';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'blacklist' AND table_name = 'appeals'),
    'CHYBA: blacklist.appeals neexistuje';
  RAISE NOTICE 'Migrace 010 (blacklist) úspěšně ověřena.';
END;
$$;

COMMIT;
