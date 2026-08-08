import type { ReportDef } from './types';
import { REPORTS_PRODEJE } from './reports-prodeje';
import { REPORTS_FINANCE } from './reports-finance';
import { REPORTS_ZAKAZNICI } from './reports-zakaznici';
import { REPORTS_UDALOSTI } from './reports-udalosti';
import { REPORTS_MARKETING } from './reports-marketing';
import { REPORTS_OPERACE } from './reports-operace';
import { REPORTS_SROVNANI } from './reports-srovnani';
import { REPORTS_PLATFORM } from './reports-platform';
import { REPORTS_EXTRA_1 } from './reports-extra-1';
import { REPORTS_EXTRA_2 } from './reports-extra-2';
import { REPORTS_EXTRA_3 } from './reports-extra-3';

/**
 * ── VYRAZENE REPORTY (R-35 / FINDINGS §160) ─────────────────────────────────
 *
 * Kazdy z nich saha na tabulku, ktera ve schematu NEEXISTUJE — spustit ho dnes
 * znamena 42P01. Definice se ZAMERNE nemazou: nesou SQL, ktere bude platit,
 * az tabulka vznikne. Vyrazuji se jen z registru.
 *
 * Mechanismus je tentyz jako `ALLOWED_JOBS` v `app/api/cron/dispatch/route.ts`:
 * jeden seznam v kodu, ktery rozhoduje o dostupnosti. Zadny novy vypinac.
 *
 * Klic = id reportu, hodnota = tabulka, ktera chybi (co dostavet).
 */
export const DISABLED_REPORTS = new Map<string, string>([
  ['zakaznici_verified_fan',        'marketing.verified_fan_registrations'],
  ['marketing_meta_pixel',          'analytics.pixel_events'],
  ['marketing_broadcast_results',   'marketing.crm_broadcasts'],
  ['marketing_access_codes_pouziti', 'marketing.access_code_groups'],
  ['marketing_rsvp_dle_akce',       'marketing.rsvp_registrations'],
  ['marketing_guestlist_bulk',      'public.guest_list_entries'],
  ['marketing_affiliate_partner',   'marketing.affiliate_commissions + affiliate_events + affiliate_partners'],
  ['ops_foyer_preorders',           'public.foyer_order_items'],
  ['ops_commemmorative',            'public.commemorative_tickets'],
  ['platform_onboarding_wizard',    'platform.onboarding_wizards'],
  ['platform_mrr',                  'platform.subscription_payments'],
  ['udalosti_lottery',              'marketing.lottery_winners'],
  ['platform_error_rate',           'orders.payment_attempts'],
  ['marketing_access_codes',        'marketing.access_code_usages'],
  ['ops_scan_duplicit',             'tickets.ticket_scans'],

  // ── Reporty se SPATNYM SLOUPCEM (R-44 / FINDINGS §169) ────────────────────
  // DISABLED_REPORTS vzniklo ze skenu chybejicich TABULEK, takze tyhle jim
  // proklouzly: tabulka existuje, ale sloupec ne. Nalezeno
  // `scripts/scan-report-columns.mjs` (self-check prosel na `re.price_halire`
  // a `le.user_id`). Hodnota = prvni chybejici sloupec.
  ['finance_voucher_redemption',        'sloupec: orders.orders.voucher_code'],
  ['finance_loyalty_vydano',            'sloupec: marketing.loyalty_transactions.points'],
  ['zakaznici_newsletter',              'sloupec: identity.users.marketing_opt_in'],
  ['zakaznici_loyalty',                 'sloupec: marketing.loyalty_transactions.type'],
  ['zakaznici_phone_verify',            'sloupec: identity.users.phone_verified'],
  ['zakaznici_waitlist_konverze',       'sloupec: orders.waiting_list.user_id'],
  ['udalosti_multi_date',               'sloupec: catalog.events.parent_event_id'],
  ['udalosti_charity',                  'sloupec: catalog.ticket_types.is_charity'],
  ['udalosti_scan_rate',                'sloupec: tickets.scan_logs.order_item_id'],
  ['udalosti_rescheduled',              'sloupec: catalog.event_reschedules.original_date'],
  ['marketing_social_shop',             'sloupec: orders.orders.referrer_platform'],
  ['ops_ticket_type_scan',              'sloupec: tickets.scan_logs.order_item_id'],
  ['ops_invalid_scans',                 'sloupec: tickets.scan_logs.result'],
  ['ops_insurance_claims',              'sloupec: public.insurance_claims.paid_amount_halire'],
  ['ops_pos_sessions',                  'sloupec: orders.orders.pos_session_id'],
  ['srov_venue_fill_yoy',               'sloupec: catalog.events.capacity'],
  ['platform_scan_volume',              'sloupec: tickets.scan_logs.result'],
  ['platform_resellers',                'sloupec: platform.reseller_partners.promoter_id'],
  ['platform_avg_fees',                 'sloupec: orders.orders.platform_fee_halire'],
  ['udalosti_backstage',                'sloupec: catalog.backstage_moments.scanned_at'],
  ['marketing_sms_campaigns',           'sloupec: marketing.sms_campaigns.sent_count'],
  ['marketing_coupon_pouziti',          'sloupec: orders.orders.promo_code'],
  ['ops_reprint_requests',              'sloupec: audit.audit_log.resource_id'],
  ['ops_staff_activity',                'sloupec: tickets.scan_logs.scanned_by'],
  ['srov_promo_efficacy',               'sloupec: orders.orders.promo_code'],
  ['marketing_waitlist_prehled',        'sloupec: orders.waiting_list.user_id'],
  ['marketing_loyalty_vydano',          'sloupec: marketing.loyalty_transactions.points'],
  ['marketing_broadcast_prehled',       'sloupec: communications.broadcasts.name'],
  ['marketing_promo_expiry',            'sloupec: marketing.promo_codes.event_id'],
  ['platform_novi_promoteri',           'sloupec: platform.promoters.owner_user_id'],
  ['zakaznici_waitlist',                'sloupec: orders.waiting_list.user_id'],
]);

/** Vsechny definice VCETNE vyrazenych — jen pro diagnostiku, ne pro UI. */
export const ALL_REPORTS_INCLUDING_DISABLED: ReportDef[] = [
  ...REPORTS_PRODEJE,
  ...REPORTS_FINANCE,
  ...REPORTS_ZAKAZNICI,
  ...REPORTS_UDALOSTI,
  ...REPORTS_MARKETING,
  ...REPORTS_OPERACE,
  ...REPORTS_SROVNANI,
  ...REPORTS_PLATFORM,
  ...REPORTS_EXTRA_1,
  ...REPORTS_EXTRA_2,
  ...REPORTS_EXTRA_3,
];

/** Registr, ze ktereho se plni UI i routa `run`. Vyrazene se sem nedostanou. */
export const ALL_REPORTS: ReportDef[] = ALL_REPORTS_INCLUDING_DISABLED.filter(
  (r) => !DISABLED_REPORTS.has(r.id),
);

/** Lookup pro routu `run`. Vyrazene reporty tu NEJSOU, takze `run` vrati 404
 *  UNKNOWN_REPORT — srozumitelnou odpoved misto 42P01 z databaze. */
export const REPORT_BY_ID = new Map<string, ReportDef>(
  ALL_REPORTS.map((r) => [r.id, r]),
);

export type { ReportDef } from './types';
export { CATEGORIES } from './types';
