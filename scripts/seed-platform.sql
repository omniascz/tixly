-- =============================================================================
-- Tixly — minimální platform seed pro lokální demo (3 role)
--
-- - Doplní chybějící sloupce/tabulky/enumy, které předpokládá Auth flow
--   (is_platform_admin, platform.promoters.status/slug, promoter_members,
--   audit.event_moderation_log, catalog.moderation_blocklist)
-- - Založí 3 demo účty: superadmin, aktivní promotér, pending promotér
-- - Heslo pro všechny: "Demo2026!"
--
-- Spuštění:
--   docker compose exec -T postgres psql -U tixly -d tixly < scripts/seed-platform.sql
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) identity.users — sloupec pro master admina
-- ---------------------------------------------------------------------------
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2) platform.promoters — chybějící sloupce status/slug/contact_email
-- ---------------------------------------------------------------------------
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'suspended'));
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_promoters_slug
  ON platform.promoters (slug)
  WHERE slug IS NOT NULL;
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS contact_email TEXT;

-- ---------------------------------------------------------------------------
-- 3) platform.member_role + platform.promoter_members
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE platform.member_role AS ENUM ('owner', 'admin', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.promoter_members (
  promoter_id  UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  role         platform.member_role NOT NULL DEFAULT 'staff',
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('pending','active','suspended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (promoter_id, user_id)
);
ALTER TABLE platform.promoter_members
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending','active','suspended'));

-- ---------------------------------------------------------------------------
-- 4) catalog.events — rozšířený status enum (pending_review/rejected/flagged)
-- ---------------------------------------------------------------------------
ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE catalog.events ADD CONSTRAINT events_status_check
  CHECK (status IN (
    'draft', 'pending_review', 'published',
    'rejected', 'flagged', 'cancelled', 'completed'
  ));

-- ---------------------------------------------------------------------------
-- 5) Audit + moderation blocklist
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.event_moderation_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL,
  actor_user_id    UUID,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('auto_keyword','auto_ai','human')),
  decision         TEXT NOT NULL CHECK (decision IN ('submitted','approved','rejected','flagged')),
  reason           TEXT,
  matched_keywords TEXT[],
  ai_score         NUMERIC(3,2),
  ai_categories    TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_log_event
  ON audit.event_moderation_log (event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog.moderation_blocklist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword    TEXT NOT NULL UNIQUE,
  category   TEXT NOT NULL CHECK (category IN ('hate','extremism','scam','adult','violence')),
  severity   TEXT NOT NULL CHECK (severity IN ('auto_reject','flag_for_review')) DEFAULT 'flag_for_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO catalog.moderation_blocklist (keyword, category, severity) VALUES
  ('heil',                   'extremism', 'auto_reject'),
  ('sieg heil',              'extremism', 'auto_reject'),
  ('judenfrei',              'extremism', 'auto_reject'),
  ('white power',            'hate',      'auto_reject'),
  ('hitler',                 'extremism', 'flag_for_review'),
  ('nacismus',               'extremism', 'flag_for_review'),
  ('rasově čistý',           'hate',      'auto_reject'),
  ('100% zaručený zisk',     'scam',      'flag_for_review'),
  ('investiční příležitost', 'scam',      'flag_for_review'),
  ('zaručeně zbohatnout',    'scam',      'flag_for_review')
ON CONFLICT (keyword) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Demo účty — heslo "Demo2026!" (bcrypt hash)
-- ---------------------------------------------------------------------------
-- Master admin
INSERT INTO identity.users (
  id, email, name, password_hash, is_platform_admin,
  email_verified_at, gdpr_consent_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000001',
  'superadmin@tixly.cz',
  'Platform Admin',
  '$2b$12$aWqNHb6WpNC96y15T.aRve78dGrvrRc0pghFWyCdV1JUfM/SzQtDi',
  TRUE,
  NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  is_platform_admin = TRUE,
  password_hash = EXCLUDED.password_hash;

-- Aktivní promotér
INSERT INTO identity.users (
  id, email, name, password_hash,
  email_verified_at, gdpr_consent_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000002',
  'admin@tixly.cz',
  'Admin Tixly',
  '$2b$12$aWqNHb6WpNC96y15T.aRve78dGrvrRc0pghFWyCdV1JUfM/SzQtDi',
  NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- Pending promotér
INSERT INTO identity.users (
  id, email, name, password_hash,
  gdpr_consent_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000003',
  'pending@example.cz',
  'Karel Pendingovič',
  '$2b$12$aWqNHb6WpNC96y15T.aRve78dGrvrRc0pghFWyCdV1JUfM/SzQtDi',
  NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- ---------------------------------------------------------------------------
-- 7) Promotér organizace
-- ---------------------------------------------------------------------------
-- Active: Demo Promoter
INSERT INTO platform.promoters (
  id, name, email, contact_email, slug, status, locale, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000010',
  'Demo Promoter',
  'admin@tixly.cz',
  'admin@tixly.cz',
  'demo-promoter',
  'active',
  'cs',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  status = 'active',
  slug = EXCLUDED.slug,
  contact_email = EXCLUDED.contact_email;

-- Pending: Pending Events
INSERT INTO platform.promoters (
  id, name, email, contact_email, slug, status, locale, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000020',
  'Pending Events s.r.o.',
  'pending@example.cz',
  'pending@example.cz',
  'pending-events',
  'pending',
  'cs',
  NOW(), NOW()
)
ON CONFLICT (id) DO UPDATE SET
  status = 'pending',
  slug = EXCLUDED.slug;

-- ---------------------------------------------------------------------------
-- 8) Promoter members
-- ---------------------------------------------------------------------------
INSERT INTO platform.promoter_members (promoter_id, user_id, role, created_at, updated_at) VALUES
  ('00000000-0000-4000-a000-000000000010', '00000000-0000-4000-a000-000000000002', 'owner', NOW(), NOW()),
  ('00000000-0000-4000-a000-000000000020', '00000000-0000-4000-a000-000000000003', 'owner', NOW(), NOW())
ON CONFLICT (promoter_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 9) Ověření
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  admin_count        INT;
  active_promoters   INT;
  pending_promoters  INT;
  blocklist_count    INT;
BEGIN
  SELECT COUNT(*) INTO admin_count
    FROM identity.users WHERE is_platform_admin = TRUE;
  SELECT COUNT(*) INTO active_promoters
    FROM platform.promoters WHERE status = 'active';
  SELECT COUNT(*) INTO pending_promoters
    FROM platform.promoters WHERE status = 'pending';
  SELECT COUNT(*) INTO blocklist_count
    FROM catalog.moderation_blocklist;

  RAISE NOTICE '✓ Platform admin accounts:      %', admin_count;
  RAISE NOTICE '✓ Active promoters:             %', active_promoters;
  RAISE NOTICE '✓ Pending promoters:            %', pending_promoters;
  RAISE NOTICE '✓ Moderation blocklist entries: %', blocklist_count;
END $$;

COMMIT;
