-- =============================================================================
-- MIGRACE 016: Schéma pro verified-fan modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\verified-fan\
-- Tabulky: verified_fan.configs, verified_fan.registrations
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS verified_fan;

-- ---------------------------------------------------------------------------
-- verified_fan.configs — nastavení programu per event
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verified_fan.configs (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na catalog.events — bez FK; UNIQUE: jeden config per event
  event_id                    UUID        NOT NULL UNIQUE,
  -- cross-schema ref na catalog.ticket_types — bez FK
  -- Typ presale vstupenky dostupné vybraným fanouškům
  presale_ticket_type_id      UUID        NOT NULL,
  -- Cena presale vstupenky v halířích (může být nižší než standard cena)
  presale_price               INTEGER     NOT NULL CHECK (presale_price >= 0),
  -- Počet míst dostupných v presale (max počet vybraných fanoušků)
  slots                       INTEGER     NOT NULL CHECK (slots > 0),
  -- Metoda výběru: fifo, random, nebo points (věrnostní body)
  selection_method            TEXT        NOT NULL DEFAULT 'random'
    CHECK (selection_method IN ('fifo', 'random', 'points')),
  -- Časové okno registrace
  registration_opens_at       TIMESTAMPTZ NOT NULL,
  registration_closes_at      TIMESTAMPTZ NOT NULL,
  -- Kdy proběhne selekce (může být po uzavření registrace)
  selection_at                TIMESTAMPTZ NOT NULL,
  -- Jak dlouho platí access link po selekci (hours, default 48h)
  link_expires_after_hours    INTEGER     NOT NULL DEFAULT 48
    CHECK (link_expires_after_hours > 0 AND link_expires_after_hours <= 168),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Logická konzistence dat
  CONSTRAINT chk_vf_config_dates
    CHECK (registration_opens_at < registration_closes_at),
  CONSTRAINT chk_vf_selection_after_registration
    CHECK (selection_at >= registration_closes_at)
);

COMMENT ON TABLE verified_fan.configs IS
  'Nastavení Verified Fan programu per event. Jeden záznam per event (UNIQUE event_id).
   selection_method: fifo (první registrovaný), random (náhodný výběr), points (věrnostní body).
   link_expires_after_hours: 1–168 hodin (max 7 dní).';

COMMENT ON COLUMN verified_fan.configs.presale_price IS
  'Cena presale vstupenky v halířích. Může být nižší než standard cena — benefit pro vybrané fanoušky.';

COMMENT ON COLUMN verified_fan.configs.slots IS
  'Max počet fanoušků v presale. runSelection() vybere min(slots, registered_count) uživatelů.';

CREATE TRIGGER trg_vf_configs_updated_at
  BEFORE UPDATE ON verified_fan.configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- verified_fan.registrations — registrace fanoušků na presale
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verified_fan.registrations (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- cross-schema ref na catalog.events — bez FK
  event_id                UUID        NOT NULL,
  -- cross-schema ref na identity.users — bez FK
  user_id                 UUID        NOT NULL,
  status                  TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'selected', 'not_selected', 'link_used')),
    -- pending:      čeká na selekci
    -- selected:     vybrán — access token byl vygenerován
    -- not_selected: nebyl vybrán (kapacita obsazena)
    -- link_used:    presale vstupenku již zakoupil
  -- Věrnostní body při registraci (pro selection_method = 'points')
  points_at_registration  INTEGER     NOT NULL DEFAULT 0 CHECK (points_at_registration >= 0),
  -- JWT access token (HS256, TTL = link_expires_after_hours)
  -- Stored pro audit; samotná validita se ověřuje přes Redis (single-use SETNX)
  access_token            TEXT,
  access_token_expires_at TIMESTAMPTZ,
  access_token_used_at    TIMESTAMPTZ,
  registered_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Jeden fanoušek = jedna registrace per event
  CONSTRAINT uq_vf_registration_user_event UNIQUE (user_id, event_id)
);

COMMENT ON TABLE verified_fan.registrations IS
  'Registrace fanoušků na Verified Fan presale. UNIQUE (user_id, event_id) — ON CONFLICT DO NOTHING.
   access_token je HS256 JWT uložený v DB pro audit; single-use ochrana přes Redis SETNX.
   Po redemption: status = link_used, access_token_used_at = NOW().';

COMMENT ON COLUMN verified_fan.registrations.points_at_registration IS
  'Snapshot věrnostních bodů při registraci (pro selection_method=points).
   Načten z loyalty.accounts.total_points v době registrace.';

COMMENT ON COLUMN verified_fan.registrations.access_token IS
  'HS256 JWT access token generovaný po selekci. TTL = config.link_expires_after_hours.
   Redis klíč: tixly:vf:token:{tokenHash} — SETNX pro single-use garanci.';

-- Selekce: ORDER BY registered_at (fifo), RANDOM() nebo points DESC
CREATE INDEX IF NOT EXISTS idx_vf_registrations_event_status
  ON verified_fan.registrations(event_id, status);

-- Lookup při redemption (GET /api/events/[id]/verified-fan/redeem)
CREATE INDEX IF NOT EXISTS idx_vf_registrations_user_event
  ON verified_fan.registrations(user_id, event_id);

-- runSelection() ORDER BY registered_at ASC (fifo)
CREATE INDEX IF NOT EXISTS idx_vf_registrations_fifo
  ON verified_fan.registrations(event_id, registered_at ASC)
  WHERE status = 'pending';

-- runSelection() ORDER BY points DESC (points method)
CREATE INDEX IF NOT EXISTS idx_vf_registrations_points
  ON verified_fan.registrations(event_id, points_at_registration DESC)
  WHERE status = 'pending';

-- RLS: uživatel vidí jen svou registraci
ALTER TABLE verified_fan.registrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY vf_registrations_user ON verified_fan.registrations
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', TRUE)::UUID);

CREATE POLICY vf_registrations_service ON verified_fan.registrations
  FOR ALL
  USING (current_setting('app.role', TRUE) IN ('service', 'admin'));

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'verified_fan' AND table_name = 'configs'),
    'CHYBA: verified_fan.configs neexistuje';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'verified_fan' AND table_name = 'registrations'),
    'CHYBA: verified_fan.registrations neexistuje';
  RAISE NOTICE 'Migrace 016 (verified-fan) úspěšně ověřena.';
END;
$$;

COMMIT;
