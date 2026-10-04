-- 506_term_cancel_postpone.sql
--   Kolo 8 / krok 7 — zrušení a přesun termínu (C-14).
--
-- POUŽITO: catalog.events.status 'cancelled', postponed_at / postponed_reason / original_date_start / rescheduled_to_date,
--          catalog.event_reschedules + orders.reschedule_responses (odkaz kupci s lhůtou), refund přes executeOrderRefund.
-- NOVĚ:    kdy a proč byl termín zrušen; výsledek žádosti o vrácení z odkazu (automaticky přes bránu / ruční vrácení).
-- Idempotentní.

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE orders.reschedule_responses ADD COLUMN IF NOT EXISTS refund_outcome text;
ALTER TABLE orders.reschedule_responses DROP CONSTRAINT IF EXISTS reschedule_responses_refund_outcome_check;
ALTER TABLE orders.reschedule_responses ADD CONSTRAINT reschedule_responses_refund_outcome_check
  CHECK (refund_outcome IS NULL OR refund_outcome IN ('refunded', 'manual', 'failed'));
