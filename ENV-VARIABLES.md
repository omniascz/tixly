# Environment variables — kompletní reference

> Stav k 2026-05-15. Single source of truth pro všechny env vars používané v Tixly.
> Pro deploy: viz `DEPLOYMENT.md`. Pro CZ/SK launch: viz `LAUNCH-CZ-SK.md`.

---

## 🔴 POVINNÉ pro production

### Database
```env
DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require
```
Neon / Supabase / vlastní Postgres. SSL povinné v produkci.

### App
```env
APP_URL=https://vstupenky.tixly.cz
NEXT_PUBLIC_APP_URL=https://vstupenky.tixly.cz
NODE_ENV=production
```

### Crypto secrets (generuj přes `openssl rand -base64 32`)
```env
JWT_SECRET=<base64-32>
INTERNAL_SERVICE_TOKEN=<hex-32>      # openssl rand -hex 32
TICKET_MAGIC_SECRET=<base64-32>      # HMAC pro SMS magic linky
EMAIL_VERIFY_SECRET=<base64-32>      # HMAC pro verify-email tokens
ENCRYPTION_KEY=<base64-32>           # AES-256-GCM pro TOTP secrets
CRON_SECRET=<hex-32>                 # Vercel cron auth
```

---

## 💳 Platební brány (vyber 1 nebo 2)

### Provider switching
```env
PAYMENT_PROVIDER=gopay        # gopay | comgate | stripe | mock
PAYMENT_PROVIDER_EUR=comgate  # volitelné — override pro EUR akce (SK)
```

### GoPay (CZ + SK, primary doporučený)
```env
GOPAY_GOID=8123456789                       # merchant ID (číselný)
GOPAY_CLIENT_ID=client-id-from-gopay
GOPAY_CLIENT_SECRET=client-secret
GOPAY_API_BASE_URL=https://gate.gopay.cz/api   # default
GOPAY_SANDBOX=false                          # true pro test
```
Sandbox URL: `https://gw.sandbox.gopay.com/api`

Webhook URL (nastav v GoPay dashboard):
```
https://vstupenky.tixly.cz/api/payments/gopay/webhook
```

### ComGate (CZ + SK, alternative)
```env
COMGATE_MERCHANT=CG-XXXXXX
COMGATE_SECRET=longsecretvalue
COMGATE_TEST=false                           # true pro test
COMGATE_API_BASE_URL=https://payments.comgate.cz/v2.0   # default
```

Webhook URL (nastav v ComGate dashboard):
```
https://vstupenky.tixly.cz/api/payments/comgate/webhook
```

### Stripe (parked, jen pro budoucí mezinárodní expanzi)
```env
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```
Webhook: `https://vstupenky.tixly.cz/api/payments/stripe/webhook`
Events: `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`

---

## 📧 Email (SMTP)

### Resend (doporučený pro CZ + SK)
```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_USER=resend
SMTP_PASS=re_xxxxxxxxxxxxxxx
EMAIL_FROM=vstupenky@tixly.cz
```
DNS records v doméně: SPF + DKIM + DMARC podle pokynů Resend.

### Alternativy
```env
# Postmark
SMTP_HOST=smtp.postmarkapp.com
SMTP_USER=<server-token>
SMTP_PASS=<server-token>

# SES (AWS)
SMTP_HOST=email-smtp.eu-central-1.amazonaws.com
SMTP_USER=<smtp-credentials-user>
SMTP_PASS=<smtp-credentials-pass>
```

### Dev (MailHog)
```env
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=vstupenky@tixly.local
```

---

## 📱 SMS — BulkGate

```env
BULKGATE_APPLICATION_ID=12345
BULKGATE_APPLICATION_TOKEN=token-from-bulkgate
BULKGATE_SENDER=Tixly                # sender ID (max 11 chars)
```
Bez těchto env padá do mock režimu (`src/lib/sms/bulkgate-mock.ts`).

---

## 🤖 Anti-bot — hCaptcha

```env
NEXT_PUBLIC_HCAPTCHA_SITE_KEY=ES_xxxxxxxxxx
HCAPTCHA_SECRET=ES_yyyyyyyyyy
```

---

## 🔔 Push notifikace — Web Push VAPID

Vygeneruj: `npx web-push generate-vapid-keys`

```env
VAPID_PUBLIC_KEY=<base64>
VAPID_PRIVATE_KEY=<base64>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<base64>     # same jako VAPID_PUBLIC_KEY
VAPID_SUBJECT=mailto:tech@tixly.cz
```

---

## 🤖 AI — Anthropic Claude

Pro AI popisy akcí + cover image generation (volitelné).
```env
ANTHROPIC_API_KEY=sk-ant-xxx
```
Bez tohoto klíče AI endpointy vracejí placeholder.

---

## 📊 Monitoring — Sentry (volitelné)

```env
SENTRY_DSN=https://xxxx@xxx.ingest.sentry.io/yyyy
SENTRY_ORG=tixly
SENTRY_PROJECT=tixly-production
SENTRY_AUTH_TOKEN=sntrys_xxx              # pro source map upload
```

---

## 🌍 Lokalizace

```env
LOCALES_ACTIVE=cs,sk,en           # default: cs,sk,en (catch-up #5)
DEFAULT_LOCALE=cs
```

---

## 🏦 Bank integrace — PSD2 OAuth (CZ banky)

Pro auto-pair bank transferů přes Fio API + KB/ČS/ČSOB PSD2 (Tier-1 #4).

### Fio Open API (jednodušší, jen ČR)
```env
FIO_API_TOKEN=<token-from-fio-online>      # per Tixly s.r.o. account
```

### PSD2 OAuth (KB / ČS / ČSOB)
```env
PSD2_CLIENT_ID=<from-bank-portal>
PSD2_CLIENT_SECRET=<from-bank-portal>
PSD2_REDIRECT_URI=https://vstupenky.tixly.cz/api/admin/bank-credentials/psd2/callback
```
Pro každou banku separátní (KB, ČS, ČSOB) — registrace v jejich developer portál.

---

## 🎁 Benefit cards (Pluxee / Edenred / Benefit Plus / Sodexo / Gallery Beta)

```env
PLUXEE_API_KEY=<key>
PLUXEE_MERCHANT_ID=<id>

EDENRED_API_KEY=<key>
EDENRED_MERCHANT_ID=<id>

BENEFITPLUS_API_KEY=<key>
BENEFITPLUS_MERCHANT_ID=<id>

SODEXO_API_KEY=<key>
SODEXO_MERCHANT_ID=<id>

GALLERYBETA_API_KEY=<key>
```
Bez env padá do mock (callback route je `/api/payments/benefit/callback`).

---

## 🎫 Wero (SEPA Instant) — pro EUR akce

```env
WERO_MERCHANT_ID=<id>
WERO_API_KEY=<key>
```

---

## 🛠 Dev tools (volitelné, jen lokálně)

```env
# Pro reset všech promotér passwords na 'Demo2026!'
DEMO_RESET_TOKEN=<hex-32>

# Skip moderation pro AI gate (jen dev!)
SKIP_AI_MODERATION=true

# Verbose logging
DEBUG=tixly:*
LOG_LEVEL=debug
```

---

## ✅ Checklist před production deploy

| Kategorie | Var | Status |
|---|---|---|
| **Database** | `DATABASE_URL` | ❓ Neon production projekt |
| **App** | `APP_URL`, `NEXT_PUBLIC_APP_URL` | ❓ vlastní doména |
| **Crypto** | 6 secrets (JWT, INTERNAL, TICKET, EMAIL, ENCRYPTION, CRON) | ❓ generuj `openssl rand` |
| **Payment** | `PAYMENT_PROVIDER` + GoPay nebo ComGate keys | ⏳ čeká na kontrakt |
| **Email** | Resend keys + DNS DKIM/SPF/DMARC | ❓ ověřená doména |
| **SMS** | BulkGate credentials | ⏳ čeká na account |
| **CAPTCHA** | hCaptcha site/secret | ❓ rychlé |
| **Push** | VAPID keys | ❓ generuj `web-push` |
| **AI** | `ANTHROPIC_API_KEY` | ✅ optional |
| **Bank** | `FIO_API_TOKEN` | ⏳ Fio Online aktivace |
| **Sentry** | `SENTRY_DSN` | ✅ optional |

---

## 🔒 Bezpečnost

- **Nikdy** necommituj `.env.local` ani `.env.production` do gitu (`.gitignore` to už řeší)
- **Rotace secretů** každých 90 dní (JWT_SECRET, INTERNAL_SERVICE_TOKEN, TICKET_MAGIC_SECRET)
- **PCI scope:** žádné raw card data v Tixly env. Gate hostuje payment page (GoPay/ComGate iframe nebo redirect)
- **Vercel env** musí mít vše v **Production scope** (ne Preview/Development) pro production deploy
- **Audit:** `audit.audit_log` zachycuje všechny webhook events pro reconciliation
