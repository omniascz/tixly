-- =============================================================================
-- MIGRACE 048: Schéma pro platform — promotery, fee schedules, payouty
-- Datum: 2026-04-08
-- Modul: C:\Users\omnia\Documents\tixly\platform\
-- Tabulky: platform.promoters, platform.fee_schedules, platform.payout_settings,
--          platform.payouts, platform.event_settlements, platform.rolling_reserves,
--          platform.payout_events
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS platform;

-- ---------------------------------------------------------------------------
-- platform.promoters — denormalizovaná data promotéra pro payout logiku
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.promoters (
  id              UUID          PRIMARY KEY,
  -- Emailová adresa promotéra (unikátní)
  email           TEXT          NOT NULL,
  -- Jméno promotéra
  name            TEXT          NOT NULL,
  -- IBAN pro bezpečné ukládání
  bank_account    TEXT,
  -- Preferovaný jazyk (ISO 639-1)
  locale          TEXT          NOT NULL DEFAULT 'cs',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.promoters IS
  'Denormalizovaná kopie promotéra z identity.users pro výplatní logiku. Zlepšuje výkon payout engine.';

COMMENT ON COLUMN platform.promoters.id IS
  'UUID promotéra, odpovídá identity.users.id (bez FK).';

COMMENT ON COLUMN platform.promoters.bank_account IS
  'IBAN účtu pro bezpečné ukládání. Senzitivní údaj — šifrování doporučeno.';

CREATE INDEX IF NOT EXISTS idx_platform_promoters_email
  ON platform.promoters(email);

-- ---------------------------------------------------------------------------
-- platform.fee_schedules — poplatková schémata per promotér
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.fee_schedules (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na platform.promoters — bez FK (denormalizace)
  promoter_id     UUID          NOT NULL,
  -- Jméno schématu (např. "Standard", "Premium")
  name            TEXT          NOT NULL,
  -- Procentní poplatek v basis points (500 = 5 %, 0–10000 = 0–100 %)
  percentage_fee  INTEGER       NOT NULL DEFAULT 0
    CHECK (percentage_fee >= 0 AND percentage_fee <= 10000),
  -- Pevný poplatek v halířích
  fixed_fee       INTEGER       NOT NULL DEFAULT 0 CHECK (fixed_fee >= 0),
  -- Minimální poplatek v halířích (nullable)
  min_fee         INTEGER       CHECK (min_fee >= 0),
  -- Maximální poplatek v halířích (nullable); CHECK: max_fee >= min_fee pokud je min_fee
  max_fee         INTEGER       CHECK (max_fee >= 0),
  -- Od kdy je schéma platné
  valid_from      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  -- Do kdy je schéma platné (NULL = stále platné)
  valid_until     TIMESTAMPTZ,
  -- Aktivní/neaktivní příznak
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- CHECK: pokud min_fee a max_fee oba existují, max_fee >= min_fee
  CHECK (min_fee IS NULL OR max_fee IS NULL OR max_fee >= min_fee),
  -- CHECK: valid_from <= valid_until pokud valid_until není NULL
  CHECK (valid_until IS NULL OR valid_from <= valid_until)
);

COMMENT ON TABLE platform.fee_schedules IS
  'Poplatková schémata per promotér. Historické záznamy: is_active=FALSE pro staré schéma.
   Vždy jedno aktivní schéma per promotér (aplikační vrstva to zajistí).';

COMMENT ON COLUMN platform.fee_schedules.percentage_fee IS
  'Procento v basis points: 100 bp = 1 %, 5000 bp = 50 %.';

COMMENT ON COLUMN platform.fee_schedules.max_fee IS
  'Maximální poplatek (cena za poplatek se limituje). NULL = bez limitu.';

CREATE INDEX IF NOT EXISTS idx_platform_fee_schedules_promoter
  ON platform.fee_schedules(promoter_id, is_active, valid_from DESC);

-- ---------------------------------------------------------------------------
-- platform.payout_settings — nastavení výplat per promotér
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.payout_settings (
  -- cross-schema ref na platform.promoters — bez FK
  promoter_id           UUID          PRIMARY KEY,
  -- Cyklus výplat
  payout_cycle          TEXT          NOT NULL DEFAULT 'weekly'
    CHECK (payout_cycle IN ('daily', 'weekly', 'monthly', 'manual')),
  -- Procento tržeb zadržovaných jako běžná rezerva (basis points: 500 = 5 %)
  rolling_reserve_pct   INTEGER       NOT NULL DEFAULT 500
    CHECK (rolling_reserve_pct >= 0 AND rolling_reserve_pct <= 10000),
  -- Dny, po nichž je běžná rezerva uvolněna (default 90 dní)
  reserve_release_days  INTEGER       NOT NULL DEFAULT 90 CHECK (reserve_release_days > 0),
  -- Minimální částka pro výplatu v halířích (500 Kč = 50 000 halířů)
  min_payout_amount     INTEGER       NOT NULL DEFAULT 50000 CHECK (min_payout_amount >= 0),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.payout_settings IS
  'Nastavení výplatního cyklu a rezervy per promotér. Jeden záznam per promoter_id.';

COMMENT ON COLUMN platform.payout_settings.rolling_reserve_pct IS
  'Procento tržeb v basis points, které se zadržují pro krytí chargbacků (např. 500 bp = 5 %).';

COMMENT ON COLUMN platform.payout_settings.reserve_release_days IS
  'Počet dní od vypořádání transakce, po níž se rezerva automaticky uvolňuje.';

-- ---------------------------------------------------------------------------
-- platform.payouts — výplatní záznamy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.payouts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na platform.promoters — bez FK
  promoter_id     UUID          NOT NULL,
  -- Období výplaty (od)
  period_from     TIMESTAMPTZ   NOT NULL,
  -- Období výplaty (do)
  period_to       TIMESTAMPTZ   NOT NULL,
  -- Hrubé tržby v halířích
  gross_revenue   INTEGER       NOT NULL DEFAULT 0 CHECK (gross_revenue >= 0),
  -- Poplatky platformy v halířích
  platform_fees   INTEGER       NOT NULL DEFAULT 0 CHECK (platform_fees >= 0),
  -- Vrácené tržby v halířích
  refunds         INTEGER       NOT NULL DEFAULT 0 CHECK (refunds >= 0),
  -- Chargebacky v halířích
  chargebacks     INTEGER       NOT NULL DEFAULT 0 CHECK (chargebacks >= 0),
  -- Zadržená běžná rezerva v halířích
  rolling_reserve INTEGER       NOT NULL DEFAULT 0 CHECK (rolling_reserve >= 0),
  -- Čistá výplata v halířích (brutto - poplatky - refundy - chargebacky - rezerva)
  net_payout      INTEGER       NOT NULL DEFAULT 0 CHECK (net_payout >= 0),
  -- Status výplaty
  status          TEXT          NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'failed', 'cancelled')),
  -- Cyklus výplat (denní/týdenní/měsíční/ruční)
  payout_cycle    TEXT          NOT NULL,
  -- Bankovní referenční číslo (vráceno od banky)
  bank_reference  TEXT,
  -- Kdy byla výplata skutečně odeslána
  paid_at         TIMESTAMPTZ,
  -- Důvod selhání (pokud status='failed')
  failure_reason  TEXT,
  -- Počet pokusů o opakování
  retry_count     INTEGER       NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  -- UUID uživatele, který schválil výplatu
  approved_by     UUID,
  -- Kdy byla schválena
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- CHECK: period_from < period_to
  CHECK (period_from < period_to),
  -- CHECK: net_payout >= 0
  CHECK (net_payout >= 0)
);

COMMENT ON TABLE platform.payouts IS
  'Immutable výplatní záznamy. Jeden záznam per promotér per období. status=pending → approved → paid/failed.';

COMMENT ON COLUMN platform.payouts.rolling_reserve IS
  'Část tržeb zadržená jako rezerva na krytí budoucích chargbacků.';

COMMENT ON COLUMN platform.payouts.retry_count IS
  'Počet pokusů o zaslání výplaty (u status=failed). Pomáhá sledovat problémy.';

CREATE INDEX IF NOT EXISTS idx_platform_payouts_promoter_status
  ON platform.payouts(promoter_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_payouts_status_pending
  ON platform.payouts(status, created_at DESC)
  WHERE status IN ('pending', 'approved');

-- ---------------------------------------------------------------------------
-- platform.event_settlements — vypořádání per event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.event_settlements (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na events.events
  event_id        UUID          NOT NULL,
  -- cross-schema ref na platform.promoters
  promoter_id     UUID          NOT NULL,
  -- cross-schema ref na platform.payouts (nullable — zatím nepatří do žádné výplaty)
  payout_id       UUID,
  -- Počet prodaných vstupenek pro event
  tickets_sold    INTEGER       NOT NULL DEFAULT 0 CHECK (tickets_sold >= 0),
  -- Hrubé tržby z event v halířích
  gross_revenue   INTEGER       NOT NULL DEFAULT 0 CHECK (gross_revenue >= 0),
  -- Poplatky platformy za event v halířích
  platform_fees   INTEGER       NOT NULL DEFAULT 0 CHECK (platform_fees >= 0),
  -- Počet vrácených vstupenek
  refunds_count   INTEGER       NOT NULL DEFAULT 0 CHECK (refunds_count >= 0),
  -- Částka vrácených vstupenek v halířích
  refunds_amount  INTEGER       NOT NULL DEFAULT 0 CHECK (refunds_amount >= 0),
  -- Počet chargebacků
  chargebacks_count INTEGER      NOT NULL DEFAULT 0 CHECK (chargebacks_count >= 0),
  -- Částka chargebacků v halířích
  chargebacks_amount INTEGER     NOT NULL DEFAULT 0 CHECK (chargebacks_amount >= 0),
  -- Čisté příjmy za event (brutto - poplatky - refundy - chargebacky)
  net_revenue     INTEGER       NOT NULL DEFAULT 0 CHECK (net_revenue >= 0),
  -- Je event vypořádán (zahrnut do výplaty)?
  settled         BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Kdy byl event vypořádán
  settled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- UNIQUE: jeden záznam per (event, promoter)
  CONSTRAINT uq_event_settlements_event_promoter UNIQUE (event_id, promoter_id)
);

COMMENT ON TABLE platform.event_settlements IS
  'Vypořádání per event — propojení tržeb z konkrétního eventu s výplatou promotéra.
   Když se vytvoří payout, všechny její event_settlements získají payout_id.';

COMMENT ON COLUMN platform.event_settlements.settled IS
  'TRUE = event je zahrnut do nějaké výplaty (payout_id IS NOT NULL).';

CREATE INDEX IF NOT EXISTS idx_platform_event_settlements_promoter
  ON platform.event_settlements(promoter_id, settled, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_event_settlements_payout
  ON platform.event_settlements(payout_id)
  WHERE payout_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- platform.rolling_reserves — běžná rezerva (detailní tracking)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.rolling_reserves (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na platform.promoters
  promoter_id     UUID          NOT NULL,
  -- cross-schema ref na platform.payouts (nullable — rezerva vytvořená z výplaty)
  payout_id       UUID,
  -- Částka zadržené rezervy v halířích
  amount          INTEGER       NOT NULL CHECK (amount > 0),
  -- Kdy se má rezerva automaticky uvolnit
  release_date    DATE          NOT NULL,
  -- Je rezerva uvolněna?
  released        BOOLEAN       NOT NULL DEFAULT FALSE,
  -- Kdy byla uvolněna
  released_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.rolling_reserves IS
  'Detailní log běžné rezervy. Immutable: jeden záznam per rezerva. Uvolnění = released=TRUE + released_at.';

COMMENT ON COLUMN platform.rolling_reserves.release_date IS
  'Datum, kdy se může rezerva automaticky uvolnit (release_date <= TODAY).';

COMMENT ON COLUMN platform.rolling_reserves.released IS
  'TRUE = rezerva byla uvolněna (přidána do příštího payout). Nikdy se nezmění na FALSE.';

CREATE INDEX IF NOT EXISTS idx_platform_rolling_reserves_promoter
  ON platform.rolling_reserves(promoter_id, released, release_date ASC);

CREATE INDEX IF NOT EXISTS idx_platform_rolling_reserves_release_date
  ON platform.rolling_reserves(release_date ASC)
  WHERE NOT released;

-- ---------------------------------------------------------------------------
-- platform.payout_events — immutable audit log výplatního procesu
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS platform.payout_events (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na platform.payouts
  payout_id       UUID          NOT NULL,
  -- Typ události (approved, paid, failed, cancelled, retry, ...)
  event_type      TEXT          NOT NULL,
  -- UUID uživatele, který akci vyvolal (nullable — automatické procesy)
  actor_user_id   UUID,
  -- Dodatečné detaily ve formátu JSON
  details         JSONB         NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE platform.payout_events IS
  'Immutable audit log výplatního procesu. Jeden záznam per event. Nikdy se nemění.
   Například: payout schválený, odeslán bance, selhání, retry, atd.';

COMMENT ON COLUMN platform.payout_events.event_type IS
  'Typ: approved, paid, failed, cancelled, retry, chargebacks_applied, ...';

COMMENT ON COLUMN platform.payout_events.details IS
  'JSON s kontextem: {"reason":"Network error","attempt":2} atd.';

CREATE INDEX IF NOT EXISTS idx_platform_payout_events_payout
  ON platform.payout_events(payout_id, created_at ASC);

-- ---------------------------------------------------------------------------
-- RLS: Row Level Security pro promoter roli
-- ---------------------------------------------------------------------------
ALTER TABLE platform.promoters ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_promoters_promoter ON platform.promoters
  FOR SELECT USING (
    id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.fee_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_fee_schedules_promoter ON platform.fee_schedules
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.payout_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_payout_settings_promoter ON platform.payout_settings
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_payouts_promoter ON platform.payouts
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.event_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_event_settlements_promoter ON platform.event_settlements
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.rolling_reserves ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_rolling_reserves_promoter ON platform.rolling_reserves
  FOR SELECT USING (
    promoter_id = current_setting('app.tenant_id', TRUE)::UUID
    OR current_setting('app.role', TRUE) IN ('service', 'admin')
  );

ALTER TABLE platform.payout_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_payout_events_promoter ON platform.payout_events
  FOR SELECT USING (
    payout_id IN (
      SELECT id FROM platform.payouts
      WHERE promoter_id = current_setting('app.tenant_id', TRUE)::UUID
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
  WHERE table_schema = 'platform'
    AND table_name IN (
      'promoters', 'fee_schedules', 'payout_settings',
      'payouts', 'event_settlements', 'rolling_reserves', 'payout_events'
    );

  ASSERT tbl_count = 7, format(
    'CHYBA: Očekáváno 7 tabulek v platform schema, nalezeno %s', tbl_count
  );

  -- Kontrola klíčových sloupců
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name = 'promoters'
      AND column_name = 'email'
  ), 'CHYBA: platform.promoters.email neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name = 'payouts'
      AND column_name = 'net_payout'
  ), 'CHYBA: platform.payouts.net_payout neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'platform' AND table_name = 'rolling_reserves'
      AND column_name = 'release_date'
  ), 'CHYBA: platform.rolling_reserves.release_date neexistuje';

  RAISE NOTICE 'Migrace 048 (platform) úspěšně ověřena.';
END;
$$;

COMMIT;
