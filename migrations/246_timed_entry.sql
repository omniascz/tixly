-- Timed Entry — slot-based admission pro muzea, ZOO, hrady, aquaparky.
--
-- Event s timed_entry_enabled=TRUE má generované sloty:
--   - slot_date + slot_start (hh:mm) + slot_end (hh:mm)
--   - capacity per slot (max návštěvníků)
--   - buffer_minutes mezi sloty (úklid, příprava)
--
-- Buyer vybere slot v UI, checkout uloží slot_id do orders.orders.
-- Scanner vstup ověřuje že aktuální čas je v rozmezí slotu (s tolerancí 15 min).

BEGIN;

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS timed_entry_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE catalog.entry_slots (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID         NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  slot_start      TIMESTAMPTZ  NOT NULL,
  slot_end        TIMESTAMPTZ  NOT NULL,
  capacity        INTEGER      NOT NULL CHECK (capacity > 0),
  remaining       INTEGER      NOT NULL CHECK (remaining >= 0),
  status          TEXT         NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'sold_out', 'cancelled')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_entry_slots_window CHECK (slot_end > slot_start),
  CONSTRAINT chk_entry_slots_capacity CHECK (remaining <= capacity),
  CONSTRAINT uq_entry_slots_event_start UNIQUE (event_id, slot_start)
);

CREATE INDEX idx_entry_slots_event_date
  ON catalog.entry_slots (event_id, slot_start)
  WHERE status = 'open' AND remaining > 0;

ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS entry_slot_id UUID;

COMMENT ON TABLE catalog.entry_slots IS
  'Časové sloty pro timed-entry akce (muzea, ZOO, hrady). Capacity per slot, buyer vybere v checkoutu.';
COMMENT ON COLUMN orders.orders.entry_slot_id IS
  'Volitelná reference na catalog.entry_slots — buyer si zvolil konkrétní slot.';

COMMIT;
