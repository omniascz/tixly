# Reprodukce auditního prostředí a kontrol

Auditovaný commit: `d4b43f4` (= `origin/master`), aplikace `nextjs-boilerplate/`.
Vše běží lokálně a izolovaně. **K produkční DB, platbám ani e-mailu se audit nepřipojuje.**

## 1. Kontejnery (izolované, prefix `audit-`)
```sh
docker network create audit-net
docker run -d --name audit-pg    --network audit-net -e POSTGRES_USER=neondb_owner -e POSTGRES_PASSWORD=auditowner -e POSTGRES_DB=neondb -p 55532:5432 postgis/postgis:17-3.5 -c max_connections=300
docker run -d --name audit-redis --network audit-net -p 56579:6379 redis:7-alpine
docker run -d --name audit-mail  --network audit-net -p 51125:1025 -p 58125:8025 axllent/mailpit:latest
```
> Porty session 3 (55532/56579/51125/58125) se liší od session 1 (55432/56379/51025/58025), protože
> původní porty držel jiný, nesouvisející kontejner. Kdo reprodukuje s volnými porty, může použít původní.

## 2. Schéma z migrací (od nuly, ne z produkce)
```sh
sh audit/db/migrate-from-zero.sh tixly_audit      # 24/24 OK → logs/18_migrate_from_zero_session3.log
docker exec audit-pg psql -U neondb_owner -d neondb -c "CREATE DATABASE e2e TEMPLATE tixly_audit"
docker exec audit-pg psql -U neondb_owner -d neondb -c "ALTER ROLE tixly_app WITH LOGIN PASSWORD 'auditapp'"
```
Výsledek schématu (session 3): 632 policies, 600 tabulek, `tixly_app` NOBYPASSRLS, `neondb_owner` BYPASSRLS.
`\restrict` v `000_baseline` se filtruje (psql 17.5), stejně jako `scripts/baseline-clone.mjs` (viz S6).

## 3. Aplikace v produkčním režimu
```sh
cd nextjs-boilerplate && (set -a; . ../audit/e2e/app.s3.env; set +a; npx next build)   # → logs/19_build_session3.log (exit 0)
# instance pod tixly_app (RLS platí):
(set -a; . ../audit/e2e/app.s3.env; set +a; npx next start -p 3100)                     # → logs/20_app_server_s3.log
# instance pod neondb_owner (BYPASSRLS = dnešní produkční role dle GO-LIVE-CHECKLIST):
DATABASE_URL=postgresql://neondb_owner:auditowner@localhost:55532/e2e … npx next start -p 3101
```
Simulátor brány: `FAKE_GOPAY_LOG=../logs/s3_fake-gopay.jsonl node audit/tools/fake-gopay.mjs` (port 3999).

## 4. E2E kontroly
```sh
. audit/e2e/s3.env.sh            # exportuje AUDIT_OWNER_URL, MAILPIT, FAKE_GOPAY, AUDIT_BASE, AUDIT_LOG_PREFIX=s3_, AUDIT_STATE=state.s3.json, AUDIT_APP_URL
node audit/e2e/01-setup-roles.mjs           # zakládá role/akce → state.s3.json
node audit/e2e/02-purchase.mjs              # … 03 … 09 (04 spouštět 2×: bez arg = app :3100, `owner` = :3101)
node audit/e2e/10-demo-paths.mjs            # neautentizované „demo" prodejní cesty (session 3)
```
Značení výsledku: `s3_e2e_02:P15a` = řádek kontroly `P15a` v `audit/logs/s3_e2e_02.out`.
Skripty čtou ground truth přímo z DB přes `neondb_owner` (bypass RLS), nikdy z odpovědi aplikace (`audit/e2e/lib.mjs`).

## 5. Reprodukovatelnost proti session 1
Všech 9 původních skriptů (01–09) dalo v session 3 **stejný vzor PASS/FAIL** jako v session 1
(`diff` výstupů = shodné; jediné číselné odchylky jsou kumulativní počítadla, viz níže).
Env-závislé pasti při reprodukci:
- **Rate-limit loginu** je per-IP i per-účet v Redisu; skript 06 při opakovaném běhu narazí na 429 →
  před re-runem `docker exec audit-redis redis-cli FLUSHALL`.
- **Kumulativní počítadla** (počet mailů, počet `updateTicketPricesTo1Halir` v 07b) rostou s počtem běhů
  proti téže DB — hodnotí se, že jsou > 0 / v očekávaném poměru, ne absolutní číslo.
- Skripty jsou parametrizované přes env (`AUDIT_STATE`, `AUDIT_LOG_PREFIX`, `MAILPIT`, `AUDIT_APP_URL`,
  `FAKE_GOPAY_LOG`), aby běh session 3 nepřepsal důkazy session 1.

## 6. Úklid
`docker rm -f audit-pg audit-redis audit-mail audit-pgb; docker network rm audit-net` + zabít `next start`/`fake-gopay`.
