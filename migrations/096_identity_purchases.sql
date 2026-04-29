-- =============================================================================
-- Migration 096: Identity Purchases — per-identity purchase limit tracking
-- Tixly · 2026-04-11
--
-- Tracks ticket purchases keyed by identity_hash (SHA-256 of verified
-- personal data) so the same real person cannot bypass per-event ticket
-- limits by creating multiple platform accounts.
--
-- Used by: identity-verification/src/services/purchase-limit.service.ts
-- =============================================================================

-- Schema already exists from migration 026
CREATE SCHEMA IF NOT EXISTS identity;

-- -----------------------------------------------------------------------------
-- identity.identity_purchases
-- One row per confirmed purchase, keyed on identity_hash + event_id.
-- identity_hash is a CHAR(64) hex-encoded SHA-256 digest.
-- -----------------------------------------------------------------------------
CREATE TABLE identity.identity_purchases (
  id              BIGSERIAL       PRIMARY KEY,
  identity_hash   CHAR(64)        NOT NULL,
  event_id        UUID            NOT NULL,
  ticket_count    INTEGER         NOT NULL CHECK (ticket_count > 0),
  order_id        UUID,                       -- optional FK back to orders.orders
  purchased_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Primary lookup: "how many tickets has this identity bought for this event?"
CREATE INDEX identity_purchases_hash_event_idx
  ON identity.identity_purchases (identity_hash, event_id);

-- Secondary: find all purchases for a given event (admin/reporting)
CREATE INDEX identity_purchases_event_idx
  ON identity.identity_purchases (event_id);

-- Secondary: look up purchases by order (for refund/cancellation flows)
CREATE INDEX identity_purchases_order_idx
  ON identity.identity_purchases (order_id)
  WHERE order_id IS NOT NULL;
