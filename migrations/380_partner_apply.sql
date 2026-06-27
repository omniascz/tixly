-- Migration 380: partner self-service apply fields
-- Adds website_url, partner_type, apply_description to partner.partners
-- These fields support the public /partner/apply form.

ALTER TABLE partner.partners
  ADD COLUMN IF NOT EXISTS website_url      TEXT,
  ADD COLUMN IF NOT EXISTS partner_type     TEXT CHECK (partner_type IN ('media', 'travel', 'ticketshop', 'agency', 'other')),
  ADD COLUMN IF NOT EXISTS apply_note       TEXT,
  ADD COLUMN IF NOT EXISTS applied_at       TIMESTAMPTZ;
