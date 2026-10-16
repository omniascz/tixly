-- 486_buyer_protected_columns_guard.sql  (kolo 3 / krok 2)
--
-- BEFORE UPDATE guard na orders.orders, tickets.tickets a orders.order_items.
--
-- Problém: RLS UPDATE politiky omezují, KTERÉ řádky kupec mění (své), ale ne KTERÉ
-- sloupce. Kupec pod vlastním kontextem (app.role='user') tak mohl své objednávce
-- přepsat status ('paid'), částku, měnu, platební identifikátory nebo vazbu na akci
-- a lístku status / typ / cenu — přímým UPDATE z jakékoli routy, která pod jeho
-- kontextem píše do těchto tabulek.
--
-- Pravidlo: chráněné sloupce smí měnit jen
--   - service/system kontext   (app_is_service(): app.role in service/admin/system —
--                               webhooky, crony, asSystemInTx po ověření vlastnictví),
--   - platform admin            (app_is_platform_admin()),
--   - promotér                  (app.current_promoter_id nastavené runWithPromoterContext;
--                               KTERÉ řádky smí, dál řeší RLS),
--   - role s BYPASSRLS          (vlastník schématu: migrace, údržba).
-- Ostatní (kupec 'user', anonym '') → 42501.
--
-- Idempotentní: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION public.app_may_write_protected()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_is_service()
      OR app_is_platform_admin()
      OR app_current_promoter_id() IS NOT NULL
      OR COALESCE((SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user), false);
$$;

COMMENT ON FUNCTION public.app_may_write_protected() IS
  'Kolo 3: smí aktuální kontext měnit chráněné sloupce objednávek/lístků (status, částky, měna, platební id, vazba na akci)? service/system, platform admin, promotér, BYPASSRLS role.';

-- ── orders.orders ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION orders.guard_orders_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF app_may_write_protected() THEN
    RETURN NEW;
  END IF;
  IF NEW.status                     IS DISTINCT FROM OLD.status                     THEN changed := changed || 'status'::text; END IF;
  IF NEW.user_id                    IS DISTINCT FROM OLD.user_id                    THEN changed := changed || 'user_id'::text; END IF;
  IF NEW.event_id                   IS DISTINCT FROM OLD.event_id                   THEN changed := changed || 'event_id'::text; END IF;
  IF NEW.total_amount               IS DISTINCT FROM OLD.total_amount               THEN changed := changed || 'total_amount'::text; END IF;
  IF NEW.currency                   IS DISTINCT FROM OLD.currency                   THEN changed := changed || 'currency'::text; END IF;
  IF NEW.discount_halire            IS DISTINCT FROM OLD.discount_halire            THEN changed := changed || 'discount_halire'::text; END IF;
  IF NEW.service_fee_minor          IS DISTINCT FROM OLD.service_fee_minor          THEN changed := changed || 'service_fee_minor'::text; END IF;
  IF NEW.postal_fee_halire          IS DISTINCT FROM OLD.postal_fee_halire          THEN changed := changed || 'postal_fee_halire'::text; END IF;
  IF NEW.carbon_offset_halire       IS DISTINCT FROM OLD.carbon_offset_halire       THEN changed := changed || 'carbon_offset_halire'::text; END IF;
  IF NEW.loyalty_discount_halire    IS DISTINCT FROM OLD.loyalty_discount_halire    THEN changed := changed || 'loyalty_discount_halire'::text; END IF;
  IF NEW.affiliate_commission_minor IS DISTINCT FROM OLD.affiliate_commission_minor THEN changed := changed || 'affiliate_commission_minor'::text; END IF;
  IF NEW.refunded_amount_halire     IS DISTINCT FROM OLD.refunded_amount_halire     THEN changed := changed || 'refunded_amount_halire'::text; END IF;
  IF NEW.promo_code_id              IS DISTINCT FROM OLD.promo_code_id              THEN changed := changed || 'promo_code_id'::text; END IF;
  IF NEW.paid_at                    IS DISTINCT FROM OLD.paid_at                    THEN changed := changed || 'paid_at'::text; END IF;
  IF NEW.payment_provider           IS DISTINCT FROM OLD.payment_provider           THEN changed := changed || 'payment_provider'::text; END IF;
  IF NEW.gopay_payment_id           IS DISTINCT FROM OLD.gopay_payment_id           THEN changed := changed || 'gopay_payment_id'::text; END IF;
  IF NEW.gopay_order_id             IS DISTINCT FROM OLD.gopay_order_id             THEN changed := changed || 'gopay_order_id'::text; END IF;
  IF NEW.stripe_payment_intent_id   IS DISTINCT FROM OLD.stripe_payment_intent_id   THEN changed := changed || 'stripe_payment_intent_id'::text; END IF;
  IF NEW.stripe_payment_method_id   IS DISTINCT FROM OLD.stripe_payment_method_id   THEN changed := changed || 'stripe_payment_method_id'::text; END IF;
  IF NEW.stripe_customer_id         IS DISTINCT FROM OLD.stripe_customer_id         THEN changed := changed || 'stripe_customer_id'::text; END IF;
  IF NEW.variable_symbol            IS DISTINCT FROM OLD.variable_symbol            THEN changed := changed || 'variable_symbol'::text; END IF;
  IF NEW.refund_completed_at        IS DISTINCT FROM OLD.refund_completed_at        THEN changed := changed || 'refund_completed_at'::text; END IF;
  IF NEW.refund_gateway_response    IS DISTINCT FROM OLD.refund_gateway_response    THEN changed := changed || 'refund_gateway_response'::text; END IF;
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION 'orders.orders: sloupce % smí měnit jen systém/pořadatel/admin (kontext role=%)',
      array_to_string(changed, ','), COALESCE(NULLIF(current_setting('app.role', true), ''), 'anon')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_guard_protected ON orders.orders;
CREATE TRIGGER trg_orders_guard_protected
  BEFORE UPDATE ON orders.orders
  FOR EACH ROW EXECUTE FUNCTION orders.guard_orders_protected_columns();

-- ── tickets.tickets ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION tickets.guard_tickets_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  changed text[] := ARRAY[]::text[];
BEGIN
  IF app_may_write_protected() THEN
    RETURN NEW;
  END IF;
  IF NEW.status         IS DISTINCT FROM OLD.status         THEN changed := changed || 'status'::text; END IF;
  IF NEW.order_id       IS DISTINCT FROM OLD.order_id       THEN changed := changed || 'order_id'::text; END IF;
  IF NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id THEN changed := changed || 'ticket_type_id'::text; END IF;
  IF NEW.seat_id        IS DISTINCT FROM OLD.seat_id        THEN changed := changed || 'seat_id'::text; END IF;
  IF NEW.event_seat_id  IS DISTINCT FROM OLD.event_seat_id  THEN changed := changed || 'event_seat_id'::text; END IF;
  IF NEW.original_price IS DISTINCT FROM OLD.original_price THEN changed := changed || 'original_price'::text; END IF;
  IF NEW.used_at        IS DISTINCT FROM OLD.used_at        THEN changed := changed || 'used_at'::text; END IF;
  IF NEW.revoked_at     IS DISTINCT FROM OLD.revoked_at     THEN changed := changed || 'revoked_at'::text; END IF;
  IF cardinality(changed) > 0 THEN
    RAISE EXCEPTION 'tickets.tickets: sloupce % smí měnit jen systém/pořadatel/admin (kontext role=%)',
      array_to_string(changed, ','), COALESCE(NULLIF(current_setting('app.role', true), ''), 'anon')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tickets_guard_protected ON tickets.tickets;
CREATE TRIGGER trg_tickets_guard_protected
  BEFORE UPDATE ON tickets.tickets
  FOR EACH ROW EXECUTE FUNCTION tickets.guard_tickets_protected_columns();

-- ── orders.order_items ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION orders.guard_order_items_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF app_may_write_protected() THEN
    RETURN NEW;
  END IF;
  IF NEW.order_id       IS DISTINCT FROM OLD.order_id
  OR NEW.ticket_type_id IS DISTINCT FROM OLD.ticket_type_id
  OR NEW.seat_id        IS DISTINCT FROM OLD.seat_id
  OR NEW.quantity       IS DISTINCT FROM OLD.quantity
  OR NEW.unit_price     IS DISTINCT FROM OLD.unit_price
  OR NEW.total_price    IS DISTINCT FROM OLD.total_price THEN
    RAISE EXCEPTION 'orders.order_items: položky objednávky smí měnit jen systém/pořadatel/admin (kontext role=%)',
      COALESCE(NULLIF(current_setting('app.role', true), ''), 'anon')
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_items_guard_protected ON orders.order_items;
CREATE TRIGGER trg_order_items_guard_protected
  BEFORE UPDATE ON orders.order_items
  FOR EACH ROW EXECUTE FUNCTION orders.guard_order_items_protected_columns();
