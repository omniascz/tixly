-- Doháněcí performance indexy (2026-06-01)
-- Migrace 014 vytváří indexy jen pro tabulky, které v jejím pořadí už existují.
-- Indexy pro tabulky vzniklé později (subscriptions.* → 277, marketing.*,
-- catalog.access_codes) se dovytvoří zde, kdy už všechny tabulky existují.
-- Plně idempotentní (IF NOT EXISTS + to_regclass guard) — na existující dev DB no-op.

DO $$
BEGIN
  IF to_regclass('subscriptions.consumptions') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_consumptions_sub_period_event
      ON subscriptions.consumptions (subscription_id, period_start, event_id);
  END IF;

  IF to_regclass('marketing.event_broadcasts') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_event_broadcasts_promoter_created
      ON marketing.event_broadcasts (promoter_id, created_at DESC);
  END IF;

  IF to_regclass('marketing.newsletter_subscribers') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_newsletter_promoter_status
      ON marketing.newsletter_subscribers (promoter_id, status)
      WHERE unsubscribed_at IS NULL;
  END IF;

  IF to_regclass('catalog.access_codes') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_access_codes_event_code_upper
      ON catalog.access_codes (event_id, UPPER(code));
  END IF;
END $$;
