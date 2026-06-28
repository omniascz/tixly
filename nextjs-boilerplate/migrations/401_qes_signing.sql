-- eIDAS QES (Qualified Electronic Signature) infrastruktura
-- Podporuje mock QTSP + DocuSign + Signicat (dle QES_PROVIDER env var).
-- Výsledný podpis je roven vlastnoručnímu podpisu dle nařízení EU 910/2014.

-- Sloupec pro datum podpisu smlouvy na promotérovi
ALTER TABLE platform.promoters
  ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS contract_document_url text;

-- Tabulka žádostí o podpis
CREATE TABLE IF NOT EXISTS platform.qes_signing_requests (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  promoter_id         uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  document_type       text NOT NULL,   -- 'promoter_agreement' | 'reseller_agreement' | 'custom'
  document_hash       text NOT NULL,   -- SHA-256 hex obsahu dokumentu (non-repudiation)
  document_url        text,            -- uložené URL PDF
  document_content_b64 text,          -- base64 PDF pro přímé stažení (max ~2 MB)
  signer_email        text NOT NULL,
  signer_name         text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','sent','viewed','signed','rejected','expired')),
  provider            text NOT NULL DEFAULT 'mock',  -- mock | docusign | signicat | namirial
  external_ref        text,            -- provider envelope ID
  signing_url         text,            -- URL zaslané podepisujícímu
  signed_at           timestamptz,
  expires_at          timestamptz NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  signature_proof     jsonb,           -- certifikát, timestamp, OCSP odpověď
  created_by_user_id  uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qes_requests_promoter ON platform.qes_signing_requests(promoter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qes_requests_status   ON platform.qes_signing_requests(status);
CREATE INDEX IF NOT EXISTS idx_qes_requests_extref   ON platform.qes_signing_requests(external_ref) WHERE external_ref IS NOT NULL;

-- RLS
ALTER TABLE platform.qes_signing_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY qes_requests_svc ON platform.qes_signing_requests
  USING (current_setting('app.bypass_rls', true) = 'on');
