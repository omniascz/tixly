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
