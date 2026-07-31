-- =============================================================================
-- MIGRACE 049: Schéma pro passes — season/flex pass management
-- Datum: 2026-04-08
-- Modul: C:\Users\omnia\Documents\tixly\passes\
-- Tabulky: passes.season_pass_types, passes.season_passes,
--          passes.pass_usages, passes.pass_tickets
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS passes;

-- ---------------------------------------------------------------------------
-- passes.season_pass_types — konfigurace permanentky (nastavuje organizátor)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passes.season_pass_types (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users (organizátor) — bez FK
  organizer_id    UUID          NOT NULL,
  -- Jméno permanentky (např. "VIP Sezóna 2026", "Flex Vstupy 5x")
  name            TEXT          NOT NULL,
  -- Typ permanentky: season = s pevným časem, flex = s počtem vstupů
  kind            TEXT          NOT NULL CHECK (kind IN ('season', 'flex')),
  -- Cyklus platby
  billing_cycle   TEXT          NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
  -- Cena permanentky v halířích
  price_haler     INTEGER       NOT NULL CHECK (price_haler > 0),
  -- Počet vstupů (pouze pro kind='flex'; pro season=NULL)
  total_uses      INTEGER,
  -- Platnost permanentky (počet měsíců)
  valid_months    INTEGER       NOT NULL CHECK (valid_months > 0),
  -- Výhody permanentky: JSON s addonDiscountPercent, earlyAccessHours, guestPasses
  benefits        JSONB         NOT NULL DEFAULT '{"addonDiscountPercent":0,"earlyAccessHours":0,"guestPasses":0}',
  -- Je typ aktivní (vydávat nové permanentky)?
  active          BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- CHECK: pokud kind='flex', pak total_uses MUST NOT NULL
  CHECK (kind <> 'flex' OR total_uses IS NOT NULL),
  -- CHECK: pokud kind='season', pak total_uses MUST BE NULL
  CHECK (kind <> 'season' OR total_uses IS NULL)
);

COMMENT ON TABLE passes.season_pass_types IS
  'Konfigurace permanentky. Organizátor si vytvoří jednu či více typů.
   kind=season: pevná délka trvání (např. 12 měsíců).
   kind=flex: počet vstupů (např. 5 vstupů za rok, neomezená doba).';

COMMENT ON COLUMN passes.season_pass_types.benefits IS
  'JSON: {"addonDiscountPercent":10,"earlyAccessHours":24,"guestPasses":2}
   addonDiscountPercent: 0–100 (sleva na doplňkové produkty)
   earlyAccessHours: počet hodin předčasného přístupu na vstupenky
   guestPasses: počet hostenských vstupenek';

COMMENT ON COLUMN passes.season_pass_types.valid_months IS
  'Jak dlouho je permanentka platná: 12=rok, 1=měsíc, atd.';

CREATE INDEX IF NOT EXISTS idx_passes_season_pass_types_organizer
  ON passes.season_pass_types(organizer_id, active);

-- ---------------------------------------------------------------------------
-- passes.season_passes — vydané permanentky (jedna per nákup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passes.season_passes (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na identity.users (majitel permanentky) — bez FK
  user_id         UUID          NOT NULL,
  -- cross-schema ref na identity.users (organizátor) — bez FK
  organizer_id    UUID          NOT NULL,
  -- cross-schema ref na passes.season_pass_types
  pass_type_id    UUID          NOT NULL REFERENCES passes.season_pass_types(id) ON DELETE RESTRICT,
  -- Typ permanentky (kopie z pass_type pro denormalizaci)
  kind            TEXT          NOT NULL CHECK (kind IN ('season', 'flex')),
  -- Název permanentky (kopie z pass_type)
  name            TEXT          NOT NULL,
  -- Cyklus platby (kopie z pass_type)
  billing_cycle   TEXT          NOT NULL CHECK (billing_cycle IN ('monthly', 'annual', 'one_time')),
  -- Status permanentky
  status          TEXT          NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('active', 'expired', 'cancelled', 'suspended', 'pending_payment')),
  -- Zbývající počet vstupů (pouze pro kind='flex'; nakopíruje se z pass_type.total_uses)
  remaining_uses  INTEGER       CHECK (remaining_uses >= 0),
  -- GoPay subscription ID (pro automatické platby, nullable)
  gopay_subscription_id TEXT,
  -- Kdy permanentka vypršela
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- UNIQUE: jeden aktivní pass per typ per uživatel
  CONSTRAINT uq_season_passes_user_type_active UNIQUE (user_id, pass_type_id)
    WHERE status = 'active',
  -- CHECK: pokud kind='flex', remaining_uses MUST NOT NULL
  CHECK (kind <> 'flex' OR remaining_uses IS NOT NULL),
  -- CHECK: pokud kind='season', remaining_uses MUST BE NULL
  CHECK (kind <> 'season' OR remaining_uses IS NULL)
);

COMMENT ON TABLE passes.season_passes IS
  'Vydaná permanentka. Jeden záznam = jeden nákup permanentky uživatelem.
   status=pending_payment → active (po zaplacení) → expired/cancelled/suspended.';

COMMENT ON COLUMN passes.season_passes.remaining_uses IS
  'Zbývající vstupů (dekrementuje se každým vstupem). NULL pro season (čas určuje platnost).';

COMMENT ON COLUMN passes.season_passes.gopay_subscription_id IS
  'ID GoPay subscription pro opakované platby (měsíční/roční cykly).';

CREATE INDEX IF NOT EXISTS idx_passes_season_passes_user
  ON passes.season_passes(user_id, status);

CREATE INDEX IF NOT EXISTS idx_passes_season_passes_organizer
  ON passes.season_passes(organizer_id, status);

CREATE INDEX IF NOT EXISTS idx_passes_season_passes_gopay
  ON passes.season_passes(gopay_subscription_id)
  WHERE gopay_subscription_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- passes.pass_usages — log použití permanentky (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passes.pass_usages (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na passes.season_passes
  pass_id         UUID          NOT NULL REFERENCES passes.season_passes(id) ON DELETE CASCADE,
  -- cross-schema ref na tickets.tickets (nullable — pokud byl vygenerován ticket)
  ticket_id       UUID,
  -- cross-schema ref na events.events
  event_id        UUID          NOT NULL,
  -- Kdy byla permanentka použita
  used_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE passes.pass_usages IS
  'Immutable log každého použití permanentky. Jeden záznam = jeden vstup.
   Pro season pass: sledování účasti. Pro flex pass: dekrement remaining_uses.';

COMMENT ON COLUMN passes.pass_usages.ticket_id IS
  'ID vygenerovaného ticketu (pokud byl vygenerován pro daný vstup). Nullable.';

CREATE INDEX IF NOT EXISTS idx_passes_pass_usages_pass_id
  ON passes.pass_usages(pass_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_passes_pass_usages_event_id
  ON passes.pass_usages(event_id);

-- ---------------------------------------------------------------------------
-- passes.pass_tickets — propojení permanentky s generovaným ticketem
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS passes.pass_tickets (
  -- cross-schema ref na passes.season_passes
  pass_id         UUID          NOT NULL REFERENCES passes.season_passes(id) ON DELETE CASCADE,
  -- UUID ticketu z tickets.tickets (primary key, bez FK)
  ticket_id       UUID          PRIMARY KEY,
  -- Kdy byl ticket vygenerován
  issued_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE passes.pass_tickets IS
  'Propojení permanentky s konkrétním vygenerovaným ticketem.
   ticket_id je PK (originální ticket), pass_id je bez FK (cross-schema reference).';

COMMENT ON COLUMN passes.pass_tickets.ticket_id IS
  'UUID z tickets.tickets (cross-schema). Bez FK — tickets.tickets mohou být v jiném schématu.';

CREATE INDEX IF NOT EXISTS idx_passes_pass_tickets_pass_id
  ON passes.pass_tickets(pass_id);

-- ---------------------------------------------------------------------------
-- RLS: Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE passes.season_pass_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY passes_season_pass_types_organizer ON passes.season_pass_types
  FOR SELECT USING (
    organizer_id = current_setting('app.current_user_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE passes.season_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY passes_season_passes_user ON passes.season_passes
  FOR SELECT USING (
    user_id = current_setting('app.current_user_id', TRUE)::UUID
    OR organizer_id = current_setting('app.current_user_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE passes.pass_usages ENABLE ROW LEVEL SECURITY;
CREATE POLICY passes_pass_usages_user ON passes.pass_usages
  FOR SELECT USING (
    pass_id IN (
      SELECT id FROM passes.season_passes
      WHERE user_id = current_setting('app.current_user_id', TRUE)::UUID
        OR organizer_id = current_setting('app.current_user_id', TRUE)::UUID
    )
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE passes.pass_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY passes_pass_tickets_user ON passes.pass_tickets
  FOR SELECT USING (
    pass_id IN (
      SELECT id FROM passes.season_passes
      WHERE user_id = current_setting('app.current_user_id', TRUE)::UUID
        OR organizer_id = current_setting('app.current_user_id', TRUE)::UUID
    )
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  tbl_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO tbl_count
  FROM information_schema.tables
  WHERE table_schema = 'passes'
    AND table_name IN (
      'season_pass_types', 'season_passes', 'pass_usages', 'pass_tickets'
    );

  ASSERT tbl_count = 4, format(
    'CHYBA: Očekáváno 4 tabulek v passes schema, nalezeno %s', tbl_count
  );

  -- Kontrola klíčových sloupců
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'passes' AND table_name = 'season_pass_types'
      AND column_name = 'kind'
  ), 'CHYBA: passes.season_pass_types.kind neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'passes' AND table_name = 'season_passes'
      AND column_name = 'remaining_uses'
  ), 'CHYBA: passes.season_passes.remaining_uses neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'passes' AND table_name = 'pass_usages'
      AND column_name = 'used_at'
  ), 'CHYBA: passes.pass_usages.used_at neexistuje';

  RAISE NOTICE 'Migrace 049 (passes) úspěšně ověřena.';
END;
$$;

COMMIT;
