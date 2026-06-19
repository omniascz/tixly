BEGIN;

CREATE TABLE IF NOT EXISTS orders.lottery_campaigns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id            UUID NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  promoter_id         UUID NOT NULL REFERENCES platform.promoters(id),
  ticket_type_id      UUID REFERENCES catalog.ticket_types(id),
  max_winners         INT NOT NULL CHECK (max_winners >= 1),
  registration_opens  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  registration_closes TIMESTAMPTZ NOT NULL,
  draw_at             TIMESTAMPTZ NOT NULL,
  payment_window_hours INT NOT NULL DEFAULT 48,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','open','closed','drawn','completed')),
  winner_count        INT NOT NULL DEFAULT 0,
  entry_count         INT NOT NULL DEFAULT 0,
  drawn_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders.lottery_entries (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      UUID NOT NULL REFERENCES orders.lottery_campaigns(id) ON DELETE CASCADE,
  email            TEXT NOT NULL,
  name             TEXT NOT NULL,
  entry_token      TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(20), 'hex'),
  status           TEXT NOT NULL DEFAULT 'entered'
                     CHECK (status IN ('entered','won','lost','converted','expired')),
  draw_position    INT,
  notified_at      TIMESTAMPTZ,
  payment_deadline TIMESTAMPTZ,
  order_id         UUID REFERENCES orders.orders(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_lottery_entries_campaign ON orders.lottery_entries(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_token ON orders.lottery_entries(entry_token);

COMMIT;
