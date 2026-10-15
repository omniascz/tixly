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
