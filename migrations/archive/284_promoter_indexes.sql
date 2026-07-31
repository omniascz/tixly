-- 284_promoter_indexes.sql
-- P2: Doplnit indexy na promoter_id pro tabulky kde chybí.
-- 30 tabulek s promoter_id BEZ indexu → multi-tenant queries dělají full scan.
--
-- CREATE INDEX CONCURRENTLY — neblokuje writes. Bez transakce (pg requirement).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_accreditation_promoter
  ON accreditation.accreditation_requests(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_platform_log_promoter
  ON audit.platform_log(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_access_codes_promoter
  ON catalog.access_codes(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_donation_campaigns_promoter
  ON catalog.donation_campaigns(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_ticket_defaults_promoter
  ON catalog.event_ticket_defaults(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_plans_promoter
  ON catalog.payment_plans(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_conference_exhibitors_promoter
  ON conference.exhibitors(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cross_scanner_guest_lists_promoter
  ON cross_scanner.guest_lists(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_eventim_export_jobs_promoter
  ON eventim_export.export_jobs(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_flex_plans_promoter
  ON flex_plans.flex_plans(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transfer_imports_promoter
  ON orders.bank_transfer_imports(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tap_to_pay_sessions_promoter
  ON pos.tap_to_pay_sessions(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bogo_rules_promoter
  ON promo.bogo_rules(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_receipts_promoter
  ON reservations.booking_receipts(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_package_purchases_promoter
  ON reservations.package_purchases(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reservations_waitlist_promoter
  ON reservations.waitlist_entries(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pricing_scenarios_promoter
  ON revenue.pricing_scenarios(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fraud_cases_promoter
  ON risk.fraud_cases(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seg_export_jobs_promoter
  ON segmentation.export_jobs(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sport_multi_game_packages_promoter
  ON sport.multi_game_packages(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sport_season_holders_promoter
  ON sport.season_ticket_holders(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_surveys_promoter
  ON surveys.surveys(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_event_entry_modes_promoter
  ON validation.event_entry_modes(promoter_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_venues_entry_bookings_promoter
  ON venues.entry_bookings(promoter_id);
