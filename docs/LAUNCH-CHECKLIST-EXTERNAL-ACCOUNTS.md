# Launch Checklist — externí účty

**Stav k 2026-05-21.** Co je hotové (✅) vs co musíš ručně udělat (❌).

---

## ✅ Hotové automaticky / code

| Položka | Stav | Detail |
|---|---|---|
| Vercel deploy | ✅ | https://nextjs-boilerplate-gamma-three-brbfcxv720.vercel.app |
| GitHub repo | ✅ | https://github.com/omniascz/tixly |
| Auto-deploy z `master` | ✅ | Push triggers Vercel build |
| Neon Postgres | ✅ | EU Frankfurt, 192 migrací aplikováno |
| VAPID keys | ✅ | Generated + uploaded to Vercel env |
| `DATABASE_URL` | ✅ | Production + Development |
| `JWT_SECRET` | ✅ | Random 65-char |
| `INTERNAL_SERVICE_TOKEN` | ✅ | Random 64-char |
| `CRON_SECRET` | ✅ | Random 64-char |
| `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` | ✅ | Web Push ready |

---

## ❌ Čeká na tebe (cca 30 minut total)

### 1. Upstash Redis — ⏱ 5 min

**Proč:** seat holds (anti-double-booking), email queue, rate limiting per tenant.

**Postup:**
1. https://console.upstash.com/login → Sign in with GitHub
2. **Create Database:**
   - Name: `tixly-redis`
   - Region: **eu-central-1 (Frankfurt)** (stejné jako Neon!)
   - Type: Regional
   - Eviction: disabled (TTL handling explicitní v kódu)
3. V detail "REST API" tabu zkopíruj **UPSTASH_REDIS_REST_URL** + token
4. V "Node.js" tabu zkopíruj **redis://** connection string
5. **Pošli oba sem do chatu.** Já nastavím:
   - `REDIS_URL=redis://default:...@...upstash.io:6379`
   - `UPSTASH_REDIS_REST_URL=https://...upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN=...`

### 2. Sentry — ⏱ 5 min

**Proč:** error tracking, performance monitoring, runbook URL injection (`docs/RUNBOOK-DR.md`).

**Postup:**
1. https://sentry.io/signup → Sign in with GitHub
2. Create project: **Next.js**, name: `tixly-production`, team: default
3. Po vytvoření klikni **"Settings → Client Keys (DSN)"**
4. Zkopíruj DSN URL (format: `https://abc123@o12345.ingest.sentry.io/678`)
5. **Pošli sem.** Nastavím:
   - `SENTRY_DSN=https://...`
   - `NEXT_PUBLIC_SENTRY_DSN=https://...`

Free plan: 5k events/měsíc, dostačující pro launch.

### 3. Better Uptime probe — ⏱ 5 min

**Proč:** alert do emailu / SMS pokud `/api/health/ready` selže.

**Postup:**
1. https://uptime.betterstack.com/users/sign-up → free plan
2. Create monitor:
   - URL: `https://nextjs-boilerplate-gamma-three-brbfcxv720.vercel.app/api/health/ready`
   - Type: HTTP
   - Check every: 1 minute
   - Recovery period: 1 min
   - Email alerts: ✅
3. Optional: SMS alerts (paid)
4. Klikni "Create"

**Žádné Vercel env vars** — Better Uptime checks externě.

### 4. Resend SMTP — ⏱ 30 min + 1-2 dny DNS propagace

**Proč:** confirmation emails, refund notifications, newsletter digest cron.

**Postup:**
1. https://resend.com/signup → Sign in with GitHub
2. Free plan: 3k emails/měsíc
3. **Add Domain → `tixly.cz`**
4. Resend ti dá 3 DNS records (TXT + 2 CNAME):
   ```
   send.tixly.cz   CNAME  resend.com
   ...
   _dmarc.tixly.cz TXT    v=DMARC1; p=none; rua=mailto:dmarc@tixly.cz
   tixly.cz        TXT    v=spf1 include:_spf.resend.com ~all
   ```
5. Vlož do Cloudflare DNS pro `tixly.cz`
6. Počkej 1-2 dny propagace
7. V Resend dashboard verify → zelená galéria
8. Vytvoř **API key** (full access)
9. **Pošli sem.** Nastavím:
   - `SMTP_HOST=smtp.resend.com`
   - `SMTP_PORT=587`
   - `SMTP_USER=resend`
   - `SMTP_PASS=re_XXX...`
   - `EMAIL_FROM=vstupenky@tixly.cz`

### 5. GoPay merchant — ⏱ ~14 dní

**Proč:** real platby (zatím mock).

**Postup:**
1. https://www.gopay.cz/ → kontakt obchod
2. Smlouva — IČO, KYC dokumenty, jednatelé ID
3. KYC review (3-7 dní)
4. Sandbox testovací API → live API (1-2 dny)
5. Webhook URL whitelist: `https://app.tixly.cz/api/webhooks/gopay`
6. **Pošli sem credentials.** Nastavím:
   - `GOPAY_GOID=...`
   - `GOPAY_CLIENT_ID=...`
   - `GOPAY_CLIENT_SECRET=...`
   - `GOPAY_API_URL=https://gate.gopay.cz/api/`

### 6. Apple Wallet PassType cert — ⏱ ~7 dní

**Proč:** signed `.pkpass` files (currently unsigned dev mode).

**Postup:**
1. https://developer.apple.com → Apple Developer Program enrollment (99 USD/rok)
2. KYC review (3-5 dní)
3. Po schválení: Certificates → New Pass Type ID
4. Stáhni `.p12` cert + Apple WWDR cert
5. **Pošli sem soubory + heslo.** Nastavím v Vercel:
   - `APPLE_PASS_TYPE_ID=pass.cz.tixly.ticket`
   - `APPLE_PASS_CERT_P12_BASE64=...`
   - `APPLE_PASS_CERT_PASSWORD=...`
   - `APPLE_WWDR_CERT_BASE64=...`

### 7. Google Wallet — ⏱ ~3 dny

**Proč:** "Add to Google Wallet" button funkční.

**Postup:**
1. https://pay.google.com/business/console/ → Sign in with Google
2. Create issuer account (3-5 dní review)
3. Po schválení: Generate service account JSON
4. **Pošli sem JSON.** Nastavím:
   - `GOOGLE_WALLET_ISSUER_ID=...`
   - `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=...`

### 8. Cloudflare DNS pro `tixly.cz` — ⏱ 10 min

**Proč:** custom domain `app.tixly.cz`.

**Postup:**
1. Pokud doménu už máš někde jinde (regZone, dnshosting.cz, ...) → transfer NS records na Cloudflare
2. Cloudflare → Add Site → tixly.cz → Free plan
3. V Vercel: Project Settings → Domains → Add `app.tixly.cz`
4. Vercel ti dá CNAME (např. `cname.vercel-dns.com`)
5. Cloudflare DNS → `app.tixly.cz` CNAME → `cname.vercel-dns.com`
6. Po propagaci (5-30 min) → Vercel automaticky vystaví SSL

---

## Prioritní pořadí

**Hned (10 min):**
1. ✅ VAPID — hotové
2. **Upstash Redis** ← kritické pro full funkčnost
3. **Sentry** ← snadné

**Tento týden:**
4. **Better Uptime** ← alert na výpadek
5. **Cloudflare DNS** ← custom domain

**Příští 2 týdny:**
6. **Resend SMTP** ← potřeba pro emails (cron + checkout confirmation)
7. **Apple Wallet** ← signed pkpass
8. **Google Wallet** ← Add to Google Wallet button

**Měsíc / déle:**
9. **GoPay live** ← real platby (mock funguje pro demo)

---

## Kontrola po setupu každého účtu

```bash
# Health check
curl https://app.tixly.cz/api/health/ready
# {"ok":true,"checks":{"db":"ok","redis":"ok",...}}

# Pro každý endpoint specifický:
curl https://app.tixly.cz/api/health/redis  # po Upstash
curl https://app.tixly.cz/api/health/providers  # po GoPay
```

Vercel deploy logs:
```bash
vercel logs https://app.tixly.cz --follow=false
```

Sentry errors:
- Open https://sentry.io/organizations/<your-org>/issues/

Better Uptime status:
- Open https://uptime.betterstack.com/team/<id>/monitors

---

## Audit log

| Datum | Akce | Status |
|---|---|---|
| 2026-05-20 | Vercel project link + GitHub auto-deploy | ✅ |
| 2026-05-20 | Neon Postgres + migrations | ✅ |
| 2026-05-21 | VAPID keys generated + uploaded | ✅ |
| TBD | Upstash Redis | ⏳ |
| TBD | Sentry DSN | ⏳ |
| TBD | Better Uptime probe | ⏳ |
| TBD | Resend domain verified | ⏳ |
| TBD | GoPay live API | ⏳ |
| TBD | Apple Wallet cert | ⏳ |
| TBD | Google Wallet service account | ⏳ |
| TBD | Cloudflare DNS app.tixly.cz | ⏳ |
