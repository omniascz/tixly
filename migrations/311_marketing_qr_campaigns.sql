-- 311_marketing_qr_campaigns.sql
-- Print marketing QR campaigns — promotér si vygeneruje krátký URL slug,
-- vytiskne ho na plakát, billboard, leták atp. Klik na /qr/[slug] → inkrement
-- scan_count + redirect na /cs/events/[event_id]. Po nákupu se inkrementuje
-- conversion_count přes attribution cookie (qr_ref).
--
-- DACH parity: EVENTIM.Light Standard QR (audit DACH-AUDIT-VERIFIED.md sekce #5).
-- Promotér měří "kolik mi dal plakát v metru" — UTM-like attribution.
--
-- Idempotent — IF NOT EXISTS guards.

BEGIN;

CREATE TABLE IF NOT EXISTS marketing.qr_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  slug             text NOT NULL UNIQUE,
  name             text NOT NULL,            -- "Plakát Praha 1", "Leták srpen 2026"
  utm_source       text,                     -- "poster", "billboard", "flyer"
  utm_medium       text,                     -- "print"
  utm_campaign     text,                     -- volitelný
  scan_count       integer NOT NULL DEFAULT 0,
  conversion_count integer NOT NULL DEFAULT 0,
  conversion_total_halire bigint NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES identity.users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (slug ~ '^[a-z0-9-]{3,40}$')
);

CREATE INDEX IF NOT EXISTS idx_qr_campaigns_event ON marketing.qr_campaigns(event_id);
CREATE INDEX IF NOT EXISTS idx_qr_campaigns_slug ON marketing.qr_campaigns(slug);

-- RLS: promotér vidí jen vlastní kampaně přes event ownership.
ALTER TABLE marketing.qr_campaigns ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'marketing' AND tablename = 'qr_campaigns'
      AND policyname = 'qr_campaigns_promoter_isolation'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY qr_campaigns_promoter_isolation ON marketing.qr_campaigns
        FOR ALL TO tixly_app
        USING (
          event_id IN (
            SELECT e.id FROM catalog.events e
            JOIN platform.promoter_members pm ON pm.promoter_id = e.promoter_id
            WHERE pm.user_id = current_setting('app.current_user_id', true)::uuid
          )
          OR current_setting('app.platform_admin', true) = 'true'
        )
    $POL$;
  END IF;
END $$;

-- Tracking: per-scan record pro analytics (volitelné, pro budoucí dashboard).
CREATE TABLE IF NOT EXISTS marketing.qr_scans (
  id            bigserial PRIMARY KEY,
  campaign_id   uuid NOT NULL REFERENCES marketing.qr_campaigns(id) ON DELETE CASCADE,
  scanned_at    timestamptz NOT NULL DEFAULT now(),
  user_agent    text,
  ip_hash       text,                       -- hashed pro GDPR
  referer       text
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_campaign ON marketing.qr_scans(campaign_id, scanned_at DESC);

-- orders.orders: přidat qr_campaign_id pro attribution tracking konkrétní objednávky
-- k QR kampani (přes cookie qr_ref v checkout/route.ts).
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS qr_campaign_id uuid
  REFERENCES marketing.qr_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_qr_campaign ON orders.orders(qr_campaign_id)
  WHERE qr_campaign_id IS NOT NULL;

COMMIT;
