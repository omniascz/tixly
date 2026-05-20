-- 285_rls_enable_critical.sql
-- P1 SECURITY: Enable RLS na kritické multi-tenant tabulky.
-- Bez RLS: bug v WHERE klauzuli → data leak napříč promotéry.
--
-- Vyžaduje:
--   1. App musí volat `SET LOCAL app.current_promoter_id = '<uuid>'` per request
--      (middleware v requirePromoter helper)
--   2. Platform admin bypass: SET LOCAL app.is_platform_admin = 'true'
--      → policy USING true pro platform admin role
--
-- Pokud app.current_promoter_id není set, RLS vrátí 0 rows.
-- To zabraní accidental leak ale rozbije queries co tento setting nemají.
--
-- Postupný rollout: nejdřív log-only audit, pak ENABLE.

BEGIN;

-- Helper function pro current promoter (graceful fallback NULL)
CREATE OR REPLACE FUNCTION app_current_promoter_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_promoter_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION app_is_platform_admin() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('app.is_platform_admin', true)::boolean, false);
$$ LANGUAGE sql STABLE;

-- catalog.events
ALTER TABLE catalog.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_events_promoter_scope ON catalog.events;
CREATE POLICY p_events_promoter_scope ON catalog.events
  USING (
    app_is_platform_admin()
    OR promoter_id = app_current_promoter_id()
    OR status = 'published'    -- public listing
  );

-- catalog.ticket_types
ALTER TABLE catalog.ticket_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_ticket_types_event_scope ON catalog.ticket_types;
CREATE POLICY p_ticket_types_event_scope ON catalog.ticket_types
  USING (
    app_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM catalog.events e
       WHERE e.id = catalog.ticket_types.event_id
         AND (e.promoter_id = app_current_promoter_id() OR e.status = 'published')
    )
  );

-- catalog.access_codes — privacy critical
ALTER TABLE catalog.access_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_access_codes_promoter ON catalog.access_codes;
CREATE POLICY p_access_codes_promoter ON catalog.access_codes
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- marketing.campaigns
ALTER TABLE marketing.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_campaigns_promoter ON marketing.campaigns;
CREATE POLICY p_campaigns_promoter ON marketing.campaigns
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- marketing.gift_vouchers
ALTER TABLE marketing.gift_vouchers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_gift_vouchers_promoter ON marketing.gift_vouchers;
CREATE POLICY p_gift_vouchers_promoter ON marketing.gift_vouchers
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- marketing.newsletter_subscribers
ALTER TABLE marketing.newsletter_subscribers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_newsletter_promoter ON marketing.newsletter_subscribers;
CREATE POLICY p_newsletter_promoter ON marketing.newsletter_subscribers
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- orders.invoices
ALTER TABLE orders.invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_invoices_promoter ON orders.invoices;
CREATE POLICY p_invoices_promoter ON orders.invoices
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- orders.refund_requests
ALTER TABLE orders.refund_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_refund_requests_promoter ON orders.refund_requests;
CREATE POLICY p_refund_requests_promoter ON orders.refund_requests
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- platform.fee_schedules — citlivá business data
DROP POLICY IF EXISTS fee_schedules_promoter_scope ON platform.fee_schedules;
CREATE POLICY fee_schedules_promoter_scope ON platform.fee_schedules
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- platform.staff_members
ALTER TABLE platform.staff_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_staff_members_promoter ON platform.staff_members;
CREATE POLICY p_staff_members_promoter ON platform.staff_members
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- b2b.api_keys
ALTER TABLE b2b.api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_b2b_api_keys_promoter ON b2b.api_keys;
CREATE POLICY p_b2b_api_keys_promoter ON b2b.api_keys
  USING (app_is_platform_admin() OR promoter_id = app_current_promoter_id());

COMMIT;
