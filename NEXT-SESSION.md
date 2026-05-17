# Konec dne — kde jsme skončili a co dál

> Session ended: **2026-05-15 večer**.
> Stav: TypeScript clean, 358/362 testů zelených, all migrations 069-269 napsané, all 15 cronů v dispatcheru.

---

## ✅ Co je dnes hotové

### Infrastruktura
- **Provider abstrakce pro platby** — GoPay, ComGate, Stripe (parked), env-switchable
- **Webhook endpointy** — `/api/payments/gopay/webhook`, `/api/payments/comgate/webhook` s payment_events log
- **VS generator** per-event sequence (`EEEEEENNNN` formát, 10 digits)
- **Holdback engine** tier-based (T1: 5%/90d, T2: 3%/60d, T3+: 0)
- **15 vercel.json crons** v dispatcheru a `ALLOWED_JOBS` setu
- **Auto-settle weekly payouts cron** (pondělky 7 ráno)

### CZ/SK specifika
- **Migrace 265** — `promoters.country`, `primary_currency`, `chargeback_holdback_pct/days`, `fee_schedules.buyer_fee_halire/currency`
- **Migrace 266** — `orders.refund_requests` queue
- **Migrace 267** — `marketing.campaigns` + recipients
- **Migrace 268** — `identity.password_reset_tokens`
- **Migrace 269** — `audit.content_reports` (DSA Art. 16)
- **Per-event refund policy** — deadline před akcí, fee %, min fee
- **QR policy enum** — static_allowed / rotating_24h / rotating_only / photo_required
- **VAT category enum** — standard / cultural / food_beverage / merchandise / reduced
- **SK kulturní DPH 5 %** (CZ má 10 %)

### Admin UI (`/admin`)
- Promotér dashboard s refund rate, churn signals, top 5 customers, churn risk list
- Event create wizard s CZ/SK defaults z promotér country
- Event settings: refund policy + QR policy + VAT category
- Holds & Kills per event (5 kategorií)
- Refund requests queue
- Reservations B2B/phone flow
- Campaigns composer (email/SMS/push)
- Marketing dashboard (UTM attribution)
- Reports (CSV + Pohoda XML)
- POS desktop + quick tablet
- Onboarding checklist s country/currency check

### Master admin UI (`/platform`)
- Overview dashboard: revenue/měna, top promotéři, holdback monitor, webhook activity, provider health
- Promotér detail s CZ/SK launch settings card (country, currency, tier, fee override s důvodem)
- Event moderation queue + AI gate
- DSA content reports queue (GET + PATCH)
- Webhook events log
- Audit log

### Sales web (`/cs`, `/sk`, `/en`)
- Lokalizovaná homepage: kategorie + this week + upcoming
- Public promotér profile s stats (4 cards: total events, upcoming, rating, reviews)
- Event detail s ReportButton (DSA „Nahlásit obsah")
- Checkout: GoPay/Wero/bank transfer + benefit karty toggle (5 providerů)
- My-tickets: Apple Wallet + Google Wallet tlačítka
- Cookie banner CS/SK/EN
- Legal pages (terms, privacy) CS + SK lokalizace

### Auth
- **Password reset flow** — forgot-password page, reset-password page, 2 API endpointy, lokalizované emaily, rate-limit, force logout všech sessions

### Payment methods
- GoPay (CZ/SK, kód kompletní)
- ComGate (CZ/SK, kód kompletní)
- Bank transfer s VS (10-digit per-event)
- Pluxee, Sodexo, Benefit Plus, Edenred, Gallery Beta (5 benefit karet — UI radio buttony + backend router)
- Apple Wallet pass
- Google Wallet pass (RS256 JWT)

### Monitoring + provoz
- `/api/health/providers` — stav 11 providerů
- Public `/status` page s provider health + incidents placeholder
- Sentry config files + package.json (čeká `npm install`)
- `.github/workflows/db-backup.yml` — týdně S3 backup s AES-256 encrypt
- `scripts/restore-from-s3.sh` — restore drill script

### Dokumenty
- `STANDING-2026-05-15-v2.md` — porovnání vs konkurence
- `AUDIT-CZ-LAUNCH.md` — důkladný audit gapů
- `LAUNCH-CZ-SK.md` — roadmap CZ/SK
- `ENV-VARIABLES.md` — kompletní env reference
- `DEPLOYMENT.md` (updated) — Stripe → GoPay/ComGate
- `TESTER-PLAYBOOK.md` — manuální QA scénáře
- `BUG-INVENTORY.md` — aktuální seznam (98 % done)
- `ARCHIVE-INVENTORY.md` — 187 archive modulů klasifikovaných
- `TICKETING-VS-MARKETING.md` — separace vrstev
- `ANALYZA-CHARGEBACK-A-QR.md` — anti-padělání analýza

---

## ⏳ Co tě čeká — TVOJE STRANA

### Před production deploy (must-have)

| # | Co | Kde / akce | Doba |
|---|---|---|---|
| 1 | **GoPay nebo ComGate API keys** | Smlouva podepsaná → keys do Vercel env (`GOPAY_GOID/CLIENT_ID/SECRET` nebo `COMGATE_MERCHANT/SECRET`) | 5-7 dní KYC |
| 2 | **Fio IBAN** (CZK + EUR) | Update `platform.promoters` Tixly entity přes psql nebo `/platform/promoters/[id]` | 5 min když máš |
| 3 | **Resend doména + DNS** | resend.com → Add Domain → DKIM/SPF/DMARC records v DNS provider | 30 min + DNS propagace |
| 4 | **`npm install`** v `nextjs-boilerplate/` | Stáhne `@sentry/nextjs` (přidaný do package.json) | 2 min |
| 5 | **GitHub Actions secrets** pro backup | Settings → Secrets → 6 hodnot (viz `db-backup.yml` header) | 10 min |
| 6 | **AWS S3 bucket** + lifecycle policy | Create bucket `tixly-backups` v eu-central-1 + Standard-IA → Glacier → expire 365 | 15 min |
| 7 | **Production deploy** | Vercel link → push to main → migrace 069-269 na Neon → seed master admin | 30 min |

### Volitelné, do týdne po launch

| # | Co | Kdy |
|---|---|---|
| 8 | **BulkGate SMS account** | Pokud chceš SMS QR vstupenky |
| 9 | **hCaptcha keys** | Anti-bot pro checkout (10 min) |
| 10 | **Google Wallet RS256 keypair** | Pokud chceš production Google Wallet (Apple Wallet stačí pro start) |
| 11 | **Sentry DSN** | Production error tracking |
| 12 | **Právník — ToS + Privacy CZ + SK revize** | 1-2 týdny |
| 13 | **VAT MOSS pro SK trading** | Pokud chceš prodávat slovenským pořadatelům |

---

## 🚀 Launch path — kdy pustit první akci

```
Týden 1 (TY)
  □ GoPay/ComGate kontrakt
  □ Resend doména + DNS
  □ npm install + Vercel env setup
  □ GitHub Actions secrets

Týden 1-2 (JÁ po tvých datech)
  □ Production deploy na Vercel
  □ Migrace 001-269 na Neon production
  □ Seed master admin
  □ Onboard první divadlo (Divadlo Verze ze seedu nebo nové)
  □ Test purchase 1 Kč vlastní kartou
  □ Verify: email s PDF + scan + payout

Týden 2-3
  □ První reálná akce za peníze
  □ Sledování /platform dashboard + status page
  □ Případné fixes z reálných problémů

Měsíc 1+
  □ Více pořadatelů (cold outreach z analysis/*-analyza.md)
  □ Marketing kampaně přes /admin/campaigns
  □ Měsíční Pohoda export pro účetní
```

---

## 🎯 Open backlog (nice-to-have, post-pilot)

Tyhle věci NE-blokují launch, ale stojí za pozornost po prvních akcích:

- **Notifications center** (`/admin/notifications`) — in-app alerts pro promotéra
- **Full-text search vylepšení** — `pg_trgm` + typo tolerance v `/cs/search`
- **Sitemap.xml dynamic** — auto-pull published eventů + promotérů pro Google
- **API documentation page** — Swagger / Redoc pro veřejný GraphQL
- **Money S3 ISDOC export** — pro menší CZ účetní software
- **iDoklad export** — taky menší CZ
- **Native mobile PWA enhancement** — manifest + push + offline-first
- **OTel tracing** — instrumentace nad rámec Sentry
- **Status page incidenty** — DB table + publish flow (UI placeholder hotový)
- **Cover image upload widget** — místo externí URL field
- **Audience segmentation UI** rozšířit (víc dimenzí než 2)
- **Smart send-time UI** otevřít (backend existuje)
- **Webhook subscriptions admin UI** — pro custom 3rd party integrations
- **Audit log advanced filters** — date range, actor type
- **Event cloning UI** (modul je v archive)
- **Notification center promotér**
- **DSA transparency report** — quarterly publish per Art. 24

---

## 📍 Klíčové soubory pro start nové session

```
docs/
  STANDING-2026-05-15-v2.md       — kompletní porovnání vs konkurence
  AUDIT-CZ-LAUNCH.md              — co reálně funguje (98 %)
  LAUNCH-CZ-SK.md                 — roadmap CZ + SK
  ENV-VARIABLES.md                — všechny env vars
  DEPLOYMENT.md                   — krok-za-krokem deploy
  NEXT-SESSION.md                 — TENTO SOUBOR

config/
  nextjs-boilerplate/package.json — @sentry/nextjs přidaný
  nextjs-boilerplate/vercel.json  — 15 crons
  nextjs-boilerplate/next.config.mjs — Sentry wrap
  .github/workflows/db-backup.yml — S3 backup workflow

scripts/
  run-migrations.sh                — production migrate
  restore-from-s3.sh               — restore drill
  seed-platform.sql                — master admin + 3 demo promotéři
  seed-divadlo-celetna.sql         — Divadlo Verze (pilot)

migrations/
  069_event_seats_base.sql         — chybějící CREATE TABLE
  264_event_seats_nulls_not_distinct.sql
  265_cz_sk_launch.sql             — country/currency/tier/fee/holdback
  266_refund_requests.sql
  267_marketing_campaigns.sql
  268_password_reset_tokens.sql
  269_dsa_reports.sql
```

---

## 💡 Pro novou session

Když začneme znovu, řekni jednu z těchto:

- **„pokračuj"** — vezmu open backlog nahoře a začnu kde dává smysl
- **„deployujeme"** — pokud máš GoPay credentials, projdeme deploy step-by-step
- **„onboard divadlo"** — vytvoříme pilot promotér flow
- **„fix [konkrétní bug]"** — focus na něco co nefunguje při tvém testu
- **„audit znovu"** — pokud chceš ověřit stav po pauze

Memory mám aktualizovanou. Tixly stav z dnešního dne mě nezapomenu.

---

**Dobrou noc.** Spousta věcí hotových.
