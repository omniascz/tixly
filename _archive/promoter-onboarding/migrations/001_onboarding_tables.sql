-- Email verifikační tokeny
CREATE TABLE identity.email_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  email       VARCHAR(255) NOT NULL,
  token       VARCHAR(64) NOT NULL UNIQUE,   -- HMAC-SHA256 hex token
  is_used     BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at  TIMESTAMPTZ NOT NULL,           -- NOW() + 24 hours
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_email_verif_token ON identity.email_verifications(token) WHERE is_used = FALSE;
CREATE INDEX idx_email_verif_user ON identity.email_verifications(user_id, is_used);

-- KYC dokumenty (metadata — skutečné soubory jsou v object storage)
CREATE TABLE platform.kyc_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  document_type   VARCHAR(50) NOT NULL
    CHECK (document_type IN ('business_registration', 'bank_statement', 'id_document', 'tax_certificate', 'other')),
  file_name       VARCHAR(255) NOT NULL,
  file_size       INTEGER NOT NULL CHECK (file_size > 0),   -- bytes
  storage_key     TEXT NOT NULL,                            -- S3/object storage klíč
  mime_type       VARCHAR(100) NOT NULL,
  uploaded_by     UUID NOT NULL,                            -- user_id
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kyc_docs_promoter ON platform.kyc_documents(promoter_id);

-- Onboarding progress tracking
CREATE TABLE platform.onboarding_progress (
  promoter_id         UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  step_account        BOOLEAN NOT NULL DEFAULT FALSE,  -- email ověřen
  step_profile        BOOLEAN NOT NULL DEFAULT FALSE,  -- profil vyplněn
  step_kyc            BOOLEAN NOT NULL DEFAULT FALSE,  -- KYC odesláno
  step_activated      BOOLEAN NOT NULL DEFAULT FALSE,  -- admin schválil
  completed_at        TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin KYC review log
CREATE TABLE platform.kyc_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID NOT NULL REFERENCES platform.promoters(id),
  admin_user_id   UUID NOT NULL,
  decision        TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'request_more_info')),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kyc_reviews_promoter ON platform.kyc_reviews(promoter_id, created_at DESC);
