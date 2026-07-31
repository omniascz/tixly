-- Migration 409: Sport vertikál — fotbal, hokej, basket, ... (analogie Ticketmaster Sports / SeatGeek)
--
-- Architektura (identická s kino vertikálem 408):
--   catalog.sport_teams  — týmy / kluby (logo, barvy, sport, liga)
--   catalog.events       — každý zápas = jeden event
--                          (is_match, home_team_id, away_team_id, competition, match_day)
--
-- Reusuje: checkout, ticket_types (tribuna západ/VIP/hosté), event_seats, foyer_items.
-- Sezónní permanentky: stávající system (subscription_plans / season_passes).

-- ─── Sportovní týmy ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS catalog.sport_teams (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id      uuid        REFERENCES platform.promoters(id),  -- NULL = veřejný katalog
  name             text        NOT NULL,          -- "AC Sparta Praha"
  short_name       text,                          -- "Sparta", "SKA", "LAC"
  code             text,                          -- "SPA", "BOH" (3–4 znaky pro výsledky)
  sport_type       text        NOT NULL DEFAULT 'football'
                               CHECK (sport_type IN
                                 ('football','hockey','basketball','volleyball','handball',
                                  'tennis','athletics','mma','motorsport','esport','other')),
  logo_url         text,
  primary_color    text,       -- hex, např. '#AC0000'
  secondary_color  text,       -- hex
  city             text,
  country          text        NOT NULL DEFAULT 'CZ',
  league_name      text,       -- "Fortuna liga", "Tipsport extraliga"
  league_country   text,
  founded_year     smallint,
  website_url      text,
  stadium_name     text,       -- domácí stadion / aréna
  status           text        NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','archived')),
  created_at       timestamptz NOT NULL DEFAULT NOW(),
  updated_at       timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sport_teams_promoter   ON catalog.sport_teams (promoter_id);
CREATE INDEX IF NOT EXISTS idx_sport_teams_sport_type ON catalog.sport_teams (sport_type);

-- ─── Rozšíření catalog.events o sport/zápas sloupce ─────────────────────────

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS is_match        boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_team_id    uuid     REFERENCES catalog.sport_teams(id),
  ADD COLUMN IF NOT EXISTS away_team_id    uuid     REFERENCES catalog.sport_teams(id),
  ADD COLUMN IF NOT EXISTS sport_type      text,    -- 'football','hockey', ... (kopie z týmu pro rychlý filtr)
  ADD COLUMN IF NOT EXISTS competition     text,    -- "Fortuna liga", "Tipsport extraliga", "UEFA Cup"
  ADD COLUMN IF NOT EXISTS match_day       smallint,-- kolo / round číslo (volitelné)
  ADD COLUMN IF NOT EXISTS is_home_match   boolean; -- true = domácí zápas home_team

CREATE INDEX IF NOT EXISTS idx_events_home_team ON catalog.events (home_team_id)
  WHERE home_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_away_team ON catalog.events (away_team_id)
  WHERE away_team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_sport_type ON catalog.events (sport_type)
  WHERE sport_type IS NOT NULL;

COMMENT ON COLUMN catalog.events.is_match IS
  'true = sportovní zápas; reusuje celý event+ticket+seat stack';
COMMENT ON COLUMN catalog.events.home_team_id IS
  'Domácí tým FK; NULL pro regulérní eventy';
