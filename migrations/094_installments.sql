-- =============================================================================
-- MIGRACE 094: Splátkový kalendář (Installments)
-- Datum: 2026-04-08
-- Modul: installments
-- Závislosti: 001_initial.sql (orders.orders, orders.tickets, catalog.ticket_types)
-- =============================================================================
-- Schéma: installments
--   installments.plans       — konfigurace splátkových plánů per ticket_type
--   installments.schedules   — splátkové kalendáře per objednávka
--   installments.payments    — jednotlivé splátky
-- Všechny peněžní hodnoty jsou v haléřích (INTEGER).
-- =============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS installments;

-- ---------------------------------------------------------------------------
-- installments.plans — konfigurace splátkového plánu pro typ vstupenky
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS installments.plans (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_type_id         UUID          NOT NULL
                           REFERENCES catalog.ticket_types(id) ON DELETE CASCADE,
  num_installments       SMALLINT      NOT NULL
                           CHECK (num_installments IN (2, 3, 4)),
  interval               TEXT          NOT NULL
                           CHECK (interval IN ('weekly', 'monthly')),
  first_installment_pct  SMALLINT      NOT NULL
                           CHECK (first_installment_pct BETWEEN 1 AND 99),
  active                 BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Pouze jeden aktivní plán per ticket_type
CREATE UNIQUE INDEX IF NOT EXISTS idx_installments_plans_active_ticket_type
  ON installments.plans (ticket_type_id)
  WHERE active = TRUE;

CREATE INDEX IF NOT EXISTS idx_installments_plans_ticket_type
  ON installments.plans (ticket_type_id);

-- ---------------------------------------------------------------------------
-- installments.schedules — splátkový kalendář objednávky
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS installments.schedules (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID          NOT NULL
                            REFERENCES orders.orders(id) ON DELETE RESTRICT,
  ticket_id               UUID          NOT NULL
                            REFERENCES orders.tickets(id) ON DELETE RESTRICT,
  user_id                 UUID          NOT NULL,
  plan_id                 UUID          NOT NULL
                            REFERENCES installments.plans(id),
  total_amount            INTEGER       NOT NULL
                            CHECK (total_amount > 0),
  status                  TEXT          NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  gopay_recurrence_token  TEXT          NOT NULL,
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Jeden aktivní kalendář per objednávka
CREATE UNIQUE INDEX IF NOT EXISTS idx_installments_schedules_order_id
  ON installments.schedules (order_id);

CREATE INDEX IF NOT EXISTS idx_installments_schedules_user_id
  ON installments.schedules (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_installments_schedules_status
  ON installments.schedules (status);

CREATE INDEX IF NOT EXISTS idx_installments_schedules_ticket_id
  ON installments.schedules (ticket_id);

-- ---------------------------------------------------------------------------
-- installments.payments — jednotlivé splátky
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS installments.payments (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id          UUID          NOT NULL
                         REFERENCES installments.schedules(id) ON DELETE CASCADE,
  installment_number   SMALLINT      NOT NULL
                         CHECK (installment_number >= 1),
  amount               INTEGER       NOT NULL
                         CHECK (amount > 0),
  due_date             TIMESTAMPTZ   NOT NULL,
  status               TEXT          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'paid', 'failed', 'retrying')),
  paid_at              TIMESTAMPTZ   NULL,
  gopay_payment_id     TEXT          NULL,
  retry_count          SMALLINT      NOT NULL DEFAULT 0
                         CHECK (retry_count BETWEEN 0 AND 3),
  last_retry_at        TIMESTAMPTZ   NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Unikátní pořadové číslo splátky per kalendář
  UNIQUE (schedule_id, installment_number)
);

CREATE INDEX IF NOT EXISTS idx_installments_payments_schedule_id
  ON installments.payments (schedule_id, installment_number);

CREATE INDEX IF NOT EXISTS idx_installments_payments_status_due
  ON installments.payments (status, due_date)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS idx_installments_payments_gopay_id
  ON installments.payments (gopay_payment_id)
  WHERE gopay_payment_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Trigger: automatická aktualizace updated_at
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION installments.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_installments_plans_updated_at
  BEFORE UPDATE ON installments.plans
  FOR EACH ROW EXECUTE FUNCTION installments.set_updated_at();

CREATE TRIGGER trg_installments_schedules_updated_at
  BEFORE UPDATE ON installments.schedules
  FOR EACH ROW EXECUTE FUNCTION installments.set_updated_at();

CREATE TRIGGER trg_installments_payments_updated_at
  BEFORE UPDATE ON installments.payments
  FOR EACH ROW EXECUTE FUNCTION installments.set_updated_at();

COMMIT;
