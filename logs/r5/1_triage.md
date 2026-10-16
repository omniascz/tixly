# Kolo 5 / krok 1 — triáž gitleaks (hodnoty se nevypisují)

Sken: gitleaks 8.30.1, výchozí konfigurace jako security.yml (gitleaks-action@v2 bez .gitleaks.toml), --redact.
- master (co skenuje plánovaný běh security.yml): 660 commitů, **26** nálezů (CI 2026-09-28 hlásilo 25; master se posunul) — logs/r5/1_gitleaks_master.json
- celá historie (--all, vč. fix/*): 801 commitů, **63** nálezů — logs/r5/1_gitleaks_all.json

**Výsledek: SKUTEČNÉ TAJEMSTVÍ 0, NEJASNÉ 0, TESTOVACÍ/FALEŠNÉ 63.** Rotace klíčů z těchto nálezů není potřeba.

| Nález (pravidlo, soubor:řádek) | Počet | Kategorie | Služba / co to je | První výskyt (commit, datum) | V HEAD master / fix-round4 |
|---|---|---|---|---|---|
| generic-api-key audit/logs/r2_e2e_03_refund_scan.jsonl:4 | 36 | TESTOVACÍ | idempotency_key (UUID) z auditu proti izolované lokální DB + fake-gopay | 8d97de9f 2026-10-03 | soubor ne / ANO; soubor ne / ne |
| generic-api-key audit/logs/13_gitleaks.json:19 | 1 | TESTOVACÍ | starší gitleaks report (Secret redigováno) citující shareToken z FINDINGS | 2e4d0c15 2026-09-30 | soubor ne / soubor ne |
| generic-api-key FINDINGS_SCHEMA_REALITY.md:2739 | 1 | TESTOVACÍ | shareToken party-split z dočasné Neon větve (live-fixture ji po běhu maže); není přístupový klíč služby | 2dc58dbf 2026-08-04 | ANO / ANO |
| generic-api-key nextjs-boilerplate/scripts/seed-e2e-fixtures.sql:12,13,20,21 | 4 | FALEŠNÉ | název sloupce (meta_capi_token…) v seznamu sloupců INSERT | e63a729a 2026-06-30 | ANO / ANO |
| generic-api-key nextjs-boilerplate/src/app/api/admin/settings/route.ts:88 | 1 | FALEŠNÉ | výraz v kódu (s.ga4_…) — název proměnné | d5d38951 2026-06-23 | ANO / ANO |
| generic-api-key migrations/000_baseline_20260730.sql:3554,10942 | 2 | FALEŠNÉ | definice sloupce meta_capi_token | 8a2822c8 2026-07-30 | ANO / ANO |
| generic-api-key e2e/tests/golden-path-benefit-pluxee-callback.spec.ts:19 | 1 | TESTOVACÍ | konstanta test… v E2E testu | c74adc91 2026-05-23 | ANO / ANO |
| generic-api-key docs/TIXLY-SYSTEM-MAP.md:812 | 1 | TESTOVACÍ | příklad tick_test_… v dokumentaci | 811e5d60 2026-05-20 | ANO / ANO |
| curl-auth-header docs/TIXLY-SYSTEM-MAP.md:814 | 1 | TESTOVACÍ | příklad tick_test_… v dokumentaci | 811e5d60 2026-05-20 | ANO / ANO |
| generic-api-key db/baseline.sql:3068 | 1 | FALEŠNÉ | definice sloupce meta_capi_token | ee818484 2026-06-01 | ANO / ANO |
| generic-api-key nextjs-boilerplate/.env.example:53 | 1 | FALEŠNÉ | prázdné COMGATE_SECRET=, regex chytil název další proměnné | b6b0e557 2026-05-19 | ANO / ANO |
| generic-api-key b2b-api/b2b-api/src/__tests__/middleware.test.ts:165 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key b2b-api/src/__tests__/middleware.test.ts:165 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key email-templates/email-templates/examples/usage-examples.ts:22,80 | 2 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key email-templates/examples/usage-examples.ts:22,80 | 2 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key friend-invites/src/__tests__/friend-invite.test.ts:14 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key resale-api/src/__tests__/discovery-feed.service.test.ts:15 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key resale-api/src/__tests__/retailer.service.test.ts:24 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| generic-api-key stripe-payments/src/__tests__/stripe.test.ts:42 | 1 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |
| private-key wallet-passes/src/lib/wallet.test.ts:118,330 | 3 | TESTOVACÍ | fixture v testu / příkladu (abc123…, whsec_test…, "fake" PEM, prefix klíče) | a4021614 2026-04-29 | soubor ne / soubor ne |

Pozn.: private-key wallet.test.ts:330 = tělo RSA klíče 48 znaků (platný RSA klíč má stovky) ve fixture service accountu; ř. 118 = PEM s tělem „fake“.
HEAD = master i fix/round4: skutečné tajemství v HEAD není → nic se z HEAD neodstraňuje. Testovací nálezy půjdou do .gitleaksignore (fingerprint) na integrační větvi v kroku 3.
