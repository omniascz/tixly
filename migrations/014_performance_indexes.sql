-- Performance indexy pro hot paths Tixly v2 (session 2026-05-14)
-- Spustit přes: docker exec -i tixly-postgres psql -U tixly -d tixly < migrations/014_performance_indexes.sql
--
-- POZN. (oprava 2026-06-01): Část indexů míří na tabulky, které vznikají až
-- pozdějšími migracemi (subscriptions.* → 277, marketing.* a catalog.access_codes
-- → pozdější). Na čisté DB v pořadí proto 014 dřív padala ("schema subscriptions
-- does not exist") a auto-init ji jen WARNoval a pokračoval = tichá díra.
-- Každé vytvoření indexu je nově guardované přes to_regclass(): vytvoří se, jen
-- pokud cílová tabulka už existuje. Indexy pro zatím neexistující tabulky dožene
-- idempotentně migrace 326_deferred_perf_indexes.sql.

DO $$
BEGIN
  -- tickets — refund flow projde "kterých lístků objednávky je status=valid"
  IF to_regclass('tickets.tickets') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_tickets_order_status
      ON tickets.tickets (order_id, status)
      WHERE status = 'valid';
  END IF;

  -- subscriptions.consumptions — check zbývajícího allowance per period
  IF to_regclass('subscriptions.consumptions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_consumptions_sub_period_event
      ON subscriptions.consumptions (subscription_id, period_start, event_id);
  END IF;

  -- broadcast historie per promotér (admin/broadcasts page)
  IF to_regclass('marketing.event_broadcasts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_event_broadcasts_promoter_created
      ON marketing.event_broadcasts (promoter_id, created_at DESC);
  END IF;

  -- followers filter (newsletter_subscribers WHERE promoter_id AND status='confirmed')
  IF to_regclass('marketing.newsletter_subscribers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_newsletter_promoter_status
      ON marketing.newsletter_subscribers (promoter_id, status)
      WHERE unsubscribed_at IS NULL;
  END IF;

  -- access codes filter na buyer redeem (event_id + UPPER(code))
  IF to_regclass('catalog.access_codes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_access_codes_event_code_upper
      ON catalog.access_codes (event_id, UPPER(code));
  END IF;

  -- audit log — promotér audit log query (actor_id ∈ promoter_members)
  IF to_regclass('audit.audit_log') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_audit_log_actor_table_created
      ON audit.audit_log (actor_id, table_name, created_at DESC)
      WHERE actor_id IS NOT NULL;
  END IF;

  -- season dashboard — events filtr WHERE promoter_id AND status='published' AND date_start
  IF to_regclass('catalog.events') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_events_promoter_status_date
      ON catalog.events (promoter_id, status, date_start)
      WHERE status = 'published';
  END IF;
END $$;
