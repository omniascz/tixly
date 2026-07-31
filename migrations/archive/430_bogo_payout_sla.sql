-- Migration 430: BOGO multi-buy + Payout SLA
-- Feature 3: free tickets (BOGO) in volume discount rules
ALTER TABLE catalog.volume_discount_rules
  ADD COLUMN IF NOT EXISTS free_qty INT NOT NULL DEFAULT 0 CHECK (free_qty >= 0);

-- Feature 4: Payout SLA — auto-pay N days after event ends
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS auto_payout_days_after_event INT CHECK (auto_payout_days_after_event > 0);
