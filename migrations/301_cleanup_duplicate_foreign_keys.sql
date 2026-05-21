-- 301_cleanup_duplicate_foreign_keys.sql
-- DB integrity cleanup: 14 tabulek mělo 2 FK na promoter_id se rozdílnými
-- ON DELETE actions → nedeterministic behavior. Tahle migrace ponechá vždy
-- 1 FK podle business logiky.
--
-- Strategie:
-- - Tenant data (venues, staff, invoices, branding, ...) → CASCADE
--   (smažu promotéra → smažou se jeho data)
-- - Audit logy (platform_log) → SET NULL
--   (audit záznamy přežijí smazání promotéra)

BEGIN;

-- ============================================================
-- KONFLIKTNÍ duplikáty (různé ON DELETE actions)
-- ============================================================

-- venues: CASCADE vs SET NULL → keep CASCADE (venue patří k promotérovi)
ALTER TABLE catalog.venues DROP CONSTRAINT IF EXISTS venues_promoter_id_fkey;

-- staff_members: CASCADE vs NO ACTION → keep CASCADE
ALTER TABLE platform.staff_members DROP CONSTRAINT IF EXISTS staff_members_promoter_id_fkey;

-- invoices: CASCADE vs NO ACTION → keep CASCADE
ALTER TABLE orders.invoices DROP CONSTRAINT IF EXISTS invoices_promoter_id_fkey;

-- platform_log: SET NULL vs NO ACTION → keep SET NULL (audit přežije)
ALTER TABLE audit.platform_log DROP CONSTRAINT IF EXISTS platform_log_promoter_id_fkey;

-- ============================================================
-- IDENTICKÉ duplikáty (oba CASCADE) — drop pozdější `_fk` variant,
-- ponechat původní `_fkey` (Postgres auto-generated naming)
-- ============================================================

ALTER TABLE platform.email_templates DROP CONSTRAINT IF EXISTS email_templates_promoter_id_fk;
ALTER TABLE marketing.sms_campaigns DROP CONSTRAINT IF EXISTS m_sms_campaigns_promoter_id_fk;
ALTER TABLE catalog.payment_plans DROP CONSTRAINT IF EXISTS payment_plans_promoter_id_fk;
ALTER TABLE marketing.affiliates DROP CONSTRAINT IF EXISTS m_affiliates_promoter_id_fk;
ALTER TABLE platform.promoter_branding DROP CONSTRAINT IF EXISTS promoter_branding_id_fk;
ALTER TABLE marketing.newsletter_subscribers DROP CONSTRAINT IF EXISTS m_newsletter_promoter_id_fk;
ALTER TABLE notifications.promoter_notifications DROP CONSTRAINT IF EXISTS promoter_notifications_id_fk;
ALTER TABLE marketing.gift_vouchers DROP CONSTRAINT IF EXISTS m_gift_vouchers_promoter_id_fk;
ALTER TABLE platform.bank_credentials DROP CONSTRAINT IF EXISTS bank_credentials_promoter_id_fk;
ALTER TABLE b2b.api_keys DROP CONSTRAINT IF EXISTS b2b_api_keys_promoter_id_fk;

INSERT INTO public.schema_migrations (filename)
VALUES ('301_cleanup_duplicate_foreign_keys.sql')
ON CONFLICT (filename) DO NOTHING;

COMMIT;
