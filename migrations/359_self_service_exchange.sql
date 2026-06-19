-- 359_self_service_exchange.sql
-- Self-service výměna data vstupenky
-- productions: skupina reprí stejné hry (Romeo a Julie = 1 produkce, 40 reprí)
-- events dostane production_id; ticket_changes dostane auto_approve flag

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.productions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  slug            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_productions_promoter ON catalog.productions(promoter_id);

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS production_id UUID REFERENCES catalog.productions(id) ON DELETE SET NULL;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS allow_self_service_exchange BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS exchange_fee_halire INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_events_production ON catalog.events(production_id) WHERE production_id IS NOT NULL;

COMMIT;
