# PROGRESS — kolo 19 (@sentry/nextjs 8.55.2 → 11.x beze změny chování, restriktivní sběr údajů, tunel z prohlížeče)

Větev `fix/round19-sentry11-2026-10-15` z `origin/integrate/2026-10-04` (ed9afdc2). Výstupy `logs/r19/`. Skripty `logs/r19/`:
`reset_demo.sh` (r19demo z create.sh --local), `serve_r19.sh [build]` (:3200, SENTRY_DSN na simulátor :3995),
`run_sentry.sh <štítek>` (simulátor + server + spec `e2e/tests/golden-path-r19-sentry11.spec.ts`), `screens.sh <adr> <štítek>`
(28 screenshotů, spec kola 15), `stop_mine.sh` (ukončí jen vlastní next start :3200 a simulátor), `redact.mjs` (před commitem
masky tajemství a JWT v logs/r19), `routes.mjs` (tabulka rout + First Load JS), `audit_summary.mjs`.
Lokální služby fix-pg/fix-redis/fix-mail touto session nastartovány (byly zastavené).

## Krok 0 — výchozí stav a baseline ✅
- `0_state.md`: integrate lokál = origin = ed9afdc2; master lokál 3ab73410 (139 nepushnutých, záměrně), origin/master d4b43f4f;
  fix/round18 716fe3c9 (beze změny). Cizí commity po ed9afdc2: žádné. Necommitnuté změny: žádné.
  PR #2 CLEAN, všechny kontroly zelené vč. Vercel nextjs-boilerplate a tixly. `staging.keys.env` neexistuje.
- a) `0_audit.json`, `0_audit_summary.md`: info 0, low 1, moderate 27, high 23, critical 2 (53). High přes @sentry/nextjs,
  @sentry/webpack-plugin, @sentry/bundler-plugin-core, unplugin, rollup (+ @opentelemetry/* moderate, @sentry/node moderate).
- b) `0_build.txt`, `0_build_summary.md`, `0_routes.norm.txt`: 1124 rout (1119 ƒ, 5 ○); First Load JS sdílený 168 kB
  (54.4 + 109 + 3.89), Middleware 95 kB; největší /admin/orders 216 kB. Klientské .js.map v .next/static: 0.
- c) `0_sentry_baseline.txt` (+ `0_envelopes.jsonl`, `.raw.jsonl`, `0_sentry.txt`): (a) route handler DORAZÍ, (b) cron 502
  DORAZÍ, (f) 401/401/401. (c) chyba z prohlížeče NEDORAZÍ — DSN 127.0.0.1 není SaaS → SDK tunel nepoužije a přímé odeslání
  blokuje CSP connect-src; tunel samotný na baseline lokálně neověřitelný (SDK 8 přepisuje natvrdo na sentry.io).
  **Zjištění (d) už na SDK 8:** událost z route handleru nese request.cookies (accessToken JWT, cookie kupce), tělo
  požadavku se jménem kupce, telefon v URL-kódovaném dotazu (scrub ho nepozná), IP v x-real-ip/x-forwarded-for;
  transakce (beforeSend se na ně nevztahuje) nesou IP a hlavičku cookie.
- d) `0_screenshots/` 28 PNG (build 0, čerstvá r19demo).
- Simulátor `e2e/load/r14-fake-sentry.mjs` rozšířen: položky „span" (SDK 11) a celé obálky do `<výstup>.raw.jsonl`.

## Krok 1 — upgrade balíčku a konfigurace buildu ✅ (6a563c80)
- `npm install @sentry/nextjs@^11` → **11.7.0** (lockfile; `1_npm_install.txt`, `1_npm_ls.txt`: next 15.5.27 deduped, bez
  --force/--legacy-peer-deps, peer next ^14 || ^15 || ^16). Jiné balíčky jen tranzitivně (`1_lock_diff.txt`): rollup
  4.60.1 → 4.64.6 (sdílený s vite), dotenv/path-scurry jen přes @sentry/bundler-plugins.
- next.config.mjs: import `@sentry/nextjs/config` (dynamický s fallbackem jako dřív), `hideSourceMaps` pryč, `disableLogger`
  → `webpack.treeshake.removeDebugLogging: true`, `release.name` = APP_VERSION ?? NEXT_PUBLIC_APP_VERSION ??
  VERCEL_GIT_COMMIT_SHA (žádná nová proměnná), `sourcemaps.deleteSourcemapsAfterUpload: true` ponecháno (výchozí true —
  `node_modules/@sentry/nextjs/build/types/config/types.d.ts` „Defaults to `true`"), `tunnelRoute` beze změny.
- Audit (`1_audit*.json/md`, `1_audit_compare.txt`): 53 → 26 (high 23 → 18, critical 2 → 2 = vitest/tinypool, beze změny);
  high přes @sentry/nextjs, webpack-plugin, bundler-plugin-core, unplugin, rollup zmizely; nové advisories: žádné.
- Build (`1_build.txt`) exit 0, 0 řádků Sentry/deprecated/removed — ALE `silent: true` potlačuje build logger SDK
  (config/buildLogger.js) → ověření se `silent: false` u RED buildu v kroku 2. Tabulka rout identická (1124/1119/5);
  First Load JS sdílený 168 → 166 kB, Middleware 95 → 86.5 kB; klientské .js.map 0 (jako baseline).
- Typecheck (`npx tsc --noEmit`) 0. `// @ts-nocheck` PONECHÁNO: bez něj 6 chyb (`1_tsc_nocheck_removed.txt`) —
  beforeSend vrací `Record<string, unknown>` ze `scrubSentryEvent` (typ ErrorEvent nesedí); úprava configů patří do kroku 2
  (RED musí běžet na neupravených configech). `sendDefaultPii` v SDK 11 neexistuje (v build/ 0 výskytů) → dnes ignorováno.
- Pozn.: Next při buildu/startu načítá `nextjs-boilerplate/.env.local` (gitignored) — žádné SENTRY_* (žádný upload),
  síťové proměnné přepisuje serve_r19.sh na localhost (stejně jako kola 14–17).
- Build bez sítě v čistém klonu 6a563c80 (`1_build_no_network.console.txt`): OK, 0 síťových spojení.
- Varování SDK se `silent: false` (jen RED build, `2_red_build.txt` ř. 9–15, necommitováno): (1) chybí hook `onRequestError`
  v instrumentation („outdated configuration" — doporučení zachytávat chyby vnořených RSC; přidání = nové chování, nepřidáno);
  (2) chybí global-error.js (stejné jako na baseline); (3) „DEPRECATION WARNING" k NÁZVU souboru `sentry.client.config.ts`
  → `instrumentation-client.ts` (týká se Turbopacku; build je webpack) — ponecháno, přesun = změna načítání SDK v prohlížeči
  (+ onRouterTransitionStart); (4) bez auth tokenu se nenahrávají source mapy / nezakládá release; (5) „Sending telemetry
  data … to Sentry" — telemetrie webpack pluginu (viz níže). Žádné varování o odstraněné volbě (SDK hlásí jen unstable_*).
- **Telemetrie pluginu:** @sentry/bundler-plugins posílá ve výchozím stavu telemetrii na o1.ingest.sentry.io (i bez auth
  tokenu; core/sentry/telemetry.js). Buildy 0 a 1 (DSN nastaven) proběhly BEZ pojistky → pokus o odeslání telemetrie pluginu
  (verze pluginu/bundleru, ne data aplikace) na sentry.io pravděpodobně proběhl, nelze zpětně ověřit. Od RED buildu
  `logs/r19/net-guard.cjs` (NODE_OPTIONS) blokuje *.sentry.io na úrovni connect/DNS: build RED i GREEN 3× BLOCKED, nic jiného
  mimo localhost (`2_net_summary.txt`). Totéž dělá každý build s SENTRY_DSN na Vercelu (stejně jako s SDK 8).

## Krok 2 — osobní údaje a tunel ✅
- Prostředí: klient DSN `http://…@o1.ingest.sentry.io/1` jen jako řetězec (SDK tuneluje jen DSN ve tvaru SaaS,
  client/tunnelRoute.js; s DSN 127.0.0.1 by prohlížeč posílal přímo a CSP connect-src to blokuje), build s
  `_SENTRY_TUNNEL_DESTINATION_OVERRIDE=http://127.0.0.1:3995/api/1/envelope/?hsts=0` (config/withSentryConfig/tunnel.js) →
  routes-manifest přepisuje /api/monitoring jen na simulátor; prohlížeč smí jen na localhost (ostatní abort + host-resolver-rules
  *.sentry.io ~NOTFOUND). Server SENTRY_DSN 127.0.0.1:3995. Release: VERCEL_GIT_COMMIT_SHA při buildu (test release.name).
- RED (`2_red.txt`, commit 4627f02a — omylem se zprávou kroku 1, viz další commit): (a) (b) (c) (f) NEJSOU RED — tunel
  funguje bez úpravy middleware (/api/monitoring = passThrough, POST → 200) → middleware NEUPRAVEN. (d) RED: telefon v
  URL-kódovaném dotazu, jméno v těle, IP v x-real-ip/x-forwarded-for, span s hlavičkou cookie (e-mail); (e) RED: span
  user.ip_address. Jméno ve volném textu zprávy z prohlížeče = vada návrhu testu (nelze maskovat ani na SDK 8) → test upraven.
  Unit `tests/r19-sentry-scrub.test.ts` RED 6/7 (`2_unit_red.txt`).
- Úpravy: `scrub-pii.ts` — SENTRY_DATA_COLLECTION (MIGRATION.md „keep the v10 default" + deny authorization, cookie,
  x-internal-token, x-user-id, set-cookie), scrubSentrySpan (maže hlavičky identity/tajemství/IP, client.address, user.* kromě
  id; maskuje text), PHONE_RE i pro %2B/%20/+; scrubSentryEvent<T extends object>. Configy: `dataCollection`, `beforeSendSpan`,
  `sendDefaultPii` pryč (v 11 neexistuje), `@ts-nocheck` pryč (tsc 0, `2_tsc.txt`). Sampling, ignoreErrors, environment,
  runbook tagy, mazání hlaviček v beforeSend beze změny. Middleware beze změny.
- GREEN (`2_green.txt`): spec 1 passed — (a) 500 + událost, release 6a563c80… (release.name z VERCEL_GIT_COMMIT_SHA);
  (b) 502 + událost; (c) přes tunel 200, dorazí; (d)+(e) 0 nálezů v 64 obálkách / 205 spanech (38 z prohlížeče přes tunel);
  (f) 401×3. Grep jana@x.cz / 777 123 456 / Nováková / 10.255.255.1 / ip_address / {{auto}} = 0 (baseline 2/2/1/7/0/0).
  Typy: události shodné s r14 a baseline (Sentry kontrola, Cron charge-installments); transakce → streamované spany (SDK 11).
  Unit r14 5/5 + r19 7/7 (`2_unit_green.txt`), live `fix-r14-ops-monitoring` 18/18 (`2_live_ops_monitoring.txt`, DB r19a z
  migrací `9_build_db_r19a.txt`), lint změněných souborů 0.

## Krok 3 — beze změny chování a vzhledu ✅
- Build `3_build.txt` (HEAD 1b091be8, stejné prostředí jako baseline: oba DSN na simulátor 127.0.0.1:3995): tabulka rout
  **identická** s 0_build (1124 rout, 1119 ƒ / 5 ○; `3_routes_diff.txt` prázdný). First Load JS sdílený **168 → 166 kB**
  (−1,2 %), Middleware 95 → 86,9 kB, největší stránka /admin/orders 216 → 216 kB. Klientské .js.map 0.
- Pixelové porovnání (přesné, `logs/r19/compare.mjs` = r15-compare + max. rozdíl kanálu): běh 1 `3_compare.txt` 23/28,
  běh 2 `3b_compare.txt` **26/28** (≥ 25/28 kola 15). Stejný build mezi běhy 1 a 2 (`3_compare_self.txt`) 25/28 se stejnými
  místy → nedeterministický šum vykreslení. Odchylky (běh 2): 04-termin a 11-pokladna 1440 — 19 px, max. 6/255, hrany kruhového
  avataru „D" v hlavičce administrace (1360–1391, 23–31). Běh 1 navíc 07-firemni (28 px: avatar + 8 px zaobleného rohu
  1392–1399 × 755–762), 08-promo-kody (19 px avatar), 13-saly (23 px avatar + roh). Mobilní a veřejné obrazovky 28/28 beze změny.
- golden-path-r16-prehydration 12/12, golden-path-r13-keep 10/10 (`3_golden.txt`, čerstvá r19demo, SDK 11 v prohlížeči).
- Síť: všechny buildy/servery od RED přes net-guard — jediné nelokální pokusy 3× telemetrie pluginu na sentry.io na build,
  zablokované (`net_summary.txt`).

## Závěrečná sada (HEAD c7df116c = kód 1b091be8) ✅
- Migrace od nuly: r19a z 61 souborů, FAILED_FILES=0 (`9_build_db_r19a*.txt`, 4× čerstvě: live, audity, turné).
- tsc 0 (`9_tsc.txt`); lint 967 chyb, baseline 1008, žádná nová (`9_lint.txt`); unit 78 souborů / 719 passed, 13 skipped
  (`9_unit.txt`; kolo 16: 712 + 7 nových r19).
- Live (r19a, tixly_app, 1 worker, rozdělení kola 16, `live/`): n00 83 (1. běh 82 + 1× „Connection terminated due to
  connection timeout" v auth-reset-password; samostatně 2× 4/4, 3. opakování 429 = rate-limit z mých opakování; po vyčištění
  rl:* celý n00 83/83 `live/n00_run2.txt`), n01 49, n02 73, n03 40, g00 163 + 1 opt-in, g01 77, webhook-pool 2 (se simulátorem
  GoPay; bez něj ECONNREFUSED :3998 — `live/webhook_pool_bez_gopay.txt`) → 108 souborů, 487 testů.
- Build OK, routy identické (`3_build.txt`); build bez sítě v čistém klonu c7df116c OK, 0 spojení (`9_build_no_network.console.txt`).
- Audity (`9_audits_summary.txt`): 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b zápisy 0/0/0/0 (= kolo 16), 08 2,
  09 12, 10 7, 11 8, 12 5 — 0 FAIL. Sentry během auditů: 2 713 spanů, 0 e-mailů @audit.test, 0 hlaviček identity, 0 JWT.
- Turné 10/10 (`9_tour.txt`, screenshoty `logs/r19/tour`, logs/r8/tour vráceno). Sentry zachytil 2× „d.event_date_start.replace
  is not a function" (Server Component /[locale]/order-confirmation/[orderId], page.tsx:369) — STARÁ vada, stejná chyba je
  v server logu turné kol 14, 15 i 16; SDK ji jen hlásí. Neopraveno (mimo rozsah kola).
- golden-path-r13-keep 10/10, golden-path-r16-prehydration 12/12 (`3_golden.txt`, stejný kód), offline skener 6/6 (`9_offline.txt`).
- Síť (`net_summary.txt`): kromě zablokované telemetrie pluginu Sentry žádné spojení mimo localhost.
