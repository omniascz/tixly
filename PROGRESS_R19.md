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
