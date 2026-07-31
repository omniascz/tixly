-- RLS Fáze 2 — policy review vlna 3: 8 RLS-off tabulek s PII (email/telefon/jméno).
-- Žádná se nečte v anon kontextu (ověřeno) → bezpečné zapnout RLS.

-- hospitality_inquiries: B2B leady promotéra → scope přes package→event→promotér
ALTER TABLE orders.hospitality_inquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_scope ON orders.hospitality_inquiries;
CREATE POLICY p_scope ON orders.hospitality_inquiries FOR ALL USING (
  app_is_service() OR app_is_platform_admin()
  OR EXISTS (
    SELECT 1 FROM catalog.hospitality_packages hp
    JOIN catalog.events e ON e.id = hp.event_id
    WHERE hp.id = hospitality_inquiries.package_id
      AND e.promoter_id = app_current_promoter_id()
  )
);

-- Platform-network entity + nepoužívané sub-moduly s PII → service/admin only.
-- (partner/retailer/charity partners = platform-managed; conference/escape/cross_scanner/
--  discovery feed = sub-moduly bez tenant kontextu; všechny čteny jen ve service/admin.)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'partner.partners','retailer.retailers','charity.partners',
    'conference.exhibitor_staff','venues.escape_bookings',
    'cross_scanner.imported_tickets','discovery_feed.feed_subscriptions'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS p_scope ON %s', t);
    EXECUTE format($f$
      CREATE POLICY p_scope ON %1$s FOR ALL USING (
        app_is_service() OR app_is_platform_admin()
      )$f$, t);
  END LOOP;
END $$;
