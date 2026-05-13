-- Platform admin tables migration
-- Extends platform.admin_actions from P0-1 and adds new tables

-- Rozšíření existující tabulky admin_actions
ALTER TABLE platform.admin_actions
  ADD COLUMN IF NOT EXISTS ip_address INET,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS session_id UUID;

-- Platform-wide statistiky (cache tabulka, refresh každých 5 minut)
CREATE TABLE IF NOT EXISTS platform.stats_cache (
  id              TEXT PRIMARY KEY,   -- 'platform_overview', 'daily_gmv', atd.
  data            JSONB NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

-- Admin notifikace (upozornění na akce vyžadující pozornost)
CREATE TABLE IF NOT EXISTS platform.admin_notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(50) NOT NULL,
    -- 'kyc_submitted', 'payout_pending', 'promoter_registered',
    -- 'high_chargeback_rate', 'suspicious_activity'
  priority        TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  title           VARCHAR(200) NOT NULL,
  body            TEXT,
  target_type     VARCHAR(50),    -- 'promoter', 'payout', 'event'
  target_id       UUID,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_by         UUID,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_unread
  ON platform.admin_notifications(is_read, priority, created_at DESC)
  WHERE is_read = FALSE;

CREATE INDEX IF NOT EXISTS idx_admin_notif_type
  ON platform.admin_notifications(type, created_at DESC);
