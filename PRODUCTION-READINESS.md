# Production readiness checklist — Tixly

> Co všechno musí být zelené, než pustíme **reálný traffic + první reálnou platbu**. Doplnit k existujícímu `DEPLOYMENT.md` (technické nastavení) a `BUG-INVENTORY.md` (kódové bugy).
>
> Stav k 2026-05-15. Označuj `[x]` jak řešíš.

---

## 1. DevOps & infrastructure

### 1.1 Hosting & deploy
- [ ] **Vercel production projekt** vytvořen + linked do GitHub repo
- [ ] **Custom doména** + HTTPS (Vercel auto)
- [ ] **Preview deployments** ve Vercel funkční pro PR review
- [ ] **Production branch protection** v GitHub (require PR review + status checks)
- [ ] **Rollback plán** — Vercel „Promote previous deployment" otestován v dry-run
- [ ] **Build cache** v Vercel optimalizován (`pnpm install --frozen-lockfile`)
- [ ] **Environment variables** všechny v Vercel Production scope (ne v `.env.local`)
- [ ] **Secret rotation policy** — co rotovat za 90 dní (JWT_SECRET, INTERNAL_SERVICE_TOKEN, …)

### 1.2 Database (Neon Postgres)
- [ ] **Neon production projekt** v EU (Frankfurt) → GDPR safe
- [ ] **Connection pooling** přes pgbouncer (Neon auto)
- [ ] **Read replica** pro analytics (Neon Launch plán a výš)
- [ ] **Point-in-time recovery (PITR)** povolen (free 7 dní, paid 30+)
- [ ] **Daily `pg_dump` na S3/Backblaze** (defense-in-depth) — cron
- [ ] **Migration runner** otestován v staging (`scripts/run-migrations.sh`)
- [ ] **B6 fix:** `UNIQUE NULLS NOT DISTINCT` na `event_seats` — viz BUG-INVENTORY
- [ ] **RLS** (row-level security) na všech multi-tenant tabulkách — schema audit
- [ ] **Backup restore drill** — alespoň 1× otestováno proti čerstvému Neon projektu

### 1.3 Monitoring & alerting
- [ ] **Sentry projekt** + DSN v env
- [ ] **Sentry alert rules** — error rate > 1% / 5min, performance regression
- [ ] **UptimeRobot** ping `/api/health` každých 5 min
- [ ] **Vercel Analytics** povolen
- [ ] **Performance budget** — Lighthouse score ≥ 80 na key pages
- [ ] **Slack/email alerting** pro Sentry + UptimeRobot

### 1.4 CI/CD
- [ ] **GitHub Actions** workflow pro PR: lint + typecheck + test + build
- [ ] **Playwright E2E** v CI (alespoň golden-path-buyer + scanner verifier)
- [ ] **Branch protection** — žádný direct push do `main`
- [ ] **Dependency audit** v CI (`pnpm audit --prod`) — fail on high/critical
- [ ] **Snyk / Dependabot** PR pro security updates

### 1.5 Performance / load
- [ ] **Load test scénář** — 1000 concurrent buyers + 100 onsales/sec (k6 / Artillery)
- [ ] **Redis pro queue** — Upstash provisioned + connection string v env
- [ ] **Rate limiting** per IP a per email pro: login, register, checkout, refund
- [ ] **CDN cache headers** na static assets
- [ ] **Image optimization** — Next/Image + Vercel CDN
- [ ] **DB query plan review** — top 10 dotazů přes pg_stat_statements

### 1.6 Cron jobs (Vercel cron)
- [ ] `CRON_SECRET` v env
- [ ] **Promoter tier evaluation** cron (monthly) — `/api/internal/cron/promoter-tier-evaluate`
- [ ] **Payment plan charge** cron — `/api/internal/cron/charge-installments`
- [ ] **Order timeout cleanup** cron (every 15 min) — orphaned holds, expired carts
- [ ] **Daily stats email** cron — `/api/internal/cron/daily-stats`
- [ ] **Resend bounce sync** cron (denně)
- [ ] **Webhook retry** dispatcher cron

---

## 2. Security

### 2.1 Application security
- [ ] **CSP** (Content Security Policy) headers v Next config
- [ ] **HSTS** přes Vercel (auto-enabled)
- [ ] **CSRF protection** na všech mutate endpointech (JWT + same-origin)
- [ ] **XSS prevention** — žádný `dangerouslySetInnerHTML` bez `DOMPurify`
- [ ] **SQL injection** — všechny dotazy přes parametrizované queries (žádné string concat)
- [ ] **OWASP top 10** audit — pen-test nebo aspoň vlastní review

### 2.2 Auth & access
- [ ] **JWT secret rotation** plán (90 dní)
- [ ] **Refresh token revocation** funguje (logout / password change)
- [ ] **2FA pro admin** povinné (`/admin/2fa/setup` existuje) — vynutit při onboardingu
- [ ] **Passkey/WebAuthn** opt-in pro buyers (P2 gap)
- [ ] **Login rate limiting** — 5 attempts/15min/IP
- [ ] **Password complexity** — alespoň 12 chars, není v top 10k common
- [ ] **Bcrypt cost factor** ≥ 12

### 2.3 Payment security
- [ ] **Stripe PCI-DSS SAQ A** — checkout přes Stripe Elements (žádné raw card data)
- [ ] **3DS** povinné pro karty
- [ ] **Webhook signature verification** (`STRIPE_WEBHOOK_SECRET`) — anti-forgery
- [ ] **Webhook idempotency** — `event.id` v `payments.webhook_events` tabulce
- [ ] **Refund authorization** — jen owner nebo admin

### 2.4 Bot / fraud
- [ ] **hCaptcha** na: register, checkout, password reset
- [ ] **Verified Fan** dostupný pro high-demand akce
- [ ] **Purchase limit** per email/payment method pro 1 akci
- [ ] **Device fingerprinting** anti-bot (existuje archive — port)
- [ ] **IP blacklist** admin UI pro známé scalpery
- [ ] **Bot proof queue** post-purchase (B7 z DB-SCHEMA-GAP)

### 2.5 Secrets management
- [ ] **`.env.example`** v repu, **žádné** real secrets v gitu
- [ ] **Secret scanner** v CI (truffleHog / GitLeaks)
- [ ] **Vercel env** všechny v Production scope (ne Preview/Development)
- [ ] **DB connection pooling** přes pgbouncer (ne raw connection string)

---

## 3. GDPR & EU compliance

### 3.1 Právní dokumenty
- [ ] **Obchodní podmínky (ToS)** — vč. „smlouva o využití volného času" (žádné 14-day return)
- [ ] **Zpracování osobních údajů (GDPR)** — privacy policy
- [ ] **Cookie policy** + cookie banner (modul `cookie-consent` v archive — port)
- [ ] **Data Processing Agreement (DPA)** template pro promotéry (B2B)
- [ ] **Sub-processor list** publikovaný (Vercel, Neon, Stripe, Resend, BulkGate, Sentry)

### 3.2 Práva subjektů
- [ ] **Data export** — `/cs/profile/export` (GDPR Art. 20)
- [ ] **Account deletion** — `/cs/profile/delete` s anonymizací (Art. 17)
- [ ] **Marketing opt-out** v každém transakčním emailu
- [ ] **Audit log** všech access requests pro auditovatelnost

### 3.3 Specifické EU regulace
- [ ] **WCAG 2.1 AA** compliance — ✅ Tier-1 #2 (audit v `A11Y_AUDIT.md`), ověřit splnění **EAA (28.6.2025)** všech checkpointů
- [ ] **DSA (Digital Services Act)** — „Nahlásit obsah" tlačítko na public eventech
- [ ] **PSD2 SCA** strong customer authentication — 3DS na všech kartách
- [ ] **EU VAT MOSS** — pokud prodáváme přes hranice
- [ ] **PSPS (Payment Services)** — Stripe se o to stará, ale ověřit
- [ ] **Cookie consent** TCF v2.2 standard

### 3.4 České specifika
- [ ] **EET / účtenková povinnost** — ALE: účtenková povinnost byla zrušena 1.1.2023 ✅ (nemusíme)
- [ ] **§403–405** trestního zákoníku — moderace propagace extremismu (✅ TODO #217 částečně)
- [ ] **Zákon o DPH** — fakturace s DPH 21% (event services) vs 10% (kulturní akce)
- [ ] **GFŘ a finanční úřad** — pravidelné podání DPH přiznání
- [ ] **AML/CFT** — alespoň pro promotéry s objemem > 10 000 EUR/měs

---

## 4. Business & legal setup

### 4.1 Tixly s.r.o.
- [ ] **IČO + DIČ** zaregistrované
- [ ] **Bankovní účet** (CZK + EUR)
- [ ] **Účetní firma** smluvně
- [ ] **Pojistka odpovědnosti** za škodu (D&O + IT errors)
- [ ] **Datová schránka** zřízená
- [ ] **Trademark** „Tixly" — alespoň CZ + EU
- [ ] **Doménový portfolio** — tixly.cz / .sk / .com / .eu / .de

### 4.2 Smlouvy s pořadateli
- [ ] **Master Services Agreement (MSA)** template
- [ ] **Provize / fee** struktura definovaná (% z prodeje + servisní poplatek pro buyera)
- [ ] **Settlement** terms (T+7? T+14? po akci?)
- [ ] **Chargeback responsibility** — kdo nese (musí být v MSA)
- [ ] **Right to refuse** — Tixly může odmítnout akci porušující ToS
- [ ] **Limitation of liability** — max odpovědnost = poplatky za poslední rok
- [ ] **Termination** — výpovědní lhůta, převzetí dat

### 4.3 Smlouvy s buyery
- [ ] **ToS prodejní** — Tixly prodává *jménem a na účet pořadatele* (jako GoOut)
- [ ] **Refund policy** — kdy ano, kdy ne (zrušení akce = vždy ano)
- [ ] **Resale conditions** — face value cap default
- [ ] **Anti-scalping** policy

### 4.4 Smlouvy s dodavateli
- [ ] **Vercel** — Enterprise nebo Pro plán pro production (s SLA)
- [ ] **Neon** — Launch nebo Scale plán
- [ ] **Stripe** — aktivní business account + bankovní účet napojený
- [ ] **Resend** — Production plán (vyšší limit + dedicated IP volitelně)
- [ ] **BulkGate / Twilio** — kreditní účet + smlouva
- [ ] **hCaptcha / reCAPTCHA** — Enterprise plán pro vyšší limit

---

## 5. Operations

### 5.1 Oncall & incident response
- [ ] **Oncall rotace** definovaná (alespoň 1 osoba pro start)
- [ ] **Eskalační matrix** — kdo komu zavolat
- [ ] **Incident response runbook** — DB outage, Stripe outage, Resend outage, region failure
- [ ] **Status page** (statuspage.io nebo `_archive/status-page`) — public
- [ ] **War room channel** v Slacku
- [ ] **Post-mortem template** + commitment psát je do 48h po incidentu

### 5.2 Support
- [ ] **Support email** `podpora@tixly.cz` + helpdesk (Help Scout / Front)
- [ ] **Knowledge base** — alespoň 20 FAQ článků (refund, scan, dárkový voucher, …)
- [ ] **AI chatbot** pro tier-1 (paměť: SMSticket má AI nápovědu)
- [ ] **SLA pro promotéry** — odpověď do 4 hodin v pracovní době
- [ ] **SLA pro buyery** — odpověď do 24 hodin

### 5.3 Communications
- [ ] **Email templates** připravené (NOT just default): order confirm, refund, dispute, event cancel, password reset
- [ ] **SMS templates** přípravené (po BulkGate setup)
- [ ] **Multi-language**: CS / SK / EN minimálně
- [ ] **Brand voice** dokument

### 5.4 Onboarding pořadatele
- [ ] **Self-service registrace** — `/cs/register-promoter` + KYC flow
- [ ] **Onboarding wizard** — pravděpodobně `_archive/promoter-onboarding` port (3 svc, 5 tests, 7 routes)
- [ ] **První akce uvnitř 30 min** — UX target
- [ ] **Sandbox / testovací akce** — promotér si vyzkouší flow nanečisto (SMSticket „Festival v Parku")
- [ ] **1:1 call** pro tier 3+ promotéry

### 5.5 Settlement & accounting
- [ ] **Payouts** UI funkční (`/admin/payouts`)
- [ ] **Auto-invoice** generování (DPH řádný daňový doklad) — měsíční pro promotéry
- [ ] **Účetní export** ve formátech Pohoda / Money / iDoklad
- [ ] **Účet 'holdback'** pro chargebacky (5-10% z payoutu, drží X dní po akci)
- [ ] **Bank reconciliation** automatická (přes PSD2 OAuth, Tier-1 #4)

---

## 6. Marketing & launch

### 6.1 Pre-launch
- [ ] **Landing page** s waitlist (před spuštěním)
- [ ] **Pilot smlouvy** — 3-5 reálných promotérů ochotných pilotovat
- [ ] **Demo videa** v Czech (2 min: jak vytvořit akci, jak koupit, jak naskenovat)
- [ ] **Pitch deck** pro pořadatele

### 6.2 SEO
- [ ] **Sitemap.xml** + robots.txt (✅ v repu)
- [ ] **Open Graph + Twitter Card** meta na všech public stránkách
- [ ] **Google Search Console** + Bing Webmaster setup
- [ ] **Schema.org Event** structured data na public eventech
- [ ] **Page speed** Lighthouse ≥ 85 mobile, ≥ 95 desktop

### 6.3 Tracking
- [ ] **Google Analytics 4** + GA4 consent mode v2
- [ ] **Meta Pixel** + Conversion API (server-side)
- [ ] **TikTok Pixel** (volitelné)
- [ ] **Server-side tracking** přes `_archive/server-side-tracking` (iOS 17+ ITP)

---

## 7. Specifické pro ticketing

### 7.1 First-onsale ready
- [ ] **Waiting room** otestováno na load (1000+ concurrent)
- [ ] **Verified Fan** workflow funkční end-to-end
- [ ] **Seat picker** pod tlakem (race conditions, double-booking)
- [ ] **Inventory holdback** — VIP/produkce sedadla rezervovaná
- [ ] **Promo kódy** s `max_uses` countdown funguje atomicky
- [ ] **Anti-bot** na onsale spuštěné

### 7.2 Event day
- [ ] **Scanner offline mode** otestován (cesta MailHog → real prod environment)
- [ ] **Multi-gate** sken stat live
- [ ] **Box office** flow přes `/admin/scanner` nebo POS
- [ ] **Walk-in sales** přes POS (catch-up #10)
- [ ] **Re-entry rules** — aspoň statické per event (B30 z BUG-INVENTORY)

### 7.3 Post-event
- [ ] **Reconciliation** — total scanned vs total sold per event
- [ ] **Auto-payouts** podle settlement schedule
- [ ] **Post-event survey** přes mail (NPS)
- [ ] **Refund deadline cron** — auto-decline refund requests after policy deadline

---

## 8. Final go/no-go gates

Než pustíš reálný traffic, musí být všechny tyto **zelené**:

### Hard gates (no go bez nich)
- [ ] **B1 — Stripe production aktivní + webhook idempotency**
- [ ] **B2 — Resend production + verified domain**
- [ ] **B5 — IČO + DIČ + business bank account**
- [ ] **GDPR ToS + Privacy Policy publikované**
- [ ] **WCAG 2.1 AA audit prošlý** (EAA 28.6.2025 deadline)
- [ ] **Backup restore drill** úspěšný
- [ ] **Load test** prošel pro očekávaný traffic
- [ ] **Stripe webhook signature verification** ověřeno
- [ ] **Hands-on golden path** otestován v produkčním environmentu (videozáznam!)

### Soft gates (mít, ale ne blocker pro pilot)
- [ ] B3 — BulkGate SMS production
- [ ] B4 — hCaptcha production keys
- [ ] B15 — Push notif Firebase
- [ ] B22 — Apple/Google Pay
- [ ] Sentry alert rules konfigurované
- [ ] Status page online

---

## Score k dnešku (2026-05-15)

| Kategorie | Done | Total | % |
|---|---|---|---|
| DevOps & infra | ~5 | 30 | 17% |
| Security | ~10 | 25 | 40% |
| GDPR & EU | ~3 | 20 | 15% |
| Business & legal | 0 | 25 | 0% |
| Operations | ~5 | 25 | 20% |
| Marketing | ~3 | 15 | 20% |
| Ticketing-specific | ~6 | 20 | 30% |
| **Hard gates** | **1** | **9** | **11%** |

→ **Reálný production launch je daleko: ~70 dní práce (paralelně se mnou Tier A) + ~3 týdny tvoje legal/business (Tier D) + 1-3 dny KYC Stripe (Tier C).**

Realistický timeline: **8-10 týdnů od dneška** pro plný production launch s placeným pilotem.
