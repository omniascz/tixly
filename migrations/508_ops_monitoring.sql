-- 508_ops_monitoring.sql
--   Kolo 14 / krok 3 — hlídání provozu: heartbeat cronů, upozornění provozu s omezením četnosti, záznam problémů.
--
-- POUŽITO: schéma monitoring (stavová stránka), PLATFORM_ADMIN_EMAIL (adresát), dispatcher /api/cron/dispatch.
-- NOVĚ:    monitoring.cron_heartbeats — poslední úspěšný běh každého registrovaného cronu (+ poslední stav a chyba);
--          monitoring.ops_alerts      — omezení četnosti: nejvýš 1 e-mail za 30 min na stejný problém (klíč);
--          monitoring.ops_events      — každý zaznamenaný problém (denní souhrn „Chyby").
-- Přístup jen v servisním kontextu (cron, webhook, interní routy) nebo pro správce platformy — pořadatelé ne.
-- Idempotentní.

CREATE TABLE IF NOT EXISTS monitoring.cron_heartbeats (
  job              text PRIMARY KEY,
  interval_minutes integer NOT NULL CHECK (interval_minutes > 0),
  registered_at    timestamptz NOT NULL DEFAULT now(),
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_status      integer,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS monitoring.ops_alerts (
  key           text PRIMARY KEY,
  last_sent_at  timestamptz NOT NULL,
  suppressed    integer NOT NULL DEFAULT 0,
  last_detail   text
);

CREATE TABLE IF NOT EXISTS monitoring.ops_events (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL,
  key         text NOT NULL,
  detail      text,
  emailed     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_events_created_idx ON monitoring.ops_events (created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cron_heartbeats', 'ops_alerts', 'ops_events'] LOOP
    EXECUTE format('ALTER TABLE monitoring.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON monitoring.%I', 'p_' || t || '_ops', t);
    EXECUTE format('CREATE POLICY %I ON monitoring.%I FOR ALL
                      USING (public.app_is_platform_admin() OR public.app_is_service())
                      WITH CHECK (public.app_is_platform_admin() OR public.app_is_service())', 'p_' || t || '_ops', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON monitoring.%I TO tixly_app', t);
      EXECUTE format('REVOKE TRUNCATE ON monitoring.%I FROM tixly_app', t);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tixly_app') THEN
    GRANT USAGE ON SCHEMA monitoring TO tixly_app;
    GRANT USAGE, SELECT ON SEQUENCE monitoring.ops_events_id_seq TO tixly_app;
  END IF;
END $$;
