-- Marketing campaigns — generic email/SMS campaign tracking
--
-- Promotér vytvoří kampaň, vybere segment kupců, napíše obsah, naplánuje send.
-- Sledujeme sent/click/conversion counters pro reporting v /admin/marketing.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing.campaigns (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id         UUID          NOT NULL,
  name                TEXT          NOT NULL,
  channel             TEXT          NOT NULL
    CHECK (channel IN ('email', 'sms', 'push', 'inapp')),
  status              TEXT          NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'failed')),

  -- Segment selektor (JSONB s pravidly)
  segment             JSONB         NOT NULL DEFAULT '{}'::jsonb,

  -- Content
  subject             TEXT,
  body_html           TEXT,
  body_text           TEXT,
  reply_to            TEXT,

  -- UTM parametry pro attribution (Tixly marketplace tracking + Meta/GA pixel)
  utm_source          TEXT,
  utm_medium          TEXT,
  utm_campaign        TEXT,
  utm_content         TEXT,

  -- Scheduling
  scheduled_at        TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,

  -- Counters (auto-updated z sent/click/conversion logu)
  recipient_count     INTEGER       NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count          INTEGER       NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  delivered_count     INTEGER       NOT NULL DEFAULT 0 CHECK (delivered_count >= 0),
  open_count          INTEGER       NOT NULL DEFAULT 0 CHECK (open_count >= 0),
  click_count         INTEGER       NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  conversion_count    INTEGER       NOT NULL DEFAULT 0 CHECK (conversion_count >= 0),
  revenue_halire      INTEGER       NOT NULL DEFAULT 0 CHECK (revenue_halire >= 0),
  bounce_count        INTEGER       NOT NULL DEFAULT 0 CHECK (bounce_count >= 0),
  unsubscribe_count   INTEGER       NOT NULL DEFAULT 0 CHECK (unsubscribe_count >= 0),

  -- Audit
  created_by          UUID,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE marketing.campaigns IS
  'Generic marketing campaigns — email/SMS/push. Tracking metrics pro UTM attribution.';
COMMENT ON COLUMN marketing.campaigns.segment IS
  'JSONB pravidla pro výběr příjemců. Příklad: { "all_buyers": true, "min_orders": 2, "city": "Praha" }';
COMMENT ON COLUMN marketing.campaigns.revenue_halire IS
  'Suma paid orders attribute na tuto kampaň (přes UTM matching).';

CREATE INDEX IF NOT EXISTS idx_campaigns_promoter
  ON marketing.campaigns (promoter_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled
  ON marketing.campaigns (scheduled_at)
  WHERE status = 'scheduled';

DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON marketing.campaigns;
CREATE TRIGGER trg_campaigns_updated_at
  BEFORE UPDATE ON marketing.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Recipients log (audit + idempotence)
CREATE TABLE IF NOT EXISTS marketing.campaign_recipients (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID         NOT NULL REFERENCES marketing.campaigns(id) ON DELETE CASCADE,
  user_id         UUID,        -- nullable pro guest emaily
  email           TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'failed')),
  sent_at         TIMESTAMPTZ,
  opened_at       TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign
  ON marketing.campaign_recipients (campaign_id, status);

COMMIT;
