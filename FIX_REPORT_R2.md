# FIX_REPORT_R2 — kolo 2 oprav Tixly

**Větev:** `fix/round2-2026-10-01` (worktree `../tixly-fix`, založena z `1a6e96d`).
**Prostředí:** izolovaná Postgres 17 + PostGIS z migrací od nuly (`fix-pg` :55632), PgBouncer v transaction módu (`fix-pgb` :56633), Mailpit (`fix-mail`), Redis (`fix-redis`), simulátor bran `tests/helpers/fake-gopay.mjs` (:3998 — GoPay + nově PayPal/Stripe/Triple-A/Wise/Mollie). Aplikace i testy vždy pod rolí **`tixly_app`** (NOBYPASSRLS). K produkční DB ani produkčním službám se nic nepřipojilo (testy webhooků mají pojistku: fetch mimo localhost test shodí). Pracovní strom `tixly/` jsem neměnil.
**Testy:** standardní sada `nextjs-boilerplate/tests/fix-r2-*.live.test.ts` (gate `FIX_E2E=1`), vše přes skutečný `src/middleware.ts` (helper `tests/helpers/through-middleware.ts`). Logy: `logs/r2/`, auditní výstupy `audit/logs/r2_*`.

> **Důležité k závěru:** finální řetěz (typecheck → unit → live → kompletní auditní E2E) **ukončil systém kvůli nedostatku paměti** (Claude Code ho zastavil během nečinnosti). Typecheck a unit sada doběhly celé, live sada jen částečně a **závěrečná auditní E2E sada po krocích 4–5 se nespustila**. Podle pokynu ho sám znovu nespouštím. Sekce 5 proto uvádí přesně, co je doloženo z běhů po jednotlivých krocích a co ve finálním běhu chybí.

---

## 1. Krok A — stav před touto session

- Worktree `../tixly-fix` existoval na `fix/critical-2026-09-30` @ `1a6e96d`, bez necommitnutých změn.
- Větev `fix/round2-2026-10-01`, `PROGRESS_R2.md` ani `FIX_REPORT_R2.md` **neexistovaly → z kola 2 nebylo hotové nic.** Větev jsem založil z `1a6e96d`.
- Kontejnery kola 1 (DB, Mailpit, Redis) neexistovaly; běžely jen osiřelé `next start :3200` a fake-gopay z kola 1 → ukončeny. Infrastrukturu jsem postavil znovu od nuly z migrací (`logs/r2/A_migrate_from_zero.txt`, 25/25 OK).

## 2. Krok 0 — ověření kola 1, auditní skripty, x-user-id

Úpravy auditních skriptů (jen testy, commit `8d97de9`): `lib.mjs` `scenarioBuyer()` — vlastní e-mail i IP na scénář (per-e-mail limit 5 pending a per-IP 10/10 min z K3), náhodný start IP mezi běhy; skripty 02/03/04/05/06/10/11 používají kupce na scénář; R1c opravený dotaz (`audit.audit_log` nemá `entity_id` → `schema_name/table_name/record_id` + `new_values.kind='refund'`); 10 nově D5/D6 (kiosk); `12-cron-expire-probe.mjs` = skriptovaná sonda `s3_cron_expire_probe`.

| Scénář | Stav | Důkaz |
|---|---|---|
| s3_e2e_10 D1 upgrade bez platby | PASS (404, 0 volání brány) | `audit/logs/r2_e2e_10.out` |
| s3_e2e_10 D2 voucher confirm | PASS (404, voucher pending) | tamtéž |
| s3_e2e_10 D3b subscription confirm | PASS (404, holder pending) | tamtéž |
| s3_e2e_10 D3a oficiální checkout předplatného | FAIL v kroku 0 → opraveno v kroku 5 (S8) | tamtéž; `logs/r2/5_s8_*` |
| s3_e2e_10 D4 resale bez platby | PASS (404, listing active) | tamtéž |
| kiosk D5 (anon) / D6 (podvržené x-user-id obsluhy) | PASS / PASS (401, 0 objednávek) | tamtéž |
| e2e_02:P15a cron expirace | PASS (expired, 4 místa zpět) | `r2_e2e_02.out` |
| s3_cron_expire_probe (12) | PASS E1–E4 (HTTP 200, 9/9 expired, GA 4→20, sedadla volná) | `r2_e2e_12.out` |
| e2e_03:R1b refund volá bránu | PASS (1 volání, brána REFUNDED) | `r2_e2e_03.out` |
| e2e_03:R1c auditní stopa refundu | PASS (záznam `kind=refund`) | `r2_e2e_03.out` |
| e2e_04:X14 zapomenuté heslo | PASS (200) | `r2_e2e_04_app.out` |
| e2e_05:C5 rate limit nákupu | PASS (10×200, 50×429) | `r2_e2e_05.out` |

**Podvržení x-user-id:** nepřihlášený POST `/api/kiosk/order` s ručně nastaveným `x-user-id` (+ `x-is-admin`, `x-is-platform-admin`) existující obsluhy → **401, žádná objednávka, kapacita beze změny** (`tests/fix-r2-identity-headers.live.test.ts`, přes skutečný middleware). Middleware `x-user-id/x-is-admin/x-is-platform-admin` stripoval správně na všech větvích. **Inventura všech hlaviček, které API čte, ale odhalila `x-vercel-cron`:** middleware ji nestripoval a `cron/resale-payouts` (označuje výplaty paid), `cron/pricing-engine` (přepisuje ceny) a `cron/inventory-refresh` ji braly jako autentizaci → bez tajemství **200**. Opraveno (`43871e0`): middleware ji zahazuje, nový `lib/security/cron-auth.ts` (jen `CRON_SECRET`, timing-safe, fail-closed), dispatch bez `CRON_SECRET` fail-closed; `admin/gift-cards` četla `x-is-platform-admin`, které middleware nikdy nenastavuje (vždy 403) → `x-is-admin` z JWT. RED 9/10 (`resale-payouts` s podvrženou hlavičkou 200) → GREEN 10/10 (`logs/r2/0_identity_*`).

---

## 3. Nálezy kroků 1–5

Číslování migrací kola 2 od **480** — uživatel má necommitnuté migrace 472–478 (kolo 1 už kolidovalo na `472_refund_gateway_state.sql` × `472_royalty_agreements_currency.sql`). Každá migrace ověřena **od nuly** (`PGC=fix-pg sh audit/db/migrate-from-zero.sh`, poslední běh 31/31) a **2× nad stávajícím schématem**.

### Krok 1 — webhooky fail-closed (`81aa2b7`)
- **Příčina:** PayPal bez `PAYPAL_WEBHOOK_ID` podpis neověřoval a událost zpracoval; Wise bez tajemství `return true` a navíc ověřoval HMAC, ačkoli Wise podepisuje **RSA-SHA256** (ověřeno oficiálním příkladem `transferwise/digital-signatures-examples`) a stav četl z pole, které payload v2 nemá; GoPay/ComGate braly nulovou/chybějící částku jako „pokrývá" (+ GoPay mimo produkci DEV_STUB `paid:true`); Stripe a Triple-A značily paid podle těla události (Stripe částku nekontroloval vůbec); Mollie/P24 vracely 5xx (P24 nezachycená výjimka); benefit callbacky šly v produkci obejít env přepínači, Pluxee pod `tixly_app` neviděla data (i legitimní callback 404) a vendor dostával URL zakázané generické routy; QES mock provider (výchozí) přijal cokoli i v produkci → smlouva pořadatele „podepsána"; PayPal capture nevázal token na objednávku.
- **Změny:** všech 11 příchozích rout + `lib/payment/{paypal,triplea,mollie,benefits,benefit-providers/pluxee}.ts`, `lib/payouts/wise.ts`, `lib/qes/*`; base URL bran přepisitelné env (testy proti simulátoru). Před `paid` dotaz na API brány: PayPal `GET /v2/checkout/orders/{id}`, Stripe `GET /v1/checkout/sessions/{id}`, Triple-A `GET /payment/{ref}` (endpoint ověřen z oficiálního pluginu), Wise `GET /v1/transfers/{id}`; GoPay/ComGate/Mollie/P24 už API ověřovaly. Přísná částka `>0 && ≥ total` + měna.
- **Test:** `tests/fix-r2-webhooks.live.test.ts` — bez podpisu / špatný podpis / chybějící tajemství / neznámý formát → 4xx, objednávka pending, 0 vstupenek; legitimní cesty paid.
- **RED → GREEN:** 16/29 + QES (`logs/r2/1_webhooks_RED.txt`, `1_qes_RED.txt`: mock QES v produkci 200) → 29/29; HTTP audit 02 P4–P10b PASS.

### Krok 2 — V2 pod `tixly_app` (`c3c9b8e`, migrace **480**)
| Případ | Přesná příčina | Oprava |
|---|---|---|
| PDF (P7d/X2) | `ticket-pdf` dotazoval **bez RLS kontextu** → objednávka neviditelná → 404 | `runWithUserContext`; jen čtení vstupenek (dřív issuer, který by při prázdném výsledku vstupenky vystavil z požadavku kupce) |
| Storno (X3) | `orders.refund_requests` bez politiky pro kupce → INSERT 42501 | 480: kupec čte své žádosti, zakládá jen na vlastní objednávku (user_id + promotér akce) |
| POS (OP1) | `INSERT identity.users … RETURNING` — RETURNING vyžaduje SELECT viditelnost; walk-in ještě nemá objednávku (ověřeno sondou `logs/r2/2_pos_probe.out.txt`) | id v aplikaci, INSERT bez RETURNING |
| Self-refund (OP5a) | `platform.refund_policies` jen pro promotéra → LEFT JOIN NULL → 403 | 480: kupec čte politiku promotéra, u kterého má objednávku |
| (navíc) | sonda ukázala, že promotérský kontext smí vložit **platform admina s heslem** | 480: `p_users_promoter_insert` jen bez admin práv a s heslem-sentinelem `!` |
Bez SECURITY DEFINER, bez vlastnické role, RLS zapnutá. Test `tests/fix-r2-v2-tixly-app.live.test.ts`: legitimní uspěje, cizí 403/404 + DB vrstva. RED 5/5 → GREEN 5/5.

### Krok 3A — V8 zápis (`2e38967`, migrace **481**)
- **Příčina:** `p_events_promoter_scope`, `p_ticket_types_event_scope`, `p_event_seats_event_scope` FOR ALL s veřejnou větví `status='published'` bez WITH CHECK; `marketing.promo_codes` bez RLS; `orders/order_items/tickets` FOR ALL → kupec vložil paid objednávku do cizí akce.
- **Změna:** čtení beze změny, zápis jen pořadatel-vlastník/admin/servis; promo_codes RLS (`created_by_organizer_id`); INSERT objednávek/položek/vstupenek jen pořadatel akce/admin/servis. Cesty kupce, které systémově měnily kapacitu/sedadla jen díky díře (po opravě by **tiše** zasáhly 0 řádků — ověřeno: kapacita 19≠20): storno, self-refund, výměna, upgrade, mobilní platba → nový `asSystemInTx` (app.role='system' jen pro konkrétní příkaz v transakci, vlastnictví ověřeno předtím pod RLS kupce); storno `FOR UPDATE OF o`.
- **Test:** `tests/fix-r2-v8-rls-write.live.test.ts` (promotér A / kupec A / bez kontextu × akce, ceny, sedadla, promo, objednávky, vstupenky tenantu B). RED 4/5 → GREEN 5/5.

### Krok 3B — 156 tabulek bez RLS (`8c868d3`, migrace **482**, generátor `audit/r2/gen-482.mjs`)
- Rozhodnutí po tabulkách z reálných dat (sloupce, FK, použití v kódu a kontext volajících) — tabulka v sekci 4. 50 data tenantu, 3 data uživatele, 83 zamčeno (data tenantu/uživatele, která kód nepoužívá nebo jen servis/admin), 20 systémových (bez RLS, `tixly_app` jen SELECT + zápisy, které kód dělá), promo_codes v 481. `tixly_app` ztratil **TRUNCATE na všech 599 tabulkách** (obchází RLS; kód ho nepoužívá). NOCTX cesty nad zamčenými tabulkami → servisní kontext: `ads/click`, `qr/[slug]`, `v2/distribution/*`, `reseller/auth`.
- **Test:** `tests/fix-r2-3b-tables-rls.live.test.ts` (struktura: bez RLS přesně 20 systémových s minimálními právy, TRUNCATE 0; chování na vzorcích tenant/uživatel/zamčeno/audit/systém). RED 8/8 → GREEN 8/8.

### Krok 4 — V9 / R-56 (`8713d13`)
- **Příčina:** `connect()` nastavoval GUC session-level a spoléhal na samostatný přímý pool (`DATABASE_URL_DIRECT` / host `-pooler.`).
- **Změna:** `lib/db/rls-pool.ts` — jeden pool, kontext `set_config(...,true)` uvnitř transakce: BEGIN volajícího + GUC v jednom round-tripu, autocommit příkaz obalen implicitní transakcí, release s otevřenou transakcí → ROLLBACK. Při ladění nalezeno: pg-pool obnovuje při výpůjčce jen `release()`, ne `query()` → wrapper by se vrstvil na wrapper předchozího držitele (s jeho kontextem) — opraveno přes Symbol. `tests/rls-pool-pooler.live.test.ts` (Neon-gated) přepsán na novou přísnější záruku.
- **Test:** `tests/fix-r2-r56-pool.live.test.ts` — PgBouncer transaction mode, **bez** `DATABASE_URL_DIRECT`, 200 souběžných requestů (100 uživatelů / 10 tenantů) ve 3 vzorech. **RED:** `connect()+BEGIN` 173/200, autocommit 193/200 vidělo cizí data. **GREEN:** 0/200 ve všech vzorech, 0 chyb, spojení po vrácení bez kontextu (4/4).

### Krok 5
| Nález | Příčina | Změna | Test | RED → GREEN |
|---|---|---|---|---|
| **V4** scan_logs (`68c4090`, mig. **483**) | CHECK `scan_result` nepovoloval hodnoty, které skener zapisuje (`admitted/already_used/denied`); `scanned_by_device_id uuid NOT NULL`; fire-and-forget | 483: zařízení volitelné + `device_label`, CHECK rozšířen; `logScan` awaitovaný | `fix-r2-v4-scan-logs` | 5 skenů → **0** řádků → 5/5 |
| **S1** payment_paid (`bc098b6`, mig. **484**) | každé doručení webhooku = nový řádek; tabulka neměnná (nelze unique bez přepisu historie) | 484: `dedupe_key` + BEFORE INSERT trigger + parciální UNIQUE; 16 zápisů `ON CONFLICT DO NOTHING` | `fix-r2-s1-payment-paid-once` | 3 záznamy → 1 (postupně, souběžně, přímý INSERT) |
| **V6** 0 Kč (`d23d4da`) | checkout pro 0 zakládal platbu u brány → navždy pending | `totalAmount===0` (serverový výpočet) → paid/`free` před COMMIT, in-process `order-completed` (vstupenky + e-mail) | `fix-r2-v6-free-ticket` | platba u brány založena → 0 Kč paid, 1 vstupenka, e-mail v Mailpitu; placený typ s podvrženou 0 → pending, 50000 u brány |
| **S8** checkout předplatného (`cc949bb`) | `ON CONFLICT (email)` na parciálním unique indexu; DO UPDATE přepisoval cizí účet | sdílený `createOrGetGuestUser` | `fix-r2-s8-subscription-checkout` + unit | live: ON CONFLICT 500 → 2/2; unit 6 červených → **7/7 bez změny asercí** (příčina červené: mock nerozuměl řídicím příkazům rls-pool — mock rozšířen) |
| **P1** cart/validate (`1889775`) | bez volajícího, 500 (42703) | routa odstraněna + záznam z drift baseline; audit P1 čeká 404 | `fix-r2-p1-cart-validate` | 2/2 RED → 2/2 GREEN |
| **QR** výchozí politika (`0995576`, mig. **485**) | default `static_allowed` (DB + API fallback) → stačí UUID | default `rotating_24h` (TOTP povinný u brány od 24 h před akcí po celou akci, PDF zůstává — V2); explicitní `static_allowed` zůstává volbou | `fix-r2-qr-default` | nová akce static + UUID admitted → rotating_24h, bez TOTP `totp_required`, s TOTP admitted |
| navazující: onboarding (`fb73746`) | krok 4 INSERT na neexistující sloupce + CHECK hodnoty `static`/`entertainment`; každý krok `array_remove(jsonb)` | INSERT dle schématu, `completed_steps` jako jsonb | `fix-r2-onboarding` | 42703 → 1/1 |

---

## 4. Tabulky

### Webhook / callback routy (krok 1)

| Routa | Ověření před | Ověření po |
|---|---|---|
| `POST /api/payments/paypal/webhook` | **fail-open:** bez `PAYPAL_WEBHOOK_ID` se podpis neověřoval a událost se zpracovala (RED: 200 + paid); stav i částka brány brány z těla notifikace (RED: API `APPROVED` → paid); neznámý formát → 500 | bez `PAYPAL_WEBHOOK_ID`/API klíčů 401; podpis přes PayPal `verify-webhook-signature` (neplatný 401); validace formátu (400); před `paid` `GET /v2/checkout/orders/{id}` — rozhoduje stav `COMPLETED` a součet COMPLETED capture z API |
| `GET /api/payments/paypal/capture` (návrat kupce) | capture + `paid` podle samotného `?orderId=`; PayPal token nemusel patřit objednávce (RED: cizí schválená PayPal objednávka zaplatila tuto) | token musí = `orders.gopay_payment_id` dané objednávky, kontrola PŘED capture i v UPDATE |
| `POST /api/payments/wise/webhook` (výplaty) | **fail-open:** bez `WISE_WEBHOOK_SECRET` `return true`; navíc špatný algoritmus — HMAC se sdíleným tajemstvím, Wise ale podepisuje **RSA-SHA256** (oficiální příklad); stav čten z `data.resource.status`, reálný payload v2 ho má v `data.current_state` → legitimní notifikace nikdy nezaplatila | RSA-SHA256 ověření veřejným klíčem Wise (`WISE_WEBHOOK_PUBLIC_KEY`, test i s oficiálním sandbox vektorem Wise); bez klíče / API klíče 401; validace formátu 400; stav výplaty jen podle `GET /v1/transfers/{id}` |
| `GET /api/payments/gopay/webhook` | autenticita = dotaz na GoPay API ✔, ALE: nenakonfigurováno mimo produkci → `DEV_STUB paid:true`; v produkci 502 (5xx); částka `≤0` / chybějící brána „pokrývá" cenu (RED: PAID s amount 0 → paid) | bez konfigurace 401 (vždy, i mimo produkci); částka musí být `>0` a `≥ total`, měna musí sedět |
| `POST /api/payments/comgate/webhook` | secret v těle + dotaz na API ✔; bez konfigurace 503 (5xx); stejná díra „částka ≤0 pokrývá" | bez konfigurace 401; přísná částka a měna (jako GoPay) |
| `POST /api/payments/stripe/webhook` | HMAC podpis ✔ (bez secretu odmítnut 400); `paid` čistě z těla události, **částka se nekontrolovala vůbec** (RED: API `unpaid` → paid) | bez `STRIPE_WEBHOOK_SECRET`/`STRIPE_SECRET_KEY` 401, špatný podpis 401, neznámý formát 400; před `paid` `GET /v1/checkout/sessions/{id}`: `payment_status=paid`, `metadata.orderId` = objednávka, `amount_total ≥ total`, měna; výpadek API → 5xx bez zápisu „zpracováno" (Stripe zopakuje) |
| `POST /api/payments/triplea/webhook` | HMAC podpis ✔ (bez secretu 400); stav a částka z těla notifikace, chybějící částka „pokrývá" (RED: API `hold` → paid) | bez konfigurace 401, špatný podpis 401; před `paid` `GET {base}/payment/{payment_reference}` (endpoint ověřen z oficiálního pluginu triplea-dev) — `status`/`payment_tier = good`, `order_amount ≥ total`, měna |
| `POST /api/payments/mollie/webhook` | autenticita = dotaz na Mollie API ✔; bez klíče i neznámá platba → 502 (5xx) | bez `MOLLIE_API_KEY` 401; neznámá platba (4xx od Mollie) → 400; částka `>0` |
| `POST /api/payments/przelewy24/webhook` | SHA-384 podpis + P24 verify API ✔; bez CRC klíče/`sign` → **nezachycená výjimka 500** (RED) | bez CRC klíče 401; validace formátu 400; neplatný podpis 401; P24 verify API zachováno |
| `POST /api/payments/benefit/callback` (generický) | bez podpisu; v produkci blokován, ALE `BENEFIT_MOCK=1` ho otevřel i v produkci | mock jen `BENEFIT_MOCK=1` **a** `NODE_ENV≠production`; servisní kontext |
| `POST /api/payments/benefit/pluxee/callback` | HMAC ✔, ALE `BENEFIT_DEV_SKIP_CALLBACK_VERIFY=1` obcházelo ověření i v produkci; zaplacená částka se nekontrolovala; pod `tixly_app` route neviděla `benefit_payments` (RED: i legitimní callback 404); vendor dostával callback URL na generickou (zakázanou) routu | dev-skip jen mimo produkci; `paidAmountMinor ≥ amount_halire` a CZK, jinak 409 a nic se nemění; servisní kontext; `createPluxeePayment` posílá URL per-provider routy. **Dotaz na stav u Pluxee API není** (vendor dokumentaci nemáme — viz report) |
| `POST /api/qes/webhook` (DocuSign / mock) | **fail-open:** výchozí provider `mock` přijme cokoli i v produkci (RED: 200, smlouva promotéra „podepsána"); DocuSign bez HMAC klíče `return true`; porovnání podpisu `===` | mock webhook v produkci odmítnut (401); DocuSign bez klíče 401; timing-safe porovnání |
| `GET /api/cron/*` s `x-vercel-cron` (krok 0) | hlavička brána jako autentizace | viz krok 0 (43871e0) |

Mimo tabulku (nejsou příchozí webhooky): `admin/webhooks/*`, `platform/webhooks`, `v3/webhooks` = správa ODCHOZÍCH webhooků (autentizovaný admin), OAuth callbacky (`auth/oauth/callback/*`, `admin/facebook/oauth/callback`, `buyer/spotify/callback`, `admin/bank-credentials/psd2/callback`) = návratové body OAuth přihlášení/propojení, ne notifikace o platbě či stavu; v tomto kroku jsem je neauditoval.

### 156 tabulek bez RLS (krok 3B, generováno `audit/r2/gen-482.mjs`, kopie `logs/r2/3B_tables_decision.md`)

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

---

## 5. Výsledky sad

| Sada | Výsledek | Důkaz |
|---|---|---|
| Typecheck `tsc --noEmit` (finální běh) | **1 chyba, předexistující**: `.next/types/app/api/rfid/scan/route.ts` (route exportuje ne-handler `generateRfidDeviceKey`; v `d4b43f4` stejně; soubor je mezi necommitnutými změnami v `tixly/`, proto neměněn). V `src/` 0 chyb. | `logs/r2/F_tsc.txt` |
| Unit/komponentová sada `vitest run` (finální běh) | **514 prošlo, 4 skip, 0 selhalo** (54 souborů). Kolo 1 mělo 508/6 selhání — těch 6 (`subscriptions/checkout/route.test.ts`) je zelených. | `logs/r2/F_unit.txt` |
| Live sada (finální běh) | **neúplná** — systém běh ukončil (paměť). Doběhly: `fix-r2-webhooks` 29/29, `fix-r2-v2-tixly-app` 5/5, `fix-r2-3b-tables-rls` 8/8, `fix-r2-identity-headers` 10/10; Neon-gated soubory skip (bez `NEON_API_KEY`). | `logs/r2/F_live.txt` |
| Live sada — poslední kompletní běh všech `fix-*` (po kroku 4) | **75 prošlo / 4 skip / 0 selhalo** (kola 1+2) | `logs/r2/4_fix_suite.txt` |
| Testy kroku 5 (po commitech) | V4 1/1 (+ sken kola 1), S1 3/3 (+ webhooky 29/29 = 32/32), V6 2/2, S8 live 2/2 + unit 7/7, P1 2/2, QR 3/3 (+ V2 5/5, V4 1/1 = 9/9), onboarding 1/1, R-56 4/4 | `logs/r2/5_*_GREEN.txt`, `4_r56_GREEN.txt` |
| Auditní E2E pod `tixly_app` — **poslední kompletní běh (po kroku 3B, před kroky 4–5)** | **145 PASS / 15 FAIL / 8 INFO** (01, 02, 03, 04, 05, 06, 09, 10, 11, 12) | `logs/r2/3B_audit_suite.txt`, `audit/logs/r2_e2e_*.out` |
| — souběh 100 nákupů na 10 míst | **C1a PASS** (přesně 10), C1b PASS (žádné 5xx) | `audit/logs/r2_e2e_05.out` |
| — idempotence webhooku | **C2a PASS** (50 souběžných volání → přesně 10 vstupenek), C2c PASS (10 e-mailů), P5b/P5c/P5e PASS; C2b/P5d (počet `payment_paid`) v tom běhu FAIL — S1 opraven až potom, ověřen testem `fix-r2-s1` (3/3) | tamtéž |
| Auditní E2E po krocích 4–5 | **NESPUŠTĚNO** (finální řetěz ukončen pro nedostatek paměti) | — |

**Seznam FAIL v posledním kompletním auditním běhu (145/15) a jejich stav:**
- opraveno v kroku 5 po tomto běhu (ověřeno testy, ne auditním HTTP během): P1 (routa odstraněna; skript nyní čeká 404), P5d + C2b (S1), P13 (V6), V12 (V4), D3a (S8);
- mimo zadání kola 2, beze změny: R5 (webhook REFUNDED nezneplatní vstupenky), R6 (platba po expiraci bez nápravy), V9b (sken vstupenky jiné akce téhož pořadatele), X6 (`GET /api/buyer/orders` neexistuje), K3a (S4 — `recompute-dynamic-pricing` bez tokenu), K4d (S3 — refresh token jako access), K5 (N1 — CSRF jen SameSite), K8a (S9);
- X7 (doklad kupci) — **nově zjištěná předexistující vada**: `orders.invoices` má UNIQUE `invoice_number` globálně, ale čísla se generují per pořadatel (`2026-0001`…) → první faktura druhého pořadatele v roce = 500. Neopraveno (mimo zadání).

---

## 6. Co se opravit nepodařilo / zbývá

1. **Závěrečná auditní E2E sada po krocích 4 (R-56) a 5 neproběhla** a finální live sada doběhla jen částečně — běh ukončil systém pro nedostatek paměti; znovu jsem ho bez pokynu nespustil. Vše v krocích 4–5 je ověřeno cílenými testy proti izolované DB, ne celou HTTP sadou. Doporučuji spustit: `sh audit/r2/app.sh build && sh audit/r2/app.sh start && sh audit/r2/run.sh 01 02 03 04 05 06 09 10 11 12` a `FIX_E2E=1 FIX_PGBOUNCER_URL=postgresql://tixly_app:fixapp@localhost:56633/e2e npx vitest run -c vitest.live.config.ts`.
2. **Pluxee:** dotaz na stav platby u API brány není — vendor dokumentaci nemáme (kód sám uvádí „Vendor docs zatím nemáme"); endpoint by byl odhad. Callback je fail-closed (HMAC, dev-skip jen mimo produkci) a kontroluje zaplacenou částku.
3. **QR u stávajících akcí:** výchozí politika platí pro nové akce; 561 existujících akcí (v izolované DB; v produkci neověřeno) má `static_allowed` z dřívějšího defaultu a nelze odlišit od explicitní volby. Hromadná změna by zneplatnila prodané PDF u brány — rozhodnutí pro tebe (SQL: `UPDATE catalog.events SET qr_policy='rotating_24h' WHERE qr_policy='static_allowed' AND …`).
4. **Plošné eskalace v kódu:** 54 míst `SET LOCAL app.is_platform_admin = 'true'` na celou transakci (z toho řada kupcových rout) — předexistující vzor, s nímž V8 politiky nic nezmůžou (`logs/r2/3_inline_escalations.txt`). Mimo rozsah; doporučuji nahradit úzkým `asSystemInTx`.
5. **Kupec smí měnit vlastní objednávku/vstupenku** (status, částku) na úrovni RLS — není to cross-tenant, ale při SQL injection v kupcově routě by šlo např. nastavit `paid`. Řešení = BEFORE UPDATE guard trigger; nerealizováno.
6. **83 zamčených tabulek:** kód je dnes nepoužívá (nebo jen servis/admin); až funkce vzniknou, bude potřeba doplnit tenantní politiku.
7. Další zjištění mimo zadání: `mobile/payment-intent` obchází rate-limity K3; `admin/import` pod `tixly_app` (RETURNING, ON CONFLICT DO UPDATE) neověřen — změnil jsem jen sentinel hesla; tisk prodejce `app/reseller/print/[orderId]` čte bez kontextu (pod `tixly_app` nefunkční už před koly 1–2); faktury viz X7; existující (Neon-gated) `tests/rls-pool-pooler.live.test.ts` jsem upravil, ale bez `NEON_API_KEY` se nespouští.

## 7. Překryv se 92 necommitnutými změnami v `tixly/` (nic nesloučeno)

Kolem 2 změněno 196 cest (`git diff --name-only 1a6e96d..HEAD`, vč. auditní sady a logů). Přesný průnik s `git status` v `tixly/`: **1 soubor — `nextjs-boilerplate/src/middleware.ts`**:
- moje změna (kolo 1 + 2): `/api/kiosk/` v `API_PROMOTER_PREFIXES`; `requestHeaders.delete('x-vercel-cron')`;
- tvoje necommitnutá změna: `/api/offers/` v `PUBLIC_API_PREFIXES`, `/nabidka/` passthrough.
Jiné hunky, neodporují si — při sloučení spojit ručně.

Nepřímé kolize (ne stejný soubor):
- **čísla migrací:** kolo 1 `472_refund_gateway_state.sql` × tvoje `472_royalty_agreements_currency.sql`; kolo 2 používá 480–485 (bez kolize s 472–478).
- tvoje nové tabulky z 473–478 (náklady akce, vyúčtování umělců, holdy termínů, nabídky…) budou po sloučení bez RLS → test `fix-r2-3b-tables-rls` (přesně 20 tabulek bez RLS) zčervená, dokud pro ně nevznikne rozhodnutí v `audit/r2/gen-482.mjs`.
- `rls-pool.ts` (kontext jen v transakci) a migrace 481/482 platí i pro tvůj necommitnutý kód; tvoje routy pod promotérským kontextem nejsou dotčené, kupcové/anonymní zápisy do zamčených tabulek by byly.

## 8. Poslední commit

Viz konec souboru (hash commitu tohoto reportu je v odpovědi).
