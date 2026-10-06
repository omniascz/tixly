# ROUND 11 — oprava padajícího Vercel buildu

Větev `fix/round11-build-2026-10-06` z `7a8ae83b` → **PR #8** (→ `96eb50ed`) a navazující **PR #9** (→ `7e7af821`), obě sloučené
do `integrate/2026-10-04`. Master nepushnut, PR #2 nesloučen, žádný deploy, žádné spojení s produkčními hostiteli (testy jen
s nesměrovatelnou 10.255.255.1). Výstupy `logs/r11/`, průběh `PROGRESS_R11.md`.

## 1. Routy a stránky přepnuté na dynamické vykreslení

Zdroj pravdy = tabulka rout z `next build`: staticky předgenerované (○) byly jen tyto položky se síťovým přístupem:

| Routa / stránka | Síť | Změna |
|---|---|---|
| `/api/health/redis` | Redis | `force-dynamic` (příčina pádu na Vercelu) |
| `/api/health/ready` | DB + Redis | `force-dynamic` |
| `/api/subscriptions/plans` | DB (při vypnutém přepínači by se navíc natrvalo zapekla 404) | `force-dynamic` |
| `/sitemap.xml` (`src/app/sitemap.ts`) | DB | `force-dynamic` + `revalidate = 3600` |

Už z kola 10: `/api/postal-fees`, `/api/health/db`, `/api/public/incidents`. Po opravě zůstávají statické jen položky bez sítě:
`/api/graphql/schema` (SDL, záměrně `force-static`), `/api/public/push/vapid-key`, `/robots.txt` (jen env), `/icon.png`,
`/apple-icon.png`. Žádná stránka (`page.tsx`), opengraph obrázek ani `generateMetadata` se předgenerováním nespouští — všechny
stránky jsou ve výstupu buildu `ƒ`. Test `fix-r10-build-static-db-routes` rozšířen o `import('pg')` a Redis (na původním kódu chytí
obě health routy).

## 2. Timeouty Redis a DB

**Proč to viselo:** node-redis 4 má výchozí `reconnectStrategy` = zkoušet donekonečna → `connect()` k nedostupnému hostu nikdy
neskončí chybou. pg bez `connectionTimeoutMillis` čeká na TCP spojení neomezeně.

- **Redis** (`src/lib/redis/options.ts`, všichni 4 klienti — fronta/rate-limit, obě health routy, health.integration):
  `socket.connectTimeout` **5 s**, `reconnectStrategy` nejvýš **2 opakování**, pak chyba; `disableOfflineQueue`; limit **5 s na každý
  příkaz** (node-redis 4 ho nemá vestavěný → `withCommandTimeouts`, Proxy nad klientem) a na `connect()`.
- **DB** (`src/lib/db/pg-options.ts`, všech **26** pg `Pool`/`Client` — stránky, sitemap, `with-context`, health):
  `connectionTimeoutMillis` **5 s**, `statement_timeout` **15 s**, `query_timeout` **16 s** (klient přestane čekat, i když server
  neodpovídá). `rls-pool`: výpůjčka/spojení **8 s beze změny** — v pg-pool platí i pro čekání na volné spojení pod náporem (vyladěno
  zátěžovým testem); doplněn `query_timeout`.
- **Health routy:** kontroly běží souběžně s limitem 4 s → **503 do 5 s**, nikdy nevisí.

Testy `fix-r11-network-timeouts` (12): RED — health routy a `getClient` visely > 20 s, `rls-pool` 8 s, 34 klientů bez voleb,
4 routy statické → GREEN. Během lokální sady se ukázala vada vlastní opravy: Proxy volala getter `isOpen` s `this` = proxy a
node-redis má privátní pole → „Cannot read private member", rate-limit spadl do in-memory náhrady (live test 11. objednávka 200
místo 429). Opraveno (9f5f6f3f), test s třídou s privátním polem RED → GREEN, ověřeno i proti skutečnému Redisu.

## 3. Pojistka v CI

Job **„Build bez sítě (pojistka prerenderu)"** v `.github/workflows/ci.yml` → `nextjs-boilerplate/scripts/ci/build-no-network.sh`:
- proměnné z `.env.example` prázdné; síťové (`DATABASE_URL*`, `REDIS_URL`, `KV_URL`, `*_HOST`, `*_URL`…) → **10.255.255.1**
  (spojení visí, není odmítnuto — jako na Vercelu); Sentry DSN prázdný;
- `NODE_OPTIONS=--require scripts/ci/no-network-preload.cjs` (dědí i build workery): obalí `net.Socket.prototype.connect`,
  `net.connect`, `net.createConnection`, `tls.connect`; při pokusu o spojení vypíše cíl, **routu** (z cesty `.next/server/app/…`)
  a stacktrace a ukončí proces kódem 97 → build selže. Výjimka jen `fonts.googleapis.com` / `fonts.gstatic.com` (next/font/google
  stahuje písma sám Next). Lokální `.env*` skript nemaže — odmítne běžet.

**Důkaz nanečisto** (čistý klon opravené větve, z `/api/health/redis` dočasně odstraněno `export const dynamic`):
```
⨯ Next.js build worker exited with code: 97 and signal: null
::error::Build se pokusil o síťové spojení — routa/stránka se předgenerovává a sahá na síť:
[no-network-build] ZAKÁZANÉ SÍŤOVÉ SPOJENÍ BĚHEM BUILDU: net.connect → 10.255.255.1:6379
[no-network-build] routa/stránka: api/health/redis/route.js
```
exit 1 (`logs/r11/2_guard_dryrun_fail.console.txt`); úprava byla jen v dočasném klonu a je vrácená. V GitHub Actions job prošel
na PR #8, PR #9 i PR #2.

## 4. Vercel build

| | Výsledek |
|---|---|
| Lokálně **RED** — 7a8ae83, síť → 10.255.255.1, bez pojistky | exit 1 po 8 min: „Error: Static page generation for /api/health/redis is still timing out after 3 attempts" (shodně s Vercelem) |
| Lokálně **GREEN** — opravená větev, s pojistkou | exit 0 za 3 min 17 s, 0 síťových spojení |
| **PR #8** (hlava 9f5f6f3f) | **Vercel – nextjs-boilerplate: success** (pending 07:57:17 → success 08:00:26) |
| **PR #9** (hlava 3c8cdfbb) | **Vercel – nextjs-boilerplate: success** |
| **PR #2** po sloučení PR #8 (96eb50ed) | Vercel **success**; GitHub Actions zelené kromě *Dependency audit (nextjs-boilerplate)* — nová advisory `source-map-js` (high), opravitelná bez `--force` → **PR #9** (jen `source-map-js` 1.2.1 → 1.2.2 v lockfilu) |
| **PR #2** po sloučení PR #9 (**7e7af821**) | **Vercel – nextjs-boilerplate: success** (08:35:00 → 08:38:23); **všechny GitHub Actions zelené** — CI, build bez sítě, live sada, RLS verify, schema drift, Gitleaks, 4× dependency audit (RLS verify proti produkci záměrně přeskočen) |

## 5. Lokální sada (integrate = 7e7af821, DB `r11a` od nuly z migrací, 0 chyb)

| Část | Výsledek |
|---|---|
| Typecheck | 0 chyb |
| Lint (baseline) | žádná nová chyba (o 26 méně než baseline) |
| Unit | 707 prošlo (13 skip) |
| Live (simulátor GoPay, PgBouncer) | 83/83 souborů, 359 testů (21 souborů skip jen Neon) |
| Build | OK; build bez sítě s pojistkou OK (čistý klon) |
| Health na běžícím serveru | `/api/health/ready` 200 (0,09 s), `/api/health/redis` 200 (0,01 s), `/sitemap.xml` 200 |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · **07b 0 zápisů** · **08 166 rout × 3 aktéři, 0 úniků, 0× 5xx** · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 |

## 6. Co zbývá / poznámky
- Stránky si dál zakládají vlastní `new Pool` (nyní s timeouty) — sjednocení na `db()` mimo rozsah kola.
- `/api/public/push/vapid-key` a `/robots.txt` zůstávají statické — čtou jen env (hodnota z doby buildu).
