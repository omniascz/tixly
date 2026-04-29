# Tixly — Deployment guide

## Architektura produkčního prostředí

```
Uživatel → Cloudflare CDN → Vercel (Next.js)
                                    ↓
                            Railway PostgreSQL
                            Railway Redis
                            Upstash Kafka (serverless)
                            Mailgun (email)
```

---

## 1. Lokální vývoj

```bash
# Zkopíruj env proměnné
cp .env.example .env.local

# Spusť Docker služby
docker compose up -d

# Spusť Next.js
cd nextjs-boilerplate
npm install
npm run dev
```

Mailhog UI (catch-all SMTP): http://localhost:8025

---

## 2. Staging — první setup

### Vercel
```bash
npm i -g vercel
cd nextjs-boilerplate
vercel login
vercel link          # propoj s projektem
vercel env pull      # stáhni env proměnné ze staging
```

### Railway — PostgreSQL + Redis
1. Jdi na [railway.app](https://railway.app) → New Project
2. Přidej **PostgreSQL** plugin → zkopíruj `DATABASE_URL`
3. Přidej **Redis** plugin → zkopíruj `REDIS_URL`
4. Spusť migraci:
   ```bash
   psql "$DATABASE_URL" -f ticketing_schema.sql
   psql "$DATABASE_URL" -f migrations/001_price_migration.sql
   psql "$DATABASE_URL" -f migrations/002_add_currency_timezone_locale.sql
   ```

### Upstash Kafka (místo Railway — Railway nemá managed Kafka)
1. Jdi na [upstash.com/kafka](https://upstash.com/kafka) → Create Cluster (Frankfurt)
2. Zkopíruj `KAFKA_BROKERS`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`
3. Vytvoř témata dle `docker/kafka/create-topics.sh`

---

## 3. Produkce — checklist před go-live

### Vercel
- [ ] Custom doména nastavena (tixly.cz)
- [ ] SSL certifikát aktivní (Vercel automaticky)
- [ ] Environment variables nastaveny (viz `.env.example`)
- [ ] Cron joby aktivní (viz `vercel.json`)
- [ ] Analytics zapnuto (Vercel Analytics)

### Railway
- [ ] PostgreSQL — zálohy zapnuty (Railway automaticky, daily)
- [ ] Redis — persistence zapnuta (AOF)
- [ ] `DATABASE_URL` v Vercel env vars

### Cloudflare (po zakoupení domény)
- [ ] NS záznamy přepnuty na Cloudflare
- [ ] A záznam → Vercel IP
- [ ] SSL/TLS: Full (strict)
- [ ] Under Attack Mode: OFF (zapnout při DDoS)
- [ ] Rate limiting pravidlo: max 100 req/min per IP na `/api/*`
- [ ] Cache pravidlo: bypass pro `/api/*`, cache pro `/_next/static/*`

### Bezpečnost
- [ ] `JWT_SECRET` — min 32 náhodných znaků (ne z `.env.example`!)
- [ ] `POSTGRES_PASSWORD` — silné heslo
- [ ] Gitleaks scan prošel bez nálezů
- [ ] npm audit — žádné critical/high zranitelnosti

---

## 4. Deploy příkazy

```bash
# Staging
./scripts/deploy.sh staging

# Produkce (vyžaduje potvrzení)
./scripts/deploy.sh production

# Jen DB migrace (produkce)
psql "$DATABASE_URL" -f migrations/003_next_migration.sql
```

---

## 5. Monitoring

| Co | Kde |
|----|-----|
| Logy aplikace | Vercel Dashboard → Functions → Logs |
| DB výkon | Railway Dashboard → PostgreSQL → Metrics |
| Redis využití | Railway Dashboard → Redis → Metrics |
| Kafka lag | Upstash Console → Topics |
| Emaily | Mailgun Dashboard → Logs |
| Uptime | Nastavit UptimeRobot na `/api/health` |

---

## 6. Rollback

```bash
# Vercel — rollback na předchozí deployment
vercel rollback --token="$VERCEL_TOKEN"

# DB — spusť rollback skript (pokud existuje)
psql "$DATABASE_URL" -f migrations/XXX_rollback.sql
```
