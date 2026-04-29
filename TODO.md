# Tixly — Definitivní TODO
*Refresh: 15.4.2026 | Zdroje: AUDIT-2026-04-10.md + hluboký audit kódu 15.4.2026 + analýza konkurence: Ticketmaster, CTS Eventim, Eventbrite, AXS, See Tickets, SMSticket, GoOut, Ticketportal, ENIGOO, Colosseum*

## Stav
- ✅ Hotovo: 211 (202 + 9 z implementační session 18.4.2026 vlna 2: #14, #15, #203, #204, #205, #208, #209, #210, #211)
- 🟡 Částečně: 14 (přidáno #4 migrace lokálně, #217 vrstvy 1+3 z 3 hotové)
- 🔴 Zbývá: 65
- Celkem: ~263

**Aktuální session (26.4.2026):** lokální demo plně funkční (viz `DEMO-PROGRESS.md`). 23/23 smoke testů zelených.

**Implementováno 18.4.2026:** #197 WCAG (22 testů), #198 Refund engine (22 testů), #200 Feature flags (24 testů), B11 Permanentky checkout (23 testů), B12 Apple Wallet adaptery (67 testů), A1 GoPay webhook (32 testů), #5 E2E smoke (12 testů). Celkem **202 nových testů** v jedné session.

**Implementováno 25–26.4.2026 (lokální demo session):** kroky 1–15 ze `START-DEMO.md` — `.env.local`, mock GoPay, Docker stack, seed-platform.sql se 3 demo účty, Auth API + JWT s rolemi, role-based middleware, veřejné stránky `/cs/*`, `/admin/events/new` s keyword moderací, `/platform` master admin (dashboard, schvalování, moderation queue), mock-gopay platba, `/api/checkout-demo`, order confirmation, e-mail do Mailhogu. Plný E2E flow funguje. **Detail v `DEMO-PROGRESS.md`.** Vrstvy 1+3 z #217 (event moderation) hotové; vrstva 2 (AI gate) zbývá pro produkci.

> 📍 **Kde příště začít:** viz `DEMO-PROGRESS.md` — sekce „Příštích 5 navrhovaných úkolů".

---

## Faze -3 — Zákonné blokery + kritická infrastruktura
*Identifikováno hloubkovou analýzou konkurence 18.4.2026. Část jsou zákonné povinnosti (EU), část kritická provozní infrastruktura.*

### EU zákonné povinnosti

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 197 | **WCAG 2.1 AA accessibility compliance** | Sonnet | HOTOVO — `wcag-compliance` modul: colorContrast (AA/AAA checker), ariaUtils, createFocusTrap, createAnnouncer. 22/22 testů. Migrace 222. `wcag-helpers.ts` v nextjs-boilerplate. |
| · 198 | **Automatický refund engine s pravidly** | Sonnet | HOTOVO — `refund-engine` modul: processRefund (GoPay+Stripe+free), checkRefundEligibility, processEventCancellationRefunds, processBatchRefunds. EU 14-day default. 22/22 testů. Migrace 223. |
| 🔴 199 | **Age verification flow (18+)** | Haiku | Pro akce s omezením věku (alkohol, kasina, 18+ events). Odlišné od BankID identity-verification (#83) — potřeba lightweight flow: datum narození při checkoutu + checkbox potvrzení + možnost BankID ověření. |
| 🟡 217 | **Event content moderation (AI + human review)** | Sonnet | **P0 blocker pro produkci.** DSA (EU Digital Services Act) + trestní zákoník §403–405 (propagace hnutí směřujících k potlačení práv) + §355 (hanobení národa). Bez moderace lze hostovat propagaci nacismu / extremismu / scamů → riziko termace MID (Visa/MC/GoPay AUP) + reputační. **Návrh — 3 vrstvy:** (1) **keyword blocklist** + status `pending_review` default pro nové akce — `auto_reject` severity → instantní `status='rejected'`, `flag_for_review` → queue; (2) **AI gate (Claude moderation API)** — title+description+ticket types → `{decision, categories, confidence, reasoning}`; trusted promotér (≥5 schválených) auto-publish, ostatní queue; (3) **human queue** v `/platform/event-moderation` — Schválit / Zamítnout (s důvodem). **Schema:** rozšířit `catalog.events.status` enum o `pending_review`, `rejected`, `flagged`; nová tabulka `audit.event_moderation_log` (legal trail) + `catalog.moderation_blocklist`. **UI:** `/platform/event-moderation` (tabulka + akce), badge na `/admin/events`. **Promotér UX:** „Akce čeká na schválení (typicky do 24h)", u rejected ukázat důvod + reupload. **Public:** „Nahlásit akci" tlačítko (DSA požadavek). Re-review na každý významný edit. **Vrstvy 1+3 IMPLEMENTOVÁNY 25-26.4.2026** v lokálním demu (viz `DEMO-PROGRESS.md`): keyword blocklist (10 entries: extremism + scam + hate), `/api/admin/events` POST scanuje při tvorbě, auto_reject → instant `rejected`, flag_for_review → `pending_review`, `audit.event_moderation_log` legal trail funkční. `/platform/event-moderation` UI pro lidskou frontu, schvalování/zamítnutí s reason. **AI vrstvu (Claude moderation API) doplnit před produkcí.** |

### Kritická provozní infrastruktura

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 200 | **Feature flags systém** | Sonnet | HOTOVO — `feature-flags` modul: Redis store, in-memory LRU cache (5s TTL), per-tenant evaluation, gradual rollout (djb2 hash), kill-switch, batch getEnabledFlags. 24/24 testů. Migrace 224. |
| 🔴 201 | **Blue-green deployment** | manuál | Zero-downtime deploy — kritické pro ticketing (nesmí padnout během vyprodeje). Railway/Vercel to částečně řeší, ale potřeba explicitní strategie + DB migration compatibility. |
| 🔴 202 | **Disaster recovery plán + runbooks** | manuál | Co dělat při výpadku DB, Redis, emailové fronty. RPO/RTO definice. Backup restore test. Bez toho je první velká akce risk. |

---

## Faze -2 — Audit fixy 15.4.2026
*Bugy nalezené hlubokým auditem kódu dne 15.4.2026.*

### P0 — blokují produkci

| # | Bug | Model | Poznámka |
|---|-----|-------|----------|
| · B1 | Free orders nevydají vstupenky ani nepošlou email | Sonnet | HOTOVO — fire-and-forget volání `/api/internal/order-completed` v free order větvi. 2 nové testy. |
| · B2 | PDF vstupenka — ownership check je placeholder | Haiku | HOTOVO — `ownerId` do interface, ownership check, 4 nové testy. Všech 20 projde. |
| · B3 | Seed script má placeholder bcrypt hash | manuál | HOTOVO — hash vložen do řádku 38. Password: "admin123" |

### P1 — opravit před širším provozem

| # | Bug | Model | Poznámka |
|---|-----|-------|----------|
| · B4 | Timing attack na interní endpointy | Haiku | HOTOVO — `crypto.timingSafeEqual()` v obou endpoints. |
| · B5 | Email failure = objednávka stuck v `paid` navždy | Sonnet | HOTOVO — fulfillment status se nastavuje nezávisle na emailu. |
| · B6 | Guest user se vytvoří mimo transakci s objednávkou | Sonnet | HOTOVO — guest user + order v jedné `db.transaction()`. |
| · B7 | Seat locks zůstanou orphaned při chybě platby | Sonnet | HOTOVO — seat locks + payment v jedné `db.transaction()`. |
| · B8 | Expirované pending orders se nikdy nevyčistí | Sonnet | HOTOVO — cleanup v `/api/internal/fulfill-pending`, cron endpoint. |
| · B9 | `seat_ids` NULL místo prázdného pole | Haiku | HOTOVO — vždy vkládáme item.seatIds, prázdné = `[]`. |

### Mezimodulové konflikty

| # | Konflikt | Model | Poznámka |
|---|----------|-------|----------|
| · B10 | Duplicitní migrace s rozdílným schématem | Sonnet | HOTOVO — smazány modulové migrace, root `migrations/` jediný zdroj pravdy. |
| · B11 | Permanentky nemají checkout integraci | Sonnet | HOTOVO — `permanentky-checkout` modul: detectPermanentkaItems, validatePackageAvailability, reservePackage (15min TTL), linkOrderToPackage, activatePackageForOrder, cancelPackageReservation. 23/23 testů. Migrace 225. |
| · B12 | Apple Wallet implementace je nehotová | Sonnet | HOTOVO — `wallet-passes/src/lib/db-adapter.ts` (real DB: registerDevice, upsertRegistration, getUpdatedSerials) + `apn-client.ts` (HTTP/2 APN push, ES256 JWT, sendBatchApnPush). 67/67 testů (20 nových). Migrace 226. |

### P2 — design/technický dluh

| # | Problém | Model | Poznámka |
|---|---------|-------|----------|
| 🔴 B13 | Tři cenovací systémy bez hierarchie — cena se nevaliduje na serveru | Sonnet | `catalog.pricing_rules`, `pricing.rules`, `pricing.price_tiers` — tři tabulky, žádná autorita. Checkout přijímá `unitPriceHalire` z frontendu bez serverové validace. Definovat hierarchii + server-side price check. |
| 🔴 B14 | Seat holds vs. seat locks bez koordinace | Sonnet | Production holds v `seat_holds.seat_holds`, checkout locks jsou transakční. Není jasné, zda checkout kontroluje aktivní holds před zamknutím. Možná race condition. |

---

## Faze -1 — Audit fixy

### P0 — blokují produkci

| # | Bug | Model | Poznámka |
|---|-----|-------|----------|
| · A1 | GoPay webhook neoznačuje order jako paid | Sonnet | HOTOVO — flow byl již implementován v `handleGopayWebhook` (UPDATE orders, fire-and-forget order-completed). Přidáno 5 nových testů pokrývajících PAID/CANCELED/TIMEOUTED. 32/32 testů. |
| · A2 | ems-booking ↔ permanentky integrace neexistuje | Sonnet | BUG-002: HOTOVO — `PermanentkaBookingOps` callbacks, migrace 109, 5 testů. |
| · A3 | referral-system: chyběly migrace + testy | Sonnet | BUG-003: HOTOVO — migrace 090+105, 3 test soubory. |
| · A4 | action-log generic rollback handler — SQL injection | Sonnet | BUG-004: HOTOVO — `ROLLBACK_TABLE_REGISTRY` allowlist + parametrizované dotazy + adversarní testy. |
| · A5 | landing-pages block-renderer — stored XSS | Haiku | BUG-005: HOTOVO — `sanitizeContentHtml()` + `sanitizeUrl()` + `escapeHtml()`, 13 XSS testů. |

### P1 — opravit před širším provozem

| # | Bug | Model | Poznámka |
|---|-----|-------|----------|
| · A6 | Bank reconciliation nebyla transakční | Haiku | BUG-006: HOTOVO — `db.transaction` wrap. |
| · A7 | fitness-reminders silently swallows SMS | Haiku | N/A — modul `fitness-reminders` neexistuje v codebase. |
| · A8 | referral-system počítá peníze jako float | Haiku | BUG-008: kód již používá integer haléře s `Number.isInteger()` validací. |
| · A9 | fitness-portal deep cross-module import | Haiku | N/A — modul `fitness-portal` neexistuje v codebase. |
| · A10 | buyer-portal `pdf-ticket` dynamic import nefunguje | Haiku | BUG-010: route má správný dynamic import s try/catch a INTERNAL_ERROR fallback. |
| · A11 | Mutace bez `promoter_id` ve WHERE | Sonnet | BUG-011: HOTOVO — bulk-email, branch-staff, branch-settings vše scoped; RLS `withTenantContext`. |

### P2 — kosmetika

| # | Bug | Model | Poznámka |
|---|-----|-------|----------|
| · A12 | gopay webhook 200 i při parse erroru | Haiku | BUG-012: outer catch vrací 500, parse chyby v inner catch tiše ignorovány. |
| · A13 | gopay webhook GET → DoS amplifier | Haiku | BUG-013: GOPAY_WEBHOOK_IP_ALLOWLIST env var — 403 pro neznámé IP. |
| · A14 | refundGopayPayment OR id/external_id | Haiku | BUG-014: query změněn na `WHERE id = $1`. |

### Test coverage gaps z auditu

| # | Modul | Model | Poznámka |
|---|-------|-------|----------|
| · gopay-payments | gopay-payments | Sonnet | CANCELED/REFUNDED/TIMEOUTED flow, A14 UUID-only SQL check, ACCEPTED result, route testy. |
| · permanentky | permanentky | Sonnet | FOR UPDATE inside transaction, lost-update simulace, reservationId idempotency. |
| 🔴 newsletter | newsletter | Haiku | double opt-in flow |
| 🔴 lead-capture | lead-capture | Haiku | rate-limit + spam |
| 🔴 web-content-cms | web-content-cms | Haiku | block persistence + permissions |
| 🔴 tenant-runtime-config | tenant-runtime-config | Haiku | cache invalidation |
| 🔴 fitness-reminders | fitness-reminders | Haiku | chytit BUG-007 |
| 🔴 bulk-email | bulk-email | Sonnet | pause/resume/cancel |
| · action-log | action-log | Sonnet | adversarní test rollback handleru — testy existují v `default-handlers.test.ts`. |
| 🔴 event-cloning | event-cloning | Sonnet | recurring clone edge cases |

---

## Faze 0 — LAUNCH: Vlastní prodej vstupenek
*Backend + deploy. Prodáváš vstupenky na vlastní doméně.*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| 🔴 1 | Amazon SES setup + NodemailerEmailAdapter | manuál | SMTP credentials, env vars — bez toho nejdou transakční emaily. **Lokální dev: Mailhog na :1025 funguje (viz DEMO-PROGRESS).** |
| · 2 | Order → Payment → Ticket pipeline | Sonnet | checkout orchestrator + 13-step, 22 testů. (Lokální demo používá `/api/checkout-demo` zjednodušenou verzi — původní `/api/checkout` má pre-existing TS dluh.) |
| · 3 | Seed script: promoter účet | manuál | `scripts/seed-owner.sql` (broken column mismatch) → použit vlastní `scripts/seed-platform.sql` pro lokální demo. |
| 🟡 4 | Migrace na staging DB | manuál | Lokální Postgres aplikuje 001-238 přes init script (s ~360 NOTICE-level warningy o existujících relacích — schémata jsou OK). Pro staging: aplikovat migrace 001-238 na Neon/Supabase. |
| · 5 | E2E smoke test na staging | Sonnet | HOTOVO — `smoke-full-flow.test.ts` v nextjs-boilerplate: 12 testů pokrývá create event → checkout → GoPay webhook → order-completed → PDF → scanner. Free order, idempotency, auth check. 12/12 testů. |
| 🔴 6 | Railway/Vercel deploy | manuál | DEPLOYMENT.md hotový, čeká na výkon. |
| 🔴 7 | Env vars na produkci | manuál | GOPAY_*, JWT_SECRET, DATABASE_URL, REDIS_URL, SMTP_*, KAFKA_* |
| 🔴 8 | GoPay production credentials | manuál | přepnutí ze sandbox na live (čeká na IČO). |
| · 9 | Scanner PWA dokončení | Haiku | migration 130 + delta route hotov. |
| · 10 | Cookie consent propojení | Haiku | cookie-consent modul hotov. |
| · 11 | GA4 + Meta Pixel backend | Sonnet | analytics-tags + server-side-tracking hotové. |
| 🔴 12 | GO LIVE | manuál | závisí na A1 + #1, #4, #5, #6, #7, #8 |

---

## Faze 1 — Stabilizace + Admin UI
*Největší mezera: celý backend bez rozhraní.*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| 🔴 13 | **Admin UI frontend — promotér dashboard** | Opus | React/Next.js: správa akcí, prodeje, výplaty, zákazníci. Největší mezera projektu. |
| · 14 | **Admin UI — master admin panel** | Sonnet | HOTOVO — `master-admin` modul: listTenants, suspendTenant, reactivateTenant, updateTenantFee, createImpersonationToken (1h TTL, 256-bit token), logAdminAction, getPlatformOverview. 25/25 testů. Migrace 227. |
| · 15 | **Self-service onboarding wizard** | Sonnet | HOTOVO — `onboarding-wizard` modul: 5-krokový wizard (event_basics→ticket_types→payment_setup→event_details→review_publish), validace každého kroku, submitStep/goBackStep/skipStep, publishEvent v transakci, cleanupExpiredSessions cron. 36/36 testů. Migrace 228. |
| · 16 | Apple/Google Wallet integrace | Sonnet | wallet-passes: 47/47 testů. |
| 🟡 17 | SMS potvrzení (BulkGate) | Haiku | bulkgate-sms + sms-barcode — přidat send/bulk/opt-out routes. |
| · 18 | Refund-policy modul | Sonnet | refund-policy: 2 svc + 11 routes + 3 testy + migrace. |
| · 19 | Promo kódy | Sonnet | promo-codes hotov. |
| 🔴 20 | Error monitoring (Sentry) | manuál | setup + alerting. |
| 🔴 21 | Backup a monitoring | manuál | pg_dump cron, uptime monitoring. |
| 🔴 22 | **CI/CD pipeline** | manuál | GitHub Actions: lint → test → build → deploy na staging. |

---

## Faze 2 — Competitive parity
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 23 | **Rotating QR kódy (SafeTix-like)** | Sonnet | totp-qr: API routes /qr + /qr/refresh + testy hotovy. |
| · 24 | **Virtual Waiting Room** | Sonnet | migration 137 + waiting-room.service + testy hotovy. |
| · 25 | **Fan Share — P2P marketing s odměnami** | Sonnet | migration 138 + fan-share.service + testy hotovy. |
| · 26 | **Stripe finalizace + Apple/Google Pay** | Sonnet | wallet-pay.service + /wallet route + testy hotovy. |
| · 27 | **Tour / Series management** | Sonnet | migration 139 + tour.service + testy hotovy. |
| · 28 | **Lineup / Artist tool** | Haiku | migration 131 + artist.service + testy hotovy. |
| · 29 | **Multi-měna napojení na checkout** | Sonnet | migration 140 + checkout-currency.service + testy hotovy. |
| · 30 | **Stripe Terminal / POS box office** | Sonnet | migration 141 + pos.service + 11 testů hotovy. |
| · 31 | **RFID náramky** | Sonnet | migration 142 + rfid.service + 14 testů hotovy. |
| · 32 | **Accessibility — bezbariérová místa** | Haiku | migration 132 + accessibility.service + testy hotovy. |
| · 33 | **Watchlist / čekací listina** | Sonnet | kompletní GET+POST+DELETE. |
| · 34 | **Eventim XML/API export** | Sonnet | migration 143 + eventim-export.service + 8 testů hotovy. |
| · 35 | **All-In Pricing** | Haiku | migration 133 + pricing.service + testy hotovy. |
| · 36 | **Pre-Entry Check Mode** | Haiku | migration 134 + validator.service + testy hotovy. |
| · 37 | **Ticket Transfer Timer** | Haiku | migration 135 + transfer.service + testy hotovy. |
| · 38 | **Artist-controlled resale rules** | Sonnet | migration 144 + resale-rules.service + 10 testů hotovy. |
| · 39 | **Holds & Kills v seat-mapě** | Sonnet | migration 145 + holds.service + 13 testů hotovy. |
| · 40 | **Real-time revenue kalkulace** | Haiku | migration 136 + calculator.service + testy hotovy. |
| · 41 | **Flex Plans** | Sonnet | migration 146 + flex-plans.service + 15 testů hotovy. |
| · 42 | **Virtual Venue — 3D seat preview** | Sonnet | migration 147 + virtual-venue.service + 12 testů hotovy. |
| · 43 | **In-venue seat upgrades** | Sonnet | migration 148 + seat-upgrade.service + 11 testů hotovy. |
| · 44 | **Discovery Feed / Catalog API** | Sonnet | migration 149 + discovery-feed.service + 9 testů hotovy. |
| · 45 | **Passkey / passwordless login** | Haiku | WebAuthn, Face ID/Touch ID. |
| · 46 | **AI chatbot pro fan support** | Sonnet | migration 150 + support-chatbot.service + 12 testů hotovy. |
| · 160 | **Hidden tickets / Access Code tickets** | Haiku | Skryté vstupenky přes speciální odkaz/kód. |
| · 161 | **Donation tickets / Fundraising** | Haiku | Nový typ bez fixní ceny (pay-what-you-want). |
| · 162 | **BOGO promo pravidla** | Haiku | Buy-one-get-one, kup 2 dostaneš 1 zdarma. |
| · 163 | **Tap to Pay** | Haiku | Kontaktless platba přiloženou kartou k telefonu. Stripe Tap to Pay SDK. |
| · 164 | **Instant Payouts** | Sonnet | payout-management: fee 1%, limit 500–500 000 CZK, 28 testů. |
| · 165 | **Zapier / automation integrace** | Sonnet | webhook.service + action.service, HMAC-SHA256, exponential backoff, 28 testů. |
| · 170 | **Resale co-mingling na seat-mapě** | Sonnet | resale-api: seat-comingle.service, 18 testů. |
| · 171 | **Premium inventory tier** | Sonnet | premium-inventory: multiplier ≥ 1.1, 24 testů. |
| · 172 | **Draw / Ballot systém** | Sonnet | ballot-system: Fisher-Yates, 48h purchase window, 26 testů. |
| · 175 | **Comp tickets management** | Sonnet | comp-tickets: 6 kategorií, 29 testů. |
| · 176 | **Ticket swap / reissue po skenování** | Sonnet | ticket-reissue: max 1/den, scanner_failure auto-approves, 27 testů. |
| · 177 | **Default ticket settings per event** | Haiku | Globální výchozí věk. omezení, max kusů, zpráva. |
| · 178 | **Daily Stats Email** | Haiku | Automatický denní přehled prodejů promotérovi každé ráno. |
| · 181 | **PayPal integrace** | Haiku | Pro zahraniční kupující a příhraniční akce. |
| · 182 | **Prodej na fakturu (B2B invoice purchase)** | Sonnet | reserve → proforma faktura → auto-cancel dunning. |
| · 183 | **Cross-platform scanner** | Sonnet | Import CSV/XLS listiny + offline validace QR z jiných platforem. |
| · 184 | **Profilová stránka pořadatele** | Haiku | Veřejná branded stránka: logo, bio, akce, sledování. |
| · 186 | **Buyer-facing mobilní aplikace (iOS/Android)** | Opus | mobile-buyer: Expo + React Native, 32/32 testů. |
| · 187 | **Turnikety integrace** | Sonnet | API pro fyzická přístupová zařízení velkých venue. |
| · 189 | **Retailer partner portal** | Sonnet | Third-party retaileři: onboarding, inventář, vyúčtování, provize. |
| · 191 | **Mediální akreditace systém** | Sonnet | Press workflow: žádost → schválení → zone-specific QR. |
| · 192 | **Multi-zone přístupová kontrola** | Sonnet | VIP/staff/parking zóny na jednom QR kódu. |
| · 194 | **Benefitní platby (Benefit Plus, Pluxee, Gallery Beta)** | Sonnet | České zaměstnanecké benefitní platformy. |
| · 195 | **BNPL — Buy Now Pay Later (Twisto/Klarna)** | Haiku | bnpl-payments: Twisto + Klarna adaptéry, 48/48 testů. |

---

## Faze 3 — Diferenciátory
*Funkce, které konkurence nemá nebo má slabě. Tixly advantage.*

| # | Název | Model | Proč to vyhrává |
|---|-------|-------|-----------------|
| · 47 | **AI asistent pro tvorbu akce** | Sonnet | Eventbrite má základní AI popis — my jdeme dál. |
| · 48 | **Ignite CMS — branded obsah na vstupence** | Sonnet | Ticketmaster Ignite, nikdo v CZ to nemá. |
| · 49 | **Collaborative event workflow** | Sonnet | Ticketmaster TM1 — migrace 111, audit change_log, 15 testů. |
| · 50 | **AXS Invite — rezervace pro přátele** | Haiku | AXS unikát — friend-invites, 7d expiration, 6 testů. |
| · 51 | **Enhanced Apple Wallet** | Haiku | Ticketmaster Enhanced Wallet — weather/setlist/venue_map, 6 testů. |
| · 52 | **Promoted Ads — in-platform reklama** | Opus | Ticketmaster jediný v oboru — Vickrey auction, 56/56 testů. |
| · 53 | **Facebook Events / TikTok integrace** | Haiku | social-integrations: injectable SocialAdapter, 7 testů. |
| · 54 | **Fan-to-fan etický resale (capped)** | Sonnet | Price cap 110 % face value (EU Directive 2019/771). |
| · 55 | **Multichannel distribuce** | Sonnet | channel-distribution: oversell guard, 12 testů. |
| · 56 | **Spotify / hudební platformy integrace** | Haiku | music-integrations: expires_at auto-expire, 6 testů. |
| 🔴 57 | **Load testing suite** | manuál | k6 / Artillery: vyprodej 10K vstupenek za 60 s. Identifikovat bottleneck před první velkou akcí. |
| · 58 | **Find My Friends** | Haiku | venue-features: ST_DWithin PostGIS, privacy-first, 6 testů. |
| · 59 | **Dynamic Creative pro reklamy** | Haiku | ad-platform: renderCreative, previewUrl, 7 testů. |
| · 60 | **Šablony komunikace s fanoušky** | Haiku | communication-templates: countdown_7d/1d/venue_info/post_event, 8 testů. |
| · 61 | **Biometrický vstup** | Opus | biometric-entry: cosine face-similarity, GDPR Art. 15+17, 39/39 testů. |
| · 62 | **Break-even analýza + Revenue forecast** | Sonnet | event-management: 7 scénářů, recommendedMinPrice, 8 testů. |
| · 63 | **Event benchmarking** | Sonnet | event-benchmarking: p25/p50/p75, leaderboard, 32/32 testů. |
| · 64 | **Checkout custom otázky** | Haiku | checkout-questions: text/choice/checkbox/rating/date, 6 testů. |
| · 65 | **Oblíbení umělci / venue + notifikace** | Sonnet | artist-follows: importFromSpotify/AppleMusic, 26/26 testů. |
| · 66 | **Cashless in-venue platby** | Sonnet | cashless-payments: RFID wallet, top-up, vendor purchase, 23/23 testů. |
| · 67 | **Sustainability reporting** | Haiku | CO₂ transport + venue energy, tree_equivalent, 5 testů. |
| · 68 | **Vendor marketplace API** | Sonnet | vendor-marketplace: commission bps, sold_out transition, 34/34 testů. |
| · 69 | **Personalizované push notifikace** | Haiku | push-notifications: batch createNotifications, injectable PushProvider, 6 testů. |
| · 70 | **Individuální ticket layout editor** | Haiku | pdf-ticket: setDefaultTemplate (transaction), qr_position options, 7 testů. |
| · 166 | **AI copy pro reklamní kampaně** | Haiku | ai-ad-copy: injectable CallAiFn, target_audience, 5 testů. |
| · 167 | **Organizer Resource Hub** | Haiku | organizer-resources: views++, markHelpful, 8 testů. |
| · 168 | **Virtuální akce — Zoom / YouTube Live** | Sonnet | virtual-events: UUID token, expiresAt = end+48h, 31/31 testů. |
| · 169 | **Status page** | Haiku | status-page: getSystemStatus, createIncident/resolveIncident, 7 testů. |
| · 173 | **Corporate suite / VIP ticket management** | Sonnet | corporate-suites: delegation, getSuiteUsageReport, 30/30 testů. |
| · 174 | **Tickets for Good — sociální ticketing** | Sonnet | tickets-for-good: email_domain/org_code auto-verify, 34/34 testů. |
| · 179 | **Sponsor analytics dashboard (Tradable Bits-style)** | Sonnet | sponsor-analytics: demographic/geographic/engagement reports, 31/31 testů. |
| · 180 | **SMS opt-in flow (Hive-style)** | Haiku | sms-marketing: createOptIn (upsert), normalizePhone, 6 testů. |
| · 185 | **Digitálně podepsané PDF vstupenky** | Haiku | pdf-ticket: signPdfTicket, verifySignature, X.509 cert tracking, 7 testů. |
| · 188 | **Fan social graph** | Opus | fan-social-graph: friendship, blocks, activity feed, 46/46 testů. |
| · 190 | **CRM Business pro sponzory** | Sonnet | sponsor-crm: Vickrey pipeline lead→won/lost, 35/35 testů. |
| · 193 | **Fan surveys** | Haiku | fan-surveys: NPS collection, promoters/passives/detractors, 7 testů. |
| · 196 | **Pronájem prostor (venue space rental)** | Sonnet | venue-rental: buffer minutes, auto price calc, 34/34 testů. |
| · 203 | **Verified Fan 2.0 — high-demand presale registrace** | Sonnet | HOTOVO — `verified-fan-v2` modul: registerForPresale, anti-scalper (temp mail blacklist, VPN check, dup userId), conductSelection (Fisher-Yates, injectable randomFn), openPurchaseWindow (48h TTL), verifyPurchaseWindow, expireStaleWindows. 23/23 testů. Migrace 229. |
| · 204 | **Waiting Room s filtrem botů (bot-proof queue)** | Sonnet | HOTOVO — `bot-proof-queue` modul: detectBotSignals (HeadlessChrome, short UA, rate limit, datacenter IP, dup fingerprint), HMAC-SHA256 challenge token (15min), joinQueue (UNIQUE sessionId), admitFromQueue, cleanupExpired. 21/21 testů. Migrace 230. |
| · 205 | **i18n / Lokalizace (CZ/EN/SK/DE)** | Sonnet | HOTOVO — `i18n` modul: 4 locale soubory (38 klíčů každý), interpolate/safeInterpolate, createTranslator s cs fallback, formatDate/DateTime/Time (bez ext deps), formatCurrency (CZK/EUR). 28/28 testů. |
| 🔴 206 | **Distribution channels — TikTok Shop / Google Things to Do / Instagram Checkout** | Sonnet | Social commerce — zákazník kupuje vstupenku přímo ve feedu. Odlišné od #53 (jen publikace akce). Potřeba: TikTok Shop Product API, Google Things to Do feed, Instagram Shopping checkout. Eventbrite a CTS Eventim to mají. |
| 🔴 207 | **SMS marketing kampaně (info + reklamní)** | Haiku | Odlišné od #180 SMS opt-in (ten jen sbírá souhlasy). Potřeba: campaign builder, segmentace příjemců, plánování, info SMS (potvrzení, upozornění) vs. reklamní SMS (nové akce, slevy). BulkGate adaptér v bulkgate-sms existuje, chybí campaign layer. SMSticket na tom staví silný retention. |
| · 208 | **F&B pre-order (občerstvení předem)** | Sonnet | HOTOVO — `fnb-preorder` modul: getMenuForEvent, createPreorder (6-místný pickupCode, stock check), confirmPreorder, markReady, processPickup (ověří code+eventId), cancelPreorder, getEventFnbStats. 18/18 testů. Migrace 231. |
| · 209 | **Payment plan tickets (per-ticket splátky)** | Sonnet | HOTOVO — `payment-plan-tickets` modul: split_3/6/12 harmonogram, downPaymentPercent, issueTicketAfter first/full, recordInstallmentPayment (auto-complete), markAsDefaulted, getInstallmentStats. 18/18 testů. Migrace 232. |
| · 210 | **Checkout addons — merch, parking, pojištění** | Sonnet | HOTOVO — `checkout-addons` modul: getAddonsForEvent (by displayOrder), addAddonsToOrder (stock+maxQty validation), removeAddonFromOrder, confirmOrderAddons, getAddonsTotal, getAddonStats. 16/16 testů. Migrace 233. |
| · 211 | **Event Insurance pro pořadatele** | Sonnet | HOTOVO — `event-insurance` modul: getInsuranceQuote (injectable provider), purchasePolicy, submitClaim (validuje coveredEvents+amount), approveClaim, rejectClaim, triggerRefundsForClaim (auto-refund buyers). 19/19 testů. Migrace 234. |

---

## Faze 4 — Multi-tenant: Otevření pro partnery
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 71 | Promoter registrace + KYC flow | Sonnet | promoter-onboarding: 3 svc + 16 routes + 5 testů + migrace. |
| · 72 | Payout-management end-to-end | Sonnet | payout-management: 2 svc + 14 routes + 5 testů + migrace. |
| · 73 | Platform-fees správa | Sonnet | platform-fees: svc + 8 routes + 4 testy + 2 migrace. |
| · 74 | RLS E2E test | Haiku | rls-multitenancy: 4 testy včetně tenant-context.e2e. |
| · 75 | Platform admin API | Haiku | platform-admin: svc + 10 routes + 75 testů + migrace. |
| · 76 | Billing / invoicing | Sonnet | billing: VAT engine + credit notes + invoice PDF + QR Platba + migrace 108. |
| · 77 | White-label platforma | Sonnet | white-label: 2 svc + 4 routes + 68 testů. |
| · 78 | Mikro-pořadatel onboarding | Sonnet | micro-organizer: svc + 4 routes. |
| · 79 | B2B API finalizace | Sonnet | b2b-api: 2 svc + 11 routes + 86 testů. |
| · 80 | Webhooks system | Sonnet | webhooks: 4 svc + 7 routes + 35 testů. |

---

## Faze 5 — Anti-fraud & Security
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 81 | Device fingerprinting — bot detection | Sonnet | device-fingerprinting: 85 testů + bot-guard + blocklist. |
| · 82 | Verified Fan presale | Sonnet | verified-fan: 55 testů + weighted selection + redeem. |
| · 83 | Identity verification — BankID | Sonnet | identity-verification: 91 testů + GDPR export/erasure. |
| · 84 | Purchase limit enforcement | Sonnet | @tixly/purchase-limit: 30 testů. |
| · 85 | Buyer blacklist sdílený | Sonnet | buyer-blacklist: svc + 8 routes. |
| · 86 | Fraud queue — manuální review | Sonnet | fraud-queue: svc + 8 routes + 1 test. |
| · 87 | Geofencing presale | Sonnet | presale-access: geofence.ts + 13 testů. |
| · 88 | AI fraud detection | Sonnet | ai-fraud-detection: 56 testů + graph analytics + 9 detektorů. |
| · 89 | Rate limiting middleware | Sonnet | @tixly/rate-limiter, Redis sliding window, 6 testů. |
| · 90 | Input sanitization audit | Sonnet | 5 highest-risk routes opraveny. |

---

## Faze 6 — Core ticketing backend
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 91 | PDF vstupenka | Sonnet | pdf-ticket: 71/71 testů. |
| · 92 | Zákaznický portál API | Sonnet | customer-portal: 55/55 testů. |
| · 93 | Will-call výdej | Sonnet | will-call: 64/64 testů — print, sms, pickup, list, summary. |
| · 94 | Resale listing + escrow | Sonnet | resale-api: 4 svc + 10 routes + 4 testy + migrace. |
| · 95 | Seat lock flow | Sonnet | Redis SETNX TTL 7 min, Lua atomic script. |
| · 96 | Seat map backend | Sonnet | seat-map hotov. |
| · 97 | Skupinové vstupenky | Sonnet | group-tickets: 60/60 testů. |
| · 98 | Cart abandonment emaily | Sonnet | cart-abandonment: 2 svc + 3 routes. |
| · 99 | Recurring events a šablony | Sonnet | event-cloning: RRULE + 11 testů. |
| · 100 | Event CRUD service | Sonnet | event-management: 14 funkcí, 12 routes, 15 testů. |
| · 101 | Pricing engine | Sonnet | fázové zdražování + demand-based dynamika. |

---

## Faze 7 — Advanced features
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 102 | Season passes / permanentky | Sonnet | season-passes: 33 testů; permanentky modul taky. |
| · 103 | Loyalty points | Sonnet | loyalty-points: 3 svc + 4 routes. |
| · 104 | Affiliate tracking | Sonnet | affiliate-tracking: svc + 3 routes. |
| · 105 | Ambassador management | Sonnet | ambassador-management: svc + 4 routes. |
| · 106 | Upsell engine | Sonnet | upsell-engine: 3 svc + 7 routes + 3 testy + migrace. |
| · 107 | Flash sales | Sonnet | flash-sales: svc + 5 routes. |
| · 108 | Embed widget | Sonnet | embed-widget: 1 route. |
| · 109 | Re-engagement kampaně | Sonnet | re-engagement: 3 svc + 3 routes. |
| · 110 | Referral system | Sonnet | referral-system: 7 svc + 6 routes + 3 testy. |
| · 111 | Gift vouchers | Sonnet | gift-vouchers: svc + 4 routes. |
| · 112 | Dynamic cashback | Sonnet | dynamic-cashback: svc + 7 routes + 3 testy. |
| · 113 | Ticket insurance | Sonnet | ticket-insurance: 60/60 testů — tier prémie. |
| · 114 | Installments — splátky | Sonnet | installments: 40/40 testů — dunning cron hotov. |

---

## Faze 8 — Analytics a Reporting
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 115 | Post-event report | Sonnet | post-event-report: 72 testů. |
| · 116 | Real-time occupancy | Sonnet | real-time-occupancy: 70 testů. |
| · 117 | Single customer view | Sonnet | 4 svc + 4 routes + 6 testů, 360° profil + RFM + LTV. |
| · 118 | SEO events (schema.org, sitemap) | Haiku | seo-events: 83 testů. |
| · 119 | Server-side tracking (Meta CAPI, GA) | Sonnet | server-side-tracking: 23 testů. |
| · 120 | CS dashboard | Sonnet | cs-dashboard: 7 routes + 17 testů. |

---

## Faze 9 — AI & ML
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 121 | AI dynamic pricing engine | Opus | 4 strategie + combined, 8 testů. |
| · 122 | Recommendation engine | Sonnet | recommendation-engine: 117/118 testů. |
| · 123 | Churn prediction | Sonnet | churn-prediction: 119/119 testů. |
| · 124 | Auto Early Bird cutoff | Sonnet | auto-early-bird: 34/34 testů. |
| · 125 | Resale price prediction | Sonnet | resale-price-prediction: 29/29 testů. |
| · 126 | Sell-through rate forecast | Sonnet | sell-through-forecast: 29/29 testů. |

---

## Faze 10 — HR & Event staff
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 127 | Profily zaměstnanců a role | Sonnet | event-staff: 81 testů + migrace 101. |
| · 128 | Plánování směn | Sonnet | availability + swap + open shifts + labor cost. |
| · 129 | Activity log a audit trail | Sonnet | action-log hotov. |

---

## Faze 12 — Developer platform & API
*(vše hotovo)*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| · 136 | Developer portal (API docs) | Sonnet | developer-portal: 38 testů. |
| · 137 | SDKs (JS, Python) | Sonnet | sdk-generator: 25 testů. |
| · 138 | OAuth2 provider | Sonnet | oauth2-provider: 40 testů + PKCE + migrace 102. |
| · 139 | Sandbox environment | Sonnet | sandbox: 38 testů + multi-tenant + migrace 103. |

---

## Faze 13 — Integrace

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| 🔴 140 | Przelewy24 integrace | Sonnet | polský trh. |
| · 141 | Multi-currency checkout napojení | Sonnet | multi-currency: 59/59 testů. |
| · 142 | Stripe payments finalizace | Sonnet | stripe-payments: 88/88 testů. |
| · 143 | GoPay integrace finalizace | Sonnet | gopay-payments: 27/29 testů — čeká na IČO + A1. |
| 🟡 144 | GDPR consent management | Haiku | cookie-consent modul existuje. |
| 🔴 145 | Wero / A2A platba | Haiku | CTS Eventim první velký e-commerce s Wero. Evropská A2A platba — nižší poplatky než karty. |

---

## Faze 14 — Vertikály (nové trhy)
*(vše hotovo)*

| # | Název | Stav |
|---|-------|------|
| · 146–159 | Fitness, kadeřníci, coworking, sportoviště, autobusy, online kurzy, firemní benefity, parky, restaurace, parking, ski, escape rooms, kino, hotel | ✅ |

---

## CO DĚLAT JAKO DALŠÍ — doporučený pracovní rytmus
*Aktualizováno 18.4.2026 po hloubkové analýze konkurence*

### Týden 1–2: GO LIVE blokery (P0)
1. 🔴 **A1** GoPay webhook → orders (bez toho nikdo nedostane vstupenku)
2. 🔴 **#1** Amazon SES setup
3. 🔴 **B13** Cenovací hierarchie + server-side price check
4. 🔴 **#198** Automatický refund engine (EU zákon)
5. 🔴 **#200** Feature flags systém (bezpečný deploy)

### Týden 3: Deploy
- 🔴 **#4** Migrace na staging
- 🔴 **#6** Railway/Vercel deploy
- 🔴 **#7** Env vars
- 🔴 **#5** E2E smoke test
- 🔴 **#213** PgBouncer connection pooling (před GO LIVE)
- 🔴 **#12** GO LIVE

### Měsíc 2: Admin UI + Legal compliance
- 🔴 **#13** Admin UI promotér dashboard
- 🔴 **#15** Self-service onboarding wizard
- 🔴 **#22** CI/CD pipeline
- 🔴 **#197** WCAG 2.1 AA compliance (EU zákon od 28.6.2025 — urgentní!)
- 🔴 **#199** Age verification flow (18+ akce)

### Měsíc 3: Infrastruktura + Stabilizace
- 🔴 **#57** Load testing před první velkou akcí
- 🔴 **#212** Distributed tracing (OpenTelemetry)
- 🔴 **#215** Structured logging + log aggregation
- 🔴 **#216** Health check endpoints
- 🔴 **#20** Error monitoring (Sentry)
- 🔴 **#21** Backup a monitoring
- 🔴 **#202** Disaster recovery plán + runbooks

### Měsíc 4: Competitive gaps
- 🔴 **#205** i18n / Lokalizace (CZ/EN/SK) — expanze
- 🔴 **#204** Waiting Room s filtrem botů
- 🔴 **#207** SMS marketing kampaně
- 🔴 **#208** F&B pre-order
- 🔴 **#214** Rate limiting per tenant

### Měsíc 5+: Nové revenue streamy
- 🔴 **#210** Checkout addons (merch, parking)
- 🔴 **#209** Payment plan tickets
- 🔴 **#211** Event Insurance pro pořadatele
- 🔴 **#206** Distribution channels (TikTok Shop, Google Things to Do)
- 🔴 **#140** Przelewy24 (polský trh)
- 🔴 **#145** Wero / A2A platba

---

## Kde Tixly předčí konkurenci (naše výhody)
- **Vertikální pokrytí** — fitness, kino, restaurace, parking, ski, escape rooms — nikdo v CZ tak komplexně
- **AI fraud detection** — 9 detektorů, graph analytics — lepší než Eventbrite a See Tickets
- **Modularita** — každý modul izolovaný, multi-tenant od základu (RLS)
- **BankID integrace** — identity verification na evropské úrovni
- **Compliance** — VAT engine, QR Platba (SPD*1.0), credit notes — připraveno pro český trh
- **Break-even + benchmarking** (#62, #63) — analytika pro promotéry na úrovni Eventim.Analytics, nikdo v CZ to nenabízí

## Kde zaostáváme (kritické mezery vs. konkurence)
**Stav po analýze 18.4.2026**: Přidáno 20 nových gaps. Kritické: WCAG (zákon), Refund engine (zákon), i18n (expanze), Feature flags (dev safety).

1. 🔴 **Frontend** — žádný UI, celý backend bez rozhraní (#13)
2. 🔴 **WCAG 2.1 AA** — EU zákon platný od 28.6.2025, dosud žádná zmínka (#197)
3. 🔴 **Refund engine** — automatický EU-compliant refund flow (#198)
4. 🔴 **i18n / Lokalizace** — bez toho není expanze za CZ (#205)
5. 🔴 **Feature flags** — bezpečný rollout nových funkcí (#200)

---

## Faze 15 — Infrastruktura a Ops
*Identifikováno analýzou konkurence 18.4.2026. Kritická provozní infrastruktura chybějící v dosavadních plánech.*

| # | Název | Model | Poznámka |
|---|-------|-------|----------|
| 🔴 212 | **Distributed tracing (OpenTelemetry)** | Sonnet | Pro debug high-load scénářů (vyprodej 10K vstupenek za 60s). Bez tracingu není možné identifikovat bottleneck v distributed systému (Next.js + moduly + DB + Redis + Kafka). Integrace s Jaeger nebo Honeycomb. |
| 🔴 213 | **PgBouncer — connection pooling** | manuál | Bez poolingu Postgres padne při high-concurrency. Neon/Supabase mají vestavěný pooler, ale potřeba explicitní konfigurace pool_mode=transaction pro seat locks a platební transakce. Kritické před první velkou akcí. |
| 🔴 214 | **Rate limiting per tenant** | Sonnet | Máme #89 rate-limiter (global), ale chybí per-tenant limity. V multi-tenant prostředí jeden promotér může vyčerpat kapacitu ostatním. Redis sliding window per `promoter_id` + platform-wide hard limit. |
| 🔴 215 | **Structured logging + log aggregation** | manuál | Centralizované logy ze všech modulů (Next.js, microservices, cron jobs). Datadog / Logtail / Grafana Loki. Bez toho je debug produkčního problému slepý. |
| 🔴 216 | **Health check endpoints + uptime monitoring** | Haiku | `/health` endpoint pro každý modul (DB ping, Redis ping, external APIs). Napojení na uptime monitoring (BetterStack / UptimeRobot). Alert při výpadku. Závisí na #21 Backup a monitoring. |

---

## Faze 16 — P2 Future (trendy za 1–2 roky)
*Identifikováno analýzou konkurence 18.4.2026. Neblokuje GO LIVE, ale bude potřeba pro long-term competitive pozici.*

| # | Název | Model | Proč to přijde | Zdroj |
|---|-------|-------|----------------|-------|
| ✅ 217 | **Subscription ticketing (Netflix model)** | Sonnet | Recurring membership za měsíční poplatek — přístup na X akcí za měsíc. Eventbrite to plánuje, AMC Theatres to dělá (A-List). Silný retention pro věrné fanoušky. | Eventbrite, Ticketarium |
| ✅ 218 | **NFT vstupenky (opt-in)** | Sonnet | Blockchain-based vstupenky jako collectible. Ticketmaster testuje s Dapper Labs. Potřeba až mainstream přijme Web3 peněženky — opt-in vedle standardních. | Ticketmaster |
| ✅ 219 | **Group payment splitting** | Haiku | Skupina přátel koupí vstupenky, platby se automaticky rozdělí. AXS a Eventbrite to plánují. Snižuje friction při skupinových nákupech. | AXS, Eventbrite, Ticketarium |
| ✅ 220 | **Voice commerce (Alexa / Google Assistant / Siri)** | Sonnet | Ticketmaster Distributed Commerce — nákup vstupenky hlasem. Ještě niche, ale Ticketmaster to aktivně builduje. | Ticketmaster |
| ✅ 221 | **Gamifikace — achievements a badges** | Haiku | Fan dostane badge za první vstupenku, 10. akci, věrnostní milestone. GoOut to má jako USP. Zvyšuje engagement a opakované nákupy. | GoOut, Ticketarium |

---

*Orphan moduly na disku: action-log (A4), analytics-tags, branch-management (A11), bulk-email (A11), conference, conference-badges, conference-exhibitors, email-copy, email-templates, ems-booking (A2), fitness-reminders (A7), jwt-auth, landing-pages (A5), lead-capture, newsletter, optimal-send-time, platform-promoters, push-notification-copy (→ #69), rules-engine, service-catalog, shared, slot-engine, sql-reports, strategic-vision, tenant-runtime-config, totp-qr, venue-ownership, virtual-stream, web-content-cms, wellness-entry.*
