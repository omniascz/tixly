# ROUND6_REPORT — kolo 6 (2026-10-04)

Pracovní strom `tixly/` je přepnutý na `integrate/2026-10-04`, PR do `master` je otevřený (nemergováno).
Žádné spojení na produkci, `master` nepushnut, deploy nespuštěn. Výstupy: `logs/r6/`.

## 1. Přepnutí tixly/ (krok 1)
- Kontrola beze změny (dočasný index mimo repo): strom **`a44ccdb30a722a6d7db56bbd6a7385c581acc253` = snímek** ✔; index smazán.
- `tixly/` byla na `master`, za posledních 15 min se nezměnil žádný soubor.
- `../tixly-fix`: `switch --detach` (3ab73410), zůstává detached.
- Stash: **`stash@{0}: On master: pred prepnutim na integrate/2026-10-04`** — ponechán jako záloha.
- `git switch integrate/2026-10-04` ✔, `status --porcelain` prázdný.
- Snímek je v integraci celý: proti `wip/snapshot-2026-10-04` chybí jen přejmenované `479_royalty… → 488_…`,
  `red-green-479 → red-green-488` a `api/cart/validate` (smazala ji oprava P1 v kole 2); každý změněný soubor
  odpovídá commitu kol 1–5 (`logs/r6/1_diff_stat_snapshot_integrate.txt`).
- Lokální `master`: fast-forward ověřen (`merge-base --is-ancestor`) → **`d4b43f4f` → `3ab73410`** (`origin/master` beze změny).

## 2. CI na GitHubu (krok 2)
PR: **https://github.com/omniascz/tixly/pull/2** (`integrate/2026-10-04` → `master`).

Před pushem: `deploy.yml` spouštěl i `workflow_dispatch` (ruční běh lze vybrat na libovolné větvi) → odstraněno,
zůstává jen `push: [master]` + pojistka `if: github.ref == 'refs/heads/master'` v jobech deploy/migrate (`20e881d7`).

| Iterace | Commit | CI (install·typecheck·lint·unit / live) | Schema Drift | RLS Gate | Security: gitleaks / npm audit |
|---|---|---|---|---|---|
| 1 | ef658d73 | unit ✗ (ECONNREFUSED :5433) / live ✓ | ✓ | ✗ snapshot bez politik vlastníka | ✗ `pull-requests: read` / ✗ |
| 2 | df82e836 | ✓ / ✓ | ✓ | ✓ | ✓ / ✗ |
| 3 | eeb32e47 | ✓ / ✓ | ✓ | ✓ | ✓ / ✗ |

Opravy mezi iteracemi:
- **RLS Gate** — chyba integrace kola 5: `rls-snapshot.json` nebyl přegenerován po migracích vlastníka
  (7 politik chybělo, 3 staré `*_svc` přebývaly). Lokálně RED 10 rozdílů → přegenerováno z DB od nuly → GREEN (`e72932ce`).
- **Unit** — `rls-tenant-isolation.test.ts` potřebuje vývojovou DB `tixly-postgres :5433` (lokálně běží, v runneru ne) →
  spouští se jen s `RLS_TENANT_DB=1` / `DATABASE_URL_SUPER` (lokálně 9/9), jinak skip (`35e7e306`) — prostředí.
- **Gitleaks** — akce na PR čte `GET /pulls/2/commits`, chybělo `pull-requests: read` (`df82e836`) — prostředí.
  Pozn.: na PR akce skenuje jen rozsah commitů z API; úplný lokální sken celé historie s `.gitleaksignore`: **no leaks found**.

Stav workflow (poslední iterace):
| Workflow | Stav |
|---|---|
| CI | **prošel** (oba joby; live sada proti Postgresu z migrací pod `tixly_app`, PgBouncer, Mailpit, Redis, fake-gopay) |
| Schema Drift Guard | **prošel** |
| RLS Gate (DB z migrací) | **prošel**; kontrola produkce na PR záměrně neběží |
| Security — gitleaks | **prošel** |
| Security — npm audit | **selhal: skutečné zranitelné závislosti** (high+critical: nextjs-boilerplate 34+2, mobile 53+1, mobile-promoter 53+1; e2e 0) — ne prostředí, neopraveno |
| Deploy | neběží (jen push do `master`) — správně |
| DB backup | neběží na PR (jen plán/ruční) — bez secretů selže na kontrole secretů (záměrně) |

Matice `security.yml` opravena na existující balíčky (`nextjs-boilerplate`, `mobile`, `mobile-promoter`, `e2e`),
audit z lockfilu bez instalace (`ef658d73`).

**Co musí nastavit vlastník** (Settings → Secrets and variables → Actions):
- záloha: `DATABASE_URL` (sslmode=require), `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION`,
  `BACKUP_ENCRYPTION_KEY`, volitelně `SLACK_WEBHOOK_URL`;
- noční RLS gate produkce: `DATABASE_URL` (role `tixly_app`), `NEON_API_KEY` (project-scoped);
- deploy: `VERCEL_TOKEN`, `DATABASE_URL` (environment `production`);
- rozhodnout o upgradu závislostí (npm audit), jinak Security zůstane červený;
- doporučeno: v ochraně větve `master` vyžadovat checky CI, Schema Drift Guard, RLS Gate.

## 3. Opravy z analýzy kroku 3 (nalezeno při ověřování proti kódu)
| Nález | Příčina | Oprava | Test | RED → GREEN | Commit |
|---|---|---|---|---|---|
| Cross-pass zdarma | `POST /api/buyer/cross-passes/purchase` „Demo: instant purchase" — aktivní pas anonymně s `buyerEmail`, odpověď `pricePaidHalire: 150000`, brána nevolána | demo-path-guard (404, jako K1) | fix-r6-demo-paths-value | 201 → 404, 0 členství | 6e1b7280 |
| Permanentka zdarma → vstupenky zdarma | `POST /api/subscriptions/subscribe` (i host) a `POST /api/buyer/subscriptions` zakládají `active` předplatné bez platby; checkout `useSubscription` = 100% sleva | demo-path-guard u obou POST | fix-r6-demo-paths-value | 201 / PLAN_NOT_FOUND → přesně guard 404 (3/3) | 6e1b7280 |
| Hromadný refund nevrací peníze (C-14) | `bulk-refund` jen přepnul DB na `refunded`, bránu nevolal (třída K2) | sdílený automat `executeOrderRefund` (brána 1×, chyba → `refund_failed`) | fix-r6-bulk-refund-gateway | 0 volání brány → 2/2; K2 5/5 | eeb32e47 |

## 4. Co oproti plánu chybí postavit (krok 3)
Zdroje: `audit/AUDIT_REPORT.md` §2 a §6, `TESTING_MAP.md`, `GO-LIVE-CHECKLIST.md`, `REMEDIATION.md`; každá položka
ověřena proti kódu `integrate/2026-10-04`. Položky z auditu, které kola 1–6 opravila a sady/audity potvrzují
(reset hesla, expirace rezervací, rate-limit nákupu, refund přes bránu, storno/self-refund/POS/PDF pod `tixly_app`,
vstupenka zdarma, sken cizí akce, scan_logs, idempotence webhooku, výchozí rotující QR, RLS zápis, subscription checkout,
migrace od nuly, CI), v seznamu nejsou.

Seřazeno: nejdřív blokující, pak podle velikosti (S ≤ ½ dne, M ≤ 2 dny, L víc).

| Funkce | Stav (důkaz z kódu) | Co chybí | Závislosti | Velikost | Blokuje ostrý prodej |
|---|---|---|---|---|---|
| Uzávěrka prodeje po začátku akce (C-29) | **CHYBÍ** — `checkout/route.ts` nemá žádnou kontrolu `date_start` (0 výskytů), neexistuje sloupec okna prodeje; `TESTING_MAP.md:357` | guard v checkoutu a `mobile/payment-intent` (konec prodeje = začátek/konec akce, volitelně `sales_end_at`), test | — | S | **ANO** — jinak se prodávají vstupenky na už proběhlé akce |
| Doklady kupci: obsah a DPH, faktury pořadatele, ISDOC (C-54) | **ČÁSTEČNĚ** — `buyer/orders/[id]/invoice` počítá DPH z `promoters.vat_rate_pct ?? 0`, kdežto e-mail (`order-completed`) z kategorie akce (`resolveVatRate`) → doklad se může rozcházet; obsah PDF bez testu; ISDOC bez validace proti XSD | sjednotit výpočet DPH (kategorie akce), test obsahu dokladu a faktury, XSD validace ISDOC 6.0.2 | DPH nastavení (GO-LIVE) | M | **ANO** — daňový doklad s chybnou sazbou od první prodané vstupenky |
| ComGate a ostatní brány proti sandboxům (C-31, + GoPay C-30) | **NEOVĚŘENO** — GoPay ověřen jen proti simulátoru `fake-gopay`; ComGate má platbu, stav (webhook ověřuje přes API) i refund, ale nikdy neběžel proti sandboxu; Mollie/PayPal/Stripe/P24/Triple-A nemají refund (`gateway-refund.ts`: `REFUND_UNSUPPORTED_PROVIDER`) | sandbox E2E GoPay + ComGate (platba, webhook, refund, částka 0), „golden path naostro" z GO-LIVE; ostatní brány vypnout nebo doplnit refund | sandbox/produkční klíče od vlastníka (GoPay KYC ~14 dní) | M | **ANO** — bez ověření proti skutečné bráně nelze brát peníze |
| Neregistrovaný cron expire-date-holds | **CHYBÍ registrace** — routa je (fail-closed `verifyInternalToken`), ale není ve `vercel.json` ani v `cron/dispatch` | zapsat do dispatcheru + `vercel.json` | — | S | NE — týká se opcí na termíny sálu, ne prodeje |
| Lockfile mobile-promoter | **NEFUNGUJE** — `npm ci` → `EUSAGE`, chybí `@babel/preset-env@7.29.7` aj. (`logs/r6/3_mobile_promoter_npmci.txt`) | `npm install` a commit lockfile | — | S | NE — webový prodej nezávisí na mobilní appce pořadatele |
| KYC/ARES při registraci pořadatele | **NEOVĚŘENO** — `register-promoter` volá `lib/compliance/ares.ts` (skutečné `ares.gov.cz`, timeout), AML `admin/kyc/aml-check`; bez testu a bez simulátoru ARES | simulátor ARES + test registrace (platné/neplatné/nedostupné IČO), test AML | — | S | NE — kontrola pořadatele, prodej kupcům neovlivní |
| B2B publish API (GO-LIVE „stub") | **NEOVĚŘENO** — `v1/publish/events` POST zakládá akce (není stub), test jen Neon (`publish-events.live`) | lokální test | — | S | NE — prodej jde přes vlastní admin |
| Zrušení akce s hromadným refundem (C-14) | **ČÁSTEČNĚ** — `bulk-refund` od kola 6 vrací přes bránu (eeb32e47), max 100 obj./volání, bez volajícího v UI; endpoint „zrušit akci" (stav `cancelled`, stop prodeje, oznámení, refund všech) neexistuje (`emergency`, `postpone`, `reschedule` jsou jiné toky) | endpoint + UI zrušení akce, dávkování přes všechny objednávky, e-maily | brány (C-31) | M | NE — po opravě lze vracet přes API po 100 objednávkách; chybí orchestrace a UI |
| Offline režim skeneru v prohlížeči (C-50) | **NEOVĚŘENO** — `lib/scanner/offline-queue.ts` (IndexedDB fronta, manifest, flush) je napojen ve skeneru; test jen serverového manifestu | Playwright test v prohlížeči (offline sken → fronta → sync, cizí vstupenka odmítnuta) | — | M | NE — online sken funguje, offline je záloha |
| Cross-pass (C-52) | **ČÁSTEČNĚ** — nákup byl bez platby → kolo 6 vypnulo (6e1b7280); `admin/scanner/cross-pass`, wallet PDF/Apple bez testu | napojit nákup na platební tok, test skenu a walletu | brány (C-31) | M | NE — funkce je teď vypnutá, běžný prodej jde |
| Registr reportů (C-55) | **NEOVĚŘENO** — `lib/reports/*` ~200 definic, `admin/reports/run`; žádný test reporty nespouští | generovaný test: každý report pod `tixly_app` v kontextu pořadatele proti DB z migrací | — | M | NE — reporting, ne prodej |
| Editor sálu | **ČÁSTEČNĚ** — editor + `admin/venues/[id]/seating-chart` (kontrola vlastnictví sálu OK); převod plánku na sedadla akce (`lib/seats/copy-layout-to-event-seats.ts`) bez testu; audit sedadla seedoval SQL | E2E: plánek → sedadla akce → hold → nákup | — | M | NE — prodej bez místenek jde; místenkové akce až po ověření |
| 21 testů jen proti Neon klonu | **NEOVĚŘENO v CI** — `admin-guest, auth-reset-password, booking-settlement, buyer-policies, checkout-guest, checkout-stress, consent-purge, cron-contract, fan-bonus-r57, guest-user, live-fixture, mig455, party-split, payouts-processing, payouts-select, public-routes, publish-events, red-green-470-471, red-green-488, rls-pool-pooler, wrapped-routes` — bez `hasLocalDb`, v CI i lokálně skip | převést na `local-fixture` (DB z migrací) | — | M | NE — pokrytí, ne funkce (kritické toky kryjí lokální testy) |
| Pod-role gate / box_office / finance (C-07) | **CHYBÍ** — role jsou jen v Zod schématu pozvánky (`admin/team`), žádný guard na ně nevětví (grep 0), bez DB CHECK; člen `gate` má práva `manager` | matice oprávnění + guard v ~500 routách pořadatele (sken, pokladna, finance), testy | — | L | NE — bezpečnostní riziko uvnitř týmu pořadatele, prodej kupcům neblokuje |
| Výplaty pořadatelům (C-57) | **ČÁSTEČNĚ** — EUR přes Wise (`lib/payouts/wise.ts`, bez klíčů, proti sandboxu neověřeno); CZK jen ruční FIO (`executor.ts:172` označí `processing`, výsledek hlásí `paid`, peníze neodejdou); přehled `admin/payouts` bez dat vrací `source:'computed'` s ID `mock-…`; cron `payouts-execute` není ve `vercel.json` | automatická CZK výplata (FIO Business API / jiná), poctivý stav výsledku, sandbox Wise, registrace cronu, test | Wise/FIO klíče | L | NE — výplaty lze zpočátku dělat ručně z bankovnictví |
| 4 demo cesty vypnuté v kole 1 + 3 vypnuté v kole 6 bez napojení na platbu | **CHYBÍ napojení** — `buyer/resale/buy`, `buyer/tickets/[id]/upgrade`, `vouchers/holders/[id]/confirm`, `subscriptions/holders/[id]/confirm`, nově `buyer/cross-passes/purchase`, `subscriptions/subscribe`, `buyer/subscriptions` POST → 404 (`demo-path-guard`) | u každé: create payment → webhook → paid → vydání/aktivace + testy | brány (C-31) | L | NE — přeprodej, upgrade, poukazy a předplatné jsou nedostupné, prodej vstupenek jde |

## 5. Stav po kole
- Poslední zelené ověření na GitHubu: CI, Schema Drift Guard, RLS Gate, gitleaks na `eeb32e47`.
- Lokálně po opravách kola 6: tsc 0, lint 1008 (bez nárůstu), unit 65/65 (+1 skip DB test), cílené live testy zelené.
- Stash `stash@{0}` ponechán; `../tixly-fix` detached na 3ab73410; lokální `master` = 3ab73410 (nepushnut).
