# Krok 3B — 156 tabulek bez RLS: rozhodnutí (generováno audit/r2/gen-482.mjs)

Souhrn: {"data tenantu/uživatele (zamčeno)":83,"data tenantu":50,"systémová/číselník":20,"data uživatele":3}

| tabulka | kategorie | stav před | stav po | použití v kódu | odůvodnění |
|---|---|---|---|---|---|
| `accessibility.companion_pairs` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `accreditation.accreditation_scans` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `affiliate.clicks` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `affiliate.payouts` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `ambassador.codes` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `ambassador.payouts` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `analytics.audience_geo` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S1/I1/U0/D0 | geodata kupců akce (event_id) |
| `analytics.event_sales_snapshots` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S0/I1/U0/D0 | prodejní snapshoty akce |
| `audit.audit_log` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + INSERT všem (append-only) + čtení pořadatel (své členy / své objednávky) | 27 soub., S6/I27/U0/D0 | auditní stopa se starými/novými hodnotami (osobní údaje) všech tenantů; append-only |
| `audit.content_reports_rate_limit` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `audit.support_actions` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I1/U0/D0 | zásahy podpory pořadatele (actor_promoter_id) |
| `b2b.api_rate_limit_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | 1 soub., S1/I1/U0/D0 | log volání API klientů tenantů; píše/čte jen servis |
| `b2b.oauth_clients` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 6 soub., S8/I1/U1/D1 | OAuth aplikace pořadatele/uživatele (secret); kupec čte aplikace, kterým udělil přístup |
| `b2b.sandbox_fixtures` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | testovací data sandboxu API |
| `b2b.webhook_deliveries` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `b2b.webhook_subscriptions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | 1 soub., S1/I1/U0/D0 | webhooky API klientů; jen servis (v3 API) |
| `benefit_payments.providers` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | číselník benefitních poskytovatelů |
| `brands.advertisers` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT | 5 soub., S5/I1/U0/D0 | adresář inzerentů platformy (ne data tenantu); čtou ho pořadatelé v nabídkách |
| `brands.campaigns` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT/UPDATE | 8 soub., S6/I1/U4/D0 | katalog kampaní inzerentů platformy nabízený pořadatelům |
| `brands.impressions` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S0/I1/U0/D0 | impresse na akci pořadatele |
| `catalog.ab_price_assignments` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S0/I1/U0/D0 | A/B přiřazení cen (přes ab_price_tests → ticket_type) |
| `catalog.ab_price_tests` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S2/I1/U0/D0 | A/B test cen typu vstupenky |
| `catalog.access_code_ticket_types` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 3 soub., S6/I1/U0/D0 | vazba přístupových kódů pořadatele |
| `catalog.backstage_moments` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 6 soub., S6/I1/U1/D1 | backstage obsah akce; veřejně čten (NOCTX /api/backstage) u publikované akce |
| `catalog.cinema_screens` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + veřejné čtení | 4 soub., S6/I1/U1/D1 | plátna kina místa; veřejné údaje (NOCTX /api/cinema) |
| `catalog.commemorative_templates` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 4 soub., S4/I1/U0/D0 | šablony pamětních vstupenek akce |
| `catalog.discount_pricing_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I0/U0/D0 | cenová pravidla typu vstupenky |
| `catalog.dynamic_pricing_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 4 soub., S5/I1/U0/D1 | dynamické ceny typu vstupenky |
| `catalog.event_bundle_addons` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 3 soub., S5/I1/U0/D0 | doplňky balíčků akce; veřejně čteny (NOCTX /api/events/[id]/bundles) |
| `catalog.flex_pass_settings` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 6 soub., S7/I1/U0/D1 | nastavení flex passu typu; veřejně čteno (ticket-types) |
| `catalog.foyer_menu_items` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 3 soub., S4/I1/U2/D1 | menu foyer akce; veřejně čteno |
| `catalog.group_discount_tiers` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 5 soub., S7/I2/U0/D1 | skupinové slevy typu (veřejná informace) |
| `catalog.lastminute_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S3/I1/U2/D1 | last-minute pravidla akce |
| `catalog.member_pricing_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 3 soub., S4/I1/U0/D1 | členské ceny typu |
| `catalog.moderation_blocklist` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | 3 soub., S2/I0/U0/D0 | globální seznam zakázaných slov moderace |
| `catalog.pricing_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I0/U0/D0 | cenová pravidla typu |
| `catalog.pricing_windows` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S2/I1/U0/D0 | cenová okna typu |
| `catalog.program_cast_entries` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `catalog.seats` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + veřejné čtení | 3 soub., S5/I0/U5/D0 | sedadla místa (fyzika sálu, veřejná); zápis jen vlastník místa |
| `catalog.ticket_modular_pricing` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 3 soub., S2/I0/U0/D0 | modulární ceny; veřejně čteny (modular-pass) |
| `catalog.ticket_type_access` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 5 soub., S4/I2/U0/D1 | přístupová matice typu; veřejně čtena (stránka akce) |
| `catalog.ticket_type_channel_prices` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S3/I1/U0/D1 | ceny typu podle kanálu |
| `catalog.ticket_type_price_history` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S1/I1/U0/D0 | historie cen typu |
| `catalog.venue_seating_charts` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + veřejné čtení | 17 soub., S18/I5/U5/D0 | plánek sálu (veřejný, NOCTX /seats); zápis jen vlastník místa |
| `catalog.volume_discount_rules` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S4/I1/U0/D2 | množstevní slevy typu |
| `channels.channel_providers` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | číselník prodejních kanálů |
| `channels.sync_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `communications.announcement_responses` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S2/I1/U1/D0 | odpovědi kupců na krizová oznámení pořadatele |
| `conference.badge_overrides` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.badge_print_jobs` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.badge_templates` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.booth_categories` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.booths` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.days` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.floor_maps` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.session_speakers` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.sessions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `conference.tracks` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `cs.action_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `cs.notes` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `discovery_feed.feed_access_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `event_groups.bulk_edits` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S0/I2/U0/D0 | hromadné úpravy skupiny akcí |
| `event_groups.shares` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) + čtení (viz migrace) | 2 soub., S1/I1/U1/D0 | sdílení skupin mezi pořadateli |
| `eventim_export.export_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `identity.verified_persons` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `lineups.artist_profiles` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `marketing.ad_auction_log` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + čtení (viz migrace) | 2 soub., S2/I1/U0/D0 | log aukce reklam (zobrazení u pořadatele); zápis jen servis (ads/click → servisní kontext) |
| `marketing.editorial_articles` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT/UPDATE | 5 soub., S7/I1/U2/D0 | redakční články platformy (veřejný obsah) |
| `marketing.fan_bonus_issued` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + čtení (viz migrace) | 2 soub., S3/I1/U0/D0 | vydané fan bonusy (uživatel + akce); zápis jen servis |
| `marketing.promo_codes` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS (migrace 481): svc/admin + pořadatel vlastník (created_by_organizer_id) | 11 soub., S11/I1/U4/D0 | promo kódy pořadatele (created_by_organizer_id) — řeší migrace 481 (V8) |
| `marketing.qr_scans` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + čtení (viz migrace) | 1 soub., S0/I1/U0/D0 | skeny QR kampaní pořadatele; zápis jen servis (qr/[slug] → servisní kontext) |
| `marketing.transit_partners` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | 2 soub., S5/I0/U0/D0 | číselník dopravních partnerů |
| `marketing.web_vitals` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT | 1 soub., S0/I1/U0/D0 | výkonová telemetrie stránek (bez osobních údajů) |
| `monitoring.status_incidents` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | veřejné incidenty platformy |
| `monitoring.system_components` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | komponenty platformy (status) |
| `orders.foyer_orders` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 7 soub., S4/I1/U1/D0 | objednávky z foyer (akce + objednávka kupce) |
| `orders.gift_claims` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 3 soub., S3/I1/U1/D0 | uplatnění dárků (objednávka) |
| `orders.lottery_entries` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 7 soub., S11/I1/U5/D0 | přihlášky do losování (e-maily) kampaně pořadatele |
| `orders.payment_installments` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 4 soub., S5/I2/U3/D0 | splátky objednávky (viditelnost dle objednávky) |
| `orders.program_purchases` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `orders.reschedule_responses` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 3 soub., S4/I1/U1/D0 | odpovědi kupců na přesun akce |
| `orders.reseller_sales` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 5 soub., S4/I1/U1/D0 | prodeje přes prodejce (objednávka) |
| `orders.season_pass_uses` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I1/U0/D0 | použití permanentek na akci |
| `orders.season_passes` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 4 soub., S6/I1/U1/D0 | permanentky (objednávka, držitel) |
| `orders.waiting_list` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 8 soub., S11/I1/U5/D0 | čekací listina akce (e-maily) |
| `partner.partner_settlements` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `partner.partner_tokens` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | 3 soub., S2/I2/U1/D0 | tokeny partnerů (tajemství); jen admin/servis |
| `platform.advance_payout_installments` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I1/U0/D0 | splátky zálohové výplaty pořadatele |
| `platform.api_key_audit_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `platform.config` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | globální konfigurace platformy |
| `platform.currencies` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | číselník měn |
| `platform.dashboard_widgets` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | 1 soub., S1/I0/U0/D0 | katalog widgetů dashboardu |
| `platform.distribution_access_tokens` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | 2 soub., S2/I1/U0/D1 | přístupové tokeny distribučních partnerů (tajemství); NOCTX cesty → servisní kontext |
| `platform.distribution_partners` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | 4 soub., S3/I1/U2/D0 | distribuční partneři (client_secret_hash); NOCTX cesty → servisní kontext |
| `platform.exchange_rates` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | kurzy měn |
| `platform.incident_updates` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT | 2 soub., S1/I1/U0/D0 | veřejná status stránka platformy |
| `platform.incidents` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT + INSERT/UPDATE/DELETE | 4 soub., S4/I1/U2/D1 | veřejná status stránka platformy |
| `platform.publish_sold_notifications` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 1 soub., S1/I1/U2/D0 | notifikace prodeje akce |
| `platform.purchase_agents` | data uživatele | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (uživatel) | 3 soub., S2/I1/U1/D0 | nákupní AI agenti uživatele |
| `platform.reseller_partners` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + čtení (viz migrace) | 7 soub., S6/I1/U2/D0 | prodejní partneři (password_hash, api_key); čtení pořadatelem (distribuce), zápis admin/servis; reseller/auth → servisní kontext |
| `platform.staff_permissions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `platform.staff_roles` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `platform.webhook_deliveries` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `pos.pos_reconciliations` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `pos.tap_to_pay_transactions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `pricing.price_adjustment_log` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 2 soub., S1/I1/U0/D0 | log úprav cen akce |
| `referral.clicks` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `resale.resale_rules_overrides` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.availability_overrides` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.availability_rules` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.branch_closures` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.branch_hours` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.branch_service_availability` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.branch_settings` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.package_credit_balances` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.package_usage` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.rule_actions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.rule_conditions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.service_addons` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.service_pricing_rules` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.service_resources` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `reservations.slots` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `resources.resource_hub` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | veřejný obsah (návody, ke stažení) |
| `retailer.settlements` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `rfid.rfid_taps` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `rfid.rfid_top_ups` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `risk.fraud_reviews` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `risk.fraud_rules` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | globální pravidla antifraud |
| `risk.velocity_limits` | systémová/číselník | bez RLS; tixly_app SELECT/INSERT/UPDATE/DELETE/TRUNCATE | bez RLS; tixly_app SELECT | nepoužívá | globální limity rychlosti |
| `social_graph.friend_requests` | data uživatele | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (uživatel) | 3 soub., S3/I1/U3/D0 | žádosti o přátelství |
| `social_graph.friendships` | data uživatele | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (uživatel) | 3 soub., S3/I1/U0/D0 | přátelství uživatelů |
| `support_chat.chat_messages` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `support_chat.session_feedback` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `tickets.access_token_log` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `tickets.wristband_transactions` | data tenantu | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin + vlastník (pořadatel) | 4 soub., S1/I3/U0/D0 | transakce náramků (viditelnost dle náramku → vstupenka) |
| `tours.series_metrics` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `tours.shared_seat_maps` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.court_bookings` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.courts` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.daily_capacity` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.daily_tickets` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.entry_slots` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.escape_rooms` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.facility_zones` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.game_results` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.guest_passes` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.leaderboard_entries` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.lift_scans` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.locker_reservations` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.ski_pass_types` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.ski_school_sessions` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.ticket_types` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.venue_zones` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `venues.zone_access` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `virtual_venue.seat_previews` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
| `virtual_venue.section_panoramas` | data tenantu/uživatele (zamčeno) | bez RLS; tixly_app čte/zapisuje vše | RLS: svc/admin | nepoužívá | data tenantu/uživatele bez použití v kódu |
