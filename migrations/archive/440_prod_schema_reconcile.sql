-- 440 — Prod schema reconciliation (E2E audit 2026-06-30)
-- Production DB drifted behind code: several migration fragments were applied
-- to the local/dev DB but never reached prod. This breaks checkout, refund,
-- POS, gate scanning, payment plans and per-promoter tracking on prod.
-- All statements idempotent. Verified safe: prod has 0 orders / 0 audit rows.
-- Each fix was validated end-to-end on a prod-clone Neon branch.

-- ── mig 356 (buyer service fee) — missing on prod ───────────────────────────
ALTER TABLE platform.fee_schedules ADD COLUMN IF NOT EXISTS buyer_fee_basis text NOT NULL DEFAULT 'per_ticket';
ALTER TABLE platform.fee_schedules DROP CONSTRAINT IF EXISTS fee_schedules_buyer_fee_basis_check;
ALTER TABLE platform.fee_schedules ADD CONSTRAINT fee_schedules_buyer_fee_basis_check CHECK (buyer_fee_basis IN ('per_ticket','per_order'));
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS service_fee_minor integer NOT NULL DEFAULT 0;

-- ── mig 390 (EU B2B reverse-charge VAT) — missing on prod ───────────────────
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS buyer_vat_number TEXT;
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS buyer_company_name TEXT;
ALTER TABLE orders.orders ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN NOT NULL DEFAULT FALSE;

-- ── mig 375 (per-promoter Meta Pixel + GA4) — missing on prod ───────────────
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS meta_pixel_id text;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS meta_capi_token_enc text;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS ga4_measurement_id text;
ALTER TABLE platform.promoters ADD COLUMN IF NOT EXISTS ga4_api_secret_enc text;

-- ── delivery_method: prod still has the OLD enum and rejects the values the
--    checkout code now inserts ('digital'/'postal'). Repoint to code semantics.
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_delivery_method_check;
ALTER TABLE orders.orders ALTER COLUMN delivery_method SET DEFAULT 'digital';
ALTER TABLE orders.orders ADD CONSTRAINT orders_delivery_method_check CHECK (delivery_method IN ('digital','postal'));

-- ── order status: prod lacks 'paid_partial' (payment plans / installments) ──
ALTER TABLE orders.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders.orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending','paid','paid_partial','cancelled','refunded','expired','chargeback'));

-- ── audit_log actor_type: prod lacks 'promoter' — breaks refund, POS sale and
--    gate scanning (every promoter-initiated audit write violates the check).
ALTER TABLE audit.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_type_check;
ALTER TABLE audit.audit_log ADD CONSTRAINT audit_log_actor_type_check CHECK (actor_type IN ('user','system','admin','platform_admin','gate','promoter'));
