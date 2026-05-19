# Tixly — mapa dokončovacích prací (2026-05-19)

Aktualizace TODO.md (originál 26.4.2026, 65 🔴 items) podle stavu po seriálních sessions
smoke/lint/seating audit/admin tour. **Označeno co je hotové, co částečně, co reálně zbývá.**

---

## P0 — GO-LIVE BLOKERY (čeká hlavně na externí účty)

| # | Položka | Stav | Co potřeba |
|---|---|---|---|
| **#8** | GoPay production credentials | 🔴 externí | Smlouva s GoPay (IČO, KYC), live API key, webhook URL whitelist |
| **#1** | Production SMTP (Resend / Postmark / SES) | 🔴 externí | Doménová verifikace (DKIM/SPF/DMARC), API key, FROM adresa |
| **#7** | Env vars production | 🟡 ready | `.env.example` aktualizován, čeká na fill před deployem |
| **#6** | Vercel deploy | 🔴 ready | DEPLOYMENT.md hotový, `vercel.json` má 15 crons, čeká push |
| **#4** | Migrace na staging DB | 🟡 partial | Lokálně 179 migrací aplikovaných. Neon/Supabase production DB ještě nemá běh. |
| **#12** | GO LIVE | 🔴 blocked by | #1, #4, #6, #7, #8 |

**Vlastní práce zbývá:** žádná. Vše čeká na účty + smlouvy.

---

## P0 — ZÁKONNÉ COMPLIANCE

| # | Položka | Stav | Pozn. |
|---|---|---|---|
| **#197** | WCAG 2.1 AA | ✅ HOTOVO | `wcag-compliance` modul + 22 testů (TODO mention) |
| **#198** | Refund engine (EU 14-day) | ✅ HOTOVO | `refund-engine` modul + 22 testů |
| **#217** | Event content moderation | ✅ HOTOVO | 3-vrstvý flow: keyword blocklist + AI gate (Mock + Claude provider) + human queue. `aiProviderFromEnv()` auto-switch s ANTHROPIC_API_KEY. 21 testů zelené. |
| **#199** | Age verification (18+) | 🔴 zbývá | Lightweight flow: birthdate při checkoutu + checkbox + optional BankID. Bez něho nelze prodávat 18+ akce (alkohol, kasina). |
| **#144** | GDPR cookie consent | ✅ HOTOVO | Granular consent banner (essential/analytics/marketing) + `/legal/cookie-settings` withdraw page + server-side audit log `compliance.cookie_consent_log` + weekly purge cron (90d retention). |

**Vlastní práce:** ~2 dny — #199 age verification + #217 AI gate dokončení.

---

## P1 — INFRASTRUKTURA / OPS

| # | Položka | Stav | Komentář |
|---|---|---|---|
| **#20** | Sentry monitoring | 🟡 sdk hotový | Instrumentace v `nextjs-boilerplate/sentry.*.config.ts` ✓. Čeká na `SENTRY_DSN` env. |
| **#21** | Backup + uptime monitoring | 🟡 partial | Weekly DB backup workflow + S3 restore drill commit `b0681d1`. Uptime alerting chybí. |
| **#22** | CI/CD pipeline (GitHub Actions) | ✅ HOTOVO | `.github/workflows/ci.yml` — test + seating-lint (Postgres service) + build jobs. Pre-merge gate proti seating regression. |
| **#202** | Disaster recovery plán + runbooks | ✅ HOTOVO | `docs/RUNBOOK-DISASTER-RECOVERY.md` — RPO/RTO targety, per-component runbooky (Postgres/Redis/Email/Payments/Vercel), restore drill procedura, Sentry runbook URL injection. |
| **#201** | Blue-green deployment strategy | ✅ HOTOVO | §6 v `RUNBOOK-DISASTER-RECOVERY.md` — additive vs breaking migration rules + 3-step pattern pro drop/rename column. |
| **#213** | PgBouncer connection pooling | 🟡 implicit | Neon/Supabase má vestavěný pooler. Konfigurace `pool_mode=transaction` pro seat locks ✓ (uvedeno v memory). |
| **#212** | Distributed tracing (OpenTelemetry) | 🔴 zbývá | Pro high-load debug. Honeycomb / Jaeger setup. ~3 dny. |
| **#214** | Rate limiting per tenant | ✅ HOTOVO | `lib/rate-limit/per-tenant.ts` sliding window in-memory. Aplikováno na 5 admin endpointů + B2B `/api/v1/events` (1000 req/min per API key). M2: Redis backend. |
| **#215** | Structured logging + aggregation | 🔴 zbývá | Datadog / Loki setup. ~2 dny. |
| **#216** | Health check endpoints | ✅ HOTOVO | `/api/health`, `/api/health/db`, `/api/health/redis`, `/api/health/providers`, `/api/health/ready` všechny existují (session work) |

**Vlastní práce:** ~1 týden — CI/CD + DR runbook + Sentry env + per-tenant rate limit + structured logging.

---

## P1 — ADMIN UI / FRONTEND

| # | Položka | Stav | Komentář |
|---|---|---|---|
| **#13** | Admin UI — promotér dashboard | ✅ HOTOVO (po fix) | Existuje 30+ podstránek `/admin/*`. V naší session opraveno 4 listing bugs (`02756df`, `6f3ee2f`). Funguje E2E. |
| **#14** | Master admin panel | ✅ HOTOVO | 7-sekční sidebar `/platform/*`. V session opraveno auth header. |
| **#15** | Self-service onboarding wizard | ✅ HOTOVO | `onboarding-wizard` modul + 36 testů. |
| **#17** | SMS potvrzení (BulkGate) | 🟡 partial | `bulkgate-sms` modul existuje. Send/bulk/opt-out routes ✓. Čeká na `BULKGATE_*` env. |
| **dev** | Dev quick-login | ✅ HOTOVO | `/cs/dev-login?as=platform\|admin` v `nextjs-boilerplate` (session work, commit `152cb17`) |

**Vlastní práce:** žádná. Vše hotové.

---

## P1 — TYPED API SAFETY (lint cleanup phase 2)

| Položka | Stav | Komentář |
|---|---|---|
| Typed `fetch<T>()` wrapper | 🔴 zbývá | 319 warnings `no-unsafe-*` v `.tsx` — `fetch().json()` vrací `any`. Helper s Zod parse by je všechny vyřešil. ~2 dny refaktor. |
| `useEffect` exhaustive-deps cleanup | 🔴 zbývá | 38 warnings — každá útrhové rozhodnutí (useCallback nebo refactor). ~1 den. |

**Vlastní práce:** ~3 dny pro úplnou typovou bezpečnost. Není blocker — lint exit 0.

---

## P2 — NOVÉ FEATURES (revenue / competitive)

| # | Položka | Stav | Pozn. |
|---|---|---|---|
| **#207** | SMS marketing kampaně | 🟡 partial | `bulkgate-sms` existuje, **campaign builder layer chybí**. Segmentace, plánování, A/B test. ~3 dny. |
| **#206** | TikTok Shop / Google Things to Do / Instagram Checkout | 🔴 zbývá | Social commerce. Eventbrite + CTS Eventim mají. Vyžaduje partnerské účty + Shopping API integrace. ~2 týdny. |
| **#140** | Przelewy24 integrace | 🔴 zbývá | Polský trh. Mock endpoint existuje (`/mock-przelewy24/[paymentId]`), real implementace ne. ~3 dny. |
| **#145** | Wero / A2A platba | 🔴 zbývá | Evropská A2A — nižší poplatky než karty. CTS Eventim první v EU. Mock endpoint existuje. ~5 dny. |
| **#57** | Load testing suite | 🔴 zbývá | k6 / Artillery: vyprodej 10K vstupenek za 60s. Identifikovat bottleneck před první velkou akcí. ~2 dny. |

---

## P2 — NESPADAJÍCÍ DO TODO.md (objevené v sessions)

| Položka | Stav | Komentář |
|---|---|---|
| **B2B API** (`/api/organizer/events`, `/api/v1/events`, `/api/platform/admin/invoices`) | 🔴 zbývá | Smoke testy `smoke-02`, `smoke-03` je očekávají, neexistují. 17 skipped E2E testů. Real product feature pro partner retailery (TT existuje jako #79 B2B API finalizace ✅ — ale frontend routes ne). ~1 týden. |
| **Arena Praha** kapacita 14k vs 17k cíl | 🟡 nuance | Po rewrite máme 13 728 sedadel (vs původní 14 840). Pokud klient potřebuje 17k, lze přidat 4. ring nebo zvětšit zadní sektory. ~3 hod. |
| **TS lint warnings** (354) | 🟡 soft debt | 319 unsafe-* + 35 exhaustive-deps. Není build blocker. |

---

## ✅ HOTOVO V TÉTO SÉRIÍ SESSIONS (2026-05-19)

| Téma | Commits | Output |
|---|---|---|
| Smoke test hot path | `c8abc2c` + 4 další | 17/17 Playwright zelené, DB migration drift opraven |
| Lint cleanup | 7 commitů | ESLint 2061 → 0 errors |
| Admin tour fixes | `02756df` + `6f3ee2f` | 10 platform pages opravených (auth header) |
| Dev quick-login | `152cb17` | `/cs/dev-login?as=platform\|admin` |
| Seating audit + 4-stupňový fix | `99187d1` + 5 dalších | 8/8 layoutů, 0 kolizí, Arena 14k, Olomouc 12k rescale |
| CI seating gate + Tools UI button | `75a08fc` | `npm run lint:seating`, master admin overlap detection |
| Dokumentace | `77ba4ef` + `a97c93d` + `fd317ff` | SEATING-MANUAL.md (4 scénáře), OVERLAP-REPORT.md |

---

## 🎯 STRATEGICKÝ PUNCH-LIST PRO LAUNCH

**Týden 0 (NYNÍ):**
- ⏳ GoPay smlouva + IČO → live API key
- ⏳ Resend doména verifikace
- ⏳ Vercel project create + DNS pro doménu

**Týden 1 (deploy):**
- 🔴 #199 Age verification (~2 dny)
- 🔴 #22 CI/CD (~1 den)
- 🔴 #202 DR runbook (~1 den)
- 🔴 #6 Vercel deploy preview → production

**Týden 2 (compliance + observability):**
- 🔴 #217 AI moderation gate (Claude API)
- 🔴 #214 Per-tenant rate limit
- 🔴 #215 Structured logging
- 🟡 Production smoke test live

**Týden 3+ (competitive):**
- 🔴 #57 Load testing
- 🔴 #207 SMS marketing campaigns
- 🔴 #145 Wero A2A
- 🔴 B2B API frontend routes

---

## SHRNUTÍ

**Reálné zbývá pro launch:** 1 týden vlastní práce + externí (GoPay/SMTP/Vercel)

**Po launch (1-2 měsíce):**
- AI moderation gate
- Load testing + observability stack
- B2B API
- SMS marketing
- Lint warning cleanup (typed fetch wrapper)

**Long-term (3-6 měsíců):**
- Distribution channels (#206)
- Wero A2A (#145)
- Przelewy24 (#140)
- Voice commerce, NFT, group payment (Faze 16)

**Vše ostatní z TODO.md je ✅ hotové nebo již existuje v kódu.**
