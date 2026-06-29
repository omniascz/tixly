-- Migration 417: Event watchlist — "Upozorni mě" na akce co nejsou v prodeji
-- Nebo na akce co jsou vyprodané (odlišné od waiting listu — ten je pro konkrétní místo).

CREATE TABLE IF NOT EXISTS marketing.ticket_alerts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text        NOT NULL,
  event_id    uuid        NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  user_id     uuid        REFERENCES identity.users(id) ON DELETE SET NULL,
  alert_type  text        NOT NULL DEFAULT 'on_sale'
    CHECK (alert_type IN ('on_sale','restock','price_drop')),
  token       text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'base64url'),
  notified_at timestamptz,
  cancelled_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, event_id, alert_type)
);

CREATE INDEX IF NOT EXISTS idx_ticket_alerts_event ON marketing.ticket_alerts (event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_alerts_email ON marketing.ticket_alerts (email);

-- RLS: public insert, user reads own, admin reads all
ALTER TABLE marketing.ticket_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ticket_alerts_insert ON marketing.ticket_alerts FOR INSERT WITH CHECK (true);
CREATE POLICY ticket_alerts_select ON marketing.ticket_alerts FOR SELECT USING (
  current_setting('app.is_platform_admin', true) = 'true'
  OR (user_id IS NOT NULL AND user_id::text = current_setting('app.user_id', true))
  OR current_setting('app.user_id', true) = ''
);
CREATE POLICY ticket_alerts_update ON marketing.ticket_alerts FOR UPDATE USING (true);
