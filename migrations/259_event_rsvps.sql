-- Event RSVP — social signal před nákupem.
--
-- Status:
--   interested = "zajímá mě, ale ještě se nerozhodl"
--   going     = "určitě půjdu" (typicky po koupi automaticky?)
--   declined  = "nepůjdu" (explicit no)
--
-- Slouží pro:
--   - Sociální graf (friends going) — pokud user povolí
--   - Promotér insight (X zájemců → onsale priority)
--   - Personal feed signal (interested → recommendation boost)

BEGIN;

CREATE TABLE marketing.event_rsvps (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id        UUID         NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  status          TEXT         NOT NULL
    CHECK (status IN ('interested', 'going', 'declined')),
  is_public       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_event_rsvp UNIQUE (user_id, event_id)
);

CREATE INDEX idx_event_rsvps_event_status
  ON marketing.event_rsvps (event_id, status)
  WHERE status IN ('interested', 'going');

CREATE INDEX idx_event_rsvps_user
  ON marketing.event_rsvps (user_id, created_at DESC);

COMMENT ON COLUMN marketing.event_rsvps.is_public IS
  'TRUE = ostatní (s aktivním follow vztahem) vidí v feed „X jde na akci". FALSE = privátní RSVP.';

COMMIT;
