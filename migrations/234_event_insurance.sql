CREATE TABLE IF NOT EXISTS event_insurance_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  event_id UUID NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  policy_number TEXT,
  covered_events TEXT[] NOT NULL DEFAULT '{}',
  coverage_amount_halire INTEGER NOT NULL,
  premium_halire INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'quoted' CHECK (status IN ('quoted','active','claimed','expired','cancelled')),
  coverage_from TIMESTAMPTZ NOT NULL,
  coverage_to TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_insurance_event ON event_insurance_policies(event_id, promoter_id);

CREATE TABLE IF NOT EXISTS insurance_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id UUID NOT NULL,
  promoter_id UUID NOT NULL,
  event_id UUID NOT NULL,
  claim_type TEXT NOT NULL,
  description TEXT NOT NULL,
  requested_amount_halire INTEGER NOT NULL,
  approved_amount_halire INTEGER,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','approved','rejected','paid')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX idx_claims_policy ON insurance_claims(policy_id);
CREATE INDEX idx_claims_promoter ON insurance_claims(promoter_id);
