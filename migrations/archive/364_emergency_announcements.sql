BEGIN;

-- Nouzová oznámení (herec onemocněl, změna programu)
CREATE TABLE IF NOT EXISTS communications.emergency_announcements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  subject         TEXT NOT NULL,
  message         TEXT NOT NULL,
  cast_change     TEXT,
  offer_exchange  BOOLEAN NOT NULL DEFAULT true,
  offer_refund    BOOLEAN NOT NULL DEFAULT true,
  sent_at         TIMESTAMPTZ,
  recipient_count INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS communications.announcement_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID NOT NULL REFERENCES communications.emergency_announcements(id) ON DELETE CASCADE,
  ticket_id       UUID NOT NULL REFERENCES tickets.tickets(id),
  response        TEXT NOT NULL CHECK (response IN ('accepted','exchange_requested','refund_requested')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, ticket_id)
);
CREATE INDEX IF NOT EXISTS idx_ann_resp_ann ON communications.announcement_responses(announcement_id);

COMMIT;
