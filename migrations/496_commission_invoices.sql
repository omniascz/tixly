-- 496_commission_invoices.sql
--   Kolo 7 / C-54 — faktury provize platformy pořadatelům (dosud jen stub GET /api/platform/admin/invoices).
--
-- 1) platform.billing_identity — fakturační údaje platformy jako DODAVATELE (jediný řádek id = 1).
--    Migrace ho NEPLNÍ: skutečné údaje Tixly s.r.o. nejsou známé (veřejný web uvádí „[doplníme]").
--    Dokud řádek chybí, vystavení faktury provize skončí 503 PLATFORM_BILLING_NOT_CONFIGURED.
-- 2) platform.commission_invoices — faktura provize k výplatě pořadateli (jedna na výplatu).
--    Číslo z řady orders.document_sequences(promoter, rok, 'commission'): řada per pořadatel × rok,
--    prefix s kódem pořadatele zaručí jedinečnost čísla v rámci dodavatele (platformy).
-- Idempotentní.

CREATE TABLE IF NOT EXISTS platform.billing_identity (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  legal_name    text NOT NULL,
  ico           text NOT NULL CHECK (ico ~ '^[0-9]{8}$'),
  dic           text CHECK (dic IS NULL OR dic ~ '^CZ[0-9]{8,10}$'),
  vat_payer     boolean NOT NULL,
  street        text NOT NULL,
  city          text NOT NULL,
  zip           text NOT NULL,
  country       char(2) NOT NULL DEFAULT 'CZ',
  bank_account  text,
  email         text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT vat_payer OR dic IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS platform.commission_invoices (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id            uuid NOT NULL UNIQUE REFERENCES platform.payouts(id),
  promoter_id          uuid NOT NULL REFERENCES platform.promoters(id),
  invoice_number       text NOT NULL UNIQUE,
  series_year          integer NOT NULL,
  issue_date           date NOT NULL,
  taxable_supply_date  date NOT NULL,
  due_date             date NOT NULL,
  currency             char(3) NOT NULL,
  vat_rate_code        text REFERENCES platform.vat_rate_codes(code),
  rate_pct             numeric(5,2),
  base_minor           bigint NOT NULL,
  vat_minor            bigint NOT NULL,
  total_minor          bigint NOT NULL,
  supplier             jsonb NOT NULL,
  customer             jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (base_minor + vat_minor = total_minor)
);
CREATE INDEX IF NOT EXISTS ix_commission_invoices_promoter ON platform.commission_invoices (promoter_id, issue_date DESC);

ALTER TABLE platform.billing_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.commission_invoices ENABLE ROW LEVEL SECURITY;

-- Údaje dodavatele jsou na každé faktuře → číst smí kdokoli s kontextem; měnit jen platform admin.
DROP POLICY IF EXISTS p_billing_identity_read ON platform.billing_identity;
CREATE POLICY p_billing_identity_read ON platform.billing_identity FOR SELECT USING (true);
DROP POLICY IF EXISTS p_billing_identity_admin ON platform.billing_identity;
CREATE POLICY p_billing_identity_admin ON platform.billing_identity
  FOR ALL USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());

DROP POLICY IF EXISTS p_commission_invoices_scope ON platform.commission_invoices;
CREATE POLICY p_commission_invoices_scope ON platform.commission_invoices
  FOR ALL
  USING (public.app_is_platform_admin() OR public.app_is_service() OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT SELECT, INSERT, UPDATE ON platform.billing_identity TO tixly_app;
    GRANT SELECT, INSERT ON platform.commission_invoices TO tixly_app;
    REVOKE DELETE, TRUNCATE ON platform.billing_identity, platform.commission_invoices FROM tixly_app;
  END IF;
END $$;
