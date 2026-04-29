-- Migration 124: Digitally signed PDF tickets (Feature #185)

CREATE SCHEMA IF NOT EXISTS pdf_signatures;

CREATE TABLE pdf_signatures.signed_pdfs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id              UUID NOT NULL UNIQUE,            -- ref: tickets(id)
  event_id               UUID NOT NULL,                   -- ref: catalog.events(id)
  pdf_url                TEXT NOT NULL,                   -- URL na podepsaný PDF
  signature_valid        BOOLEAN NOT NULL DEFAULT true,
  signed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  certificate_thumbprint TEXT NOT NULL,                   -- SHA-256 cert fingerprint
  expires_at             TIMESTAMPTZ,                     -- X.509 certificate expiry
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signed_event  ON pdf_signatures.signed_pdfs (event_id);
CREATE INDEX idx_signed_valid  ON pdf_signatures.signed_pdfs (signature_valid, expires_at)
  WHERE signature_valid = true;
