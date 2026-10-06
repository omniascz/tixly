# PROGRESS — kolo 11 (oprava padajícího Vercel buildu)

Větev `fix/round11-build-2026-10-06` z `7a8ae83b`. Výstupy `logs/r11/`.

## Krok 1 — systémová oprava
- Staticky předgenerované (○) položky z výstupu `next build` (kolo 10): 9 — síť používají 4: `/api/health/ready` (DB+Redis),
  `/api/health/redis` (Redis), `/api/subscriptions/plans` (DB), `/sitemap.xml` (DB). Ostatní: `/api/graphql/schema` (SDL,
  záměrně force-static), `/api/public/push/vapid-key` a `/robots.txt` (jen env), `/icon.png`, `/apple-icon.png` (soubory).
  Kolo 10 už přepnulo `/api/postal-fees`, `/api/health/db`, `/api/public/incidents`.
- Proč visel Redis: node-redis 4 má výchozí `reconnectStrategy` = zkoušet donekonečna → `connect()` na nedostupný host nikdy neskončí.
- Opravy: 4 routy `force-dynamic` (sitemap + `revalidate = 3600`); `src/lib/redis/options.ts` (connectTimeout 5 s, max 2 opakování,
  disableOfflineQueue, limit 5 s na každý příkaz přes Proxy); `src/lib/db/pg-options.ts` (connectionTimeoutMillis 5 s,
  statement_timeout 15 s, query_timeout +1 s) pro všech 26 pg klientů; rls-pool ponechává výpůjčku 8 s (pg-pool ji používá i pro
  čekání na volné spojení pod náporem), přidán query_timeout; health routy 503 do 5 s (limit 4 s na kontrolu, souběžně).
- Test `fix-r11-network-timeouts` (adresa 10.255.255.1 — spojení visí): RED (health routy a getClient visely > 20 s, rls-pool 8 s,
  34 klientů bez voleb, 4 routy statické) → GREEN 11/11. `fix-r10-build-static-db-routes` rozšířen o import('pg') a Redis
  (na původním kódu RED: health/ready, health/redis). tsc 0, lint bez nárůstu, unit 706.

## Krok 2 — pojistka v CI (job „Build bez sítě (pojistka prerenderu)")
- `nextjs-boilerplate/scripts/ci/build-no-network.sh`: proměnné z `.env.example` prázdné, síťové (DATABASE_URL*, REDIS_URL, KV_URL,
  *_HOST, *_URL…) → 10.255.255.1 (spojení visí); `NODE_OPTIONS=--require scripts/ci/no-network-preload.cjs` obalí
  net.Socket.prototype.connect + net.connect/createConnection + tls.connect → při pokusu vypíše cíl, routu, stacktrace a skončí 97.
  Výjimka: fonts.googleapis.com / fonts.gstatic.com (next/font/google stahuje sám Next). Lokální `.env*` → skript odmítne běžet
  (nemaže je). prebuild + `next build` přímo (ne přes npm).
- Nanečisto (čistý klon opravené větve, `export const dynamic` dočasně odstraněn z /api/health/redis): **exit 1** —
  „[no-network-build] ZAKÁZANÉ SÍŤOVÉ SPOJENÍ BĚHEM BUILDU: net.connect → 10.255.255.1:6379 / routa/stránka: api/health/redis/route.js"
  (`2_guard_dryrun_fail.console.txt`); úprava vrácena (byla jen v dočasném klonu).

## Krok 3 — lokální RED → GREEN (čistý klon, Node 24, bez .env)
- **RED 7a8ae83** (síť → 10.255.255.1, bez pojistky): exit 1 po 8 min — „Error: Static page generation for /api/health/redis is
  still timing out after 3 attempts" (shodně s Vercelem; `3_red_7a8ae83_blackhole.txt`).
- **GREEN fix/round11** (s pojistkou): exit 0 za 3 min 17 s, 0 síťových spojení (`3_green_fix_guarded.*`). Statické zůstaly jen
  /api/graphql/schema, /api/public/push/vapid-key, /robots.txt, ikony.
