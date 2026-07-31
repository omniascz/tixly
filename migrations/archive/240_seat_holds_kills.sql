-- Seat Holds & Kills — Admin nástroj pro blokování sedadel.
--
-- Existující event_seats.hold_until + hold_user_id slouží pro buyer-side temporary holds.
-- Tato migrace přidává promoter-side holds s kategorií (artist hold, comp ticket, kill).
--
-- hold_kind = NULL                    → běžné buyer hold přes hold_until
-- hold_kind = 'artist'                → blokováno pro umělce / produkci
-- hold_kind = 'promoter'              → vyhrazené pořadatelem pro VIP / soutěže
-- hold_kind = 'comp'                  → darovaná vstupenka (comp ticket)
-- hold_kind = 'production'            → production kill (omezený výhled, technická pozice)
-- hold_kind = 'customer'              → buyer hold (alias pro hold_until — pro konzistenci dotazů)

BEGIN;

ALTER TABLE catalog.event_seats
  ADD COLUMN hold_kind TEXT
    CHECK (hold_kind IS NULL OR hold_kind IN ('artist', 'promoter', 'comp', 'production', 'customer'));

ALTER TABLE catalog.event_seats
  ADD COLUMN hold_label TEXT;

COMMENT ON COLUMN catalog.event_seats.hold_kind IS
  'Kategorie hold-u: artist (umělec), promoter (VIP), comp (dárek), production (kill), customer (buyer temp hold).';
COMMENT ON COLUMN catalog.event_seats.hold_label IS
  'Volitelný popisek hold-u: "Manager", "Soutěž rádio", "Sloup B", apod.';

-- Partial index pro rychlou query "kolik je active hold-ů jakého kindu"
CREATE INDEX idx_event_seats_hold_kind
  ON catalog.event_seats (event_id, hold_kind)
  WHERE hold_kind IS NOT NULL;

COMMIT;
