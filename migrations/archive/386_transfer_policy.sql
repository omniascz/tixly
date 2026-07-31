-- Migration 386: Transfer policy per event + buyer on-demand PDF endpoint support
-- Adds transfer_policy + max_transfer_count to catalog.events

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS transfer_policy VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (transfer_policy IN ('open', 'restricted', 'disabled')),
  ADD COLUMN IF NOT EXISTS max_transfer_count SMALLINT;

COMMENT ON COLUMN catalog.events.transfer_policy IS
  'open = neomezeno, restricted = max max_transfer_count převodů, disabled = žádný převod';
COMMENT ON COLUMN catalog.events.max_transfer_count IS
  'Platí jen pro transfer_policy=restricted. Počet povolených převodů per vstupenka.';
