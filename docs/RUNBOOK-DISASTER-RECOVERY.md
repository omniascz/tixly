# Tixly — Disaster Recovery Runbook

**Stav:** v1 (2026-05-19) — pro M1 launch CZ/SK
**Vlastník:** ops@tixly.cz (po launchi); aktuálně Omnia
**Audit:** každých 90 dní + po každém P0 incidentu

---

## 1. RPO / RTO targety

| Komponenta | RPO (max ztracená data) | RTO (max downtime) | Severity |
|---|---|---|---|
| Postgres (orders, tickets, payments) | **5 min** | **30 min** | P0 |
| Postgres (catalog, content, marketing) | **1 hodina** | **2 hodiny** | P1 |
| Redis (seat holds, sessions, cache) | **0** (acceptable loss) | **5 min** | P1 |
| Email queue (BullMQ via Redis) | **15 min** | **30 min** | P1 |
| File storage (PDF tickets, uploads, S3) | **24 hodin** | **4 hodiny** | P2 |
| Sentry / logs | — (3rd party) | dle SLA Sentry | P2 |
| Vercel CDN / edge | **0** | **15 min** (rollback) | P0 |

**Definice:**
- **RPO** (Recovery Point Objective) — kolik posledních dat smíme ztratit
- **RTO** (Recovery Time Objective) — za jak dlouho musí být služba zpět online
- **P0** — full outage / financial impact / GDPR risk
- **P1** — degraded service, část featur nefunguje
- **P2** — internal tooling broken, no user impact

---

## 2. Backup strategie

### 2.1 Postgres (production)

**Provider:** Neon / Supabase (managed Postgres)
- **Continuous WAL archiving** — point-in-time recovery (PITR) okno 7 dní
- **Daily snapshots** — 30 dní retence (managed by provider)
- **Weekly cold backup** → S3 bucket `tixly-backups-prod` (jiný region)
  - GitHub Action: `.github/workflows/db-backup-weekly.yml` (commit `b0681d1`)
  - Cron: každou neděli 03:00 UTC
  - Retention: 12 týdnů
  - Format: `pg_dump --format=custom --jobs=4 --no-owner --no-privileges`

**Restore drill cadence:** 1× měsíčně (první pondělí), test na staging DB.

**Encryption:** AES-256 server-side (S3 SSE-KMS), encryption at rest on Neon.

### 2.2 Redis

Redis = ephemeral cache + queue. **Nevyžaduje backup pro RPO=0** (acceptable
loss). Pro provoz emailové queue (BullMQ) využíváme:

- **Upstash Redis** — managed, daily snapshots (rollback last 24h)
- **Failure mode:** Redis down → seat holds zmizí, queued emaily zmizí
  - Aplikace musí fallback graceful (viz #4.2)
  - Po obnově: cron `expire-pending-orders` releasne sirotky

### 2.3 S3 storage (PDF lístky, uploads)

- **Cross-region replication** zapnutá (Frankfurt → Stockholm)
- **Versioning ON** — 30 dní soft-delete
- **Lifecycle policy:**
  - Hot tier (0-90 dní) → S3 Standard
  - Cool (90-365 dní) → S3 IA
  - Archive (365+) → Glacier Flexible
- PDF tickets se dají regenerovat z DB (template + order data) — backup je
  defense-in-depth, ne kritický.

### 2.4 Code + config

- **Git repo:** GitHub `omnia/tixly` (private)
- **Secret backup:** Vercel env vars exportované do `1Password Tixly` vault
  monthly (process — viz #6.1)
- **CI/CD config:** vše v `.github/workflows/*` (versioned in git)

---

## 3. Incident response — první kroky

### 3.1 Detekce

Alerty (≥ P1) přijdou přes:
1. **Sentry** — error rate spike, performance regression
2. **Vercel** — deployment failure, function timeout
3. **Better Uptime / UptimeRobot** — `/api/health/ready` 200 OK check každou 1 min
4. **Customer support** — `support@tixly.cz`

### 3.2 Triage flow (prvních 5 minut)

```
1. Confirm scope:
   curl https://app.tixly.cz/api/health/ready
   curl https://app.tixly.cz/api/health/db
   curl https://app.tixly.cz/api/health/redis
   curl https://app.tixly.cz/api/health/providers

2. Otevři status page:
   /cs/status — incident publikování přes Master Admin (Faze 11)

3. Vyhlas severity:
   - DB down → P0
   - Payment provider down → P0
   - Email down → P1
   - Cache down (Redis) → P1
   - Single feature broken → P2

4. Komunikace:
   - P0 → Twitter @tixly + emailem všem promotérům + status page
   - P1 → Status page incident
   - P2 → Internal Slack jen

5. Engage:
   - P0: probudit, full focus
   - P1: pracovní hodiny + on-call
   - P2: další pracovní den
```

### 3.3 Sentry runbook URL

Každý alert v Sentry má `tags.runbook=<url>`. URL ukazují na sekce **#4**.

---

## 4. Component-specific runbooks

### 4.1 Postgres výpadek (P0)

**Symptom:** `/api/health/db` vrací 503, error rate spike Sentry.

```
KROK 1 — Diagnostika (2 min)
  - Otevři Neon dashboard → projekt `tixly-prod`
  - Zkontroluj: connection limit? CPU? disk full?
  - Pokud Neon "compute paused" (autosuspend after 5min idle):
      → automatický wakeup, počkej 30s

KROK 2 — Pokud Neon down jako service:
  - Status: https://status.neon.tech
  - Pokud P0 outage hlášený:
      → vyhlas Tixly P0 incident
      → ETA z jejich status page

KROK 3 — Pokud naše DB instance unhealthy:
  - Failover na replica:
      neonctl branches list --project-id tixly-prod
      neonctl branches set-default <replica-branch-id>
  - Update DATABASE_URL v Vercel:
      vercel env pull
      vercel env add DATABASE_URL <new-url> production
      vercel --prod   # redeploy
  - Verify: curl .../api/health/db

KROK 4 — Pokud data corruption (rare):
  - PITR restore z Neon:
      neonctl branches create --project-id tixly-prod \
        --name=restore-YYYYMMDD --parent=main --timestamp=<5min-pred-incident>
  - Promote restore branch na main:
      neonctl branches set-default <restore-branch-id>
  - Notify všechny: 5 min dat se ztratilo, požádat o resubmit klíčových akcí

KROK 5 — Postmortem
  - Šablona: /docs/POSTMORTEM-TEMPLATE.md (TBD)
  - Publikuj do 5 pracovních dnů
```

**RPO ≤ 5 min** zajištěno Neon PITR; **RTO ≤ 30 min** pokud Neon služba běží.

### 4.2 Redis výpadek (P1)

**Symptom:** `/api/health/redis` vrací 503, BullMQ jobs se neexekuují, seat holds neholdují.

```
KROK 1 — Diagnostika
  - Upstash dashboard → instance `tixly-prod-redis`
  - Pokud "max connections" → škálovat plán nebo restartovat

KROK 2 — Pokud Upstash down:
  - Aplikace má graceful fallback:
      - Seat holds: in-memory store (per Vercel instance, neabsolutně safe,
        ale zabrání over-selling pro ~5 min)
      - Email queue: zpomalí na "send-immediate" (bez retry queue)
      - Rate limit: per-instance in-memory (méně přísné)
  - Tedy: app POJEDE, jen degraded

KROK 3 — Po obnově:
  - Run cron `expire-pending-orders` manually:
      curl -X POST .../api/cron/dispatch?job=expire-pending-orders \
        -H "Authorization: Bearer $CRON_SECRET"
  - Run cron `release-expired-seat-holds`:
      curl -X POST .../api/cron/dispatch?job=release-expired-seat-holds
  - Žádný restore — Redis = cache, fresh state je OK
```

**RPO = 0** (data acceptable loss); **RTO ≤ 5 min** auto-recovery.

### 4.3 Email queue výpadek (P1)

**Symptom:** Maily se neodesílají, queue depth v dashboardu narůstá.

```
KROK 1 — Resend / Postmark status:
  - https://status.resend.com (nebo postmark)
  - Pokud outage: čekáme, queue se vyprázdní automaticky po obnově

KROK 2 — Pokud naše instance unhealthy:
  - Restart Vercel function pool:
      vercel rollback   # rollback last deploy
  - Nebo redeploy s force-restart:
      vercel --prod --force

KROK 3 — Pokud queue full (BullMQ stuck):
  - Drop poisoned jobs (manually):
      redis-cli -h <upstash> ZRANGEBYSCORE bull:email:failed 0 +inf
      redis-cli -h <upstash> DEL bull:email:waiting
  - Notify dotčené uživatele (ze Sentry tagged "email-failed")

KROK 4 — Fallback path:
  - Sendgrid jako secondary provider (lib/email/providers.ts má abstrakci)
  - Switch env: EMAIL_PROVIDER=sendgrid && redeploy
  - Vyžaduje předem nastavený SENDGRID_API_KEY
```

**RPO ≤ 15 min** (max delay přes queue); **RTO ≤ 30 min** s failover.

### 4.4 Payment provider výpadek (P0)

**Symptom:** GoPay / ComGate API timeout, checkout flow failing.

```
KROK 1 — Identify which provider:
  - Sentry breadcrumbs: tag.provider=gopay|comgate
  - https://status.gopay.com
  - https://status.comgate.cz

KROK 2 — Failover na druhého providera:
  - Provider abstrakce v lib/payments/providers.ts
  - Změň DEFAULT_PAYMENT_PROVIDER env (gopay → comgate nebo naopak):
      vercel env add DEFAULT_PAYMENT_PROVIDER comgate production
      vercel --prod
  - Existující rozpracované transakce (paid u GoPay) zůstanou na GoPay
      — řeší webhook po jejich obnově

KROK 3 — Pokud oba providers down (krajní případ):
  - Zobrazit banner: "Platby dočasně nedostupné. Lístky lze rezervovat,
    platba do 24h emailem."
  - Feature flag: PAYMENT_DEFERRED_MODE=true (zatím neexistuje, M2 item)

KROK 4 — Po obnově:
  - Reconcile webhook missed events:
      curl -X POST .../api/cron/dispatch?job=payment-reconcile \
        -H "Authorization: Bearer $CRON_SECRET"
  - (Cron job zatím neexistuje pro reconcile, M2 item)
```

**RPO ≤ 0 min** (provider has own retry); **RTO ≤ 15 min** přes failover.

### 4.5 Vercel platform výpadek (P0)

**Symptom:** Celá app vrací 503 nebo není dosažitelná.

```
KROK 1 — Status:
  - https://www.vercel-status.com
  - Pokud platform-wide: pouze čekat, žádná akce na naší straně

KROK 2 — Pokud naše konkrétní deploy unhealthy:
  - Rollback na předchozí deploy:
      vercel rollback   # interactive, vyber poslední healthy
  - Nebo přes UI: vercel.com/omnia/tixly/deployments → "Promote to production"

KROK 3 — Pokud neumíme z Vercelu zpět:
  - Cloudflare Workers fallback (TBD — není implementováno, M3 item)
  - Custom domain DNS swap: cloudflare.com → fallback static page
      "Aplikace je dočasně nedostupná, prosíme zkuste za 30 min"

KROK 4 — Customer comms:
  - Status page incident (pokud platforma žije)
  - Twitter @tixly
  - Promotér Slack channel (po launchi)
```

**RPO = 0** (stateless edge); **RTO ≤ 15 min** přes rollback.

---

## 5. Backup restore — full DB drill (1× měsíčně)

```bash
# 1. Vyber zálohu (např. před týdnem)
aws s3 ls s3://tixly-backups-prod/postgres/ | tail -5

# 2. Stáhni
aws s3 cp s3://tixly-backups-prod/postgres/tixly-2026-05-12.dump .

# 3. Vytvoř fresh test DB
neonctl branches create --project-id tixly-prod --name=restore-drill-2026-05-19

# 4. Restore
pg_restore --no-owner --no-privileges --jobs=4 \
  --dbname="postgresql://...restore-drill..." tixly-2026-05-12.dump

# 5. Sanity check
psql ...restore-drill... -c "SELECT count(*) FROM catalog.events;"
psql ...restore-drill... -c "SELECT count(*) FROM commerce.orders;"
psql ...restore-drill... -c "SELECT count(*) FROM tickets.tickets;"

# 6. Compare s production:
diff <(psql prod-readonly -c "SELECT ...") \
     <(psql restore-drill -c "SELECT ...")

# 7. Cleanup
neonctl branches delete --branch-id <restore-drill-id>

# 8. Document v RESTORE-DRILL-LOG.md (TBD)
```

**Cílový čas drilu:** ≤ 45 min od stažení po validaci.

---

## 6. Blue-green deployment strategie

Vercel řeší zero-downtime deploy nativně (atomic switch při promote-to-prod).
Klíčové však je: **DB migration compatibility**.

### 6.1 Pravidla pro migrace (blue/green safe)

**Migrace MUSÍ být dopředu kompatibilní s aktuálním kódem.** Jinak hrozí:
během deploye běží dvě verze aplikace současně na stejné DB.

**ADDITIVE migrations (safe vždy):**
- `CREATE TABLE` (nové tabulky)
- `ADD COLUMN ... DEFAULT ... NULL` (nullable nebo s defaultem)
- `CREATE INDEX CONCURRENTLY` (neblokuje writes)
- `ADD CONSTRAINT ... NOT VALID` → potom `VALIDATE CONSTRAINT` v dalším deployi

**BREAKING migrations (vyžadují multi-step):**

| Co chceš | Krok 1 (deploy A) | Krok 2 (deploy B) | Krok 3 (deploy C) |
|---|---|---|---|
| Drop column | App přestane číst/psát | (počkej 1 deploy cyklus) | `ALTER TABLE DROP COLUMN` |
| Rename column | `ADD new_col` + dual-write | App čte new_col only | `DROP old_col` |
| Add NOT NULL | `ADD col NULL DEFAULT x` | Backfill data | `ALTER ... SET NOT NULL` |
| Change type | `ADD col_new` + dual-write | Backfill + switch reads | `DROP col_old` + rename |

**ZAKÁZÁNO v jednom deployi:**
- ❌ Drop column současně se změnou kódu co ho používal
- ❌ Rename column v jednom kroku
- ❌ ALTER COLUMN s lock na velkou tabulku (orders > 1M řádků)

### 6.2 Migration tracker

- Adresář `migrations/*.sql` (jediná pravda)
- Tabulka `platform.migrations_applied` v DB (idempotency)
- CI step ověří: každá `*.sql` v repu má řádek v `migrations_applied` po deployi (TBD pro production)

### 6.3 Rollback flow

```
Pokud nový deploy něco rozbije:

1. Vercel rollback:
     vercel rollback
   → instant, no data change

2. DB migration NEMUSÍ být rolnutá zpět, pokud migrace byly ADDITIVE
   (kód funguje s i bez nových sloupců)

3. Pokud migrace byla BREAKING (drop column):
   → MŮŽEME mít data loss, ale zachovaný backup z PITR (#5)
   → Restore drill flow (#5) na novou branch + ALTER DATABASE swap

4. Communicate:
   → status page "Rolling back deploy <hash>, no user impact expected"
```

### 6.4 Secret rotation

- **DB password:** quarterly (Q1, Q2, Q3, Q4) — Neon dashboard → reset → update Vercel env
- **API keys (B2B tokens):** každý zákazník individual, manual rotation request
- **Payment webhook secrets:** roční rotace
- **JWT_SECRET:** PŘI rotaci musíš invalidovat všechny session — kommunikace na promotéry předem

---

## 7. Známé limity a TODO

| Položka | Stav | M2 / M3? |
|---|---|---|
| Per-tenant rate limit Redis backend | M2 — in-memory v M1 | M2 (Upstash provisioning) |
| Payment reconcile cron (`payment-reconcile`) | TBD | M2 |
| Sendgrid fallback (email DR) | TBD — vyžaduje SENDGRID_API_KEY env | M2 |
| Cloudflare Workers fallback (Vercel DR) | TBD | M3 |
| `PAYMENT_DEFERRED_MODE` feature flag | TBD | M2 |
| Status page Twitter integration | TBD — manuální zatím | M2 |
| Better Uptime / UptimeRobot probes | TBD — `/api/health/ready` připravený | M1 final |
| Sentry runbook URLs v `tags.runbook` | TBD | M1 final |
| `POSTMORTEM-TEMPLATE.md` | TBD | M1 final |
| `RESTORE-DRILL-LOG.md` | TBD — první drill po launchi | post-launch |

---

## 8. Kontakt eskalace

| Komponenta | 1st line | 2nd line | Vendor support |
|---|---|---|---|
| Vercel | Omnia | — | vercel.com/help → P0 |
| Neon (Postgres) | Omnia | — | console.neon.tech support |
| Upstash (Redis) | Omnia | — | upstash.com/discord |
| GoPay | Omnia | — | help@gopay.cz, +420 387 685 124 |
| ComGate | Omnia | — | helpdesk@comgate.cz |
| Resend | Omnia | — | support@resend.com |
| Sentry | Omnia | — | sentry.io/support (paid plan) |
| Cloudflare DNS | Omnia | — | dash.cloudflare.com |

---

## 9. Audit log

| Datum | Co | Kdo |
|---|---|---|
| 2026-05-19 | v1 vytvořen (session work) | Omnia + Claude |
| TBD | první monthly restore drill | — |
| TBD | první review po incidentu | — |
