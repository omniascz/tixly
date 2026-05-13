-- Performance indexy pro hot paths Tixly v2 (session 2026-05-14)
-- Spustit přes: docker exec -i tixly-postgres psql -U tixly -d tixly < migrations/014_performance_indexes.sql

BEGIN;

-- tickets — refund flow projde "kterých lístků objednávky je status=valid"
CREATE INDEX IF NOT EXISTS idx_tickets_order_status
  ON tickets.tickets (order_id, status)
  WHERE status = 'valid';

-- subscriptions.consumptions — check zbývajícího allowance per period
CREATE INDEX IF NOT EXISTS idx_consumptions_sub_period_event
  ON subscriptions.consumptions (subscription_id, period_start, event_id);

-- broadcast historie per promotér (admin/broadcasts page)
CREATE INDEX IF NOT EXISTS idx_event_broadcasts_promoter_created
  ON marketing.event_broadcasts (promoter_id, created_at DESC);

-- followers filter (newsletter_subscribers WHERE promoter_id AND status='confirmed')
CREATE INDEX IF NOT EXISTS idx_newsletter_promoter_status
  ON marketing.newsletter_subscribers (promoter_id, status)
  WHERE unsubscribed_at IS NULL;

-- access codes filter na buyer redeem (event_id + UPPER(code))
CREATE INDEX IF NOT EXISTS idx_access_codes_event_code_upper
  ON catalog.access_codes (event_id, UPPER(code));

-- audit log — promotér audit log query (actor_id ∈ promoter_members)
-- existující idx_audit_log_actor_id stačí; ale potřebujeme composite s table_name
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_table_created
  ON audit.audit_log (actor_id, table_name, created_at DESC)
  WHERE actor_id IS NOT NULL;

-- season dashboard — events filtr WHERE promoter_id AND status='published' AND date_start
CREATE INDEX IF NOT EXISTS idx_events_promoter_status_date
  ON catalog.events (promoter_id, status, date_start)
  WHERE status = 'published';

COMMIT;

-- Sanity check po migraci
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE indexname LIKE 'idx_%'
  AND indexname IN (
    'idx_tickets_order_status',
    'idx_consumptions_sub_period_event',
    'idx_event_broadcasts_promoter_created',
    'idx_newsletter_promoter_status',
    'idx_access_codes_event_code_upper',
    'idx_audit_log_actor_table_created',
    'idx_events_promoter_status_date'
  )
ORDER BY tablename, indexname;
