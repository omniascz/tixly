# ROUND 10 — poslední opravy před stagingem

Větev `fix/round10-2026-10-04` z `5fa51c02` (PR #6) → **PR #7**. Sloučeno do `integrate/2026-10-04`: PR #6 → `3648c81d`,
PR #7 → `cc1a8c51`. Master nepushnut, PR #2 nesloučen, žádný deploy, žádné spojení s produkčními hostiteli Tixly
(testy pojistek jen s `.invalid`). Výstupy `logs/r10/`, průběh `PROGRESS_R10.md`.

## 1. Krok 1 — Vercel build `nextjs-boilerplate`

**Nastavení z repa:** `nextjs-boilerplate/vercel.json` — framework nextjs, `installCommand: npm ci`, `buildCommand: npm run build`
(prebuild `copy-pdf-worker` + `next build`), bez `engines` / `.nvmrc` → Vercel default Node 24.

**Nalezená a opravená vada (07e68c63):** čistý klon, Node 24, `npm ci`, `next build` bez `.env*` jen s prázdnými proměnnými
z `.env.example` → **exit 1: „Error occurred prerendering page /api/postal-fees"**. Next 14 při buildu prerenderuje `GET()` bez
request; `/api/postal-fees` volá `db().connect()` mimo try. Stejný vzor u `/api/health/db` (zapekl by se navždy stav z buildu —
health probe by hlásil 503) a `/api/public/incidents`. Všechny tři `force-dynamic`; test `fix-r10-build-static-db-routes`
RED (3 routy) → GREEN; čistý build **exit 0**.

**Vercel ale padá dál** (status na 0e97e050 s opravou i na PR #2 `cc1a8c51`: failure po ~7 min, `dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8`).
Mimo Vercel nereprodukovatelné:
- Linux `node:24` (v24.21.0) v Dockeru, čistý klon, `npm ci`, prázdné env → **BUILD_EXIT=0**;
- totéž s `DATABASE_URL` na nesměrovatelnou dokumentační IP 192.0.2.1 (zaseknuté spojení) → **BUILD_EXIT=0** (2 min 8 s).

Historie (GitHub Deployments API — GitHub, ne Vercel): poslední **úspěšný** deploy `nextjs-boilerplate` je **ec58191a z 2026-07-04**;
už předtím deploye střídavě padaly (07-01 4×, 07-04 1×). Mezi 07-04 a 08-14 žádný deploy neproběhl — „padá od 08-14" je první
pokus po 6 týdnech. Od ec58191a se nezměnil `package.json`, lockfile, `next.config` ani nastavení buildu; crony ubyly.
Projekt „Vercel – tixly" (prochází) `vercel.json` s crony nemá; `nextjs-boilerplate` má 17 z 29 cronů častěji než 1× denně, což
tarif Hobby nedovolí — **hypotéza, ověřitelná jen ve Vercelu**.

**Co má vlastník zkopírovat** (Vercel → projekt `nextjs-boilerplate` → Deployments → deployment `dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8`
(PR #2, commit `cc1a8c51`) → **Build Logs**, nebo `npx vercel inspect dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8 --logs`):
1. **prvních ~15 řádků** (Vercel CLI verze, „Running build in …", „Cloning …", Node.js verze, „Running install command");
2. **posledních ~60 řádků až po konec** — od posledního výpisu Next (`Generating static pages` / tabulka rout) přes první řádek
   s `Error` / `Failed` až po `Command "npm run build" exited with …` nebo jinou závěrečnou chybu (`Deploying outputs`,
   `Serverless Function … exceeds`, `Hobby accounts are limited to daily cron jobs`, `out of memory`);
3. a z Settings → **Billing** aktuální tarif (Hobby / Pro).

## 2. Krok 2 — neověřené běhy z kola 9 (DB `r10a` od nuly z migrací, 0 chyb)

| Běh | Výsledek |
|---|---|
| Live sada se simulátorem GoPay přes PgBouncer | **81/81** souborů (21 skip jen Neon) — refundy `fix-k2-refund` 5/5, `fix-k3-capacity` 5/5, `fix-r3-escalations` 17/17, `fix-r6-bulk-refund-gateway`, `fix-r3-r5-webhook-refunded` zelené |
| Audit 12 (proti serveru, po 01–11) | **5/0** — oprava kapacity z kola 9 drží (cron 200, 9 objednávek expired, GA 4 → 20, sedadla volná) |
| Audity 01–11 | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · **05 7/1** · 06 21/0 · 07 6/0 · 07b · 08 0 úniků · 09 12/0 · 10 7/0 · 11 8/0 |
| Scénář turné (Playwright) | **10/10**, screenshoty `logs/r10/tour/` vizuálně zkontrolovány |

**Audit 05 C2c = skutečná vada, opravena test-first (e3e18aa2):** 11 potvrzovacích e-mailů na 10 objednávek. `order-completed` posílal
e-mail (a SMS) při každém volání; vydání vstupenek bylo idempotentní, ale běželo v autocommitu (advisory lock no-op). Oprava: vydání
v transakci + potvrzení jen z volání, které lístky čerstvě vydalo. Test `fix-r10-order-completed-email-once.live` RED (2 resp. 3 e-maily)
→ GREEN 2/2. Audit 05 po opravě **8/0** (C2c 10/10).

## 3. Kroky 3–4

### Krok 3 — nedokončené cesty vypnuté (51ca2ff7)
Přepínače `src/lib/features/launch-flags.ts`, **výchozí stav vypnuto** (zapíná jen `1`):

| Cesta | Vypnuto |
|---|---|
| Splátky (`NEXT_PUBLIC_FEATURE_INSTALLMENTS`) | checkout s `paymentPlanId` i BNPL Twisto / Skip Pay → **422 FEATURE_DISABLED**; API plánů (kupec, veřejné, pořadatel), mock-bnpl confirm, cron charge-installments → **404**; cron vyřazen z `vercel.json`; UI skryté (checkout, nastavení akce) |
| Předplatné (`…_SUBSCRIPTIONS`) | aktivace (`buyer/subscriptions`, `subscriptions/subscribe`) i checkout (abonentky, uplatnění `useSubscription` → 422) vypnuté; confirm, plány, balíčky, cron renew-subscriptions → 404; cron vyřazen; stránky `/subscriptions`, `/tixly-plus`, balíčky → 404; odkazy skryté |
| Benefitní karty (`…_BENEFIT_CARDS`) | checkout pluxee/sodexo/benefit_plus/edenred/gallery_beta/multisport → 422; callbacky → 404; UI skryté |
| payouts-execute | **neregistrován** (není ve `vercel.json` ani v `ALLOWED_JOBS`; dispatcher 422). **Výplaty jsou ruční:** admin je spustí v administraci, CZK/FIO výplata čeká ve stavu `awaiting_manual_transfer` (kolo 7), převod se odešle z bankovnictví a admin ho potvrdí |
| Cron lastminute | **GET s ověřením `isCronAuthorized`** (servisní kontext), výjimka v middlewaru jen pro tento GET. Odhalena 2. vada: dotaz četl neexistující `lr.promoter_id` → 42703 (cron by nefungoval ani s GET) — opraveno |

Testy: `fix-r10-launch-flags` (přímá API volání) **RED 23 → GREEN 27/27**; `fix-r10-lastminute-cron.live` přes skutečný middleware
**RED (42703) → GREEN**: s tajemstvím 200 + sleva uplatněna jednou, bez / se špatným tajemstvím 401. Testy zapnutých funkcí a demo-guardu
běží nově se zapnutým přepínačem (jinak by 404 prošlo naprázdno). Na běžícím serveru ověřeno: stránky i API 404, checkout 422,
lastminute 401/401/200, dispatcher payouts-execute 422; screenshot checkoutu bez BNPL a benefitních karet (`logs/r10/5_checkout_flags_off.png`).

### Krok 4 — e-maily stagingu přes Resend (a3d6600c, 7c9af1d7)
- `STAGING_EMAIL_ALLOWLIST` (adresy, `@domény`, plus-adresy) — filtr v `sendMail` (všechny e-maily přes SMTP) i v `platform-notify`
  (Resend HTTP API). Mimo allowlist se neodešle a zaloguje maskovaně (`[mailer] staging: příjemci mimo STAGING_EMAIL_ALLOWLIST — …: s***@blocked.invalid`).
- Pojistka: `TIXLY_ENV=staging` + prázdný / neplatný allowlist → **server skončí (exit 1)**. Nově `instrumentation.ts` při porušení
  pojistky ukončí proces — dřív Next jen hlásil chybu u každého požadavku a dál naslouchal.
- `smoke.sh`: doručení přes seznam odeslaných zpráv Resend API (`GET /emails`) místo Mailpitu.
- Upraveno: `vercel-preview.env.example`, `GO-LIVE-INVENTORY.md`, nový `scripts/staging/README.md`.
- Testy (Resend nahrazen simulátorem `tests/helpers/fake-resend.mjs`, SMTP + HTTP): `fix-r10-staging-email` **RED** (e-mail mimo allowlist
  odešel) **→ GREEN 5/5**; `staging-guard` RED 2 → GREEN 7/7. Boot: prázdný allowlist → exit 1; DB `prod-db.invalid` → exit 1;
  izolovaný staging naběhne a **`smoke.sh` proti němu projde** (povolená adresa v seznamu odeslaných, blokovaná ne).

Lokálně na hlavě větve kola (= obsah `cc1a8c51`): unit 695, live 83/83 (21 skip Neon), tsc 0, lint bez nárůstu, shellcheck 0; v GitHub Actions na `cc1a8c51` zelené.

## 4. Krok 5 — sloučení a CI
- **PR #6** → `3648c81d`, **PR #7** → `cc1a8c51` (`gh pr merge --merge`), oba po zelených GitHub Actions.
- **PR #2** (`integrate → master`, hlava `cc1a8c51`): **všechny GitHub Actions zelené** — CI (typecheck, lint, unit), live sada,
  RLS verify, schema drift, Gitleaks, 4 dependency audity (RLS verify proti produkci záměrně přeskočen). **„Vercel – nextjs-boilerplate":
  failure** (viz §1). „Vercel – tixly": success.
- Lokální `tixly/` na `integrate/2026-10-04` (fast-forward).

## 5. Seznam pro vlastníka — změny oproti kolu 9
1. **Vercel log** z `dpl_HWWquhd3qMF8yL6ShQXxJ4f713K8` (přesně viz §1) + tarif z Billing. Bez toho příčinu nelze určit.
2. **Staging e-mail (nové, povinné):** `STAGING_EMAIL_ALLOWLIST` (adresy testerů), `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`,
   `SMTP_PASS=re_…` (klíč Resend stagingu), `RESEND_API_KEY` = týž klíč, `EMAIL_FROM` / `MAIL_FROM` na doméně ověřené v Resendu,
   `PLATFORM_ADMIN_EMAIL` z allowlistu. Mailpit pro staging už není potřeba.
3. **smoke.sh:** nově `RESEND_API_KEY` a `STAGING_SMOKE_EMAIL` (adresa z allowlistu); turné jen volitelně `--tour` s `MAILPIT`.
4. **Nenastavovat** `NEXT_PUBLIC_FEATURE_INSTALLMENTS / _SUBSCRIPTIONS / _BENEFIT_CARDS` (ani v produkci, ani na stagingu).
5. **Výplaty pořadateli ručně** (payouts-execute neběží): spustit v administraci, převést z bankovnictví, potvrdit převod.
6. Kolo 10 **nepřidalo migrace** — seznam chybějících migrací pro produkci je beze změny oproti kolu 9 (`scripts/prod/pending-migrations.sh`).

## 6. Co se nepodařilo a proč
- **Příčina pádu Vercel buildu nenalezena** — mimo Vercel build prochází (Windows i Linux, Node 24, prázdné env i zaseknutá DB);
  logy jsou jen ve Vercelu (produkční služba, nečetl jsem). Opravená vada `/api/postal-fees` byla skutečná, ale nestačila.
- **Neověřeno proti skutečnému Resendu:** tvar seznamu odeslaných (`GET /emails` → `{data:[{to:[…]}]}`) v simulátoru i ve `smoke.sh`
  vychází z dokumentace Resend API, ne z běhu proti Resendu (nemám klíč). Pokud by se lišil, smoke selže hláškou s ukázkou odpovědi.
- **Jeden požadavek na skutečné `api.resend.com`:** RED běh testu `platform-notify` (před přidáním `RESEND_API_BASE_URL`) poslal 1 POST
  s falešným klíčem `re_test_r10` — Resend ho nemohl přijmout; produkční hostitel Tixly to není. Od opravy jde vše na simulátor.
- Scénář turné na Resend stagingu nejde (čte PDF vstupenek z Mailpitu a posílá na `@tixly.test`) — smoke má vlastní e-mailový krok.
- Administrace pořadatele pro plány předplatného a abonentky zůstává přístupná (bez možnosti nákupu kupcem) — mimo rozsah zadání.
