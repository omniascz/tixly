CREATE SCHEMA IF NOT EXISTS leads;

CREATE TABLE leads.poptavky (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  source_page TEXT,
  source TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT,
  interest TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'medium',
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  assigned_to_user_id UUID,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  consented_at TIMESTAMPTZ NOT NULL,
  contacted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_leads_promoter_status ON leads.poptavky(promoter_id, status);
CREATE INDEX idx_leads_promoter_created ON leads.poptavky(promoter_id, created_at DESC);
CREATE INDEX idx_leads_email ON leads.poptavky(email);
CREATE INDEX idx_leads_tags ON leads.poptavky USING GIN(tags);
