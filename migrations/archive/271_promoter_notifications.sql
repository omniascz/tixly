-- Migration 271: notifications.promoter_notifications
--
-- In-app alerts pro promotéra. Populates z různých zdrojů:
--   - refund_request_created
--   - payout_settled / payout_failed
--   - rolling_reserve_released
--   - abandoned_cart_high (>5 carts > 24h)
--   - event_moderation_decision (přijato/zamítnuto)
--   - churn_risk_warning (customer s pravděpodobností churn)
--   - holdback_period_ended
--   - low_inventory_warning (<10% remaining)
--
-- Notifications jsou per promoter_id (ne user_id) — viditelné všem
-- platným team členům promotéra.

CREATE SCHEMA IF NOT EXISTS notifications;

CREATE TABLE IF NOT EXISTS notifications.promoter_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (kind IN (
    'refund_request',
    'payout_settled',
    'payout_failed',
    'rolling_reserve_released',
    'abandoned_cart_high',
    'event_moderation',
    'churn_risk',
    'holdback_ended',
    'low_inventory',
    'general'
  )),

  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'critical')),

  title TEXT NOT NULL,
  body TEXT,
  link TEXT, -- relative URL kam kliknout (/admin/...)
  payload JSONB DEFAULT '{}'::jsonb,

  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pn_promoter_unread
  ON notifications.promoter_notifications (promoter_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_pn_promoter_all
  ON notifications.promoter_notifications (promoter_id, created_at DESC);

-- TTL — 90 dní, beztak nikdo nečte starší alerty
CREATE INDEX IF NOT EXISTS idx_pn_cleanup
  ON notifications.promoter_notifications (created_at)
  WHERE read_at IS NOT NULL;
