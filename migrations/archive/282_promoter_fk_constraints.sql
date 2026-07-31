-- 282_promoter_fk_constraints.sql
-- P1: Doplnit FK constraints pro klíčové tabulky s promoter_id.
-- Bez FK: smazání promotéra → orphan rows v 99 tabulkách. GDPR Art. 17 broken.
--
-- Tato migrace přidává FK na 20 nejkritičtějších tabulek. Zbývající (79) v M2 batch.
--
-- ON DELETE CASCADE — když promotér zmizí (GDPR delete / churn), zmizí i jeho data.
-- ON DELETE SET NULL pro tabulky kde mají smysl bez ownera (audit logs).

BEGIN;

-- Helper: idempotent add (skip pokud constraint už existuje)
DO $$ BEGIN
  -- 1. catalog.events — CASCADE
  ALTER TABLE catalog.events
    ADD CONSTRAINT events_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE catalog.venues
    ADD CONSTRAINT venues_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE catalog.access_codes
    ADD CONSTRAINT access_codes_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE catalog.payment_plans
    ADD CONSTRAINT payment_plans_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing.campaigns
    ADD CONSTRAINT campaigns_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing.affiliates
    ADD CONSTRAINT m_affiliates_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing.newsletter_subscribers
    ADD CONSTRAINT m_newsletter_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing.sms_campaigns
    ADD CONSTRAINT m_sms_campaigns_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE marketing.gift_vouchers
    ADD CONSTRAINT m_gift_vouchers_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders.refund_requests
    ADD CONSTRAINT refund_requests_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE orders.invoices
    ADD CONSTRAINT invoices_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.bank_credentials
    ADD CONSTRAINT bank_credentials_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.email_templates
    ADD CONSTRAINT email_templates_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.fee_schedules
    ADD CONSTRAINT fee_schedules_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.promoter_branding
    ADD CONSTRAINT promoter_branding_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE platform.staff_members
    ADD CONSTRAINT staff_members_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Audit logs: SET NULL (keep log for compliance, owner not required)
DO $$ BEGIN
  ALTER TABLE audit.platform_log
    ADD CONSTRAINT platform_log_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE audit.content_reports
    ADD CONSTRAINT content_reports_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE notifications.promoter_notifications
    ADD CONSTRAINT promoter_notifications_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE b2b.api_keys
    ADD CONSTRAINT b2b_api_keys_promoter_id_fk
    FOREIGN KEY (promoter_id) REFERENCES platform.promoters(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
