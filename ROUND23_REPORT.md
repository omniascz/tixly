# Kolo 23 — report (2026-10-16)

Cíl kola: sloučit Kolo 22 (PR #19) podle varianty A a opravit chybu, kdy se platba Wero nabízela i v produkci a skončila chybou 500
až po založení objednávky. Větev `fix/round23-wero-2026-10-16`, PR #20 → `integrate/2026-10-04` **sloučen** (`f2ba850c`).
Průběh je v `PROGRESS_R23.md`, logy v `logs/r23/`.

## 1. Krok 0

- **HEADy:**
  - integrate/2026-10-04 před: `6799fb5b` (lokál = origin). Po sloučení PR #19: `514b1215`. Po sloučení PR #20 v tomto kole: `f2ba850c`.
  - master lokálně `3ab73410` (záměrně jiný, neměnil jsem ho), origin/master `d4b43f4f`.
  - fix/round18-staging-2026-10-14: `716fe3c9` (beze změny). Head PR #19: `03ddf755` (= očekáváno).
  - Zdroj: `logs/r23/0_state.md`.
- **Viditelnost repa:** `{"visibility":"PUBLIC"}`.
- **Cizí commity** po 6799fb5b: na integrate ani na master žádné.
- **Necommitnuté změny:** žádné (`git status` prázdný).
- **Diff 5696a8f5..03ddf755 v kódu:** `git diff 5696a8f5 03ddf755 -- nextjs-boilerplate e2e` je prázdný, mění se jen logy, reporty,
  `.gitleaksignore` a výstupy auditů (`0_pr19_build.txt`). Build Kola 22 (`logs/r22/1_green_build.txt`,
  `logs/r22/9_build_no_network.console.txt` → „OK", exit 0) proto platí. Nový build jsem kvůli prázdnému diffu nepouštěl.
  Kvůli kroku 0.9 a RED jsem pak lokálně sestavil 514b1215 (`0_build.txt`, rc=0). První pokus o build (`0_build_try1_timeout.txt`)
  přerušil můj 10min limit při generování stránek.
- **Ruční Security a RLS Gate na 03ddf755** (`0_pr19_checks.txt`), oba **success**:
  - **Security 38864262906:** Gitleaks (5 kroků) a Dependency audit e2e / mobile / mobile-promoter / nextjs-boilerplate (po 8 krocích).
  - **RLS Gate 38864266050:** RLS verify (DB z migrací) 11 kroků; produkce skipped (záměrně).
  - Na stejném head byly už předtím success: CI 38808832709 (Install·typecheck·lint·unit, Live sada, Build bez sítě)
    a Schema drift 38808840007.
- **Vercel na 03ddf755:** Vercel – nextjs-boilerplate i Vercel – tixly mají commit status `failure` s popisem **„Deployment was blocked"**.
  Podle varianty A je to očekávaný stav.
- **Merge commit PR #19:** `gh pr merge 19 --merge` → **`514b1215eeaab0a227065539627febe5466bfcae`**. Lokální tixly/ jsem
  fast-forwardoval na 514b1215.
- **Běhy na novém HEAD integrate 514b1215** (`0_after_merge.txt`): spustila je událost pull_request PR #2. Push na integrate/* workflow
  nespouští, protože `push` v ci.yml a schema-drift-guard.yml je jen pro main, master a fix/**.
  - CI 38864481449, RLS Gate 38864481419, Security 38864481417, Schema Drift Guard 38864481412 — vše **success**.
- **PR #2:** OPEN, MERGEABLE, mergeStateStatus UNSTABLE (kvůli failure statusům Vercelu). `gh pr checks 2`: všechny joby GitHubu pass,
  „RLS verify (produkce)" skipping, Vercel ×2 „Deployment was blocked" → kritérium splněno.
- **%TEMP%\r22-clean:** smazána (`0_cleanup.txt`). Šlo o samostatný klon s vlastním `.git` (ne worktree, `git worktree list` ho neuvádí),
  HEAD 5696a8f5, 2757 MB, žádný proces ji nepoužíval. Nic jiného v %TEMP% jsem nemazal; výjimkou je vlastní klon `r23-clean` z tohoto
  kola (viz Závěr).
- **staging.keys.env:** neexistuje; `git check-ignore -v` → `.gitignore:105:staging.keys.env`. Staging jsem v tomto kole nedělal.
- **Ověření Kola 22 na 514b1215** (`0_verify_r22.txt`):
  - `golden-path-r22-qr-local.spec.ts` → **2 passed**. Spec má od K22 dva testy, (a) 2FA a (b) dárek; zadání uvádí „1 passed".
  - 0 požadavků mimo localhost, pixely QR shodné.
  - `grep api.qrserver.com nextjs-boilerplate/src` → jen `src/app/admin/events/[id]/kiosk-display/page.tsx:21`.

## 2. Krok 1 — Wero jen tam, kde je mock brána povolená

Spec `e2e/tests/golden-path-r23-wero.spec.ts` (mezi RED a GREEN beze změny):
- Běží nad `next start` (NODE_ENV=production) s DB r23demo, která vzniká migracemi od nuly + `seed-demo.sql`. Aplikace běží pod tixly_app
  s RLS, k tomu simulátor GoPay :3998.
- Každý požadavek prohlížeče mimo localhost se zaznamená a zahodí (`route.abort()`); zahozeno bylo 0.
- Konfigurace P = server bez `ALLOW_MOCK_PAYMENTS`, konfigurace D = `ALLOW_MOCK_PAYMENTS=1`. Konfigurace se volí přepínačem
  v `logs/r23/serve_r23.sh` a test podle ní přes `-g "\(P\)"` / `-g "\(D\)"`.
- Tělo POST pro (b) je tělo, které stránka skutečně poslala při kontrolní objednávce s gopay. Liší se jen jiným místem / holdem,
  e-mailem a `paymentMethod: "wero"`.
- Objednávky se čtou pod tixly_app (ověřeno `current_user`, bez BYPASSRLS) v transakci s RLS kontextem promotéra akce.

| bod | RED (514b1215; `logs/r23/1_red.txt`) | GREEN (`logs/r23/1_green.txt`) | commit |
|---|---|---|---|
| a1 Karta / Převodem viditelné | true / true | true / true | RED 86f1287b, GREEN 315a2930 |
| a2 žádné Wero | `input[value="wero"]` = **1**, text „Wero" = **1** → FAIL | 0 / 0 | 86f1287b / 315a2930 |
| b1 POST wero | **500** `{"error":"Internal server error"}`; v logu serveru „No real payment provider configured in production (refusing mock fallback)" → FAIL | **503** `PAYMENT_METHOD_UNAVAILABLE`, `provider: "wero"`, hláška viz níže | 86f1287b / 315a2930 |
| b2 objednávky kupce před / po | 0 / **1** → FAIL | 0 / 0 | 86f1287b / 315a2930 |
| b3 dostupnost před / po | remainingQty 59 → **58**, místo held → **sold** → FAIL | 59 → 59, held → held | 86f1287b / 315a2930 |
| pojistka (gopay přes stránku, jiný e-mail) | 200, gatewayUrl `http://localhost:3998/gw/…`, 1 objednávka v DB | totéž | — |
| c (D: Wero, nápověda, POST wero) | 1 passed: Wero viditelné, nápověda „Wero — okamžitá platba z účtu", 200 `mock-wero`, `/mock-wero/mock-pay-…`, 1 objednávka | 1 passed (totéž) | 86f1287b / 315a2930 |
| unit/live ticket-types `weroAvailable` (6 případů NODE_ENV × ALLOW_MOCK_PAYMENTS; tixly_app, DB z migrací) | 6 failed — `expected {…} to have property "weroAvailable"`; status 200 a 1 typ vstupenky prošly (`1_unit_red.txt`) | 6 passed (`1_unit_green.txt`) | 86f1287b / 315a2930 |

**Změna tří souborů** (`logs/r23/1_fix_diff.txt`, +28 −2):
- `nextjs-boilerplate/src/app/api/checkout/route.ts`: před opravou krypto guard ř. 287–302, hned za ním ř. 305 guard program-bookletu,
  `BEGIN` na ř. 330.
  - Po opravě je nový blok **ř. 305–320** (komentář + `if (input.paymentMethod === 'wero')`). Uvnitř je `mockPaymentsAllowed()`
    z `@/lib/payment/mock-guard`; když vrací false, vrátí se 503 `{ error: 'PAYMENT_METHOD_UNAVAILABLE', message, provider: 'wero' }`.
  - Blok stojí za krypto guardem a před `BEGIN`, který je teď na ř. 347.
- `nextjs-boilerplate/src/app/api/events/[id]/ticket-types/route.ts`:
  - ř. 8 nový `import { mockPaymentsAllowed } from '@/lib/payment/mock-guard';`.
  - ř. 105–106 (před opravou za ř. 103 `legacyPaymentGateways`) komentář + `weroAvailable: mockPaymentsAllowed(),`.
  - Jinak se odpověď nemění.
- `nextjs-boilerplate/src/app/[locale]/checkout/page.tsx`:
  - ř. 85–86 komentář + `const [weroAvailable, setWeroAvailable] = useState(false);`.
  - ř. 314 typ `weroAvailable?: boolean;` a ř. 325 `setWeroAvailable(d?.weroAvailable === true);` (vedle `setLegacyGateways`).
  - Label Wero, před opravou ř. 1154–1168, je teď obalený `{weroAvailable ? (` (ř. 1158) … `) : null}` (ř. 1174); vnitřní markup
    se nezměnil.
  - Nápověda: `{paymentMethod === 'wero' && (` → `{weroAvailable && paymentMethod === 'wero' && (` (ř. 1178), komentář doplněn.
- `provider.ts`, `mock-guard.ts` ani další routy jsem neměnil. Bez migrací a bez nových závislostí.
- tsc 0 (`1_tsc.txt`). eslint tří souborů: 29 nálezů před i po změně, po seskupení shodné (`1_lint_orig.txt` / `1_lint_files.txt`).

**Nový text (chybová hláška API):** `Platba Wero není momentálně dostupná. Zvolte prosím jinou metodu.`

**Snímky sekce „Platební metoda"** (`logs/r23/shots/`, rozbor `1_shots_compare.txt`):
- **D (Wero povolené):** výchozí stav `1_red_D_default.png` = `1_green_D_default.png` (398×136) a stav po výběru Wero s nápovědou
  `1_red_D_wero_selected.png` = `1_green_D_wero_selected.png` (398×238) — **0 odlišných pixelů**.
- **P:** `1_red_P_default.png` 398×136 → `1_green_P_default.png` 398×132.
  - Chybí dlaždice Wero.
  - Dlaždice Wero měla dvouřádkový popisek a byla nejvyšší v 1. řadě gridu. Bez ní je řada Karta / Převodem o 4 px nižší a obsah
    těchto dlaždic (`items-center`) o 2 px výš.
  - Blok „Firemní kredit" je posunutý o 4 px nahoru a jinak pixelově shodný (54 řádků). Legenda a horní okraj (ř. 0–31) jsou shodné.
  - Markup ostatních voleb se nezměnil. Rozdíl výšky ale není „jen chybějící volba". Je to přímý důsledek toho, že grid přizpůsobuje
    výšku řady nejvyšší dlaždici.

## 3. Krok 2 — ostatní cesty s Wero (jen čtení, `logs/r23/2_wero_routes.md`; řádky k 514b1215)

| routa | dosažitelná v produkci | založí záznam před platbou (s `wero` v produkci) | nabízí ji UI |
|---|---|---|---|
| `POST /api/checkout/party-split/[token]` | ANO, s tokenem otevřené session: enum `route.ts:120`, handler `:124`, 404 bez session `:153-156`, 409 po uzavření `:158-162`; middleware optional-auth `src/middleware.ts:73`, `:175-178` | NE: `BEGIN` `:136`, rezervace slotu `:187-192`, `createPayment` `:199` před `INSERT INTO orders.orders` `:226` a `COMMIT` `:272`; výjimka → `ROLLBACK` `:282-283` → 500 s textem výjimky `:284-287` | NE (`grep party-split src --include=*.tsx` → 0) |
| `POST /api/season-passes` | ANO, bez přihlášení: handler `route.ts:60`, enum `:57`, middleware passThrough `src/middleware.ts:171-173`; je potřeba aktivní produkt `:86` (jinak 422 `:91`) | **ANO**: `BEGIN` `:73`, `INSERT INTO orders.orders` `:146-159`, `INSERT INTO orders.season_passes` `:169-183`, `COMMIT` `:185`, `createPayment` až `:187-196`; `ROLLBACK` `:213` po COMMITu nic nevrátí → 500 `:215`, objednávka + permanentka zůstanou (`expires_at` +15 min `:155`) | NE (UI volá jen `/api/season-passes/[passToken]`: `src/app/[locale]/season-pass/[passToken]/page.tsx:73,103`) |
| `POST /api/v1/wl/orders` | ANO, jen s platným WL tokenem: `verifyWlToken` → 401 `route.ts:80-86`, enum `:58` | NE: `BEGIN` `:104`, `createPayment` `:167-176` před `INSERT INTO orders.orders` `:180`, `order_items` `:215`, `payment_events` `:228`, `COMMIT` `:235`; výjimka → `ROLLBACK` `:248-249` → 500 s textem výjimky `:251-253` | NE v aplikaci (API pro externí klienty tenanta) |
| `POST /api/buyer/modular-pass/checkout` | ANO: handler `route.ts:39`, enum `:34-36`, optional-auth `src/middleware.ts:73`; je potřeba typ s modular pricing (dotaz `:73-83`, 404 `:84-90`) | `createPayment` se nevolá vůbec. `INSERT INTO orders.orders` `:176-196` (provider = zvolená metoda `:191`), `order_items` `:198-202`, `COMMIT` `:205`, vždy `gatewayUrl /mock-gopay/…` `:253`, `:258` → záznam vzniká pro každou metodu. Mock-gopay v produkci 403 (`api/mock-gopay/[paymentId]/route.ts:14`) | NE pro Wero (`build-pass/page.tsx:126-136` posílá napevno `'gopay'`) |
| (`POST /api/checkout` — opraveno v kroku 1) | ANO (`route.ts:71-74`) | ANO před opravou (`COMMIT` `:2244` → `createPayment` `:2495`), po opravě 503 před `BEGIN` | ANO před opravou (`page.tsx:1154-1168`), po opravě jen při `weroAvailable` |

Kód těchto rout jsem neměnil. Stejnou vadu (záznam před platbou, 500 až po COMMITu) má v produkci jen přímé volání
`POST /api/season-passes`; žádné UI ho nenabízí. Modular-pass nezakládá platbu vůbec. To je samostatná vada, která s Wero nesouvisí.

## 4. Kompletní lokální sada, CI, sloučení

Kód sady je 100913b8 (src = 315a2930, totožný s PR #20).

| oblast | výsledek | log (`logs/r23/`) |
|---|---|---|
| migrace od nuly | FAILED_FILES=0 (r23a ×6 + r23demo v každém golden bloku) | `1_build_db_r23a.txt`, `9_build_db_r23a_*.txt`, `*_reset.txt` |
| typecheck | 0 chyb | `9_tsc.txt` |
| lint | **967** (baseline 1008, nevzrostl) | `9_lint.txt` |
| unit | 735 passed + 13 skip (80 souborů) | `9_unit.txt` |
| live po částech | **493 passed + 1 skip**: n00 83, n01 49, n02 73, n03 46 (+6 nový live test), webhook_pool 2, g00 163 + 1 skip, g01 77 | `9_live_summary.txt`, `live/*.txt` |
| build | OK (rc=0, kód src = HEAD) | `1_green_build.txt` |
| build bez sítě (čistý klon 100913b8) | „OK — build prošel bez jediného síťového spojení z kódu aplikace", exit 0 | `9_build_no_network.console.txt` |
| audity 01–12 vč. 07b, 08 | 0 FAIL (07b: 0 zápisů) | `9_audits_summary.txt` |
| turné | 10/10 na 3. pokus; pokusy 1 a 2: test 3 blokace, `:422:42` block-create disabled (známý souběh) | `9_tour.txt`, `9_tour_try1.txt`, `9_tour_try2.txt`, `tour/` |
| golden r13-keep / r16-prehydration / r20 / r21 | 10 / 12 / 3 / 1 = **26 passed**; token= s hodnotou v obálkách Sentry 0 | `9_golden.txt`, `9_golden_summary.txt` |
| golden r22-qr-local + r23-wero (P) / r23-wero (D) | 2 + 1 passed / 1 passed | `9_golden_r22_r23P.txt`, `9_golden_r23D.txt` |
| offline skener | 6/6 | `9_offline.txt` |
| Gitleaks lokálně | 5 fingerprintů testovacích dat v 0888caa3 → `.gitleaksignore`, pak „no leaks found" | `9_gitleaks_triage.md` |

**První pokus golden** (`9_golden_try1.txt`) pouštěl všech 5 specs v jednom bloku: 26 passed, 2 failed.
- **r22 (b):** GET seats 404. Spec r13-keep (`:124`) ve stejné DB ruší termín Hamlet Ostrava (504), na kterém r22 (b) nakupuje.
- **r16 „registrace pořadatele":** selhala pojistka „pole se mělo vyplnit před hydratací". Je to otázka časování stroje.
- **Opakování:** bloky jsem rozdělil jako K22 (r13/r16/r20/r21 zvlášť, r22 zvlášť) a všechno prošlo. Specy ani stránky jsem neměnil.

**PR #20** (`logs/r23/9_pr20.txt`, head 42f56dfa):
- **CI 38879833647:** Install·typecheck·lint·unit pass, Live sada pass, Build bez sítě pass. **Schema drift** 38879922087 pass.
- **Ruční Security 38880275851 success:** Gitleaks + Dependency audit ×4.
- **Ruční RLS Gate 38880109450 success:** RLS verify z migrací 11 kroků; produkce skipped.
- **Vercel – nextjs-boilerplate a Vercel – tixly:** `failure` s popisem „Deployment was blocked" (projekty pozastavené), nic jiného.
- **Sloučení:** `gh pr merge 20 --merge` → merge commit **`f2ba850c13d21ba1cf0a264199b4f34049e9b80d`**. Lokální tixly/ jsem
  fast-forwardoval na integrate.
- CI push na RED commitu 86f1287b (run 38867960828) skončil failure jen v Live sadě, a to jediným souborem
  `tests/r23-wero-ticket-types.live.test.ts`. Byl to očekávaný RED.

**Běhy na f2ba850c** (pull_request PR #2): CI 38880564041, RLS Gate 38880563988, Schema Drift Guard 38880563976, Security 38880563909 —
vše success.

**PR #2:** OPEN, MERGEABLE, UNSTABLE (kvůli Vercelu), head f2ba850c. Joby GitHubu pass, „RLS verify (produkce)" skipping,
Vercel ×2 „Deployment was blocked". PR #2 jsem nesloučil, master nepushnul a nic nenasadil.

Poslední commit na integrate je commit s tímto reportem (viz `git log integrate/2026-10-04 -1`); zapisuje se do K23.md.

## 5. Co nebylo ověřeno a proč

- **Build a chování ve Vercelu** — projekty jsou pozastavené („Deployment was blocked"). Podle varianty A se ověří až na PR #2 před
  spuštěním. Lokální build, build bez sítě v čistém klonu i CI build prošly.
- **Skutečná produkce** se neověřovala; spojení na produkční hostitele je zakázané. Konfigurace „P" je lokální `next start`
  (NODE_ENV=production) bez `ALLOW_MOCK_PAYMENTS`, tedy stejná podmínka jako v mock-guardu.
- **Kontrolní objednávky** (gopay v P, wero v D) zůstaly v lokální DB r23demo nezaplacené. DB se zakládá pro každý blok znovu.
- **(a2) a čekání na ticket-types:** test čeká na odpověď GET ticket-types a na dva snímky prohlížeče (rAF), ne na pevný timeout.
  Že se stav do té doby vykreslí, dokládá D: Wero se po stejném čekání ukáže.
- **Snímek P** se liší o 4 px výšky řady (viz krok 1). Je to důsledek layoutu gridu, ne změna markupu ostatních voleb.
- **Wero v ostatních routách** (season-passes, party-split, WL, modular-pass) jsem jen zmapoval. Podle zadání jsem je neměnil
  a ani nespouštěl.
- **Turné** prošlo až na 3. pokus a golden až po rozdělení bloků (viz kapitola 4). Testy ani stránky jsem neměnil.
- Při triáži Gitleaks se mi do konverzace dostala shareUrl s testovacím party-split tokenem z lokální DB r23a (localhost:3100).
  Skutečné tajemství to není a do repozitáře se nad rámec commitnutého logu nedostala.
- Vlastní klon pro build bez sítě `%TEMP%\r23-clean` jsem po úspěšném buildu smazal (žádný proces ho nepoužíval).
- Všechny procesy, které session spustila (next start :3200, simulátory GoPay a Sentry, vitest, playwright), jsou ukončené. Docker
  kontejnery fix-* i cizí jsem nechal běžet.
