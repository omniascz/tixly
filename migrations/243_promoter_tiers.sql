-- Promoter Tier System (1-4)
--
-- TIER 1 (nový):        manual approve each event, max 500 tix/event
-- TIER 2 (ověřený):     auto-approve, max 5000 tix/event
-- TIER 3 (premium):     auto-approve, unlimited, nižší provize
-- TIER 4 (enterprise):  custom SLA, dedikovaný account manager
--
-- Default tier = 1. Auto-upgrade na základě objemu posledních 90 dní spočítá
-- cron job (TODO: /api/internal/cron/promoter-tier-evaluate).

BEGIN;

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS tier INTEGER NOT NULL DEFAULT 1
    CHECK (tier BETWEEN 1 AND 4);

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ;

ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS tier_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN platform.promoters.tier IS
  '1=nový (manual approve, 500 tix limit), 2=ověřený (auto, 5000), 3=premium (unlimited, lower fee), 4=enterprise (custom SLA).';
COMMENT ON COLUMN platform.promoters.tier_updated_at IS
  'Kdy byl tier naposled upgradován (auto nebo manuálně Super Adminem).';
COMMENT ON COLUMN platform.promoters.tier_locked IS
  'TRUE → cron auto-upgrade pomine tento promotér (Super Admin manuálně řídí).';

CREATE INDEX IF NOT EXISTS idx_promoters_tier
  ON platform.promoters (tier);

COMMIT;
