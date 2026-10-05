# PROGRESS — kolo 10 (poslední opravy před stagingem)

Větev `fix/round10-2026-10-04` z `5fa51c02` (PR #6). Výstupy `logs/r10/`.

## Krok 1 — Vercel build `nextjs-boilerplate`
- Nastavení z repa: `nextjs-boilerplate/vercel.json` (framework nextjs, `npm ci`, `npm run build` = prebuild copy-pdf-worker + `next build`),
  bez `engines`/`.nvmrc` → Vercel default Node 24 (lokálně v24.14.1).
- Historie statusů na master: první `failure` 6d661fb3 (2026-08-13), d4b43f4f (2026-08-14); starší commity status nemají
  (`logs/r10/1_vercel_status_history.txt`). Tentýž den 798bbea6 přesměroval `db().connect()` na přímý (odvozený) endpoint.
- Reprodukce: čistý klon, `npm ci` OK, `next build` s prázdnými proměnnými z `.env.example`, bez `.env*` →
  **exit 1: „Error occurred prerendering page /api/postal-fees"** (`logs/r10/1_build_clean_node24.txt`).
  Příčina: GET() bez request se při buildu prerenderuje a `db().connect()` mimo try spadne. Stejný vzor (bez pádu, ale zapečený stav
  z buildu) u `/api/health/db` a `/api/public/incidents`.
- Oprava 07e68c63: `export const dynamic = 'force-dynamic'` + test `tests/fix-r10-build-static-db-routes.test.ts` RED (3) → GREEN.
  Čistý build po opravě **exit 0** (`logs/r10/1_build_clean_node24_after.txt`).
- Zda je to přesně příčina na Vercelu: ověří status „Vercel – nextjs-boilerplate" na PR (logy Vercelu nečtu — produkční služba).

## Krok 2 — neověřené běhy z kola 9 (DB r10a od nuly z migrací, 0 chyb)
- Live sada se simulátorem GoPay přes PgBouncer: **81/81 souborů** (21 skip jen Neon) — refundy `fix-k2-refund` 5/5,
  `fix-k3-capacity` 5/5, `fix-r3-escalations` 17/17, `fix-r6-bulk-refund-gateway`, `webhook-refunded` zelené (`2_live_suite_r10a.txt`).
- Audity proti serveru (:3200) + simulátor: 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · **05 7/1** · 06 21/0 · 07 6/0 · 07b · 08 0 úniků ·
  09 12/0 · 10 7/0 · 11 8/0 · **12 5/0** (oprava kapacity z kola 9 drží; samostatně po 01 padá jen příprava — akci publikuje 02).
- **Turné (Playwright) 10/10** (`2_tour.txt`, screenshoty `logs/r10/tour/`, vizuálně zkontrolováno).
- Audit 05 C2c = skutečná vada: duplicitní potvrzovací e-mail při opakovaném dokončení → oprava e3e18aa2
  (test RED 2/3 e-maily → GREEN; live sada 82/82, unit 660, tsc 0, lint bez nárůstu). Audit 05 znovu proti serveru: viz níže.

## Krok 1 — pokračování: Vercel padá dál, mimo Vercel nereprodukovatelné
- Status „Vercel – nextjs-boilerplate" na 0e97e050 (už s opravou postal-fees): **failure** po ~6 min (pending 16:53:26 → failure 16:59:20),
  deployment `dpl_4fLvsSzEBkdvQfWK7ZeSx3PefUus`. Oprava postal-fees byla skutečná vada buildu bez DB, ale Vercel padá na něčem dalším.
- Linux `node:24` (v24.21.0) v Dockeru, čistý klon, `npm ci`, prázdné env z `.env.example`: **BUILD_EXIT=0** (`1_build_linux_node24.txt`).
- Totéž s `DATABASE_URL` na nesměrovatelnou dokumentační IP 192.0.2.1 (zaseknuté spojení): **BUILD_EXIT=0**, 2 min 8 s (`1_build_linux_db_hang.txt`).
- `vercel.json` se od 2026-08-06 do 2026-10-04 neměnil; selhávající commity 6d661fb3 a d4b43f4f mění jen dokumentaci.
  → Příčina je v prostředí Vercelu (proměnné, nastavení projektu, limity plánu, balení funkcí). Logy Vercelu nečtu — viz report, co zkopírovat.

### Krok 1 — doplněk: historie deployů (GitHub Deployments API, ne Vercel)
- Poslední **úspěšný** deploy `nextjs-boilerplate`: **ec58191a, 2026-07-04** (Production); předtím deploye střídavě padaly
  (07-01 4× failure, 07-04 failure → success po „fix(build): self-host pdfjs worker"). Mezi 07-04 a 08-14 žádný deploy neproběhl.
  „Padá od 2026-08-14" = první pokus po 6 týdnech. `logs/r10/1_gh_deployments.tsv`.
- Od ec58191a se nezměnil `package.json`, lockfile ani `next.config`; crony v `vercel.json` ubyly (31 → 29 po kole 10).
- Projekt „tixly" (prochází) nemá `vercel.json` s crony; `nextjs-boilerplate` má 17 z 29 cronů častěji než 1× denně
  (Hobby tarif to nedovolí — hypotéza, ověřitelná jen ve Vercelu).

## Krok 3 — nedokončené cesty vypnuté (51ca2ff7, ověřeno na serveru 7c9af1d7)
- Přepínače `NEXT_PUBLIC_FEATURE_INSTALLMENTS / _SUBSCRIPTIONS / _BENEFIT_CARDS`, výchozí vypnuto.
- Test `fix-r10-launch-flags` RED 23 → GREEN 27/27; `fix-r10-lastminute-cron.live` RED (42703 `lr.promoter_id`) → GREEN 2/2.
- Server: stránky/API předplatného 404, checkout twisto/pluxee/useSubscription/paymentPlanId → 422 FEATURE_DISABLED,
  lastminute GET bez/špatné tajemství 401, s tajemstvím 200; dispatcher payouts-execute 422 (`5_step3_http.txt`).
- Screenshot checkoutu: jen Karta / Převodem / Wero / Firemní kredit (`5_checkout_flags_off.png`).
- Výplaty ručně (payouts-execute neregistrován, CZK/FIO → `awaiting_manual_transfer`, potvrzení adminem).
- Audit 05 znovu: **8/0** (C2c 10 e-mailů / 10 objednávek); audit 10: 7/0 (D3a upraven na vypnuté předplatné).

## Krok 4 — e-maily stagingu přes Resend (a3d6600c, 7c9af1d7)
- Allowlist v `sendMail` i `platform-notify`; pojistka: prázdný/neplatný allowlist → server skončí (exit 1).
- Testy: `fix-r10-staging-email` RED (e-mail mimo allowlist odešel) → GREEN 5/5; `staging-guard` RED 2 → GREEN 7/7.
- Boot: prázdný allowlist → exit 1; DB `prod-db.invalid` → exit 1; izolovaný staging naběhne.
- `smoke.sh` naostro proti izolovanému stagingu + simulátoru Resend: OK (`5_smoke_staging.txt`).
- **Poznámka:** RED běh testu platform-notify (před přidáním `RESEND_API_BASE_URL`) poslal 1 požadavek na skutečné
  `https://api.resend.com/emails` s falešným klíčem `re_test_r10` (nemohl nic odeslat). Žádný produkční hostitel Tixly.
