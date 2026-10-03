--
-- 476_venue_date_holds.sql
--   catalog.venue_date_holds — opce na termin v sale
--
-- ── Proc ─────────────────────────────────────────────────────────────────────
-- Uplne prvni vec, ktera se v produkci deje: agent se pta na 14. listopadu,
-- sal da prvni opci, za tyden vola druhy zajemce a dostane druhou. Kdo ma prvni,
-- ma lhutu na potvrzeni; kdyz ji propasne, posouva se druhy. Dosud to poradatele
-- vedli v tabulce nebo v hlave a prekryte terminy byly bezna havarie —
-- v systemu k tomu nebyla zadna tabulka ani endpoint.
--
-- ── Klicove rozhodnuti: opce NEZAKLADA akci ──────────────────────────────────
-- Drzeni terminu neni udalost. Kdyby zakladalo akci, zacaly by se objevovat
-- v kalendarich, v prehledech a nekdo by je omylem pustil do prodeje. Akce
-- vznikne az potvrzenim opce (`event_id` se vyplni tehdy).
--
-- ── Poradi opci ──────────────────────────────────────────────────────────────
-- `option_rank` 1 = prvni opce. Unikatni index zajisti, ze na jeden termin
-- nemuzou byt dve stejne poradi. Po propadnuti prvni se druha posune — to dela
-- aplikace, protoze soucasti posunu je i upozorneni drziteli.
--
-- Potvrzeny termin blokuje sal: unikatni index pres (venue_id, hold_date)
-- pro status='confirmed'. Dva potvrzene koncerty v jednom sale na jeden den
-- databaze nedovoli.
--

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.venue_date_holds (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id      uuid NOT NULL REFERENCES catalog.venues(id) ON DELETE CASCADE,
    promoter_id   uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
    hold_date     date NOT NULL,
    option_rank   integer NOT NULL DEFAULT 1,
    title         text NOT NULL,
    artist_name   text,
    contact_name  text,
    contact_email text,
    -- Do kdy musi drzitel potvrdit. NULL = bez lhuty (drzi, dokud nepusti).
    expires_at    timestamptz,
    status        text NOT NULL DEFAULT 'held',
    -- Vyplni se az potvrzenim: akce, ktera z opce vznikla.
    event_id      uuid REFERENCES catalog.events(id) ON DELETE SET NULL,
    notes         text,
    created_by_user_id uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT venue_date_holds_status_check
      CHECK (status = ANY (ARRAY['held'::text, 'confirmed'::text, 'released'::text, 'expired'::text])),
    CONSTRAINT venue_date_holds_rank_check CHECK (option_rank >= 1 AND option_rank <= 20),
    CONSTRAINT venue_date_holds_confirmed_has_event
      CHECK (status <> 'confirmed' OR event_id IS NOT NULL)
);

-- Na jeden termin jedno poradi. Zrusene a propadle opce se nepocitaji.
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_date_holds_rank
  ON catalog.venue_date_holds (venue_id, hold_date, option_rank)
  WHERE status = 'held';

-- Jeden potvrzeny termin na sal a den.
CREATE UNIQUE INDEX IF NOT EXISTS idx_venue_date_holds_confirmed
  ON catalog.venue_date_holds (venue_id, hold_date)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS idx_venue_date_holds_calendar
  ON catalog.venue_date_holds (promoter_id, hold_date);
CREATE INDEX IF NOT EXISTS idx_venue_date_holds_expiry
  ON catalog.venue_date_holds (expires_at) WHERE status = 'held' AND expires_at IS NOT NULL;

COMMENT ON TABLE catalog.venue_date_holds IS
  'Opce na termin v sale. Drzeni NEZAKLADA akci — ta vznikne az potvrzenim.';
COMMENT ON COLUMN catalog.venue_date_holds.option_rank IS
  '1 = prvni opce. Po propadnuti prvni se dalsi posouvaji (dela aplikace, posila upozorneni).';

ALTER TABLE catalog.venue_date_holds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_venue_date_holds_scope ON catalog.venue_date_holds;
CREATE POLICY p_venue_date_holds_scope ON catalog.venue_date_holds
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
     OR promoter_id = public.app_current_promoter_id());

COMMIT;
