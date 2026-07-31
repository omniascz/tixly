-- =============================================================================
-- MIGRACE 011: Schéma analytics pro conversion-funnel modul
-- Datum: 2026-04-05
-- Modul: C:\Users\omnia\Documents\tixly\conversion-funnel\
-- Tabulky: analytics.funnel_events
-- Poznámka: analytics schema může být sdíleno s budoucími moduly (A/B testing, atd.)
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS analytics;

-- ---------------------------------------------------------------------------
-- analytics.funnel_events — raw checkout funnel events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS analytics.funnel_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anonymní session tracking (bez vazby na user_id)
  session_id  TEXT        NOT NULL,
  -- NULL pro anonymní návštěvníky (GDPR: nenutíme login před nákupem)
  user_id     UUID,
  -- cross-schema ref na catalog.events — bez FK
  event_id    UUID        NOT NULL,
  -- Krok v checkout funnelu (pořadí: event_view → order_complete)
  step        TEXT        NOT NULL
    CHECK (step IN (
      'event_view',
      'ticket_selection',
      'seat_selection',
      'checkout_start',
      'payment_info',
      'order_complete'
    )),
  -- Volitelná metadata (např. ticketTypeId, quantity, errorCode)
  metadata    JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE analytics.funnel_events IS
  'Raw checkout funnel events. Fire-and-forget INSERT (trackStep je void — neblokuje checkout).
   Anonymní tracking — user_id může být NULL pro GDPR compliance.
   Záznamy se po 90 dnech archivují (GDPR data minimisation).';

COMMENT ON COLUMN analytics.funnel_events.step IS
  'Krok funnelu: event_view → ticket_selection → seat_selection →
   checkout_start → payment_info → order_complete.
   Drop-off rate = 1 - (count(next_step) / count(current_step)).';

COMMENT ON COLUMN analytics.funnel_events.metadata IS
  'Volitelný kontext kroku (ticketTypeId, quantity, errorCode, device, ...).
   Neukládáme PII — pouze technické identifikátory.';

-- Primární analytics dotaz: aggregace kroků per event za časové okno
CREATE INDEX IF NOT EXISTS idx_funnel_event_step
  ON analytics.funnel_events(event_id, step, created_at DESC);

-- Session-level tracking (pro path analysis)
CREATE INDEX IF NOT EXISTS idx_funnel_session
  ON analytics.funnel_events(session_id, event_id, created_at ASC);

-- User-level tracking (pro registered user funnels)
CREATE INDEX IF NOT EXISTS idx_funnel_user
  ON analytics.funnel_events(user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- GDPR archive cleanup: záznamy starší než 90 dní
CREATE INDEX IF NOT EXISTS idx_funnel_cleanup
  ON analytics.funnel_events(created_at ASC);

-- ---------------------------------------------------------------------------
-- Ověření
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'analytics' AND table_name = 'funnel_events'
  ), 'CHYBA: analytics.funnel_events neexistuje';
  RAISE NOTICE 'Migrace 011 (analytics/funnel) úspěšně ověřena.';
END;
$$;

COMMIT;
