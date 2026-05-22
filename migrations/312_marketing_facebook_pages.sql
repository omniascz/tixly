-- 312_marketing_facebook_pages.sql
-- Facebook Event 1-click publish — DACH parity #7 (EVENTIM.Light pattern).
-- Promotér napojí svou FB Page přes OAuth, potom může jedním klikem
-- publikovat event jako Facebook Event s ticket linkem zpět do Tixly.
--
-- Mock mode: FACEBOOK_APP_ID v env není → SDK vrací fake responses
-- (fb_page_id = 'mock-{uuid}', fb_event_id = 'mock-event-{uuid}'). Pro
-- produkci přidat env vars + Meta App approval (~2-4 týdny review).
--
-- Idempotent — IF NOT EXISTS guards.

BEGIN;

-- Napojené FB Pages per promotér.
-- Jeden promotér může mít víc FB pages (např. Klub Underground + jejich
-- promo brand page).
CREATE TABLE IF NOT EXISTS marketing.facebook_pages (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id               uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  fb_page_id                text NOT NULL,                    -- "1234567890"
  page_name                 text NOT NULL,                    -- "Klub Underground"
  page_category             text,                             -- "Music venue"
  page_picture_url          text,
  -- OAuth tokens (long-lived page token, ~60 days)
  access_token_encrypted    bytea NOT NULL,                   -- AES-256-GCM via encryptSecret
  token_expires_at          timestamptz,
  -- User who connected (audit)
  connected_by_user_id      uuid REFERENCES identity.users(id),
  connected_at              timestamptz NOT NULL DEFAULT now(),
  disconnected_at           timestamptz,
  -- Pro mock mode jasně označit
  is_mock                   boolean NOT NULL DEFAULT false,
  UNIQUE (promoter_id, fb_page_id)
);

CREATE INDEX IF NOT EXISTS idx_fb_pages_promoter ON marketing.facebook_pages(promoter_id)
  WHERE disconnected_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_fb_pages_active ON marketing.facebook_pages(disconnected_at)
  WHERE disconnected_at IS NULL;

ALTER TABLE marketing.facebook_pages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'marketing' AND tablename = 'facebook_pages'
      AND policyname = 'fb_pages_promoter_isolation'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY fb_pages_promoter_isolation ON marketing.facebook_pages
        FOR ALL TO tixly_app
        USING (
          promoter_id IN (
            SELECT promoter_id FROM platform.promoter_members
            WHERE user_id = current_setting('app.current_user_id', true)::uuid
          )
          OR current_setting('app.platform_admin', true) = 'true'
        )
    $POL$;
  END IF;
END $$;

-- Publish ledger — kdy a kam byl event publikován, status, fb_event_id pro
-- pozdější update/delete.
CREATE TABLE IF NOT EXISTS catalog.event_fb_publishes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  fb_page_id      uuid NOT NULL REFERENCES marketing.facebook_pages(id) ON DELETE CASCADE,
  fb_event_id     text NOT NULL,                              -- FB Event ID po publish
  status          text NOT NULL DEFAULT 'published',
  published_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  unpublished_at  timestamptz,
  last_error      text,
  is_mock         boolean NOT NULL DEFAULT false,
  CHECK (status IN ('published', 'unpublished', 'failed', 'expired')),
  UNIQUE (event_id, fb_page_id)
);

CREATE INDEX IF NOT EXISTS idx_fb_publishes_event ON catalog.event_fb_publishes(event_id);
CREATE INDEX IF NOT EXISTS idx_fb_publishes_status ON catalog.event_fb_publishes(status)
  WHERE status = 'published';

ALTER TABLE catalog.event_fb_publishes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'catalog' AND tablename = 'event_fb_publishes'
      AND policyname = 'fb_publishes_promoter_isolation'
  ) THEN
    EXECUTE $POL$
      CREATE POLICY fb_publishes_promoter_isolation ON catalog.event_fb_publishes
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

COMMIT;
