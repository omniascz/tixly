-- Migration 093: Per-event purchase limit configuration
-- Allows promoters to set custom ticket limits per event

CREATE TABLE IF NOT EXISTS catalog.purchase_limit_configs (
  event_id              UUID        PRIMARY KEY,
  max_tickets_per_user  INTEGER     NOT NULL DEFAULT 4 CHECK (max_tickets_per_user BETWEEN 1 AND 100),
  verified_only         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-update updated_at
CREATE TRIGGER trg_purchase_limit_configs_updated_at
  BEFORE UPDATE ON catalog.purchase_limit_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
