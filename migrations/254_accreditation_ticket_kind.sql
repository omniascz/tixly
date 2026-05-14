-- Rozšíření catalog.ticket_types.kind o 'accreditation'.
-- Comp tickety pro media/VIP/staff/sponsor — base_price=0, vystaveno po accreditation approve.

BEGIN;

ALTER TABLE catalog.ticket_types
  DROP CONSTRAINT IF EXISTS catalog_ticket_types_kind_check;

ALTER TABLE catalog.ticket_types
  ADD CONSTRAINT catalog_ticket_types_kind_check
    CHECK (kind IN ('standing', 'seated', 'season_pass', 'bundle', 'accreditation'));

COMMIT;
