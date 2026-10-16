# Co by obnášel upgrade @sentry/nextjs 8.55.2 → 11.x (v kole 16 se neprovádí)

Zdroje: oficiální průvodci getsentry/sentry-javascript — `docs/migration/v8-to-v9.md`, `docs/migration/v9-to-v10.md`,
`MIGRATION.md` (10 → 11), uložené v `logs/r16/sentry/`. @sentry/nextjs 11.5.0 má peer `next ^14 || ^15 || ^16` (Next 15.5 OK).
Proč: npm audit hlásí high přes @sentry/node, @sentry/webpack-plugin, rollup, OpenTelemetry (oprava jen v 11).

## Co se v kódu musí změnit (podle našeho použití)

| oblast | dnes u nás | změna při upgradu | zdroj |
|---|---|---|---|
| import do next.config | `import('@sentry/nextjs').withSentryConfig` | `@sentry/nextjs/config` (v 11 už není exportováno z hlavního balíčku) | MIGRATION.md 10→11, `@sentry/nextjs` |
| `hideSourceMaps: true` | v next.config | odstraněno bez náhrady (v 9) | v8-to-v9 `@sentry/nextjs` |
| `disableLogger: true` | v next.config | → `webpack.treeshake.removeDebugLogging` (v 11 odstraněno) | MIGRATION.md tabulka odstraněných voleb |
| `sourcemaps.deleteSourcemapsAfterUpload` | nastaveno (kolo 14) | od v 9 výchozí true — beze změny | v8-to-v9 |
| název release | odvozen z Build ID | v 9 už ne → nastavit `release.name` (jinak se releasy v Sentry nezakládají) | v8-to-v9 |
| `tunnelRoute: '/api/monitoring'` | prohlížeč posílá události přes naši routu | v 11 jde požadavek tunelu přes middleware; náš middleware neveřejné `/api/*` bez přihlášení odmítá → přidat `/api/monitoring` mezi veřejné prefixy / vyjmout z matcheru, jinak se chyby z prohlížeče ztratí | MIGRATION.md 10→11 `@sentry/nextjs` |
| osobní údaje | `sendDefaultPii: false` + `beforeSend` = `scrubSentryEvent` (kolo 14) | v 11 nahrazeno `dataCollection` s **povolenějšími výchozími hodnotami** (cookies, hlavičky, těla požadavků, user info) → nastavit explicitně restriktivně (`dataCollection: { userInfo: false, httpBodies: [], … }`), jinak by Sentry sbíral víc dat; `beforeSend` zůstává | MIGRATION.md „sendDefaultPii is replaced by dataCollection" |
| IP adresa uživatele | nesbírá se | v 10 řízeno `sendDefaultPii`, v 11 `dataCollection.userInfo` (výchozí true) → vypnout | v9-to-v10, MIGRATION.md |
| tracing | `tracesSampleRate: 0.1` | v 11 výchozí streamování spanů, `beforeSendTransaction` no-op (nepoužíváme) | MIGRATION.md |
| OpenTelemetry | nepoužíváme vlastní | `enableOpenTelemetrySetup` pro Next výchozí true — beze změny | MIGRATION.md |
| prostředí | Node 24, TypeScript 5.x | minimum Node 20.19.0, TypeScript 5.0.4 — splněno | MIGRATION.md |

## Ověření po upgradu (navrhovaný postup)
1. Simulátor Sentry z kola 14 (`e2e/load/r14-fake-sentry.mjs`): chyba z route handleru, z prohlížeče (přes tunnel) a selhání
   cronu musí dorazit, v obálkách 0 výskytů osobních údajů (jako `logs/r14/3_sentry_envelopes.jsonl`).
2. `POST /api/ops/sentry-check` po nasazení; release v Sentry s `release.name`.
3. Build bez sítě, velikost bundlu, tabulka rout, pixelové porovnání (SDK se načítá i v prohlížeči).

Odhad: střední rozsah (next.config, sentry.*.config, middleware), hlavní riziko = výchozí sběr dat v 11 a tunnel přes
middleware — obojí by bez úprav změnilo chování (víc osobních údajů / ztráta chyb z prohlížeče).
