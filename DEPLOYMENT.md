# Tixly — Production deployment (krok za krokem)

**Cíl:** Od „pohledu zvenku" po **první reálný prodej vstupenky** na produkční doméně.

**Čas:** ~1-3 dny technické práce + 1-3 dny čekání na Stripe KYC.

**Architektura:** Vercel (Next.js) + Neon (Postgres) + Resend (email) + Stripe (platby) + volitelně BulkGate (SMS) + hCaptcha + Sentry.

---

## Předpoklady

- **Doména** (jakákoli) — např. `vstupenky.divadlovceletne.cz`
- **GitHub účet**
- **Vercel účet** (free Hobby pro start)
- **Neon účet** (free 0.5 GB, stačí pro malé/střední divadlo)
- **Stripe účet** (~1.4% + 5 Kč per transakce, KYC 1-3 dny)
- **Resend účet** (free 100 emailů/den, paid od $20/měs.)
- **BulkGate** (volitelné, ~0.50 Kč/SMS)
- **hCaptcha** (free)

---

## Fáze 1 — GitHub (5 min)

```bash
cd C:\Users\omnia\Documents\tixly
# Pokud ještě není připojené:
git remote add origin git@github.com:VAS_USERNAME/tixly.git
git push -u origin master
```

> Doporučeno **private** repository — obsahuje migrace + .env.example.

---

## Fáze 2 — Database (Neon, 10 min)

1. **https://neon.tech** → Sign up s GitHub
2. **Create project** „Tixly Production" v EU (Frankfurt)
3. **Connection string** zkopíruj:
   ```
   postgres://user:password@ep-xxxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
4. **Spusť migrace lokálně proti Neon DB:**
   ```bash
   chmod +x scripts/run-migrations.sh
   export DATABASE_URL='postgres://...neon.tech/neondb?sslmode=require'
   ./scripts/run-migrations.sh
   ```
   - Idempotent: track přes `public.schema_migrations`
   - Spustí všech ~262 migrací od `001_*.sql` po `262_*.sql`

5. **Seed základních dat** (pro test):
   ```bash
   psql "$DATABASE_URL" -f scripts/seed-platform.sql
   psql "$DATABASE_URL" -f scripts/seed-owner.sql
   ```

6. **Vytvoř platform admina** (svůj email):
   ```bash
   psql "$DATABASE_URL" <<'SQL'
   INSERT INTO identity.users (email, name, password_hash, is_platform_admin, status)
   VALUES (
     LOWER('tvuj@email.cz'),
     'Platform Admin',
     -- bcrypt hash pro 'Tixly2026!' — změň po prvním loginu:
     '$2b$10$5kRq8nIa3iWvLZk7tQq.0e0sZpKKBJEjDr8X8VxV4XqW7TYR9Yvxa',
     TRUE, 'active'
   );
   SQL
   ```

---

## Fáze 3 — Vercel deploy (15 min)

1. **vercel.com** → **Import GitHub Repository**
2. **Framework preset**: Next.js (auto)
3. **Root directory**: `nextjs-boilerplate`
4. **Environment variables** (vlož všechny v jednom kroku):

### Minimum pro DEPLOY (bez plateb)
```env
DATABASE_URL=postgres://...neon.tech/neondb?sslmode=require
JWT_SECRET=<openssl rand -base64 32>
INTERNAL_SERVICE_TOKEN=<openssl rand -hex 32>
TICKET_MAGIC_SECRET=<openssl rand -base64 32>
EMAIL_VERIFY_SECRET=<openssl rand -base64 32>
NEXT_PUBLIC_APP_URL=https://your-domain.com
APP_URL=https://your-domain.com
NODE_ENV=production
```

### Pro reálné platby (GoPay nebo ComGate — vlož po Fázi 4)

**Volba primárního provideru:**
```env
PAYMENT_PROVIDER=gopay         # gopay | comgate
PAYMENT_PROVIDER_EUR=comgate   # volitelné: jiný provider pro EUR akce (SK)
```

**GoPay (CZ + SK):**
```env
GOPAY_GOID=8123456789
GOPAY_CLIENT_ID=client-id-from-gopay
GOPAY_CLIENT_SECRET=client-secret
GOPAY_SANDBOX=false
```

**ComGate (CZ + SK, alternativa):**
```env
COMGATE_MERCHANT=CG-XXXXXX
COMGATE_SECRET=your-secret
COMGATE_TEST=false
```

> Stripe je v repu parked pro budoucí mezinárodní expanzi. Pro CZ/SK launch ho nepoužíváme.

### Pro reálné emaily (Resend — vlož po Fázi 5)
```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxx
EMAIL_FROM=vstupenky@your-domain.com
```

### Volitelné (improve UX)
```env
BULKGATE_APPLICATION_ID=xxxxx
BULKGATE_APPLICATION_TOKEN=xxxxx
HCAPTCHA_SECRET=ES_xxxxx
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=ES_xxxxx
ANTHROPIC_API_KEY=sk-ant-xxx       # AI popisy akcí
CRON_SECRET=<openssl rand -hex 32>  # Vercel cron auth
SENTRY_DSN=https://xxx@sentry.io/xxx
```

5. **Deploy**. Po ~3 min online na `your-app.vercel.app`.

6. **Vlastní doména**:
   - Vercel → Settings → Domains → Add `your-domain.com`
   - Vercel ti dá DNS records (A/CNAME) — vlož v DNS provideru
   - HTTPS Vercel řeší automaticky

7. **Smoke test**:
   ```bash
   curl https://your-domain.com/api/health | jq
   ```
   Expect: `"status": "ok"`.

---

## Fáze 4 — Platební brána (GoPay / ComGate, KYC 1-7 dní)

Vyber podle nejlepších podmínek (provize, settlement, podpora). Tixly podporuje obě.

### Varianta A — GoPay (standardní volba pro CZ ticketing)

1. **https://account.gopay.cz** → Sign up Tixly s.r.o.
2. **Aktivace eshop**:
   - IČO + DIČ + bankovní účet IBAN (Fio CZK + Fio EUR pro SK akce)
   - Dokumenty: výpis z OR, identifikace jednatele
   - GoPay KYC: 1-3 dny
3. **Získej credentials** (po aktivaci): GoPay portál → Účet → API klíče
   - `GOID` (číselný)
   - `Client ID` + `Client Secret`
   - → vlož do Vercel env (`GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`)
4. **Webhook URL** v GoPay nastavení:
   - `https://vstupenky.tixly.cz/api/payments/gopay/webhook`
   - Žádné HMAC — GoPay ověřuje stav přes API
5. **Test sandbox nejdřív**:
   - `GOPAY_SANDBOX=true` + `https://gw.sandbox.gopay.com/api`
   - Pro produkci: `GOPAY_SANDBOX=false`
6. **Re-deploy Vercel** (env změny vyžadují rebuild)

### Varianta B — ComGate (alternativní, často lepší pricing)

1. **https://www.comgate.cz** → Žádost o registraci
2. **Aktivace**:
   - Stejné dokumenty (IČO, OR výpis, jednatel)
   - ComGate KYC: 3-5 dní
3. **Získej credentials**: ComGate Manager → API
   - `Merchant ID` (CG-XXXXXX)
   - `Secret` (long string)
   - → Vercel env (`COMGATE_MERCHANT`, `COMGATE_SECRET`)
4. **Webhook URL**:
   - `https://vstupenky.tixly.cz/api/payments/comgate/webhook`
   - ComGate posílá `secret` v body — verifikuje se serverem
5. **Test mode**: `COMGATE_TEST=true` → ostrá: `false`

### Multi-provider (CZ GoPay + SK ComGate)

Pokud chceš různé brány per měna:
```env
PAYMENT_PROVIDER=gopay
PAYMENT_PROVIDER_EUR=comgate
```
GoPay vyřídí CZK objednávky, ComGate EUR (SK) objednávky. Obě potřebují své credentials.

---

## Fáze 5 — Resend setup (30-60 min)

1. **https://resend.com** → Sign up
2. **Add Domain**: `your-domain.com`
3. **DNS records** — Resend ti dá:
   - **MX**: `feedback-smtp.resend.com` priority 10
   - **SPF (TXT)**: `v=spf1 include:_spf.resend.com ~all`
   - **DKIM (2× TXT)**: resend ti přesně vypíše hodnoty
   - **DMARC (TXT, volitelné, doporučeno)**: `v=DMARC1; p=quarantine; rua=mailto:admin@your-domain.com`
4. **Vlož DNS records** v provider domény (Forpsi, Wedos, Cloudflare, Vercel DNS)
5. **Wait 10-60 min** na DNS propagaci
6. **Verify domain** v Resend — musí být zelené
7. **API Key** → Vercel env `SMTP_PASS`

> ⚠ Email warm-up: první týden posílej max 50 emailů/den, jinak skončíš v spamu.

---

## Fáze 6 — Volitelné providery

### hCaptcha (10 min) — anti-bot v checkout
1. https://hcaptcha.com → Sign up
2. Add site → `your-domain.com`
3. Zkopíruj **site key** → `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`
4. Zkopíruj **secret key** → `HCAPTCHA_SECRET`

### BulkGate (30 min) — SMS vstupenky
1. https://portal.bulkgate.com → registrace
2. Verifikace identity (1-2 dny)
3. Application → Create → zkopíruj **Application ID** + **Token**
4. Vlož do Vercel env

### Sentry (10 min) — error tracking
1. https://sentry.io → Sign up
2. Create project → Next.js
3. Zkopíruj DSN → `SENTRY_DSN` env
4. (Volitelně: `npm install @sentry/nextjs` pro full tracing)

### Web Push VAPID
```bash
npx web-push generate-vapid-keys
```
Vlož outputu do Vercel env:
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT=mailto:...`

---

## Fáze 7 — Onboarding prvního promotéra (Divadlo Verze)

### A) Přes existující demo seed
```bash
psql "$DATABASE_URL" -f scripts/seed-divadlo-celetna.sql  # nebo phase1
```
Vytvoří Divadlo Verze + 3 sály + admin user `verze@divadlovceletne.cz` (heslo `Demo2026!`).

### B) Manuálně přes UI
1. Login jako platform admin: `/cs/login`
2. `/platform/promoters` — pending requests
3. Promotér se registruje přes `/cs/register-promoter`
4. Klik **Approve** → promotér je aktivní
5. Promotér dokončí onboarding (KYC, bank, branding, první akce)

---

## Fáze 8 — Pilot test (1 den)

1. **Promotér vytvoří testovací akci** „Pilot 1 Kč" v `/admin/events/new`
2. **Sám si kup vstupenku vlastní kartou** za 1 Kč
3. **Verify**:
   - ✓ Stripe Checkout → karta prošla
   - ✓ Email s PDF dorazil
   - ✓ SMS s magic linkem dorazila (pokud BulkGate)
   - ✓ `/cs/t/<token>` rendruje rotující QR
   - ✓ `/admin/scanner` přijal QR
   - ✓ Účetní export `/admin/payouts/export?month=YYYY-MM` validní
4. **Refund test**: `/my-tickets` → Požádat → Stripe refund → karta credit ✓

---

## Fáze 9 — Cutover ze SMSticketu (postupné!)

| Týden | Akce |
|---|---|
| 1 | **Paralelní běh**: 1 nová akce na Tixly, staré dobíhají na SMSticketu |
| 2-4 | **Všechny nové akce na Tixly** + denně sleduj support |
| 2-3 měsíc | **6+ úspěšných akcí na Tixly** → vypnout SMSticket subscription |

**Důležité**: dokud SMSticket dobíhá staré akce, **nech ho zaplacený**. Migrate jen NOVÉ akce, ne stávající rezervace.

---

## Provozní rutina po launch

### Daily
- **Uptime monitor**: UptimeRobot zdarma, ping `/api/health` každých 5 min

### Weekly
- `pg_dump` zálohu na S3/Backblaze (Neon má built-in PITR, ale defense-in-depth)
- Check `/platform` — pending promotéři, flagged events
- Sentry digest (errors za týden)

### Monthly
- **Settlement run**: `/admin/payouts` per promotér → bank transfer
- **Tier evaluate**: `POST /api/internal/cron/promoter-tier-evaluate`
- **Marketplace Ads invoicing**: `/admin/ads` total clicks × CPC

### Incidents
- Vercel → Deployments → Promote previous (rollback)
- Neon PITR (point-in-time recovery — last 7 days zdarma)

---

## Náklady — odhad pro 50 akcí/rok, 5 000 vstupenek

| Položka | Měsíčně | Ročně |
|---|---|---|
| Vercel Hobby → Pro | $0-20 | $0-240 |
| Neon free → Launch | $0-19 | $0-230 |
| Resend free → Pro | $0-20 | $0-240 |
| BulkGate 1000 SMS | ~500 Kč | ~6 000 Kč |
| Stripe transactional (5000× 200 Kč × 1.4% + 5) | — | ~39 000 Kč |
| Doména | — | ~250 Kč |
| **Celkem CZ** | **~700 Kč** | **~45 000 Kč** |

**vs SMSticket** (typicky 5-10% provize z prodeje): pro 1 000 000 Kč/rok = **50 000-100 000 Kč**.

→ Tixly je **levnější** + **vlastníš platformu** + můžeš mít vlastní marketplace.

---

## Quick reference

| URL | Co |
|---|---|
| `/api/health` | Uptime + provider checks |
| `/platform` | Super admin dashboard |
| `/platform/promoters` | Approve/suspend promotéři |
| `/admin` | Promotér admin (po loginu) |
| `/admin/scanner` | Scanner na bráně |
| `/admin/payouts` | Settlement view |
| `/cs/events` | Buyer marketplace |

| Cron | Frekvence | Endpoint |
|---|---|---|
| Expire pending orders | 15 min | `/api/internal/cron/expire-pending-orders` |
| Charge installments | 1 hod | `/api/internal/cron/charge-installments` |
| Bank sync Fio | 5 min | `/api/internal/cron/bank-sync-fio` |
| Promoter tier evaluate | 1× den | `/api/internal/cron/promoter-tier-evaluate` |
| Onboarding reminder | 1× den | `/api/internal/cron/onboarding-reminder` |
| Send reminders | 1 hod | `/api/internal/cron/send-reminders` |
| Daily stats | 1× den | `/api/internal/cron/daily-stats` |

Vercel cron config v `vercel.json`.

---

## Když se něco rozbije

| Problem | Diagnostika | Fix |
|---|---|---|
| 500 errors | `/api/health` | Check DB connection, Vercel logs |
| Stripe webhook nepřichází | Dashboard → Webhooks → Recent events | Resend / check signing secret |
| Email končí v spamu | Resend → Delivery insights | DKIM/SPF/DMARC; warm-up |
| DB pomalá | Neon → Monitoring | Connection pooling, upgrade plan |
| Pending orders se nevymazávají | Cron logs | `INTERNAL_SERVICE_TOKEN` env |
| 504 timeout | Vercel logs | Endpoint > 10s → optimize SQL nebo upgrade Pro |

---

## Bonus — auto-deploy via GitHub Actions

`.github/workflows/deploy.yml` (volitelné, Vercel to dělá automaticky při push):

```yaml
name: Deploy
on:
  push:
    branches: [master]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.ORG_ID }}
          vercel-project-id: ${{ secrets.PROJECT_ID }}
          vercel-args: --prod
          working-directory: nextjs-boilerplate
```
