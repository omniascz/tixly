-- =============================================================================
-- MIGRACE 024: Sportovní utkání — týmy, ligy, šablona tým vs. tým
-- Datum: 2026-04-06
-- Závislosti: ticketing_schema.sql, 017_event_type_and_venue_type.sql
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS sport;

-- ---------------------------------------------------------------------------
-- 1. sport.teams — kluby a týmy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sport.teams (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID            NOT NULL,   -- platform.promoters.id (vlastník)
  name            TEXT            NOT NULL,   -- plný název: "SK Slavia Praha"
  short_name      TEXT            NOT NULL,   -- zkratka: "SLA"
  sport_type      TEXT            NOT NULL
    CHECK (sport_type IN (
      'football', 'ice_hockey', 'basketball', 'tennis',
      'volleyball', 'handball', 'baseball', 'rugby', 'other'
    )),
  country_code    CHAR(2)         NOT NULL DEFAULT 'CZ',
  city            TEXT,
  logo_url        TEXT,
  primary_color   CHAR(7),        -- HEX #RRGGBB
  secondary_color CHAR(7),
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sport.teams IS
  'Sportovní týmy/kluby. Jeden tým může hrát v více ligách a akcích různých promotérů.
   short_name max. 10 znaků pro live score zobrazení.';

CREATE INDEX IF NOT EXISTS idx_sport_teams_promoter
  ON sport.teams(promoter_id);

CREATE INDEX IF NOT EXISTS idx_sport_teams_sport_type
  ON sport.teams(sport_type, country_code);

CREATE OR REPLACE TRIGGER sport_teams_updated_at
  BEFORE UPDATE ON sport.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. sport.leagues — soutěže a ligy
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sport.leagues (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID            NOT NULL,
  name            TEXT            NOT NULL,   -- "Česká fotbalová liga 2026/27"
  short_name      TEXT            NOT NULL,   -- "ČFL 26/27"
  sport_type      TEXT            NOT NULL
    CHECK (sport_type IN (
      'football', 'ice_hockey', 'basketball', 'tennis',
      'volleyball', 'handball', 'baseball', 'rugby', 'other'
    )),
  country_code    CHAR(2)         NOT NULL DEFAULT 'CZ',
  season_label    TEXT            NOT NULL,   -- "2026/27"
  season_year     SMALLINT        NOT NULL,   -- 2026 (rok začátku sezóny)
  total_rounds    SMALLINT,                   -- celkový počet kol (NULL = neznámý)
  status          TEXT            NOT NULL DEFAULT 'active'
    CHECK (status IN ('upcoming', 'active', 'finished', 'cancelled')),
  logo_url        TEXT,
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sport.leagues IS
  'Sportovní soutěže. Každý ročník = nový záznam (season_year).
   total_rounds umožňuje progress bar "Kolo X / Y" v UI.';

CREATE INDEX IF NOT EXISTS idx_sport_leagues_promoter
  ON sport.leagues(promoter_id);

CREATE INDEX IF NOT EXISTS idx_sport_leagues_sport_type
  ON sport.leagues(sport_type, season_year);

CREATE OR REPLACE TRIGGER sport_leagues_updated_at
  BEFORE UPDATE ON sport.leagues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. sport.event_config — rozšíření catalog.events pro sportovní utkání
--    Vztah 1:1 s catalog.events (pouze event_type = 'sport')
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sport.event_config (
  event_id        UUID            PRIMARY KEY REFERENCES catalog.events(id) ON DELETE CASCADE,

  sport_type      TEXT            NOT NULL
    CHECK (sport_type IN (
      'football', 'ice_hockey', 'basketball', 'tennis',
      'volleyball', 'handball', 'baseball', 'rugby', 'other'
    )),

  -- Týmy
  home_team_id    UUID            REFERENCES sport.teams(id),
  away_team_id    UUID            REFERENCES sport.teams(id),
  is_neutral_venue BOOLEAN        NOT NULL DEFAULT FALSE,

  -- Liga / kolo
  league_id       UUID            REFERENCES sport.leagues(id),
  round_number    SMALLINT,       -- číslo kola, NULL = pohár/přátelák
  round_label     TEXT,           -- "Kolo 12" nebo "Čtvrtfinále" nebo "Přátelský zápas"

  -- Výsledek (aktualizuje se průběžně nebo po zápase)
  home_score      SMALLINT,
  away_score      SMALLINT,
  match_status    TEXT            NOT NULL DEFAULT 'scheduled'
    CHECK (match_status IN (
      'scheduled',   -- před zápasem
      'live',        -- probíhá
      'half_time',   -- poločas
      'finished',    -- skončil
      'postponed',   -- odložen
      'cancelled'    -- zrušen
    )),
  match_minute    SMALLINT,       -- aktuální minuta zápasu (live)
  extra_info      JSONB,          -- extra data: {"ot": true, "penalties": "3:4", "period": 2}

  created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_sport_different_teams CHECK (
    home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id
  )
);

COMMENT ON TABLE sport.event_config IS
  'Sportovní metadata utkání — rozšíření catalog.events (1:1).
   home_team_id / away_team_id může být NULL pro přátelské zápasy nebo anonymní soutěže.
   match_status a score se aktualizují live tickerem nebo manuálně.
   is_neutral_venue = TRUE pro finále a zápasy na neutrální půdě.';

CREATE INDEX IF NOT EXISTS idx_sport_event_config_league_round
  ON sport.event_config(league_id, round_number)
  WHERE league_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sport_event_config_home_team
  ON sport.event_config(home_team_id)
  WHERE home_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sport_event_config_away_team
  ON sport.event_config(away_team_id)
  WHERE away_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sport_event_config_status
  ON sport.event_config(match_status);

CREATE OR REPLACE TRIGGER sport_event_config_updated_at
  BEFORE UPDATE ON sport.event_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sport' AND table_name = 'teams'
  ), 'CHYBA: sport.teams neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sport' AND table_name = 'leagues'
  ), 'CHYBA: sport.leagues neexistuje';

  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'sport' AND table_name = 'event_config'
  ), 'CHYBA: sport.event_config neexistuje';

  RAISE NOTICE 'Migrace 024 úspěšně ověřena — sport schema připraveno.';
END;
$$;

COMMIT;
