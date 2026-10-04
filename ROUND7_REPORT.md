# ROUND7_REPORT — kolo 7: blokery ostrého prodeje a drobné nedodělky (2026-10-04)

Větev `fix/round7-2026-10-04` z `ed77a3b9` → PR do `integrate/2026-10-04`.
Žádné spojení na produkční DB ani produkční služby, `master` nepushnut, deploy nespuštěn.
Aplikace i testy pod rolí `tixly_app` proti izolované DB z migrací. Výstupy: `logs/r7/`. Postup: `PROGRESS_R7.md`.
Zakázané příkazy se nepoužily; stash „pred prepnutim na integrate/2026-10-04" je ponechán.

## 1. Kroky

| Krok | Výsledek | RED → GREEN | Commit |
|---|---|---|---|
| 1 Uzávěrka prodeje (C-29) | `catalog.events.sales_end_at` (výchozí `date_start`, ≤ `date_end`), sdílená serverová kontrola `lib/sales/cutoff.ts` na 13 kupcových cestách (checkout, party-split, mobilní payment-intent, seat hold, kiosk, claimy, resale, season pass, white-label …) a 4 pokladních (POS do `date_end`, jinak `date_start + 12 h`); doplacení dříve založené objednávky projde; stránka akce „Prodej ukončen", pole v editaci, validace 422 | 5 → 7/7 | 6659671f |
| 2a DPH jako data (C-54) | `platform.vat_rates` (kód, %, platnost), typ vstupenky má kód sazby; plátce bez DIČ / placený typ bez sazby nelze publikovat ani prodat (422 `VAT_NOT_CONFIGURED`); výchozí 0 % a tabulka v kódu odstraněny | → 7/7 | 9d88f9bf |
| 2b Doklady kupci | rozpis po sazbách k datu plnění, neplátce s textem, řada per pořadatel × rok bez děr (50 souběžných dokladů, ROLLBACK nespálí číslo), dobropis se zápornými částkami po sazbách při refundu | 7 → 7/7 | 1748dd64 |
| 2c ISDOC + faktury provize | ISDOC 6.0.2 validovaný oficiálním XSD (plátce, neplátce, dobropis); faktury provize platformy pořadatelům s údaji platformy jako dodavatele (`platform.billing_identity`, bez vyplnění 503) | starý generátor 5 chyb XSD → 5/5; stub 3/3 → 3/3 | f925611f |
| 3 Výplaty (C-57) | stav `awaiting_manual_transfer`; `paid` jen po potvrzení platform adminem (datum + reference) nebo bankou — hlídá DB trigger; audit log; migrace převedla neověřené `paid`; UI pravdivě (pořadatel bez vymyšleného „Vyplaceno" a falešného účtu, platforma s potvrzením převodu); ne-admin 403, bez reference 400, s referencí `paid` | 5 → 5/5 | 43a159b6 |
| 4 Zranitelné závislosti | web: axios/postcss/nodemailer v rámci major + `npm audit fix` (63 → 52); mobile: lockfile srovnán + audit fix (80 → 71); gate `.github/scripts/audit-fixable.mjs` (opravitelné = zmizí po `npm audit fix` bez `--force`, nesmí zhoršit jiné); Security workflow zelený | gate před opravou exit 1 (web 7, mobile 9 opravitelných) → 0 | c6edc85a, 54261adf, 2fe9352d, fe90f30a |
| 5a mobile-promoter lockfile | `npm ci` padal (EUSAGE) → srovnáno, audit fix (80 → 70), `npm ci` OK, typecheck 0 | ✗ → ✓ | 81fa66d2 |
| 5b Cron expire-date-holds | ve `vercel.json` (hodinově) a v allowlistu dispatcheru (CRON_SECRET + předání x-internal-token); test: propadlá opce → expired, další se posune | 3 → 3/3 | d83bb154 |
| 5c Simulátor ARES | úspěch / neexistující IČO / zaniklý / výpadek 503 / timeout; výpadek a timeout → ruční ověření (`manual_verification_required`), IČO neoznačené jako neplatné, KYC přijato k ručnímu posouzení | 6 → 6/6 | 6ff7145e |
| 6a ComGate dle oficiálního API | klient volal neexistující cesty, posílal `currency` místo `curr`, četl `state` místo `status`, webhook bral jen formulář (v2.0 posílá JSON), refund bez timeoutu; checkout ukládal `payment_provider` jako zvolenou metodu, ne bránu | 3 → 3/3 | d3099c14 |
| 6b GoPay scope | token `payment-create` nesmí stav ani refund (doc.gopay.com) → `payment-all` | 6 → 119/119 | 2ac760e0 |
| 6c Brány bez refundu | Stripe/Mollie/PayPal/P24/Triple-A jen pro akce existující před mig. 499 (checkout 422, mobil 503 → web, UI skryje krypto) | 5 → 5/5 | 048d7c56 |
| 6d Sandbox testy | `tests/sandbox/{gopay,comgate}.sandbox.test.ts` + README s env; bez klíčů skip s hláškou; ochrana proti produkci | guard 4/4; nanečisto proti simulátorům 2/2 | 5d60d70c |

Migrace: 493–499, každá idempotentní, ověřená 2× nad stávajícím schématem (`r7`) i od nuly (`r7z`, 52 souborů, 0 chyb).

### Odchylky a předpoklady
- **Krok 1:** existující nevynucovaný `sale_end_at` jsem převedl do nového `sales_end_at` a všechny zapisovače přepnul (sloupec označen jako zastaralý).
- **Krok 2c:** skutečné fakturační údaje Tixly s.r.o. nejsou známé (web uvádí „[doplníme]") → `platform.billing_identity` migrace neplní, vyplní platform admin (PUT `/api/platform/admin/billing-identity`). Předpoklad k potvrzení: `payouts.platform_fees` je cena služby **včetně DPH**, DUZP = konec výplatního období, sazba `CZ_STANDARD`.
- **Krok 5c:** KYC u zaniklého subjektu (ARES `inactive`) projde jako dřív, jen se uloží stav — beze změny chování.
- **Krok 6c:** volba brány pro akci v administraci neexistuje (žádný sloupec ani UI) — brány se nabízejí kupci v checkoutu, EUR se automaticky směruje na Stripe a mobil platí přes Stripe. Proto je politika v checkoutu, mobilním payment-intent a UI checkoutu. Existující akce dostaly `legacy_payment_gateways = true` (beze změny chování).
  - Seznam existujících akcí, které tyto brány použily, vypíše migrace 499 (`RAISE NOTICE`). Na produkci ji nespouštím; vlastník ho získá i dotazem
    `SELECT e.id, e.title, o.payment_provider, count(*) FROM catalog.events e JOIN orders.orders o ON o.event_id=e.id WHERE o.payment_provider IN ('stripe','mollie','paypal','przelewy24','crypto','triplea') GROUP BY 1,2,3;`
  - V lokální testovací DB jde o 115 testovacích akcí z dřívějších běhů.
  - Důsledek: nová akce v EUR bez `PAYMENT_PROVIDER_EUR=gopay|comgate` nejde prodat (fail-closed).
- **Externí volání v RED bězích** (oba byly jen čtecí nebo odmítnuté):
  - RED test ARES poslal několik čtecích dotazů na veřejný `ares.gov.cz`, protože starý klient ignoroval `ARES_BASE_URL`.
  - RED mobilního testu 6c jednou zavolal `api.stripe.com` se zástupným klíčem a Stripe ho odmítl.
  - Obě cesty jsou teď konfigurovatelné (`STRIPE_API_BASE_URL` i v `lib/payment/stripe.ts`) a testy míří na simulátor nebo nedosažitelnou lokální adresu.

## 2. DPH a ISDOC — zdroje

**Sazby (migrace 494, `platform.vat_rates`, platnost od 1. 1. 2024):** `CZ_STANDARD` = **21 %**, `CZ_REDUCED` = **12 %**.
- Zákon č. 235/2004 Sb., o DPH, § 47 odst. 1 (znění účinné od 1. 1. 2026, zakonyprolidi.cz/cs/2004-235, verze 69): „a) základní sazba daně ve výši 21 %, nebo b) snížená sazba daně ve výši 12 %". Podle § 47 odst. 2 se použije sazba platná ke dni uskutečnění plnění.
- Informace GFŘ ke změnám sazeb DPH od 1. 1. 2024, příloha č. 2 (CZ-CPA 59.14, 90, 91, 93): vstupné na kulturní akce → snížená sazba. Zdroj: financnisprava.gov.cz, `…/Informace_GFR_ke_zmenam_sazeb_DPH_od_1_1_2024.pdf`; text je v `logs/r7/2_gfr_sazby_dph_2024.txt`.

**Zaokrouhlení** (`lib/tax/vat.ts`, testy `vat.test.ts` a `fix-r7-tax-documents`):
- DPH z ceny s daní = cena × s / (10000 + s), kde s je sazba v setinách procenta, počítané v BigInt.
- Zaokrouhluje se na haléře, 0,5 od nuly, symetricky i pro dobropisy.
- Základ = cena − DPH. Položky se stejnou sazbou se nejdřív sečtou, pak rozdělí.
- Rozpočet na položky jde metodou největšího zbytku.

**ISDOC:** verze **6.0.2**, oficiální XSD `https://isdoc.cz/6.0.2/xsd/isdoc-invoice-6.0.2.xsd` (MV ČR, 23. 3. 2022), namespace `http://isdoc.cz/namespace/2013`, sha256 `fb5de36fe7b5517acb8aa0c7950d91f8e28910e63b8cdcaaf7db0b0f4f0420bb`. Je uložené v repu (`src/lib/accounting/xsd/`) a validuje se přes xmllint-wasm 5.3.0 (libxml2) v unit i live testech.

## 3. Zbývající zranitelnosti (high/critical)
Úplná tabulka (120 řádků, balíček | závažnost | přímá/tranzitivní | potřebná verze | runtime/dev): `logs/r7/4_vuln_table.tsv`. Souhrn po kořenových balíčcích — vše jen novou hlavní verzí nebo bez opravy:

| Balíček | Závažnost | Přímá/tranzitivní | Potřebná verze | Dopad |
|---|---|---|---|---|
| next (web) | critical | přímá | 16.3.8 (major) | runtime — DoS Image Optimizeru (remotePatterns), postcss uvnitř next |
| vitest, @vitest/ui, vite (web) | critical/high | přímá | vitest 5.0.3 (major) | jen vývoj/testy (UI server vitest) |
| @sentry/nextjs (+ webpack-plugin, rollup, unplugin) | high | přímá | 11.4.0 (major) | build/runtime SDK |
| node-forge (web) | high | přímá | bez opravy | runtime — Apple Wallet pass (`lib/wallet/apple-pass.ts`) jen podepisuje; advisory se týká ověřování podpisu |
| nodemailer (web) | high | přímá (devDependency, ale používá `lib/email/mailer.ts`) | 10.0.14 (major) | runtime e-maily — volba `raw` (Tixly ji nepoužívá) |
| @vercel/blob → undici, @fastify/busboy | high | tranzitivní | @vercel/blob 2.8.0 (major) | runtime upload |
| tailwindcss, eslint-config-next, @typescript-eslint/* (+ glob, minimatch, braces…) | high | přímá | major | jen build/lint |
| expo (+ @expo/*, tar, xmldom, metro…) (mobile, mobile-promoter) | critical (tar)/high | přímá/tranzitivní | expo 44.0.6 (npm nabízí downgrade) — reálně upgrade Expo SDK | build/dev (tar) a runtime |
| react-native (+ cli, jest, metro) | high | přímá | 0.87.1 (major) | build/dev |
| @stripe/stripe-react-native (mobile) | high | přímá | npm navrhuje 0.18.1 (major) | runtime |
| turbo-stream / @remix-run/* (pod expo-router) | high | tranzitivní | „v rozsahu", ale npm 11.19 to „opraví" downgradem @remix-run na 2.8.1 = critical | gate to nebere jako opravu |

## 4. Sandbox brány — env proměnné
Návod a ověřené odkazy jsou v `nextjs-boilerplate/tests/sandbox/README.md`. Spuštění: `npm run test:sandbox` (+ `FIX_E2E=1`, `FIX_DB_*`).

| Proměnná | Kde ji vlastník získá |
|---|---|
| `GOPAY_SANDBOX_GOID`, `GOPAY_SANDBOX_CLIENT_ID`, `GOPAY_SANDBOX_CLIENT_SECRET` | Testovací přístupy posílá GoPay po registraci obchodníka: https://www.gopay.com/en/ · https://help.gopay.com/en/s/u8 · https://help.gopay.com/en/s/wk (testovací karty) |
| `COMGATE_SANDBOX_MERCHANT`, `COMGATE_SANDBOX_SECRET` | Klientský portál https://portal.comgate.cz/cs/ → Integrace → Nastavení obchodu → Propojení obchodu. Je třeba povolit i IP adresu stroje, ze kterého testy běží (whitelist): https://apidoc.comgate.cz/en/faq |
| `SANDBOX_PAY_TIMEOUT_MS` | volitelné, čekání na zaplacení (výchozí 300 s) |

Pro ostrý provoz dále `PAYMENT_PROVIDER=gopay|comgate`, `GOPAY_*` / `COMGATE_*` (`COMGATE_REFUND_TIMEOUT_MS` volitelně). Notifikační URL ComGate se nastavuje v portálu (`/api/payments/comgate/webhook`).

## 5. Výsledky sad (Závěr, DB `r7z` od nuly)
| Sada | Výsledek | Log |
|---|---|---|
| Migrace od nuly | 52 souborů, 0 chyb; RLS gate bez driftu | Z_1_* |
| Typecheck | 0 chyb | Z_2_tsc.txt |
| Lint (baseline) | 994 chyb, baseline 1008, žádná nová | Z_3_lint.txt |
| Unit | 67 souborů / 636 testů prošlo, 13 přeskočeno | Z_4_unit.txt |
| Live (tixly_app, PgBouncer) | 70 souborů / 306 testů prošlo; 21 souborů skip (jen pro Neon, známé z kola 6) | Z_5_live.txt |
| Build | `next build` EXIT 0 (lokální env, produkční hostitelé z `.env.local` přepsané) | Z_6_build.txt |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · **07b** 0 zápisů v 5 pokusech · **08** 2/0 (159 rout × 3 aktéři, 0 úniků, 0× 5xx) · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 | Z_8_audit_* |
| Sandbox | bez klíčů 2 skip + guard 4/4; nanečisto proti simulátorům 2/2 | 6_sandbox_* |
| Gitleaks (commity kola 7) | no leaks found | Z_9_gitleaks_r7_range.txt |
| Vizuální kontrola (CDP) | „Prodej ukončen", výplaty pořadatele, výplaty platformy, ruční ověření ARES, checkout bez krypta — vše odpovídá | Z_vis_*.png |

**CI na GitHubu:**
- Poslední ověřené push běhy (b344d52d) prošly: CI, Schema Drift Guard i RLS Gate.
- Security (ruční běh na větvi, 37170601116) prošel: gitleaks + audit 4 modulů.
- Mezi tím selhaly dva CI běhy na typech v testech (2fe9352d, d3099c14); obě chyby jsou opravené v následujících commitech.
- Stav po finálním pushi je uveden v PR.

## 6. Co se nepodařilo / neověřeno
- **Sandbox brány proti skutečnému sandboxu NEověřeny.** Chybí klíče. Logika obou toků prošla jen proti simulátorům postaveným podle oficiální dokumentace. Krok zaplacení vyžaduje člověka (testovací karta).
- **ComGate a GoPay nikdy neběžely proti skutečné bráně.** Opravy 6a a 6b vycházejí z oficiální dokumentace (apidoc.comgate.cz, doc.gopay.com) a simulátorů, ne ze živého sandboxu.
- Fakturační údaje platformy (dodavatel na fakturách provize) nejsou vyplněné. Vystavení faktury provize vrací 503, dokud je platform admin nezadá.
- Zranitelnosti z tabulky v části 3 vyžadují upgrade na novou hlavní verzi (Next 16, Expo SDK, Sentry 11, Vitest 5 …) — mimo rozsah kola.
- Mimo C-57 zůstává:
  - `cron/resale-payouts` (výplaty prodejcům přeprodeje) dál zapisuje mock „paid"; přeprodej je vypnutá demo cesta;
  - automatická CZK výplata (FIO Business API) neexistuje — výplaty jdou ručně a potvrzují se.
- 21 live testových souborů běží jen proti Neon klonu (stav z kola 6).
