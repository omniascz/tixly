-- =============================================================================
-- Migration 235: Age Verification Flow (18+)
-- =============================================================================

-- Add min_age column to catalog.events
ALTER TABLE catalog.events
ADD COLUMN IF NOT EXISTS min_age INT CHECK (min_age >= 0 AND min_age <= 120);

-- Add requires_age_verification column to orders.orders
ALTER TABLE orders.orders
ADD COLUMN IF NOT EXISTS requires_age_verification BOOLEAN NOT NULL DEFAULT false;

-- Create age_verifications table
CREATE TABLE IF NOT EXISTS age_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders.orders(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  method TEXT NOT NULL CHECK (method IN ('self_declared', 'bankid')),
  age_at_verification INT NOT NULL CHECK (age_at_verification >= 0 AND age_at_verification <= 150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(order_id)
);

CREATE INDEX idx_age_verifications_user_id ON age_verifications(user_id);
CREATE INDEX idx_age_verifications_order_id ON age_verifications(order_id);
CREATE INDEX idx_age_verifications_promoter_id ON age_verifications(promoter_id);
CREATE INDEX idx_age_verifications_method ON age_verifications(method);
CREATE INDEX idx_age_verifications_verified_at ON age_verifications(verified_at DESC) WHERE verified_at > NOW() - INTERVAL '90 days';
