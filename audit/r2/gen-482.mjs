// Kolo 2 / krok 3B — generátor migrace 482 + tabulky „156 tabulek bez RLS".
// Vstup: logs/r2/3_tables_usage.json (sloupce/FK/kód), logs/r2/3_tables_ops.json (operace a kontexty).
// Výstup: migrations/482_rls_tables_without_rls.sql, logs/r2/3B_tables_decision.md
//
// Kategorie:
//   SYSTEM   — globální konfigurace/číselník/telemetrie bez dat tenantu či uživatele:
//              RLS se NEzapíná, tixly_app dostane jen SELECT (+ zápisy, které kód skutečně dělá).
//   TENANT   — data pořadatele: RLS + svc/admin + vlastník (pořadatel) [+ veřejné čtení, kde je kód
//              čte bez kontextu na veřejných stránkách a jde o veřejné údaje publikované akce].
//   USER     — data uživatele: RLS + svc/admin + vlastník (uživatel).
//   LOCKED   — data tenantu/uživatele, která kód NEPOUŽÍVÁ (nebo jen v servisním/admin kontextu):
//              RLS + jen svc/admin. Přístup tenantu se doplní, až funkce vznikne.
import { readFileSync, writeFileSync } from 'node:fs';

const usage = JSON.parse(readFileSync('logs/r2/3_tables_usage.json', 'utf8'));
const ops = Object.fromEntries(JSON.parse(readFileSync('logs/r2/3_tables_ops.json', 'utf8')).map((o) => [o.t, o]));

const SA = 'public.app_is_platform_admin() OR public.app_is_service()';
const CUR_P = 'public.app_current_promoter_id()';
const CUR_U = 'public.app_current_user_id()';
const rel = (t) => t.split('.')[1];
const eventOwn = (t, c) => `EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = ${rel(t)}.${c} AND e.promoter_id = ${CUR_P})`;
const eventPub = (t, c) => `EXISTS (SELECT 1 FROM catalog.events e WHERE e.id = ${rel(t)}.${c} AND e.status = 'published')`;
const ttOwn = (t, c) => `EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ${rel(t)}.${c} AND e.promoter_id = ${CUR_P})`;
const ttPub = (t, c) => `EXISTS (SELECT 1 FROM catalog.ticket_types tt JOIN catalog.events e ON e.id = tt.event_id WHERE tt.id = ${rel(t)}.${c} AND e.status = 'published')`;
const venueOwn = (t, c) => `EXISTS (SELECT 1 FROM catalog.venues v WHERE v.id = ${rel(t)}.${c} AND v.promoter_id = ${CUR_P})`;
const orderVis = (t, c) => `EXISTS (SELECT 1 FROM orders.orders o WHERE o.id = ${rel(t)}.${c})`; // viditelnost dle RLS objednávek

// ─── rozhodnutí pro tabulky, které kód POUŽÍVÁ ───────────────────────────────
// own = výraz vlastnictví (ALL), read = dodatečné čtení (SELECT), grants = zápisy pro SYSTEM
const D = {
  'analytics.audience_geo': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'geodata kupců akce (event_id)' },
  'analytics.event_sales_snapshots': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'prodejní snapshoty akce' },
  'audit.audit_log': { cat: 'TENANT', custom: 'audit_log', why: 'auditní stopa se starými/novými hodnotami (osobní údaje) všech tenantů; append-only' },
  'audit.support_actions': { cat: 'TENANT', own: (t) => `${rel(t)}.actor_promoter_id = ${CUR_P}`, why: 'zásahy podpory pořadatele (actor_promoter_id)' },
  'b2b.api_rate_limit_log': { cat: 'LOCKED', why: 'log volání API klientů tenantů; píše/čte jen servis' },
  'b2b.oauth_clients': { cat: 'TENANT', own: (t) => `(${rel(t)}.owner_promoter_id = ${CUR_P} OR ${rel(t)}.owner_user_id = ${CUR_U})`,
    read: (t) => `EXISTS (SELECT 1 FROM b2b.oauth_access_tokens at WHERE at.client_id = ${rel(t)}.id AND at.user_id = ${CUR_U})`,
    why: 'OAuth aplikace pořadatele/uživatele (secret); kupec čte aplikace, kterým udělil přístup' },
  'b2b.webhook_subscriptions': { cat: 'LOCKED', why: 'webhooky API klientů; jen servis (v3 API)' },
  'brands.advertisers': { cat: 'SYSTEM', grants: ['INSERT'], why: 'adresář inzerentů platformy (ne data tenantu); čtou ho pořadatelé v nabídkách' },
  'brands.campaigns': { cat: 'SYSTEM', grants: ['INSERT', 'UPDATE'], why: 'katalog kampaní inzerentů platformy nabízený pořadatelům' },
  'brands.impressions': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'impresse na akci pořadatele' },
  'catalog.ab_price_assignments': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM catalog.ab_price_tests x WHERE x.id = ${rel(t)}.test_id)`, why: 'A/B přiřazení cen (přes ab_price_tests → ticket_type)' },
  'catalog.ab_price_tests': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'A/B test cen typu vstupenky' },
  'catalog.access_code_ticket_types': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM catalog.access_codes ac WHERE ac.id = ${rel(t)}.access_code_id AND ac.promoter_id = ${CUR_P})`, why: 'vazba přístupových kódů pořadatele' },
  'catalog.backstage_moments': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), read: (t) => eventPub(t, 'event_id'), why: 'backstage obsah akce; veřejně čten (NOCTX /api/backstage) u publikované akce' },
  'catalog.cinema_screens': { cat: 'TENANT', own: (t) => venueOwn(t, 'venue_id'), read: () => 'true', why: 'plátna kina místa; veřejné údaje (NOCTX /api/cinema)' },
  'catalog.commemorative_templates': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'šablony pamětních vstupenek akce' },
  'catalog.discount_pricing_rules': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'cenová pravidla typu vstupenky' },
  'catalog.dynamic_pricing_rules': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'dynamické ceny typu vstupenky' },
  'catalog.event_bundle_addons': { cat: 'TENANT',
    own: (t) => `EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id WHERE b.id = ${rel(t)}.bundle_id AND e.promoter_id = ${CUR_P})`,
    read: (t) => `EXISTS (SELECT 1 FROM catalog.event_bundles b JOIN catalog.events e ON e.id = b.event_id WHERE b.id = ${rel(t)}.bundle_id AND e.status = 'published')`,
    why: 'doplňky balíčků akce; veřejně čteny (NOCTX /api/events/[id]/bundles)' },
  'catalog.flex_pass_settings': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), read: (t) => ttPub(t, 'ticket_type_id'), why: 'nastavení flex passu typu; veřejně čteno (ticket-types)' },
  'catalog.foyer_menu_items': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), read: (t) => eventPub(t, 'event_id'), why: 'menu foyer akce; veřejně čteno' },
  'catalog.group_discount_tiers': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), read: (t) => ttPub(t, 'ticket_type_id'), why: 'skupinové slevy typu (veřejná informace)' },
  'catalog.lastminute_rules': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'last-minute pravidla akce' },
  'catalog.member_pricing_rules': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'členské ceny typu' },
  'catalog.moderation_blocklist': { cat: 'SYSTEM', why: 'globální seznam zakázaných slov moderace' },
  'catalog.pricing_rules': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'cenová pravidla typu' },
  'catalog.pricing_windows': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'cenová okna typu' },
  'catalog.seats': { cat: 'TENANT', own: (t) => venueOwn(t, 'venue_id'), read: () => 'true', why: 'sedadla místa (fyzika sálu, veřejná); zápis jen vlastník místa' },
  'catalog.ticket_modular_pricing': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), read: (t) => ttPub(t, 'ticket_type_id'), why: 'modulární ceny; veřejně čteny (modular-pass)' },
  'catalog.ticket_type_access': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), read: (t) => ttPub(t, 'ticket_type_id'), why: 'přístupová matice typu; veřejně čtena (stránka akce)' },
  'catalog.ticket_type_channel_prices': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'ceny typu podle kanálu' },
  'catalog.ticket_type_price_history': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'historie cen typu' },
  'catalog.venue_seating_charts': { cat: 'TENANT', own: (t) => venueOwn(t, 'venue_id'), read: () => 'true', why: 'plánek sálu (veřejný, NOCTX /seats); zápis jen vlastník místa' },
  'catalog.volume_discount_rules': { cat: 'TENANT', own: (t) => ttOwn(t, 'ticket_type_id'), why: 'množstevní slevy typu' },
  'communications.announcement_responses': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM communications.emergency_announcements a WHERE a.id = ${rel(t)}.announcement_id AND a.promoter_id = ${CUR_P})`, why: 'odpovědi kupců na krizová oznámení pořadatele' },
  'event_groups.bulk_edits': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM event_groups.groups g WHERE g.id = ${rel(t)}.group_id AND g.promoter_id = ${CUR_P})`, why: 'hromadné úpravy skupiny akcí' },
  'event_groups.shares': { cat: 'TENANT', own: (t) => `${rel(t)}.owner_promoter_id = ${CUR_P}`, read: (t) => `${rel(t)}.shared_with_promoter_id = ${CUR_P}`, why: 'sdílení skupin mezi pořadateli' },
  'marketing.ad_auction_log': { cat: 'TENANT', read: (t) => `${rel(t)}.shown_on_promoter_id = ${CUR_P}`, why: 'log aukce reklam (zobrazení u pořadatele); zápis jen servis (ads/click → servisní kontext)' },
  'marketing.editorial_articles': { cat: 'SYSTEM', grants: ['INSERT', 'UPDATE'], why: 'redakční články platformy (veřejný obsah)' },
  'marketing.fan_bonus_issued': { cat: 'TENANT', read: (t) => `(${rel(t)}.user_id = ${CUR_U} OR ${eventOwn(t, 'event_id')})`, why: 'vydané fan bonusy (uživatel + akce); zápis jen servis' },
  'marketing.promo_codes': { cat: 'TENANT', skip: true, why: 'promo kódy pořadatele (created_by_organizer_id) — řeší migrace 481 (V8)' },
  'marketing.qr_scans': { cat: 'TENANT', read: (t) => `EXISTS (SELECT 1 FROM marketing.qr_campaigns q JOIN catalog.events e ON e.id = q.event_id WHERE q.id = ${rel(t)}.campaign_id AND e.promoter_id = ${CUR_P})`, why: 'skeny QR kampaní pořadatele; zápis jen servis (qr/[slug] → servisní kontext)' },
  'marketing.transit_partners': { cat: 'SYSTEM', why: 'číselník dopravních partnerů' },
  'marketing.web_vitals': { cat: 'SYSTEM', grants: ['INSERT'], why: 'výkonová telemetrie stránek (bez osobních údajů)' },
  'orders.foyer_orders': { cat: 'TENANT', own: (t) => `(${eventOwn(t, 'event_id')} OR ${orderVis(t, 'order_id')})`, why: 'objednávky z foyer (akce + objednávka kupce)' },
  'orders.gift_claims': { cat: 'TENANT', own: (t) => orderVis(t, 'order_id'), why: 'uplatnění dárků (objednávka)' },
  'orders.lottery_entries': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM orders.lottery_campaigns c WHERE c.id = ${rel(t)}.campaign_id AND c.promoter_id = ${CUR_P})`, why: 'přihlášky do losování (e-maily) kampaně pořadatele' },
  'orders.payment_installments': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM orders.order_payment_plans pp JOIN orders.orders o ON o.id = pp.order_id WHERE pp.id = ${rel(t)}.order_payment_plan_id)`, why: 'splátky objednávky (viditelnost dle objednávky)' },
  'orders.reschedule_responses': { cat: 'TENANT', own: (t) => orderVis(t, 'order_id'), why: 'odpovědi kupců na přesun akce' },
  'orders.reseller_sales': { cat: 'TENANT', own: (t) => orderVis(t, 'order_id'), why: 'prodeje přes prodejce (objednávka)' },
  'orders.season_pass_uses': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'použití permanentek na akci' },
  'orders.season_passes': { cat: 'TENANT', own: (t) => orderVis(t, 'order_id'), why: 'permanentky (objednávka, držitel)' },
  'orders.waiting_list': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'čekací listina akce (e-maily)' },
  'partner.partner_tokens': { cat: 'LOCKED', why: 'tokeny partnerů (tajemství); jen admin/servis' },
  'platform.advance_payout_installments': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM platform.advance_payout_schedules s WHERE s.id = ${rel(t)}.schedule_id AND s.promoter_id = ${CUR_P})`, why: 'splátky zálohové výplaty pořadatele' },
  'platform.dashboard_widgets': { cat: 'SYSTEM', why: 'katalog widgetů dashboardu' },
  'platform.distribution_access_tokens': { cat: 'LOCKED', why: 'přístupové tokeny distribučních partnerů (tajemství); NOCTX cesty → servisní kontext' },
  'platform.distribution_partners': { cat: 'LOCKED', why: 'distribuční partneři (client_secret_hash); NOCTX cesty → servisní kontext' },
  'platform.incident_updates': { cat: 'SYSTEM', grants: ['INSERT'], why: 'veřejná status stránka platformy' },
  'platform.incidents': { cat: 'SYSTEM', grants: ['INSERT', 'UPDATE', 'DELETE'], why: 'veřejná status stránka platformy' },
  'platform.publish_sold_notifications': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'notifikace prodeje akce' },
  'platform.purchase_agents': { cat: 'USER', own: (t) => `${rel(t)}.owner_user_id = ${CUR_U}`, why: 'nákupní AI agenti uživatele' },
  'platform.reseller_partners': { cat: 'TENANT', read: () => `${CUR_P} IS NOT NULL`, why: 'prodejní partneři (password_hash, api_key); čtení pořadatelem (distribuce), zápis admin/servis; reseller/auth → servisní kontext' },
  'pricing.price_adjustment_log': { cat: 'TENANT', own: (t) => eventOwn(t, 'event_id'), why: 'log úprav cen akce' },
  'social_graph.friend_requests': { cat: 'USER', own: (t) => `(${rel(t)}.from_user_id = ${CUR_U} OR ${rel(t)}.to_user_id = ${CUR_U})`, why: 'žádosti o přátelství' },
  'social_graph.friendships': { cat: 'USER', own: (t) => `(${rel(t)}.user_a = ${CUR_U} OR ${rel(t)}.user_b = ${CUR_U})`, why: 'přátelství uživatelů' },
  'tickets.wristband_transactions': { cat: 'TENANT', own: (t) => `EXISTS (SELECT 1 FROM tickets.wristbands w WHERE w.uid = ${rel(t)}.wristband_uid)`, why: 'transakce náramků (viditelnost dle náramku → vstupenka)' },
};

// ─── nepoužívané tabulky: SYSTEM vs LOCKED ───────────────────────────────────
const SYSTEM_UNUSED = {
  'b2b.sandbox_fixtures': 'testovací data sandboxu API',
  'benefit_payments.providers': 'číselník benefitních poskytovatelů',
  'channels.channel_providers': 'číselník prodejních kanálů',
  'monitoring.status_incidents': 'veřejné incidenty platformy',
  'monitoring.system_components': 'komponenty platformy (status)',
  'platform.config': 'globální konfigurace platformy',
  'platform.currencies': 'číselník měn',
  'platform.exchange_rates': 'kurzy měn',
  'resources.resource_hub': 'veřejný obsah (návody, ke stažení)',
  'risk.fraud_rules': 'globální pravidla antifraud',
  'risk.velocity_limits': 'globální limity rychlosti',
};

const rows = [];
let sql = `-- 482_rls_tables_without_rls.sql — kolo 2 / krok 3B (GENEROVÁNO audit/r2/gen-482.mjs)
--
-- Audit L7: 156 tabulek bez RLS čitelných (i zapisovatelných) rolí tixly_app bez ohledu na tenanta.
-- Tabulky s daty tenantu nebo uživatele: RLS + politiky (svc/admin + vlastník [+ veřejné čtení]).
-- Systémové a číselníkové tabulky: bez RLS, tixly_app jen SELECT (+ zápisy, které kód dělá).
-- Navíc: tixly_app ztrácí TRUNCATE na všech tabulkách (TRUNCATE obchází RLS; kód ho nepoužívá).
-- Rozhodnutí a odůvodnění po tabulkách: logs/r2/3B_tables_decision.md. Idempotentní.

BEGIN;
`;
const pol = (t, name, cmd, using, check) => {
  const r = rel(t);
  let s = `DROP POLICY IF EXISTS ${name}_${r} ON ${t};\nCREATE POLICY ${name}_${r} ON ${t} FOR ${cmd}`;
  if (using) s += `\n  USING (${using})`;
  if (check) s += `\n  WITH CHECK (${check})`;
  return s + ';\n';
};

for (const u of usage) {
  const t = u.t;
  const d = D[t] ?? (SYSTEM_UNUSED[t] ? { cat: 'SYSTEM', why: SYSTEM_UNUSED[t] } : { cat: 'LOCKED', why: u.files.length ? '!!! CHYBÍ ROZHODNUTÍ' : 'data tenantu/uživatele bez použití v kódu' });
  if (d.why.startsWith('!!!')) throw new Error(`chybí rozhodnutí pro používanou tabulku ${t}`);
  const o = ops[t];
  const used = u.files.length ? `${u.files.length} soub., S${o?.S ?? 0}/I${o?.I ?? 0}/U${o?.U ?? 0}/D${o?.D ?? 0}` : 'nepoužívá';
  sql += `\n-- ${t}  [${d.cat}] ${d.why}\n`;
  if (d.cat === 'SYSTEM') {
    sql += `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ${t} FROM tixly_app;\nGRANT SELECT ON ${t} TO tixly_app;\n`;
    if (d.grants?.length) sql += `GRANT ${d.grants.join(', ')} ON ${t} TO tixly_app;\n`;
    rows.push([t, 'systémová/číselník', 'bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE', `bez RLS; tixly_app SELECT${d.grants?.length ? ' + ' + d.grants.join('/') : ''}`, used, d.why]);
    continue;
  }
  sql += `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;\n`;
  sql += pol(t, 'svc_admin', 'ALL', SA, SA);
  let after = 'RLS: svc/admin';
  if (d.custom === 'audit_log') {
    // append-only: zápis smí každý kontext (immutabilitu drží triggery), čtení jen admin/servis,
    // pořadatel akce svých členů a pořadatel u objednávek své akce (detail objednávky).
    sql += pol(t, 'append', 'INSERT', null, 'true');
    sql += pol(t, 'tenant_read', 'SELECT',
      `EXISTS (SELECT 1 FROM platform.promoter_members m WHERE m.user_id = audit_log.actor_id AND m.promoter_id = ${CUR_P})
   OR (audit_log.schema_name = 'orders' AND audit_log.table_name = 'orders'
       AND EXISTS (SELECT 1 FROM orders.orders o JOIN catalog.events e ON e.id = o.event_id
                    WHERE o.id::text = audit_log.record_id AND e.promoter_id = ${CUR_P}))`, null);
    after += ' + INSERT všem (append-only) + čtení pořadatel (své členy / své objednávky)';
  } else {
    if (d.own) { sql += pol(t, 'owner', 'ALL', d.own(t), d.own(t)); after += ` + vlastník (${d.cat === 'USER' ? 'uživatel' : 'pořadatel'})`; }
    if (d.read) { sql += pol(t, 'read', 'SELECT', d.read(t), null); after += d.read(t) === 'true' ? ' + veřejné čtení' : ' + čtení (viz migrace)'; }
  }
  sql += `REVOKE TRUNCATE ON ${t} FROM tixly_app;\n`;
  rows.push([t, d.cat === 'USER' ? 'data uživatele' : d.cat === 'LOCKED' ? 'data tenantu/uživatele (zamčeno)' : 'data tenantu', 'bez RLS; tixly_app čte/zapisuje vše', after, used, d.why]);
}

sql += `
-- TRUNCATE obchází RLS — tixly_app ho nepoužívá (grep src: 0 výskytů) → odebrat všude.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
              AND has_table_privilege('tixly_app', c.oid, 'TRUNCATE')
  LOOP
    EXECUTE format('REVOKE TRUNCATE ON %I.%I FROM tixly_app', r.nspname, r.relname);
  END LOOP;
END $$;

COMMIT;
`;
writeFileSync('migrations/482_rls_tables_without_rls.sql', sql);
const cnt = rows.reduce((a, r) => { a[r[1]] = (a[r[1]] ?? 0) + 1; return a; }, {});
let md = `# Krok 3B — 156 tabulek bez RLS: rozhodnutí (generováno audit/r2/gen-482.mjs)\n\nSouhrn: ${JSON.stringify(cnt)}\n\n| tabulka | kategorie | stav před | stav po | použití v kódu | odůvodnění |\n|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| \`${r[0]}\` | ${r[1]} | ${r[2]} | ${r[3]} | ${r[4]} | ${r[5]} |\n`;
writeFileSync('logs/r2/3B_tables_decision.md', md);
console.log('tables', rows.length, cnt);
