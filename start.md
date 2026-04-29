# Tixly — Kompletní návod k spuštění

## Přehled architektury

```
Uživatel → Cloudflare → Vercel (Next.js)
                              ↓
                    Railway (PostgreSQL + Redis)
                    Upstash (Kafka)
                    Amazon SES (emaily)
                    GoPay (platby)
```

---

## ČÁST 1 — Služby k registraci a objednání

### 1.1 Doména — tixly.cz

**Kde:** WEDOS, Forpsi, nebo Cloudflare Registrar  
**Co objednat:** Doménu `tixly.cz` (pokud ještě nemáš)  
**Cena:** ~150–300 Kč/rok  
**Po registraci:** Nameservery přepíšeš na Cloudflare (viz sekce 1.3)

---

### 1.2 Vercel — Frontend hosting

**URL:** vercel.com  
**Plán:** Hobby (zdarma pro start) → Pro ($20/měs) až budeš mít provoz  
**Co udělat:**
1. Registrace přes GitHub účet
2. Import projektu ze složky `nextjs-boilerplate`
3. Nastavíš env vars (seznam v sekci 2)
4. Vercel automaticky nasadí při každém push na main

**Proč Vercel:** Projekt je Next.js 14 — Vercel je od stejného týmu, zero-config deploy, edge network, automatický SSL.

---

### 1.3 Cloudflare — CDN + DNS + DDoS ochrana

**URL:** cloudflare.com  
**Plán:** Free (dostačuje pro start)  
**Co udělat:**
1. Registrace
2. Přidáš doménu `tixly.cz`
3. Cloudflare ti dá 2 nameservery → jdeš k registrátorovi domény a přepíšeš NS záznamy
4. Po propagaci (0–24h) nastavíš:
   - A záznam: `tixly.cz` → Vercel IP (Vercel ti dá IP při nastavování domény)
   - SSL/TLS: **Full (Strict)**
   - Rate limiting: max 100 req/min per IP na `/api/*`

---

### 1.4 Railway — PostgreSQL + Redis

**URL:** railway.app  
**Plán:** Hobby ($5/měs kredit zdarma, pak pay-as-you-go ~$10–30/měs)  
**Co udělat:**
1. Registrace přes GitHub
2. New Project → Add PostgreSQL plugin → zkopíruj `DATABASE_URL`
3. Add Redis plugin → zkopíruj `REDIS_URL`
4. Zapneš Redis persistence: Settings → AOF enabled

**Proč Railway:** Managed databáze, automatické daily backupy, jednoduchý dashboard, přímé napojení na Vercel.

> **Alternativa (levnější):** Neon.tech (PostgreSQL, generous free tier) + Redis Cloud (Redis). Neon má lepší free plán než Railway pro PostgreSQL.

---

### 1.5 Upstash — Kafka (message queue)

**URL:** upstash.com/kafka  
**Plán:** Free tier (10K zpráv/den) → Pay-per-use  
**Co udělat:**
1. Registrace
2. Create Cluster → Region: **Frankfurt** (EU, GDPR)
3. Zkopíruj: `KAFKA_BROKERS`, `KAFKA_USERNAME`, `KAFKA_PASSWORD`
4. Vytvoříš témata dle skriptu `docker/kafka/create-topics.sh` (25+ témat — seznam je tam)

**Proč Upstash:** Railway nemá managed Kafka. Upstash je serverless — platíš jen za zprávy, ne za běžící cluster.

---

### 1.6 GoPay — Platební brána (KLÍČOVÉ — čeká na IČO)

**URL:** gopay.com/cs  
**Co potřebuješ:**
- **IČO** (živnostenský list nebo s.r.o.) — bez toho nelze získat produkční credentials
- Bankovní účet (pro výplaty)

**Postup:**
1. Zaregistruješ se na gopay.com → žádost o produkční účet
2. GoPay ověří IČO + bankovní účet (trvá 1–5 pracovních dní)
3. Dostaneš: `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_GOID`
4. Sandbox (pro testování) je ihned — změníš `GOPAY_API_URL=https://gw.sandbox.gopay.com/api`

**POZOR:** Toto je **P0 blokující bug A1** — GoPay webhook neoznačuje order jako paid. Je to backend bug čekající na produkční credentials pro E2E test. Bez IČO nejde otestovat na produkci.

---

### 1.7 Amazon SES — Transakční emaily

**URL:** aws.amazon.com/ses  
**Plán:** Pay-per-use ($0.10/1000 emailů) — prakticky zdarma na začátku  
**Co udělat:**
1. Vytvoříš AWS účet (potřebuješ kreditní kartu)
2. Jdeš do SES Console → Region: **eu-central-1 (Frankfurt)**
3. Ověříš doménu `tixly.cz`:
   - SES ti dá DNS záznamy (TXT, CNAME pro DKIM)
   - Přidáš je v Cloudflare
4. **Žádost o odstranění z sandboxu** (sandbox = jen ověřené emaily):
   - SES → Account Dashboard → Request production access
   - Vyplníš use case (transakční emaily pro vstupenky)
   - Schválení: 24–48h
5. Vytvoříš SMTP credentials: SES → SMTP Settings → Create credentials
6. Dostaneš: `SMTP_USER`, `SMTP_PASS`

**Env vars:**
```
SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=<z kroku 5>
SMTP_PASS=<z kroku 5>
EMAIL_FROM=vstupenky@tixly.cz
```

> **Alternativa:** Mailgun (jednodušší setup, $15/měs pro 50K emailů, EU region dostupný)

---

### 1.8 BulkGate — SMS

**URL:** bulkgate.com  
**Plán:** Pay-per-use (~1–3 Kč/SMS do CZ)  
**Co udělat:**
1. Registrace
2. Dobijíš kredit
3. Získáš API klíč (Application ID + Application Token)
4. Nastavíš v kódu (sdílený modul `@shared/sms-sender` ho čte)

---

### 1.9 Apple Developer Program — Apple Wallet

**URL:** developer.apple.com  
**Cena:** $99/rok (~2300 Kč)  
**Co udělat:**
1. Registrace Apple Developer účtu (potřebuješ Apple ID + platbu)
2. Certificates, Identifiers & Profiles → Pass Type IDs → nový Pass Type ID
3. Identifier: `pass.cz.tixly`
4. Vytvoříš certifikát pro tento Pass Type ID (P12 soubor)
5. Vytvoříš APN klíč pro push notifikace na wallet
6. Hodnoty:
   - `APPLE_PASS_TYPE_IDENTIFIER=pass.cz.tixly`
   - `APPLE_TEAM_IDENTIFIER=` (najdeš v Account → Membership)
   - `APPLE_CERT_P12_BASE64=` (base64 encode P12 souboru)
   - `APPLE_CERT_P12_PASSWORD=`
   - `APPLE_APN_KEY_ID=`
   - `APPLE_APN_KEY_BASE64=`

> **Dá se odložit** — Apple Wallet není blokující pro GO LIVE. Prioritizuj GoPay + SES.

---

### 1.10 Google Cloud — Google Wallet

**URL:** console.cloud.google.com  
**Cena:** Zdarma (Google Wallet API je bezplatné)  
**Co udělat:**
1. Vytvoříš Google Cloud projekt
2. Povolíš Google Wallet API
3. Vytvoříš Service Account → stáhneš JSON klíč
4. Zaregistruješ se v Google Pay & Wallet Console jako Issuer
5. Hodnoty:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL=`
   - `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=` (z JSON klíče)
   - `GOOGLE_ISSUER_ID=` (z Wallet Console)

> **Dá se odložit** — stejně jako Apple Wallet.

---

### 1.11 Anthropic — Claude API (AI funkce)

**URL:** console.anthropic.com  
**Plán:** Pay-per-use  
**Co udělat:**
1. Registrace
2. API Keys → Create Key
3. Přidáš do env vars (klíč používá sdílený modul `@shared/ai-provider`)

---

### 1.12 Sentry — Error monitoring

**URL:** sentry.io  
**Plán:** Free (5K errors/měs) → Team ($26/měs)  
**Co udělat:**
1. Registrace
2. New Project → Next.js
3. Dostaneš `SENTRY_DSN`
4. Instalace: `npm install @sentry/nextjs` v `nextjs-boilerplate`
5. Konfigurace dle Sentry průvodce (generuje `sentry.config.js`)

---

### 1.13 UptimeRobot — Uptime monitoring

**URL:** uptimerobot.com  
**Plán:** Free (50 monitorů, check každých 5 minut)  
**Co udělat:**
1. Registrace
2. New Monitor → HTTP(s) → URL: `https://tixly.cz/api/health`
3. Nastavíš email alerting

---

### 1.14 GitHub — CI/CD (pokud ještě nemáš)

**URL:** github.com  
**Plán:** Free  
**Co udělat:**
1. Repozitář pro Tixly kód
2. GitHub Actions pro CI/CD pipeline (viz sekce 3 — manuální řešení #22)

---

## ČÁST 2 — Kompletní checklist env vars

Po registraci všech služeb vyplníš tento soubor. Zkopíruj `.env.example` → `.env.local`:

```bash
# ─── Databáze (Railway) ───────────────────────────────────────
DATABASE_URL=postgresql://...             # z Railway
POSTGRES_HOST=...
POSTGRES_PORT=5432
POSTGRES_DB=tixly
POSTGRES_USER=...
POSTGRES_PASSWORD=...

# ─── Redis (Railway) ──────────────────────────────────────────
REDIS_URL=redis://...                    # z Railway
REDIS_HOST=...
REDIS_PORT=6379
REDIS_PASSWORD=...

# ─── Kafka (Upstash) ──────────────────────────────────────────
KAFKA_BROKERS=...                        # z Upstash
KAFKA_CLIENT_ID=tixly-api

# ─── JWT (vygeneruj náhodný secret!) ─────────────────────────
JWT_SECRET=<64 náhodných znaků>          # node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_ACCESS_TOKEN_TTL=900
JWT_REFRESH_TOKEN_TTL=604800

# ─── GoPay ────────────────────────────────────────────────────
GOPAY_CLIENT_ID=                         # čeká na IČO
GOPAY_CLIENT_SECRET=
GOPAY_GOID=
GOPAY_API_URL=https://gw.sandbox.gopay.com/api   # sandbox zatím

# ─── Email (Amazon SES) ───────────────────────────────────────
SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=                               # z SES SMTP credentials
SMTP_PASS=
EMAIL_FROM=vstupenky@tixly.cz

# ─── Apple Wallet ─────────────────────────────────────────────
APPLE_PASS_TYPE_IDENTIFIER=pass.cz.tixly
APPLE_TEAM_IDENTIFIER=
APPLE_CERT_P12_BASE64=
APPLE_CERT_P12_PASSWORD=
APPLE_APN_KEY_ID=
APPLE_APN_KEY_BASE64=

# ─── Google Wallet ────────────────────────────────────────────
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
GOOGLE_ISSUER_ID=

# ─── Meta + TikTok Tracking ───────────────────────────────────
META_PIXEL_ID=
META_ACCESS_TOKEN=
TIKTOK_PIXEL_ID=
TIKTOK_ACCESS_TOKEN=

# ─── Aplikace ─────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=https://tixly.cz
NODE_ENV=production
```

---

## ČÁST 3 — Manuální řešení otevřených modulů

Z `TODO.md` jsou tyto položky označené jako `manuál ❌` — tedy čekají na ruční akci, ne na kód:

---

### Manuál #1 — Amazon SES setup (Faze 0, BLOKUJÍCÍ)

**Co zbývá:**
1. AWS účet + SES region eu-central-1
2. Ověření domény tixly.cz (DNS záznamy do Cloudflare)
3. Žádost o production access (sandbox vypnutí)
4. SMTP credentials → do env vars

**Stav:** ❌ Bez toho nejdou transakční emaily (vstupenky, potvrzení objednávky)

---

### Manuál #4 — Migrace na staging DB (Faze 0, BLOKUJÍCÍ)

**Co zbývá:** Spustit všech 108+ migrací na Railway PostgreSQL:

```bash
# Po vytvoření Railway PostgreSQL a nastavení DATABASE_URL:
psql "$DATABASE_URL" -f ticketing_schema.sql
psql "$DATABASE_URL" -f migrations/001_price_migration.sql
psql "$DATABASE_URL" -f migrations/002_add_currency_timezone_locale.sql
# ... (001 až 108 a výše — jsou v /migrations/)
```

**Prakticky:** Projdeš složku `migrations/`, seřadíš soubory číselně a spustíš jeden po druhém nebo jako skript.

---

### Manuál #6 — Railway/Vercel deploy (Faze 0)

**Co zbývá:**
```bash
# Instalace Vercel CLI
npm i -g vercel

# V nextjs-boilerplate
cd nextjs-boilerplate
vercel login
vercel link        # propoj s projektem na Vercel dashboardu
vercel env pull    # stáhni env vars

# První deploy
vercel --prod
```

**Railway:** Projekt má `railway.toml` — stačí připojit GitHub repozitář v Railway dashboardu a nastavit build command.

---

### Manuál #7 — Env vars na produkci (Faze 0)

**Co zbývá:** Vyplnit všechny env vars v **Vercel dashboardu**:
1. Vercel → projekt → Settings → Environment Variables
2. Přidáš každou proměnnou z výše uvedeného seznamu
3. Scope: Production (a případně Preview)

---

### Manuál #8 — GoPay production credentials (Faze 0, čeká na IČO)

**Co zbývá:**
1. Získat IČO (živnostenský list nebo s.r.o.)
2. Zaregistrovat se na gopay.com jako merchant
3. Po schválení (1–5 dní): vyplnit `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_GOID`
4. Změnit `GOPAY_API_URL` na `https://gate.gopay.cz/api` (produkce)
5. Opravit bug A1 (backend fix — GoPay webhook konzument)

---

### Manuál #20 — Sentry error monitoring (Faze 1)

**Co zbývá:**
1. Sentry účet + Next.js projekt
2. `npm install @sentry/nextjs` v nextjs-boilerplate
3. Konfigurace dle Sentry průvodce
4. Přidat `SENTRY_DSN` do env vars

---

### Manuál #21 — Backup a monitoring (Faze 1)

**Co zbývá:**
1. **Railway PostgreSQL** — automatické daily backupy jsou zapnuté, ověříš v Railway dashboardu
2. **UptimeRobot** — monitor na `https://tixly.cz/api/health` (viz sekce 1.13)
3. Volitelně: pg_dump cron přes Railway nebo AWS Lambda pro offsite backup

---

### Manuál #22 — CI/CD pipeline (Faze 1)

**Co zbývá:** Vytvořit GitHub Actions workflow. Základní struktura:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
        working-directory: nextjs-boilerplate
      - run: npm run lint
        working-directory: nextjs-boilerplate
      - run: npm run test
        working-directory: nextjs-boilerplate
      - run: npm run build
        working-directory: nextjs-boilerplate
```

Vercel se nasadí automaticky při push na main (Vercel má přímou GitHub integraci).

---

### Manuál #57 — Load testing (Faze 3)

**Co zbývá:** Až budeš mít první větší akci, před prodejem:
1. Nainstalovat k6 (`winget install k6` nebo Chocolatey)
2. Napsat scénář: 10K požadavků na `/api/checkout` za 60 sekund
3. Identifikovat bottleneck (typicky: seat lock v Redis nebo DB connections)

---

### Bug A1 — GoPay webhook (P0, blokující GO LIVE)

**Co zbývá:** Toto je **backendový bug**, ne manuální konfigurace. Ale čeká na tebe:
1. GoPay produkční credentials (IČO)
2. Pak bude potřeba backend fix: přidat Kafka konzumenta pro `gopay.payment.paid`
3. E2E test: create event → buy → GoPay sandbox → webhook → PDF email

---

## ČÁST 4 — Pořadí kroků (co dělat jako první)

```
1. [IHNED]  Registrace: Vercel, Railway, Upstash, Cloudflare
2. [IHNED]  Doména tixly.cz — pokud nemáš
3. [IHNED]  Amazon SES setup + ověření domény
4. [IHNED]  Seed první promoter účet: scripts/seed-owner.sql
5. [IHNED]  Migrace DB (001-108) na Railway
6. [IHNED]  Deploy na Vercel (staging)
7. [IHNED]  Env vars na Vercel
8. [IHNED]  Kafka témata na Upstash
9. [SOUBĚŽNĚ] GoPay registrace + IČO proces (trvá dny)
10. [PO #9]  GoPay credentials → produkční GOPAY_API_URL
11. [PO #9]  Fix bug A1 (backend)
12. [PO A1]  E2E smoke test
13. [PO smoketest] GO LIVE
14. [FAZE 1]  Sentry, UptimeRobot, CI/CD
```

---

## ČÁST 5 — Lokální vývoj (než je produkce připravená)

Než dostaneš všechny credentials, vyvíjíš lokálně:

```bash
# 1. Zkopíruj env
cp .env.example .env.local

# 2. Spusť Docker (PostgreSQL + Redis + Kafka + Mailhog)
docker compose up -d

# 3. Spusť Next.js
cd nextjs-boilerplate
npm install
npm run dev
```

- Emaily chytá Mailhog: `http://localhost:8025`
- GoPay: sandbox credentials (ihned z gopay.com bez IČO)
- DB: lokální Docker PostgreSQL

---

## Shrnutí: Co potřebuješ nakoupit/objednat

| Služba | Cena orientační | Priorita | Čeká na |
|--------|----------------|----------|---------|
| Doména tixly.cz | ~200 Kč/rok | P0 | — |
| Cloudflare | Zdarma | P0 | Doménu |
| Vercel | Zdarma → $20/měs | P0 | — |
| Railway (DB+Redis) | ~$10–30/měs | P0 | — |
| Upstash Kafka | ~$0–10/měs | P0 | — |
| Amazon SES | ~$0–5/měs | P0 | AWS účet |
| GoPay | % z transakcí | P0 | **IČO** |
| BulkGate SMS | ~1–3 Kč/SMS | P1 | — |
| Sentry | Zdarma → $26/měs | P1 | Deploy |
| UptimeRobot | Zdarma | P1 | Deploy |
| Apple Developer | $99/rok | P2 | — |
| Google Cloud | Zdarma | P2 | — |
| Anthropic Claude | Pay-per-use | P2 | — |

**Největší blokátor:** IČO pro GoPay — to je jediná věc, která ti zabrání přijímat platby na produkci.
