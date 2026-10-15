# Kolo 19 — @sentry/nextjs 8.55.2 → 11.7.0 (2026-10-15)

Větev `fix/round19-sentry11-2026-10-15` z `origin/integrate/2026-10-04` (`ed9afdc2`), sloučeno PR #16 (`f14ee9d6`).
Výstupy v `logs/r19/`, průběh v `PROGRESS_R19.md`. Sentry DSN mířilo jen na lokální simulátor
(`e2e/load/r14-fake-sentry.mjs`, 127.0.0.1:3995); od RED buildu `logs/r19/net-guard.cjs` blokoval *.sentry.io.

## 1. Krok 0 — výchozí stav a baseline

- HEADy: integrate/2026-10-04 lokálně = origin = `ed9afdc2`; master lokálně `3ab73410` (139 commitů nepushnutých,
  záměrně), origin/master `d4b43f4f`; fix/round18-staging-2026-10-14 `716fe3c9` (beze změny).
- Cizí commity po `ed9afdc2` na integrate ani na master: žádné. Necommitnuté změny: žádné.
- PR #2: CLEAN, všechny kontroly zelené (CI, Live sada, Build bez sítě, Dependency audit ×4, RLS verify, Schema drift,
  Gitleaks, Vercel – nextjs-boilerplate, Vercel – tixly). `staging.keys.env` neexistuje (pravidlo `.gitignore:105`).
- Audit (`0_audit_summary.md`): info 0, low 1, moderate 27, high 23, critical 2 (celkem 53); high přes @sentry/nextjs,
  @sentry/webpack-plugin, @sentry/bundler-plugin-core, unplugin, rollup; @opentelemetry/* moderate.
- Build (`0_build_summary.md`): 1124 rout (1119 ƒ, 5 ○); First Load JS sdílený 168 kB (54.4 + 109 + 3.89), Middleware 95 kB;
  5 největších: /admin/orders 216, /admin 213, /admin/payouts 211, /admin/events 210, /admin/reports/inhouse 209 kB.
- Sentry baseline (`0_sentry_baseline.txt`): (a) chyba z route handleru DORAZÍ, (b) cron 502 DORAZÍ, (c) chyba z prohlížeče
  NEDORAZÍ — SDK 8 tuneluje jen DSN ve tvaru SaaS a přímé odeslání na 127.0.0.1 blokuje CSP connect-src; tunel samotný na SDK 8
  lokálně ověřit nelze (přepis natvrdo na sentry.io). **Zjištění už na SDK 8:** událost z route handleru nesla
  `request.cookies` (accessToken, cookie kupce), tělo požadavku se jménem kupce, telefon v URL-kódovaném dotazu,
  IP v x-real-ip/x-forwarded-for; transakce (beforeSend se na ně nevztahuje) nesly IP a hlavičku cookie.
- 28 screenshotů (`0_screenshots/`).

## 2. Krok 1 — upgrade a konfigurace buildu

- @sentry/nextjs **11.7.0** (lockfile), peer `next ^14 || ^15 || ^16`, next 15.5.27 deduped, bez --force/--legacy-peer-deps
  (`1_npm_ls.txt`). Tranzitivně: rollup 4.60.1 → 4.64.6 (`1_lock_diff.txt`).

| volba | před | po | zdroj |
|---|---|---|---|
| import | `@sentry/nextjs` | `@sentry/nextjs/config` (dynamický, fallback beze změny) | MIGRATION.md (10→11) |
| hideSourceMaps | `true` | odstraněno | v8-to-v9.md |
| disableLogger | `true` | `webpack.treeshake.removeDebugLogging: true` | MIGRATION.md |
| sourcemaps.deleteSourcemapsAfterUpload | `true` | `true` (výchozí true) | `@sentry/nextjs/build/types/config/types.d.ts` |
| release.name | (z Build ID) | `APP_VERSION ?? NEXT_PUBLIC_APP_VERSION ?? VERCEL_GIT_COMMIT_SHA` | v8-to-v9.md |
| tunnelRoute | `/api/monitoring` | `/api/monitoring` | beze změny |

| audit | info | low | moderate | high | critical | celkem |
|---|---|---|---|---|---|---|
| před (0_audit) | 0 | 1 | 27 | 23 | 2 | 53 |
| po (1_audit) | 0 | 1 | 5 | 18 | 2 | 26 |

High přes @sentry/nextjs, @sentry/webpack-plugin, @sentry/bundler-plugin-core, unplugin, rollup zmizely; nové advisories 0
(`1_audit_compare.txt`). Zbylé high = eslint/typescript-eslint řetězec, critical = vitest/tinypool (beze změny).
- Build `1_build.txt` exit 0, 0 řádků Sentry s „deprecated"/„removed"; se `silent: false` (RED build) SDK neohlásil žádnou
  odstraněnou volbu. Typecheck 0. Build bez sítě v čistém klonu OK (0 spojení).
- `// @ts-nocheck`: v kroku 1 ponecháno (6 chyb typu `beforeSend`), v kroku 2 po typování `scrubSentryEvent<T>` **odstraněno**
  ze všech tří configů (tsc 0, `2_tsc.txt`).
- Commit `6a563c80` (a omylem znovu `4627f02a` se stejnou zprávou, obsahuje RED test kroku 2).

## 3. Krok 2 — osobní údaje a tunel

Test: `e2e/tests/golden-path-r19-sentry11.spec.ts` (prohlížečová část v Playwright) + unit `tests/r19-sentry-scrub.test.ts`.

| bod | RED | GREEN | commit |
|---|---|---|---|
| (a) route handler dorazí | ne (dorazí) | ano, release = SHA buildu | 1b091be8 |
| (b) cron přes dispatcher, 502 | ne | ano | 1b091be8 |
| (c) prohlížeč přes `/api/monitoring` | ne (tunel 200, dorazí bez úpravy) | ano | 1b091be8 |
| (d) žádné osobní údaje | ano (`2_red.txt`: telefon v URL, jméno v těle, IP v hlavičkách, cookie v atributu spanu) | ano, 0 nálezů v 64 obálkách / 205 spanech | 1b091be8 |
| (e) z `user` jen `id` | ano (span `user.ip_address`) | ano | 1b091be8 |
| (f) neveřejné /api/* bez přihlášení | ne (401/401/401 = baseline) | ano 401/401/401 | 1b091be8 |

- Úpravy: `scrub-pii.ts` — `SENTRY_DATA_COLLECTION` (bez userInfo, cookies, těl; hlavičky authorization, cookie,
  x-internal-token, x-user-id, set-cookie zakázané), `scrubSentrySpan`, PHONE_RE i pro URL kódování; configy
  `dataCollection` + `beforeSendSpan`, `sendDefaultPii` pryč (v 11 neexistuje). Sampling, ignoreErrors, environment,
  runbook tagy a mazání hlaviček v beforeSend beze změny.
- Grep (`2_envelopes_compare.txt`): jana@x.cz 0, 777 123 456 0, Nováková 0, 10.255.255.1 0, ip_address 0, {{auto}} 0
  (baseline 2/2/1/7/0/0). Typy událostí shodné s r14 a baseline; transakce → streamované spany (SDK 11).
- Middleware **beze změny**: `/api/monitoring` už propouští `src/middleware.ts:171–172`
  (`if (!isPlatformApi && !isPromoterApi && !isOptionalAuthApi) return passThrough();`), POST přes kontrolu stejného
  původu ř. 141. Výjimka se tedy nepřidávala; (f) dokládá, že ostatní cesty zůstaly 401.
- r14-sentry-scrub 5/5, r19 7/7, fix-r14-ops-monitoring 18/18 beze změny assertů. `POST /api/ops/sentry-check` → 500 jako
  na baseline, událost dorazí s release podle 1.2.

## 4. Krok 3 — beze změny chování a vzhledu

- Tabulka rout identická (`3_routes_diff.txt` prázdný). First Load JS sdílený 168 → 166 kB, Middleware 95 → 86,9 kB.
- Pixelově (přesně) **26/28** (`3b_compare.txt`), kolo 15 25/28. Odchylky: 04-termin a 11-pokladna 1440 px — 19 px,
  max. 6/255, hrany kruhového avataru „D" v hlavičce administrace (x 1360–1391, y 23–31). Stejný build proti sobě
  (`3_compare_self.txt`) dává 25/28 na stejných místech → šum vykreslování.
- golden-path-r16-prehydration 12/12, golden-path-r13-keep 10/10.

## 5. Závěrečná sada a sloučení

- Migrace od nuly FAILED_FILES=0; tsc 0; lint 967 (baseline 1008); unit 719 passed / 13 skipped (78 souborů);
  live 487 testů ve 108 souborech (n00 83, n01 49, n02 73, n03 40, g00 163 + 1 opt-in, g01 77, webhook-pool 2);
  build + build bez sítě OK; audity 01–12 vč. 07b a 08 0 FAIL; turné 10/10; golden-path 10/10 a 12/12; offline skener 6/6.
- CI na `b969736b`: Install·typecheck·lint·unit, Live sada, Build bez sítě, Schema drift pass; RLS Gate (ručně) pass;
  Security (ručně): Gitleaks + Dependency audit ×4 pass; Vercel – nextjs-boilerplate i Vercel – tixly pass.
- Gitleaks: ruční běh Security skenuje celou historii (`--all`) a selhával i na nálezech kol 9–16 (stejně jako plánovaný běh
  na master 2026-10-12). Triáž `logs/r19/9_gitleaks_triage.md`: 55 fingerprintů, vše testovací data / prázdná hodnota,
  skutečné tajemství 0.
- PR #16 sloučen `--merge` → `f14ee9d6`.

## 6. Co nebylo ověřeno

- Skutečné sentry.io (zakázáno): příjem událostí, tunel na skutečný ingest, release v Sentry UI.
- Nahrávání source map (bez SENTRY_AUTH_TOKEN) a vznik release v Sentry.
- Vercel produkce/preview s DSN (preview buildy prošly, ale bez Sentry proměnných se neověřovalo).
- Telemetrie build pluginu: buildy 0 a 1 proběhly bez pojistky → pokus o odeslání telemetrie pluginu na sentry.io nelze
  vyloučit (jen verze pluginu/bundleru). Plugin to dělá i na Vercelu s SDK 8; `telemetry: false` = rozhodnutí vlastníka.
- Nové proměnné: žádné.
- Stará vada mimo rozsah: „d.event_date_start.replace is not a function" na /[locale]/order-confirmation (page.tsx:369).
