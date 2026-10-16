-- 501_venue_places_seat_types.sql
--   Kolo 8 / krok 2 — knihovna míst: místo (název, město, adresa) → sál → plánek; typy míst a cenové zóny.
--
-- POUŽITO: catalog.venues = sál (events.venue_id i venue_seating_charts.venue_id na něj už ukazují),
--          catalog.venue_seating_charts = plánek sálu (verze, aktivní jedna), catalog.event_seats.
-- NOVĚ:    catalog.venue_places (místo) + venues.place_id; na event_seats typ místa, poznámka a cenová zóna;
--          events.seat_chart_id = ze které verze plánku sálu byla sedadla termínu převzata.
-- Idempotentní.

CREATE TABLE IF NOT EXISTS catalog.venue_places (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  city        text NOT NULL CHECK (length(btrim(city)) > 0),
  address     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_venue_places_promoter ON catalog.venue_places (promoter_id, city);

ALTER TABLE catalog.venues ADD COLUMN IF NOT EXISTS place_id uuid REFERENCES catalog.venue_places(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_venues_place ON catalog.venues (place_id) WHERE place_id IS NOT NULL;

ALTER TABLE catalog.venue_places ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_venue_places_scope ON catalog.venue_places;
CREATE POLICY p_venue_places_scope ON catalog.venue_places
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON catalog.venue_places TO tixly_app;
    -- výchozí oprávnění schématu dávají i TRUNCATE, který obchází RLS (hlídá generovaný test fix-r2-3b)
    REVOKE TRUNCATE ON catalog.venue_places FROM tixly_app;
  END IF;
END $$;

ALTER TABLE catalog.event_seats
  ADD COLUMN IF NOT EXISTS seat_type  text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS seat_note  text,
  ADD COLUMN IF NOT EXISTS price_zone text;
ALTER TABLE catalog.event_seats DROP CONSTRAINT IF EXISTS event_seats_seat_type_check;
ALTER TABLE catalog.event_seats ADD CONSTRAINT event_seats_seat_type_check
  CHECK (seat_type IN ('standard', 'wheelchair', 'companion', 'unsellable', 'restricted'));
COMMENT ON COLUMN catalog.event_seats.seat_type IS 'Kolo 8: běžné | pro vozíčkáře | doprovod vozíčkáře | neprodejné (technika, režie) | s omezeným výhledem.';
COMMENT ON COLUMN catalog.event_seats.price_zone IS 'Kolo 8: cenová zóna místa z plánku sálu (název zóny = ticket_types.zone).';

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS seat_chart_id uuid REFERENCES catalog.venue_seating_charts(id) ON DELETE SET NULL;
COMMENT ON COLUMN catalog.events.seat_chart_id IS 'Kolo 8: verze plánku sálu, ze které byla zkopírována sedadla termínu (pozdější úprava plánku termín nemění).';
