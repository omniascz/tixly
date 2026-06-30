-- 441 — Deploy missing feature tables (E2E audit 2026-06-30)
-- public.forgemsg_outbox (ForgeMsg ticketing sync) had NO migration and existed
-- nowhere; marketing.modular_pass_pending_selections existed only on dev DB.
-- Both referenced by code → silently broken on prod (caught in order-completed).
-- Idempotent. forgemsg DDL derived from src/lib/forgemsg; modular_pass DDL
-- extracted from dev DB; RLS mirrors the dev-DB policy.

-- ── ForgeMsg outbox (drained by forgemsg-dispatch cron) ─────────────────────
CREATE TABLE IF NOT EXISTS public.forgemsg_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promoter_id uuid REFERENCES platform.promoters(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending',
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);
CREATE INDEX IF NOT EXISTS forgemsg_outbox_status_created_idx ON public.forgemsg_outbox (status, created_at);
ALTER TABLE public.forgemsg_outbox DROP CONSTRAINT IF EXISTS forgemsg_outbox_status_check;
ALTER TABLE public.forgemsg_outbox ADD CONSTRAINT forgemsg_outbox_status_check CHECK (status IN ('pending','sent','failed'));
ALTER TABLE public.forgemsg_outbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_rls_forgemsg_outbox ON public.forgemsg_outbox;
CREATE POLICY p_rls_forgemsg_outbox ON public.forgemsg_outbox FOR ALL USING (app_is_service() OR app_is_platform_admin() OR promoter_id = app_current_promoter_id()) WITH CHECK (app_is_service() OR app_is_platform_admin() OR promoter_id = app_current_promoter_id());

-- ── Modular festival pass pending selections (consumed at order-completed) ───
CREATE TABLE IF NOT EXISTS marketing.modular_pass_pending_selections (
  order_id   uuid NOT NULL PRIMARY KEY REFERENCES orders.orders(id) ON DELETE CASCADE,
  selections jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE marketing.modular_pass_pending_selections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_rls_modular_pass_pending_selections ON marketing.modular_pass_pending_selections;
CREATE POLICY p_rls_modular_pass_pending_selections ON marketing.modular_pass_pending_selections FOR ALL USING (app_is_platform_admin() OR app_is_service() OR (EXISTS (SELECT 1 FROM orders.orders o_ WHERE o_.id = modular_pass_pending_selections.order_id AND (o_.user_id = app_current_user_id() OR EXISTS (SELECT 1 FROM catalog.events ev_ WHERE ev_.id = o_.event_id AND ev_.promoter_id = app_current_promoter_id())))));
