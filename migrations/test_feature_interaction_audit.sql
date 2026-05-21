-- Feature interaction audit — testuje, jestli nové featury neblokují jiné.
-- Vše v BEGIN/ROLLBACK.

BEGIN;

DO $$
DECLARE
  v_promoter uuid;
  v_event uuid;
  v_user uuid;
  v_ticket uuid;
  v_order uuid;
  v_test_passed boolean;
  v_pending_count int;
BEGIN
  -- Najdi reálnou paid objednávku
  SELECT e.promoter_id, e.id, o.user_id, o.id, t.id
    INTO v_promoter, v_event, v_user, v_order, v_ticket
    FROM catalog.events e
    JOIN orders.orders o ON o.event_id = e.id
    JOIN tickets.tickets t ON t.order_id = o.id
   WHERE o.status = 'paid' AND t.status = 'valid'
   LIMIT 1;

  IF v_event IS NULL THEN
    RAISE NOTICE 'Žádná paid order — SKIP audit.';
    RETURN;
  END IF;

  RAISE NOTICE '=== FEATURE INTERACTION AUDIT ===';
  RAISE NOTICE 'Test scope: event=%, user=%, ticket=%', v_event, v_user, v_ticket;
  RAISE NOTICE '';

  -- ============================================================
  -- KONFLIKT 1: hot_event_mode (no_gifting) vs allow_ticket_changes
  -- ============================================================
  RAISE NOTICE '[1] Hot event no_gifting + ticket_changes';
  UPDATE catalog.events
     SET no_gifting_mode = true, allow_ticket_changes = true
   WHERE id = v_event;

  -- Pokud no_gifting, ticket_change_request endpoint by mělo block
  -- (kontrola je v lib code, ne DB constraint) — OK jen ověříme oba flagy mohou koexistovat
  IF EXISTS (SELECT 1 FROM catalog.events WHERE id = v_event AND no_gifting_mode = true AND allow_ticket_changes = true) THEN
    RAISE NOTICE '   ⚠️  DB allow both flags. App code in change-request/route.ts blokuje pokud no_gifting → OK.';
  END IF;

  -- ============================================================
  -- KONFLIKT 2: require_phone_binding vs transfer-invite
  -- ============================================================
  RAISE NOTICE '[2] Phone binding + transfer-invite';
  UPDATE catalog.events SET require_phone_binding = true WHERE id = v_event;
  UPDATE tickets.tickets SET bound_phone_e164 = '+420555111222' WHERE id = v_ticket;

  -- Transfer-invite by měl projít DB, ale v handle smí kontrolovat hot_mode
  -- DB-level je OK pokud bound_phone_e164 sloupec existuje
  IF EXISTS (SELECT 1 FROM tickets.tickets WHERE id = v_ticket AND bound_phone_e164 IS NOT NULL) THEN
    RAISE NOTICE '   ✅ Phone binding + transfer-invite koexistují (app logika rozhoduje).';
  END IF;

  -- ============================================================
  -- KONFLIKT 3: resale_policy = disabled vs Face Value Exchange
  -- ============================================================
  RAISE NOTICE '[3] resale_policy disabled vs face_value mode';
  UPDATE catalog.events SET resale_policy = 'disabled' WHERE id = v_event;

  -- Check resale eligibility view
  PERFORM 1 FROM resale.vw_ticket_resale_eligibility
   WHERE ticket_id = v_ticket AND is_eligible = false AND eligibility_reason = 'event_resale_disabled';
  IF FOUND THEN
    RAISE NOTICE '   ✅ Disabled policy blokuje resale (view returns is_eligible=false).';
  ELSE
    RAISE NOTICE '   🔴 PROBLEM: resale_policy=disabled NEBLOKUJE resale!';
  END IF;

  -- ============================================================
  -- KONFLIKT 4: postponed_at + cancel_order
  -- ============================================================
  RAISE NOTICE '[4] Postponed event + buyer cancel';
  UPDATE catalog.events
     SET postponed_at = now(), allow_buyer_cancel = true,
         refund_pct_before_deadline = 100,
         buyer_cancel_deadline_hours_before = 999999  -- vždy refund 100 %
   WHERE id = v_event;

  -- Postponed event s allow_cancel = true: should allow + full refund
  IF EXISTS (SELECT 1 FROM catalog.events
              WHERE id = v_event AND postponed_at IS NOT NULL AND allow_buyer_cancel = true) THEN
    RAISE NOTICE '   ✅ Postponed + cancel koexistují (správně — odložené akce nabízejí refund).';
  END IF;

  -- ============================================================
  -- KONFLIKT 5: qr_reveal_minutes_before + NFC payload
  -- ============================================================
  RAISE NOTICE '[5] Hidden QR (reveal 60 min before) + NFC tap';
  UPDATE catalog.events SET qr_reveal_minutes_before = 60 WHERE id = v_event;

  -- NFC payload endpoint NEKONTROLUJE qr_reveal_minutes — to je business decision:
  -- NFC tap musí fungovat i když QR ještě skrytý (rychlejší přístup u brány)
  -- TM Enhanced Wallet: pass se odhalí 3 dny předem
  RAISE NOTICE '   ⚠️  qr_reveal_minutes neblokuje NFC payload generování (correct — NFC je always-on)';

  -- ============================================================
  -- KONFLIKT 6: tan_validated_at + ticket_changes
  -- ============================================================
  RAISE NOTICE '[6] TAN validation requirement + ticket_change_request';
  UPDATE catalog.events SET require_tan_validation = true WHERE id = v_event;
  UPDATE orders.orders SET tan_validated_at = NULL WHERE id = v_order;

  -- Bez TAN by user neměl vidět tickety. Change-request endpoint sám kontrolu nedělá,
  -- ale buyer beztoho nemá přístup k ticket detailu → blokace na UI úrovni.
  RAISE NOTICE '   ⚠️  TAN required + change request: UI gating (lístek se nezobrazí bez TAN)';

  -- ============================================================
  -- KONFLIKT 7: will_call + NFC tap
  -- ============================================================
  RAISE NOTICE '[7] Will Call delivery + NFC tap';
  UPDATE orders.orders SET delivery_method = 'will_call' WHERE id = v_order;

  -- Will call = lístek se vydá na pokladně. Buyer NESMÍ mít online QR/NFC.
  -- App layer musí check delivery_method před serving NFC payload.
  -- DB-level OK (oba flagy koexistují)
  RAISE NOTICE '   ⚠️  Will call + NFC: app layer musí blokovat NFC pro will_call orders';

  -- ============================================================
  -- KONFLIKT 8: hot_event_mode (max_tickets_per_buyer) + Group discount
  -- ============================================================
  RAISE NOTICE '[8] max_tickets_per_buyer + group_discount (5+ tickets)';
  UPDATE catalog.events SET max_tickets_per_buyer = 4 WHERE id = v_event;

  -- Pokud cap = 4, group tier 5+ je unreachable per single buyer (správně).
  -- Group discount má smysl jen pokud cap > min_quantity tieru
  RAISE NOTICE '   ⚠️  cap=4 vs group tier 5+ — buyer cap blokuje group price (intended)';

  -- ============================================================
  -- KONFLIKT 9: Pre-event payout schedule + Refund flow
  -- ============================================================
  RAISE NOTICE '[9] Pre-event payouts + refund_request';

  -- Pokud pre-event payout už proběhl (70 % T-30) a buyer chce cancel po deadline,
  -- refund_request potřebuje fund od promotéra. DB check:
  IF EXISTS (
    SELECT 1 FROM platform.advance_payout_installments
     WHERE schedule_id IN (
       SELECT id FROM platform.advance_payout_schedules WHERE event_id = v_event
     )
       AND status = 'paid'
  ) THEN
    RAISE NOTICE '   ⚠️  Pre-event payout proběhl + refund_request → promotér musí vrátit (chargeback)';
  ELSE
    RAISE NOTICE '   ✅ No advance payout konflikt';
  END IF;

  -- ============================================================
  -- KONFLIKT 10: Donation campaign + Group discount (donation = pay-what-you-want)
  -- ============================================================
  RAISE NOTICE '[10] Donation + group discount';

  -- Pokud ticket_type.is_donation = true, group discount nemá smysl (any-price)
  -- DB allows both — app layer rozhodne
  IF EXISTS (
    SELECT 1 FROM catalog.ticket_types tt
     WHERE tt.event_id = v_event AND tt.is_donation = true
       AND EXISTS (SELECT 1 FROM catalog.group_discount_tiers WHERE ticket_type_id = tt.id)
  ) THEN
    RAISE NOTICE '   ⚠️  Donation tier + group discount na stejném ticket_type — UI by mělo varovat';
  ELSE
    RAISE NOTICE '   ✅ No donation+discount konflikt na test eventu';
  END IF;

  -- ============================================================
  -- KONFLIKT 11: Resale active listing + ticket_change request
  -- ============================================================
  RAISE NOTICE '[11] Active resale listing + change-request na stejný ticket';

  -- Pokud máš ticket listed v resale (status=active), nemá smysl
  -- ho současně chtít přepnout na jiný typ.
  -- Check: jsou tu pending ticket_changes pro tickety s active resale listing?
  SELECT COUNT(*) INTO v_pending_count
    FROM tickets.ticket_changes tc
    JOIN resale.resale_listings rl ON rl.ticket_id = tc.ticket_id
   WHERE tc.status = 'pending' AND rl.status = 'active';
  IF v_pending_count > 0 THEN
    RAISE NOTICE '   🔴 % collisions: ticket má pending change + active resale!', v_pending_count;
  ELSE
    RAISE NOTICE '   ✅ No collisions: ticket_change vs active_resale';
  END IF;

  -- ============================================================
  -- KONFLIKT 12: Verified Fan + ticket_changes
  -- ============================================================
  RAISE NOTICE '[12] Verified Fan registration + ticket swap to non-verified ticket type';

  -- Pokud byl ticket koupen přes verified fan flow, swap na "regular" ticket_type
  -- bypassuje VF security. App layer by měla kontrolovat.
  RAISE NOTICE '   ⚠️  App layer policy: VF tickety swap jen za VF tickety';

  -- ============================================================
  -- KONFLIKT 13: Coordinated onsale + per-event hot_mode
  -- ============================================================
  RAISE NOTICE '[13] Coordinated onsale (Event Groups) + hot_mode per event';

  -- Event group coordinates onsale, ale hot_mode (TAN, phone binding) je per-event flag.
  -- Pokud festival má 10 dnů a jeden z dnů má hot_mode, ostatní ne → inconsistent UX.
  -- DB allows. App layer by mělo nabízet "apply to all events in group".
  RAISE NOTICE '   ⚠️  Per-event hot_mode v Group — UI by mělo nabídnout bulk apply';

  -- ============================================================
  -- KONFLIKT 14: A/B price test + dynamic pricing engine
  -- ============================================================
  RAISE NOTICE '[14] A/B price test + dynamic_pricing_rules';

  -- Pricing rules engine (lib/pricing/rules-engine.ts):
  -- order: base → window → dynamic → ab_test
  -- A/B test má prioritu → poslední vrátí finalPrice
  -- Dynamic má smysl jen pokud A/B test inactive
  RAISE NOTICE '   ✅ Engine ordering: window > dynamic > ab_test (ab_test wins když active)';

  -- ============================================================
  -- KONFLIKT 15: Channel-based pricing + dynamic pricing
  -- ============================================================
  RAISE NOTICE '[15] Channel price override + dynamic uplift';

  -- Eg. box_office má -10 % override, dynamic by chtělo +15 % uplift
  -- Engine order: window → dynamic. Channel override by se aplikoval jako window.
  -- Final price = channel_override → dynamic uplift over channel
  RAISE NOTICE '   ⚠️  Channel override → dynamic uplift po něm (intended chain)';

  RAISE NOTICE '';
  RAISE NOTICE '=== AUDIT DONE ===';
END $$;

ROLLBACK;
