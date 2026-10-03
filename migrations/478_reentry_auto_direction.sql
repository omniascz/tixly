--
-- 478_reentry_auto_direction.sql
--   Automaticky smer pruchodu, oprava skenu a rezim brany
--
-- ── Proc ─────────────────────────────────────────────────────────────────────
-- Re-entry v systemu bylo, ale obsluha musela pred kazdym pipnutim prepnout
-- „vstup / vystup". U dveri to nikdo nedela — a kdyz zapomene, dostane 409
-- a fronta stoji. Server pritom uz vi z `tickets.currently_inside`, kterym
-- smerem clovek jde. Staci mu to ukazat.
--
-- Tahle migrace pridava tri veci, bez kterych to nejde provozovat:
--
-- 1) `catalog.venue_gates.direction` — brana muze mit smer natvrdo. U vetsi
--    akce ma vystup vlastni turniket a obsluha tam nema co prepinat.
--
-- 2) `tickets.scan_events.undone_at` + kdo a proc — kdyz se zobrazi spatny
--    smer, musi jit posledni sken VZIT ZPET, ne pipnout znovu. Opakovane
--    pipnuti by stav prehodilo zpatky, ale zaroven naceslo pocitadlo vstupu
--    o jedna a v evidenci by zustaly dva pruchody, ktere se nestaly.
--    Vraceny sken zustava v tabulce (auditni stopa), jen se nepocita.
--
-- 3) `catalog.events.reentry_cooldown_seconds` — prodleva mezi vystupem
--    a navratem. Zaroven slouzi jako ochrana proti dvojimu nacteni tehoz kodu:
--    pipnuti stejne vstupenky v ramci prodlevy se ignoruje a zopakuje se
--    predchozi vysledek misto prehozeni stavu.
--

BEGIN;

-- 1) Smer brany --------------------------------------------------------------
ALTER TABLE catalog.venue_gates
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'both';

ALTER TABLE catalog.venue_gates
  DROP CONSTRAINT IF EXISTS venue_gates_direction_check;
ALTER TABLE catalog.venue_gates
  ADD CONSTRAINT venue_gates_direction_check
  CHECK (direction = ANY (ARRAY['both'::text, 'entry'::text, 'exit'::text]));

COMMENT ON COLUMN catalog.venue_gates.direction IS
  'both = smer urci system podle stavu vstupenky; entry/exit = brana ma smer natvrdo.';

-- 2) Vzeti skenu zpet --------------------------------------------------------
ALTER TABLE tickets.scan_events
  ADD COLUMN IF NOT EXISTS undone_at timestamptz,
  ADD COLUMN IF NOT EXISTS undone_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS undo_reason text;

CREATE INDEX IF NOT EXISTS idx_scan_events_active
  ON tickets.scan_events (ticket_id, scanned_at DESC)
  WHERE undone_at IS NULL;

COMMENT ON COLUMN tickets.scan_events.undone_at IS
  'Sken vzat zpet obsluhou (spatny smer, dvojite nacteni). Zaznam zustava kvuli auditu.';

-- 3) Prodleva mezi pruchody --------------------------------------------------
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS reentry_cooldown_seconds integer NOT NULL DEFAULT 10;

ALTER TABLE catalog.events
  DROP CONSTRAINT IF EXISTS events_reentry_cooldown_check;
ALTER TABLE catalog.events
  ADD CONSTRAINT events_reentry_cooldown_check
  CHECK (reentry_cooldown_seconds >= 0 AND reentry_cooldown_seconds <= 3600);

COMMENT ON COLUMN catalog.events.reentry_cooldown_seconds IS
  'Prodleva mezi dvema pruchody teze vstupenky. Chrani pred dvojim nactenim kodu; 0 = vypnuto.';

COMMIT;
