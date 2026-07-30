-- Smoke test: ověřuje, že CASCADE řetězec se chová dle business expectation.
-- Vše v BEGIN/ROLLBACK — žádný side-effect na DB.

BEGIN;

DO $$
DECLARE
  v_promoter uuid;
  v_event uuid;
  v_user uuid;
  v_order uuid;
  v_ticket uuid;
  v_orders_before bigint;
  v_users_before bigint;
  v_users_after bigint;
  v_event_count bigint;
  v_test_passed boolean;
BEGIN
  -- Najdi prvního paid order s celým řetězcem
  SELECT e.promoter_id, e.id, o.user_id, o.id, t.id
    INTO v_promoter, v_event, v_user, v_order, v_ticket
    FROM catalog.events e
    JOIN orders.orders o ON o.event_id = e.id
    JOIN tickets.tickets t ON t.order_id = o.id
   WHERE o.status = 'paid'
   LIMIT 1;

  IF v_event IS NULL THEN
    RAISE NOTICE 'Žádná paid objednávka — nemůžu testovat. SKIP.';
    RETURN;
  END IF;

  RAISE NOTICE 'Test setup: promoter=%, event=%, user=%, order=%',
    v_promoter, v_event, v_user, v_order;

  -- ======================================================
  -- Test 1: smazání uživatele s objednávkou MUSÍ failnout
  -- ======================================================
  v_test_passed := false;
  BEGIN
    DELETE FROM identity.users WHERE id = v_user;
  EXCEPTION
    WHEN foreign_key_violation THEN v_test_passed := true;
  END;
  IF v_test_passed THEN
    RAISE NOTICE '✅ Test 1 PASS: smazání usera s aktivní objednávkou blokováno FK';
  ELSE
    RAISE NOTICE '🔴 Test 1 FAIL: user delete prošlo!';
  END IF;

  -- ======================================================
  -- Test 2: smazání eventu s access tokens MUSÍ failnout
  -- ======================================================
  IF EXISTS (SELECT 1 FROM tickets.access_tokens WHERE resource_id = v_event) THEN
    v_test_passed := false;
    BEGIN
      DELETE FROM catalog.events WHERE id = v_event;
    EXCEPTION
      WHEN foreign_key_violation THEN v_test_passed := true;
    END;
    IF v_test_passed THEN
      RAISE NOTICE '✅ Test 2 PASS: smazání eventu s access tokens blokováno RESTRICT';
    ELSE
      RAISE NOTICE '🔴 Test 2 FAIL: event delete prošlo přes access_tokens';
    END IF;
  ELSE
    RAISE NOTICE '⏭️  Test 2 SKIP: event nemá access tokens';
  END IF;

  -- ======================================================
  -- Test 3: smazání eventu s objednávkami
  -- ======================================================
  SELECT count(*) INTO v_orders_before FROM orders.orders WHERE event_id = v_event;
  v_test_passed := null;
  BEGIN
    DELETE FROM catalog.events WHERE id = v_event;
    v_test_passed := false;
  EXCEPTION
    WHEN foreign_key_violation THEN v_test_passed := true;
  END;
  IF v_test_passed THEN
    RAISE NOTICE '✅ Test 3 PASS: smazání eventu s % objednávkami blokováno (data zachována)', v_orders_before;
  ELSIF v_test_passed = false THEN
    RAISE NOTICE '🔴 Test 3 FAIL: event smazán + % objednávek zmizelo (CASCADE)', v_orders_before;
  END IF;

  -- ======================================================
  -- Test 4: smazání promotéra
  -- ======================================================
  SELECT count(*) INTO v_event_count FROM catalog.events WHERE promoter_id = v_promoter;
  SELECT count(*) INTO v_users_before FROM identity.users;
  v_test_passed := null;
  BEGIN
    DELETE FROM platform.promoters WHERE id = v_promoter;
    SELECT count(*) INTO v_users_after FROM identity.users;
    IF v_users_before = v_users_after THEN
      v_test_passed := true;
    ELSE
      v_test_passed := false;
    END IF;
  EXCEPTION
    WHEN foreign_key_violation THEN v_test_passed := true;
  END;
  IF v_test_passed THEN
    RAISE NOTICE '✅ Test 4 PASS: smazání promotéra NEUBRALO uživatele (zachováno %)', v_users_before;
  ELSE
    RAISE NOTICE '🔴 Test 4 FAIL: smazání promotéra ubralo uživatele (% → %)',
      v_users_before, v_users_after;
  END IF;

  -- ======================================================
  -- Test 5: sync trigger pro user name
  -- ======================================================
  v_test_passed := null;
  UPDATE identity.users
     SET first_name = 'TestFirst', last_name = 'TestLast'
   WHERE id = v_user;
  PERFORM 1 FROM identity.users
   WHERE id = v_user AND name = 'TestFirst TestLast';
  IF FOUND THEN
    RAISE NOTICE '✅ Test 5 PASS: name auto-sync z first_name + last_name funguje';
  ELSE
    RAISE NOTICE '🔴 Test 5 FAIL: trigger nesync name';
  END IF;

  -- ======================================================
  -- Test 6: trigger funguje i opačně (legacy code dodá name → split)
  -- ======================================================
  v_test_passed := null;
  -- Reset first_name/last_name na NULL a dodáme jen name
  UPDATE identity.users
     SET first_name = NULL, last_name = NULL, name = 'Petr Kovář'
   WHERE id = v_user;
  PERFORM 1 FROM identity.users
   WHERE id = v_user AND first_name = 'Petr' AND last_name = 'Kovář';
  IF FOUND THEN
    RAISE NOTICE '✅ Test 6 PASS: legacy name → first/last auto-split funguje';
  ELSE
    RAISE NOTICE '🔴 Test 6 FAIL: legacy name split nefunguje';
  END IF;

END $$;

ROLLBACK;
