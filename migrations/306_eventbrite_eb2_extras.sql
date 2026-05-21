-- 306_eventbrite_eb2_extras.sql
-- Eventbrite Parity Fáze EB2:
-- 1. Collections — curated event lists (Eventbrite "Collections")
-- 2. Order self-service cancel (před paid → cancellable kdykoli;
--    paid → respekt refund policy)
-- 3. Pre-event payouts — explicitní mód s schedule
-- 4. Lineup music integration stub (artists × external links)

BEGIN;

-- ============================================================
-- 1. Collections — curated event lists
-- ============================================================
CREATE TABLE IF NOT EXISTS catalog.event_collections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  -- NULL = platform-curated (master admin), jinak promotérova
  slug            text NOT NULL,
  title           text NOT NULL,
  subtitle        text,
  description     text,
  cover_image_url text,
  -- Display config
  display_style   text NOT NULL DEFAULT 'grid' CHECK (display_style IN ('grid', 'list', 'carousel', 'masonry')),
  is_public       boolean NOT NULL DEFAULT true,
  is_featured     boolean NOT NULL DEFAULT false,
  -- Auto-curation (volitelné) — pokud zadáno, includes events matching
  auto_filter     jsonb,                    -- { category: 'hudba', city: 'praha', ... }
  display_order   integer NOT NULL DEFAULT 100,
  created_by_user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_slug_promoter
  ON catalog.event_collections(slug, COALESCE(promoter_id::text, 'platform'));
CREATE INDEX IF NOT EXISTS idx_collections_public
  ON catalog.event_collections(promoter_id, display_order) WHERE is_public = true;

COMMENT ON TABLE catalog.event_collections IS
  'Curated event lists. promoter_id NULL = platform-wide (Tixly editorial), jinak promotérova.';

-- M:N events ↔ collections (manual add)
CREATE TABLE IF NOT EXISTS catalog.collection_events (
  collection_id   uuid NOT NULL REFERENCES catalog.event_collections(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  display_order   integer NOT NULL DEFAULT 100,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_events_event
  ON catalog.collection_events(event_id);

-- ============================================================
-- 2. Order self-service cancel — column flag
-- ============================================================
ALTER TABLE orders.orders
  ADD COLUMN IF NOT EXISTS cancelled_by_buyer_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_refund_status text
    CHECK (cancellation_refund_status IN (NULL, 'no_refund', 'pending', 'approved', 'completed', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by_buyer
  ON orders.orders(cancelled_by_buyer_at) WHERE cancelled_by_buyer_at IS NOT NULL;

-- Refund eligibility settings na events
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS allow_buyer_cancel boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS buyer_cancel_deadline_hours_before integer DEFAULT 48,
  ADD COLUMN IF NOT EXISTS refund_pct_before_deadline integer DEFAULT 100,
  ADD COLUMN IF NOT EXISTS refund_pct_after_deadline integer DEFAULT 0;

-- ============================================================
-- 3. Pre-event payouts (explicit advance schedule)
-- ============================================================
CREATE TABLE IF NOT EXISTS platform.advance_payout_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
  -- Schedule: kolik % se vyplatí kdy (relativně k event_start)
  -- Eg. 70% při 30 dnech před = early access pro promotéra k cashflow
  installments    jsonb NOT NULL,           -- [{ days_before: 30, pct: 70 }, { days_before: 0, pct: 30 }]
  total_authorized_halire integer NOT NULL,
  total_paid_halire integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_advance_payout_event
  ON platform.advance_payout_schedules(event_id) WHERE status = 'active';

-- Per-installment payouts
CREATE TABLE IF NOT EXISTS platform.advance_payout_installments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id     uuid NOT NULL REFERENCES platform.advance_payout_schedules(id) ON DELETE CASCADE,
  installment_index integer NOT NULL,
  amount_halire   integer NOT NULL,
  scheduled_for   timestamptz NOT NULL,
  paid_at         timestamptz,
  external_payout_id text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'eligible', 'paid', 'failed')),
  UNIQUE (schedule_id, installment_index)
);

CREATE INDEX IF NOT EXISTS idx_advance_installments_eligible
  ON platform.advance_payout_installments(scheduled_for)
  WHERE status IN ('pending', 'eligible');

COMMENT ON TABLE platform.advance_payout_schedules IS
  'Promotér si nastaví pre-event payouts (Eventbrite parity). Eg. 70% při T-30, 30% při T-0.';

-- ============================================================
-- 4. Music integration links — Spotify/Bandsintown/Songkick auto-post
-- ============================================================
ALTER TABLE lineups.artists
  ADD COLUMN IF NOT EXISTS bandsintown_id text,
  ADD COLUMN IF NOT EXISTS songkick_id text,
  ADD COLUMN IF NOT EXISTS apple_music_id text,
  ADD COLUMN IF NOT EXISTS youtube_channel_id text;

-- Auto-post job queue
CREATE TABLE IF NOT EXISTS lineups.music_post_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id       uuid NOT NULL REFERENCES lineups.artists(id) ON DELETE CASCADE,
  event_id        uuid NOT NULL REFERENCES catalog.events(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('spotify', 'bandsintown', 'songkick', 'apple_music')),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'posted', 'failed', 'skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  external_post_id text,
  last_error      text,
  posted_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_music_post_jobs_pending
  ON lineups.music_post_jobs(status, created_at) WHERE status = 'pending';

INSERT INTO public.schema_migrations (filename)
VALUES ('306_eventbrite_eb2_extras.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
