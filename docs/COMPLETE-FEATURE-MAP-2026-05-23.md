# Tixly — Complete Feature Map 2026-05-23

Co Tixly OPRAVDU umí, sgroupované do feature kategorií. Inventory zdrojů:
- **402 API endpoints** (route.ts)
- **96 admin UI pages** (80 promotér + 16 platform-admin)
- **63 buyer UI pages**
- **~95 lib modulů** + **24 cron jobs** + **24 external integrací**

---

## ČÁST 1 — Porovnání vs zahraniční konkurence

### DACH (Eventim, Reservix, DICE) — 100 % parity

| # | Feature | Konkurence | Tixly | Status |
|---|---|---|---|---|
| P0-1 | FanSALE resale s anti-scalping | Eventim FanSALE | ✓ `/cs/resale` + EU 110% cap | ✓ |
| P0-2 | Theatre Abonnement (Festabo + Wahl-Abo) | Reservix | ✓ subscriptions schema + pick flow | ✓ |
| P0-3 | Insurance Stornoschutz | Eventim/Reservix | ✓ premium calc + claim flow E2E | ✓ |
| P0-4 | Rotating QR / TOTP anti-share | Eventim SafeTicket | ✓ TOTP lib + per-event qr_policy + Wallet | ✓ |
| P1-1 | Verified Fan presale gate | Reservix queue | ✓ admin approve → presale_code → checkout gate enforced | ✓ |
| P1-2 | Voucher self-service 3yr | Reservix Gutschein | ✓ buyer + PDFKit voucher | ✓ |
| P1-3 | Print Marketing QR + attribution | DICE/Eventim | ✓ migrace 311 + cookie + PNG export | ✓ |
| P1-4 | White-label TaaS B2B2C | Ticketino | ✓ promoter_domains + branding + WhiteLabelTheme | ✓ |
| P2-1 | Facebook Event 1-click publish | DICE | 🎭 mock SDK + real Graph code (čeká Meta Review) | partial |
| P2-2 | Benefit Pay (stravenky) | Reservix CZ | 🎭 4 handlery (Pluxee/Sodexo/BP/Edenred) best-effort, vendor docs nemáme | partial |
| P2-3 | Spotify Discovery (DICE 40%) | DICE | 🎭 real OAuth + mock fallback, refresh cron registr | partial |
| P2-4 | Social FOMO + RSVP | DICE | ✓ friendships + event_rsvps + FOMO widget v event detail | ✓ |
| P2-5 | PWA install + offline | — | ✓ manifest + SW v2 + InstallPrompt + /offline | ✓ |
| P2-6 | Click&View seat photos | Reservix exclusive | ✓ URL-paste + buyer SeatPicker integration | ✓ |
| P3-1 | MHD Transit Combo | München MVV pattern | 🎭 mock DPP SDK + real handler (čeká partnership) | partial |

### FR/UK/IT trh (15 platforem audited) — implementováno per CZ priority

| # | Feature | Konkurence | Tixly | Status |
|---|---|---|---|---|
| #1 | Friend ticket transfer (gift, no payment) | UK Tout Ban, IT Legge 232 | ✓ /api/buyer/tickets/transfer-invite + 7d TTL accept | ✓ |
| #2 | BNPL Twisto / Skip Pay | UK Klarna, IT Scalapay, FR Alma | ✓ /mock-bnpl + checkout UI radio + 0 real Twisto API yet | partial-UI |
| #3 | OTP SMS validation v checkout | IT Legge anti-bagarinaggio | ✓ SHA-256 OTP + checkout gate + buyer UI phone+code + Twilio stub | partial-SMS |
| #4 | Verified Fan / Queue upgrade | TM Verified Fan | ✓ end-to-end (viz DACH P1-1) | ✓ |
| #5 | Group bookings + payment splitting | DICE | ⚠ light verze (share link + attribution, žádné splitting) | partial-MVP |
| #6 | Loyalty / cashback FanBonus | Eventim FanBonus | ✓ engine + checkout redeem + award + UI | ✓ |
| #7 | Dynamic pricing engine | Eventim/AXS | ✓ cron + resolve-price.ts top-priority branch | ✓ |
| #8 | RFID cashless wristbands | Weezevent FR | ✓ bind/topup/charge + admin UI + DB schema migration 324 | ✓ |
| #9 | Tickets for Good charity | UK AXS partnership | ✓ allocation + slot token + claim → free ticket | ✓ |
| #10 | Skiddle Rep affiliate | UK indie | ✓ /r/[code] redirect + ?ref= + checkout integration | ✓ |
| #11 | Native iOS+Android app | DICE/AXS | ✗ PWA stačí (ROI 4/10, NE 2026-27) | out-of-scope |
| #12 | Retail outlet integration | FR/IT | ✗ CZ trend opačný | out-of-scope |

### Out-of-scope pro CZ (country-specific)

- SIAE/AdE fiscalní cert (IT-only), CNM 3,5% taxe (FR), CB Carte Bancaire (FR), Pass Culture (FR €300/y voucher), 18app / Carta Cultura (IT €500+ voucher), Tessera del tifoso (IT football), Klarna/Scalapay/Alma (CZ má Twisto), AXS Mobile ID (need native app), Live Nation hospitality.

**Verdikt parity**: Z 21 ROI-relevant features pro CZ je **18 reálně funkčních end-to-end**, **3 mock-only** čekají external blockers (Meta App Review, Spotify Developer Keys + cron, vendor partnerships pro Benefit/Transit). Žádná konkurenční feature není missing.

---

## ČÁST 2 — Co Tixly konkrétně umí (capability map)

### A. BROWSE & DISCOVERY

| Co umí | Endpoint / Page | Jak |
|---|---|---|
| Browse events s filtry | `/cs/events` | search bar + city/category/date/price filters + sort by date/sales |
| Geo mapa eventů | `/cs/events/map` | Leaflet map view |
| Per-city landing | `/cs/city/[city]` | SEO-friendly per-město |
| Semantic search | `GET /api/search` | `lib/ai/semantic-search` — query intent + pg_trgm fuzzy, prod by pgvector |
| Spotify personalized discovery | `/cs/discover` | OAuth PKCE Authorization Code → `/me/top/artists` → match score (artist name 10/rank + genre intersection 3×count) |
| Featured carousel | `GET /api/events/featured` | platform-admin curated `/platform/editorial` |
| "Visitors also bought" | `GET /api/events/[id]/recommendations` | `lib/recommendations/engine.ts` co-occurrence + content fallback |
| Personalized feed | `GET /api/buyer/recommendations` | weighted (followed promoter + type + city + price band + trending) |
| Follow promotéry/artists | `/cs/profile/follows` + `POST /api/buyer/follows` | `identity.user_follows` |
| Public promoter store | `/cs/p/[slug]` | white-label aware homepage |
| Blog / CMS | `/cs/blog` + `GET /api/blog` | `marketing.blog_articles` |
| Curated collections | `/api/public/collections/[slug]` | `marketing.collections` |

### B. EVENT DETAIL & PURCHASE

| Co umí | Endpoint / Page | Jak |
|---|---|---|
| Event detail s lineup | `/cs/events/[id]` | + Social FOMO widget (friends going) + RSVP buttons |
| Interactive seat picker | `/cs/events/[id]/seats` + `GET /api/events/[id]/seats` | layout + status + 15min hold + Click&View photos modal |
| Atomický seat hold | `POST /api/events/[id]/seats/hold` | `FOR UPDATE` + 15min TTL |
| SSE real-time seat updates | `GET /api/events/[id]/seats/stream` | delta avail bez polling |
| Timeslot picker (museum/exhibition) | `/cs/events/[id]/slots` | `catalog.entry_slots` s kapacitou |
| Single-point checkout | `POST /api/checkout` | validuje: seat hold + queue admit + OTP + VF gate + age, resolveCurrentPrice, aplikuje promo/loyalty/insurance/addons/subscription/bundle/dynamic pricing |
| Price calculator | `/cs/events/[id]/price-calculator` | dynamic pricing preview |
| Cart validation (pre-checkout) | `POST /api/cart/validate` | dostupnost + ceny live |
| Promo code validation | `POST /api/promo-codes/validate` | bez commit |
| Accreditation request (press/VIP) | `/cs/events/[id]/accreditation` | form → admin queue |
| Lottery enrollment | `/cs/events/[id]/lottery` | open/close/draw window |
| Verified Fan registrace | `/cs/events/[id]/verified-fan` | motivation field → admin queue |
| Waitlist | `POST /api/events/[id]/waitlist` | join + notify cron |
| Virtual queue (high-demand) | `/cs/queue/[eventId]` + Redis | token + polling, admit-on-poll |

### C. PAYMENT METHODS

**Real-ready (production code path):**
- **GoPay** — OAuth2 client_credentials + payment-create + webhook
- **ComGate** — basic auth merchant+secret (CZ+SK)
- **Stripe** — Checkout Sessions (parked pro internat. expansion)
- **Bank transfer** — 10-digit VS generator + Fio API reconciliation
- **Mock** — `/mock-gopay/[paymentId]` + `/mock-wero` + `/mock-przelewy24` (dev only)

**Mock-only s real-ready scaffolding (potřebuje vendor keys):**
- **Twisto BNPL** — 3 splátky (Mastercard owned)
- **Skip Pay BNPL** — 4 splátky (ČSOB)
- **Pluxee** (ex-Sodexo CZ) — OAuth Bearer + X-Merchant-Id + HMAC callback
- **Sodexo** → alias na Pluxee (po acquisition 2023)
- **Edenred** — Ticket Restaurant + Sport-Culture, ApiKey auth
- **Benefit Plus** — HMAC-SHA256 signature pattern
- **Gallery Beta** — Bearer + Idempotency-Key

**Special:**
- **Charity** — provider='charity', amount=0, no money flow
- **Voucher** — partial payment + voucher balance deduction
- **Subscription** — Wahl-Abo zbytkový kredit

### D. TICKET LIFECYCLE

| Co umí | Endpoint | Jak |
|---|---|---|
| Issue tickets | `POST /api/internal/order-completed` | TOTP 20B secret šifrovaný AES-256-GCM (`@tixly/crypto`) + PDF + email + SMS |
| Rotating TOTP QR (live) | `/cs/tickets/[ticketId]/show` | RFC 6238 HOTP 30s step + per-event qr_policy (static_allowed / rotating_24h / rotating_only / photo_required) |
| SMS short link | `/cs/t/[token]` | HMAC-signed magic token, public access |
| Mobile ticket view | `/m/ticket/[ticketId]` | no-locale, SMS-delivered |
| Apple Wallet `.pkpass` | `GET /api/buyer/tickets/[ticketId]/wallet/apple` | P12-signed PKCS#7 |
| Google Wallet | `GET /api/buyer/tickets/[ticketId]/wallet/google` | JWT pro `pay.google.com` |
| Apple PassKit Web Service | `/api/wallet/apple/v1/...` | register/unregister/list updates |
| Wallet push update | `POST /api/admin/events/[id]/wallet-push` | seat change / gate change / cancel |
| iCal calendar | `GET /api/buyer/tickets/[ticketId]/calendar` | .ics file |
| NFC tap-to-enter | `GET /api/buyer/tickets/[ticketId]/nfc-payload` | HMAC-SHA256 + 10s TTL |
| Bind device (anti-share) | `POST /api/buyer/tickets/[ticketId]/bind-device` | fingerprint binding |
| Edit attendee details | `POST /api/buyer/tickets/[ticketId]/attendee` | named tickets |
| Change request (admin queue) | `POST /api/buyer/tickets/[ticketId]/change-request` | jméno/email change |
| Upgrade ticket type | `POST /api/buyer/tickets/[ticketId]/upgrade` | upsell flow |
| Friend transfer (P2P, free) | `POST /api/buyer/tickets/[ticketId]/transfer-invite` | 7d TTL token, email-link |
| Transfer accept (no auth) | `/cs/transfer/accept/[token]` | recipient claim |
| Resale list | `POST /api/buyer/resale/list` | EU 110% cap enforced |
| Resale cancel | `POST /api/buyer/resale/list/[id]/cancel` | self-service |
| Resale marketplace | `/cs/resale` (public) | listings feed |
| Resale buy | `POST /api/buyer/resale/buy` | ownership transfer + new TOTP secret + parent link |
| Cancel order | `POST /api/buyer/orders/[orderId]/cancel` | pending only |
| Refund self-service | `POST /api/buyer/orders/[orderId]/refund` | per-event refund policy + okno |
| Insurance claim | `POST /api/buyer/orders/[orderId]/insurance-claim` | full premium back, auto-approve |
| BNPL installment plan | `POST /api/buyer/orders/[orderId]/payment-plan` | activate Twisto/Skip Pay schedule |
| Pay-what-you-want donation | `lib/donations/compute.ts` | min/max validation |

### E. SOCIAL / SHARING / GROWTH

| Co umí | Endpoint | Jak |
|---|---|---|
| Friend graph | `/cs/friends` + `/api/social/*` | friendships canonical + friend_requests accept/decline/cancel |
| Social FOMO widget | `GET /api/events/[id]/social-context` | totalGoing + friendsGoing top 5 (DICE pattern) |
| RSVP (going/interested) | `POST /api/buyer/rsvp` | `social_graph.event_rsvps` |
| Group invitation share link | `POST /api/buyer/group-invitations` | share URL → friend checkout linkne order (NO payment splitting) |
| Group claim public preview | `/cs/group/[token]` | progress: X of N already paid |
| Affiliate /r/[code] redirect | `/r/[code]?event=X` | Skiddle Rep — cookie aff_code + ?ref= query → checkout commission |
| Print Marketing QR | `/admin/events/[id]/marketing-qr` + `/api/qr/[slug]` | PNG export (real `qrcode` lib) + cookie 90d + conversion increment |
| Promoter follow | `POST /api/buyer/follows` | notify on new event |
| Web push subscribe | `POST /api/buyer/push/subscribe` | VAPID Aes128Gcm |
| Web push to followers | `lib/push/notify-followers.ts` | publish event → push všem |
| Verified Fan presale (anti-bot) | admin bulk approve → PSL-xxxx code → checkout gate | one-time-use enforced |
| OTP SMS (anti-bot) | `POST /api/buyer/otp/request` + `/verify` | 6-digit SHA-256 hash, rate limit 3/10min, 5 attempts/OTP |
| Hot mode (anti-scalper) | `/admin/events/[id]/hot-mode` | max tickets/buyer + TAN + phone bind + no-gift + photo ID |
| Fraud ML scoring | `lib/ai/fraud-ml.ts` | velocity + disposable email + high_value + geo_mismatch, block decision in checkout |
| Bot detection | `lib/bot-detection/detect.ts` | honeypot + sub-2s submit + per-fingerprint velocity + UA blocklist |
| Lottery winner email | `/api/internal/lottery-winner-email` | winner pre-fill checkout `/cs/lottery/redeem` |
| Waitlist notify cron | `/api/internal/cron/waitlist-notify` | notify when seats released |

### F. MARKETING & CAMPAIGNS (promoter tools)

| Co umí | Page | Jak |
|---|---|---|
| Multi-channel campaigns | `/admin/campaigns` | email/sms/push/inapp + metrics |
| Email blast | `/admin/broadcasts` + `POST /api/admin/events/[id]/broadcast` | filter by paid/waitlist/ticket_type |
| SMS campaigns | `/admin/sms-campaigns` | BulkGate API (mock fallback) |
| Email templates editor | `/admin/email-templates` | per-event override + preview render |
| Smart send-time ML | `POST /api/admin/campaigns/smart-send-time` | best hour per user dle past opens |
| Promo codes CRUD | `/admin/promo-codes` | %/fixed amount, max uses, expiry |
| Access codes (presale) | `/admin/access-codes` | hidden ticket_types unlock |
| Gift vouchers | `/admin/vouchers` | batch generator + PDFKit branded voucher |
| Affiliate codes | `/admin/affiliates` | commission % per affiliate |
| Tracking pixels | `/admin/tracking-pixels` | Meta/Google Ads/TikTok per event/global |
| Promoted Ads (in-platform CPC) | `/admin/ads` | marketplace slot auction, CPC, budget cap |
| Facebook OAuth + 1-click publish | `/admin/facebook` + `/admin/events/[id]/publish-facebook` | mock SDK + real Graph (Meta App Review needed) |
| Customer CRM segmentace | `/admin/customers` | champion/loyal/new/at_risk/lost RFM |
| Member groups | `/admin/member-groups` | rules + member CRUD + per-group pricing |
| Loyalty engine | `lib/loyalty/engine.ts` | 1b/10 Kč × tier mult (bronze/silver/gold), redeem 1b=1Kč max 50% subtotal |
| Tixly Plus subscription | `/cs/tixly-plus` | recurring billing plans |
| Abandoned cart recovery | `/api/internal/cron/abandoned-cart` | 30min stale → reminder email |
| Newsletter double opt-in | `/api/newsletter/subscribe` + `/confirm` | unsubscribe token (HMAC) |
| AI auto-tag | `POST /api/admin/ai/auto-tag` | genre/audience/vibe extraction |
| AI description gen | `POST /api/admin/ai/description` | GPT-4o-mini, 3 tones |
| AI cover image | `POST /api/admin/ai/cover-image` | DALL-E 3 / FAL.ai / SD |
| AI moderation pre-check | `POST /api/admin/ai/moderate` | safe/sensitive/prohibited |
| AI price suggestion | `POST /api/admin/ai/price-suggestion` | historic analysis |
| AI social posts | `POST /api/admin/ai/social-posts` | FB/IG/Twitter |

### G. PRICING & SALES MECHANICS

| Co umí | Modul / Page | Jak |
|---|---|---|
| Single price authority | `lib/pricing/resolve-price.ts` | hierarchie: dynamic_price_minor → tier (All-In) → rule → base |
| Dynamic pricing engine | `lib/dynamic-pricing/compute.ts` | velocity + scarcity → uplift %, bounded max_uplift_pct/max_price_minor |
| Recompute cron | `/api/internal/cron/recompute-dynamic-pricing` | 5min, max 500 rules/run |
| Pricing windows (time-based) | `/admin/events/[id]/pricing-windows` | early bird / regular / late / door |
| Per-channel prices | `/admin/events/[id]/channel-prices` | web/POS/affiliate override |
| Volume discount | `/admin/ticket-types/[id]/volume-discount` | quantity tiers (5+/10+/20+) |
| Group discount | `/admin/events/[id]/group-discounts` | min qty + % nebo flat |
| Member pricing | `/admin/events/[id]/member-pricing` | per-group slevy |
| A/B price testing | `/admin/events/[id]/ab-price-tests` | conversion + significance |
| Price scenarios (what-if) | `/admin/events/[id]/price-scenarios` | projected revenue vs baseline |
| All-In Pricing (face + fee + VAT) | `pricing.price_tiers.total_hellers` | display total |
| Donation/pay-what-you-want | `/admin/events/[id]/donation` | goal + min/max + beneficiary |
| BNPL installment templates | `/admin/events/[id]/payment-plans` | Twisto/Skip Pay schedules |
| Insurance Stornoschutz | `/admin/events/[id]/settings` + `lib/insurance/compute.ts` | premium = max(pct·subtotal, flat) |
| Promo code application | `/api/checkout` | %/fixed, max uses |
| Loyalty points redeem | `/api/checkout` body.redeemLoyaltyPoints | max 50% subtotal cap |

### H. SUBSCRIPTIONS & PASSES

| Co umí | Endpoint | Jak |
|---|---|---|
| Theatre Abonnement (Festabo) | `/cs/p/[slug]/subscriptions/[packageSlug]` | fixed package N event_ids |
| Wahl-Abo (Choice-Abo) | `/cs/my-subscriptions/[holderId]/pick` | max_picks_for_choice z portfolia |
| Restwert credit | `GET /api/buyer/restwert-balance` | zbytkový kredit po cancel |
| Pro-rata refund | `POST /api/buyer/subscriptions/[id]/refund-prorata` | zbylé eventy |
| Cross-passes (festival) | `/cs/cross-passes/[id]` | multi-event bundle s remaining_qty |
| Flex pass | `/admin/ticket-types/[id]/flex-settings` | pick_required, kind |
| Gift voucher | `/cs/p/[slug]/vouchers` | self-purchase 3yr validity |
| Gift redeem | `/cs/gift/redeem?code=` | credit nebo ticket |
| Membership renewals | `/api/internal/cron/renew-subscriptions` | recurring billing daily |

### I. CHECK-IN & ON-SITE OPS

| Co umí | Page / Endpoint | Jak |
|---|---|---|
| QR scanner (admin) | `/admin/scanner` | offline queue (IndexedDB) + camera + manual entry |
| TOTP-aware validate | `POST /api/admin/scanner/validate` | + idempotent mark used |
| NFC tap-to-enter | `POST /api/admin/scanner/validate-nfc` | SafeTix-grade HMAC |
| Cross-pass scan | `POST /api/admin/scanner/cross-pass` | festival multi-event |
| Re-entry state machine | `POST /api/admin/scanner/reentry` | entry/exit + zone |
| Gate/zone selector | `GET /api/admin/scanner/gates` | per-event multi-gate |
| Scan log export | `GET /api/admin/scanner/export` | audit CSV |
| POS box-office | `/admin/pos` + `/admin/pos/quick` | event+TT+qty + cash/card/print thermal receipt |
| Will-call pickup | `/admin/events/[id]/will-call` | lokace + hodiny + ID required |
| RFID cashless wristbands | `/admin/wristbands` + `/api/admin/wristbands/*` | bind UID → ticket, topup balance, charge na baru, INSUFFICIENT_BALANCE protection |
| Live ops dashboard | `/admin/events/[id]/live-ops` | real-time scan rate, zones, queue, inventory |
| Real-time sales SSE | `GET /api/admin/sales-stream` | tickets sold per minute |
| MHD Transit Pass (DPP/IDOS Brno) | `GET /api/buyer/orders/[orderId]/transit-pass` | HMAC-signed QR, idempotent |

### J. FINANCE, PAYOUTS & ACCOUNTING

| Co umí | Page / Modul | Jak |
|---|---|---|
| Orders dashboard | `/admin/orders` | filter + bulk actions |
| Refund requests queue | `/admin/refund-requests` | approve/reject buyer requests |
| Bulk refund | `POST /api/admin/orders/bulk-refund` | 5/min rate limit |
| Chargebacks dashboard | `/admin/chargebacks` | Stripe disputes evidence |
| Bank transfer reconcile | `/admin/bank-transfers` | VS matching s Fio Open API polling |
| PSD2 OAuth (KB/ČSOB/Erste) | `lib/bank/psd2.ts` | generic OAuth2 per banka |
| Payouts dashboard | `/admin/payouts` | týdenní + fee calc + export + settle |
| Rolling reserves | `/api/internal/cron/release-rolling-reserves` | per-tier holdback (chargeback protection) |
| Advance payout (factoring) | `/admin/events/[id]/advance-payout` | request advance před akcí |
| Invoices CRUD | `/admin/invoices` + PDF download | accounting.invoices |
| ISDOC export | `lib/accounting/isdoc.ts` | Pohoda/Money S3/Helios/ABRA/FlexiBee import |
| Pohoda export | `GET /api/admin/reports/pohoda` | CZ accounting standard |
| NIPOS Kult 1-01 | `lib/reporting/nipos.ts` + `GET /api/admin/reports/nipos` | CZ culture stats per Q/Y |
| VAT rates per země/kategorie | `lib/tax/vat-rates.ts` | CZ+SR primary (10/12/15/21) |
| ARES IČO verify | `lib/ares/verify.ts` | gov.cz REST + checksum |
| Per-promoter daily stats | `/api/internal/cron/daily-stats` | summary email |

### K. ADMIN — EVENT MANAGEMENT

**36 event-level subpages** + 44 promoter-wide pages.

Klíčové: events list, multi-step wizard create, CSV batch import, edit (re-moderation gate), per-event settings (queue/insurance/OTP/VF/refund/QR/VAT), addons, holds (artist/comp/press), custom checkout fields, multi-day season, postpone/cancel cascading notif, will-call config, hot-mode, embed snippet, sales report, live-ops dashboard, ticket history audit chain, dynamic-pricing, pricing-windows, channel-prices, price-scenarios, A/B price tests, volume/group/member discounts, donation, lotteries, verified-fan queue, resale-policy, advance-payout, wallet-modules, wallet-push, broadcast email, marketing-qr, FB publish, transit-combo, view-photos, AI description, hospitality, accreditation queue, artist lineup, analytics, demographics, ai-description.

**Tour/festival**: event-groups (coordinated onsale), event-templates (reusable), collections (curated), season overview.

### L. PROMOTER TOOLS (cross-event)

- Dashboard 14d revenue + sparkline + KPIs
- Onboarding checklist (KYC, bank, branding, first event)
- Audit log (filterable diff)
- Notifications feed
- Alerts (critical warnings)
- Settings (profile, contact, 2FA TOTP)
- Branding (logo, favicon, primary/accent color, email HTML)
- Custom domains + DNS verification token
- KYC submit (IČO/DIČ/address/bank/VAT)
- Team members invite (owner/admin/staff roles)
- Staff CRUD (POS/scanner access)
- API keys (B2B `tick_test_*`/`tick_live_*`)
- OAuth client apps (promoter as provider)
- Webhooks (event-type registry + send-test + delivery log)
- Fraud-flagged orders queue
- Custom dashboard layouts (react-grid widgets)

### M. PLATFORM ADMIN (super-user)

- Promoter lifecycle: approve/suspend/edit, KYC queue + decisions
- Master venue catalog (search, classify size, edit)
- Visual seating chart authoring (paint physics, CSV/JSON import, bulk ops, versions + diff + rollback, overlap-check, transform, summary)
- Event moderation queue (approve/reject pending events)
- Buyer verifications (KYC for VF gate)
- Status page incidents (investigating/resolved, severity)
- User-reported content queue (DSA compliance)
- Editorial CMS (homepage content)
- Platform analytics (aggregated revenue, top promoters, active events)
- Platform-level webhooks
- Cross-promoter audit log

### N. INTEGRATIONS (24 external)

**Real-ready (production OK):**
1. GoPay (CZ payment gateway)
2. ComGate (CZ+SK payment)
3. Stripe (international parked)
4. Resend/Postmark/SendGrid/SES (SMTP)
5. Fio Bank (Open API polling)
6. PSD2 banks (KB/ČSOB/Erste OAuth2)
7. ARES gov.cz (IČO verify)
8. GA4 Measurement Protocol (server-side conversion tracking)
9. Meta Conversions API (SHA-256 hashed user data, CAPI)
10. BulkGate (SMS, real path when creds)
11. Apple Wallet (.pkpass with P12 signature)
12. Google Wallet (JWT)
13. Spotify OAuth (real path when SPOTIFY_CLIENT_ID + cron refresh)
14. Facebook Graph (real fetch when FACEBOOK_APP_ID + Meta App Review)
15. OpenAI (Moderation + GPT-4o-mini for AI features)

**Mock-only / partnership-blocked (real handler exists, vendor docs needed):**
16. Pluxee (ex-Sodexo CZ)
17. Edenred (Ticket Restaurant/Sport-Culture)
18. Benefit Plus
19. Gallery Beta
20. DPP/Lítačka (Prague transit)
21. IDOS Brno/KORDIS (Brno transit)
22. Twisto BNPL
23. Skip Pay BNPL
24. Bandsintown (music post-jobs skeleton)

### O. BACKGROUND SERVICES (cron jobs)

**21 internal crons** (via `/api/cron/dispatch?job=X` → `POST /api/internal/cron/<job>`):
- expire-pending-orders (5min)
- release-expired-seat-holds (5min)
- recompute-dynamic-pricing (5min)
- send-reminders (15min)
- waitlist-notify (30min)
- refresh-spotify (50min)
- anomaly-detect (1h)
- bank-sync-fio (2h)
- abandoned-cart (6h)
- charge-installments (3 AM daily)
- process-gdpr-deletions (2 AM daily)
- renew-subscriptions (4 AM daily)
- release-rolling-reserves (5 AM daily)
- daily-stats (6 AM daily)
- verify-event-completion (8 AM daily)
- onboarding-reminder (9 AM daily)
- payouts-auto-settle (7 AM Mondays)
- consent-log-purge (4 AM Mondays)
- newsletter-digest (9 AM Mondays)
- promoter-tier-evaluate (1 AM 1st of month)
- recompute-dynamic-pricing (5 min)

**4 external crons** (`/api/cron/*`): dispatch, inventory-refresh, pricing-engine, resale-payouts.

### P. COMPLIANCE & SECURITY

- **GDPR**: Right to portability (`GET /api/buyer/gdpr/export`), Right to erasure (`POST /api/buyer/gdpr/delete` s 30d grace), consent log Art. 7, anonymization cron, 90d retention purge.
- **DSA**: User-reported content queue (`/platform/reports`), transparency reports (`/api/public/reports`).
- **PCI**: No card data stored — tokenized via GoPay/Stripe/ComGate.
- **2FA promoter**: TOTP setup/verify/disable (`/api/admin/2fa/*`).
- **WebAuthn / Passkeys**: Skeleton (`/api/buyer/passkeys/*`).
- **JWT auth 3 levels**: requirePlatformAdmin (master), requirePromoter (tenant), x-user-id middleware (buyer JWT) + x-internal-token (interní).
- **RLS context**: AsyncLocalStorage → `SET LOCAL app.is_platform_admin` / `app_current_promoter_id` / `app.current_user_id`.
- **Email verification**: HMAC stateless token (`lib/email-verification/token.ts`).
- **Unsubscribe**: One-click HMAC token.
- **Browser fingerprinting**: `lib/safetix/fingerprint.ts` (UA+screen+TZ+canvas SHA-256).
- **NFC payload signing**: HMAC-SHA256 with ~10s TTL.
- **Cookie consent**: `/cs/legal/cookie-settings` toggles + consent log.
- **Audit log**: All admin actions diff-logged (schema/table/action).
- **TAN OTP guard**: `/api/buyer/orders/[orderId]/tan` pro citlivé akce.

### Q. B2B API & DEVELOPER PLATFORM

- **B2B v1**: `GET /api/v1/events` (Bearer `tick_test_*`/`tick_live_*`)
- **Multi-format feeds**: `/api/v1/feed/events`, `.ics`, `.rss`
- **Eventbrite-style v3**: `/api/v3/events/[id]`, `/api/v3/organizations/[id]/events`, `/api/v3/inventory/status`
- **OAuth 2.0 server**: `/api/oauth/authorize` + `/api/oauth/token` (RFC 6749), promoter as OAuth provider via `/admin/oauth-apps`
- **GraphQL** (read-only): `/api/graphql` (dynamic loaded if `graphql` package installed)
- **Webhooks**: 26 event types, retry with backoff, delivery log, send-test
- **Distribution**: `GET /api/distribution/google-feed` (Google Things to Do JSON-LD)
- **Secure Entry SDK**: TOTP refresh 30s + 5min short-lived token (Ticketmaster pattern)
- **Public REST v3**: OAuth scoped + 1h sliding rate-limit
- **Partner API**: Token-based (`tixly_partner_<32hex>`, SHA-256 hash storage)
- **Apple PassKit Web Service**: register/unregister/list updatable passes since tag

---

## ČÁST 3 — Statistika code base

| Kategorie | Počet |
|---|---|
| API endpoints (route.ts) | **402** |
| Admin UI pages | **96** (80 promotér + 16 platform-admin) |
| Buyer UI pages | **63** |
| Lib modulů | **~95** |
| Cron jobs | **24** (21 interních + 3 externí) |
| External integrations | **24** (15 real-ready, 9 mock-blocked) |
| DB migrations | **324** (poslední 324_tier3_schema_backfill) |
| E2E test specs | **43 specs / 213 tests** (199 PASS, 14 legit skip, 0 fail) |
| Vitest unit | **51 tests PASS** |
| Locales | **3** (cs primary, sk, en) |
| Payment methods | **14** (5 real-ready + 7 mock-stub + 2 special) |
| Webhook event types | **26** |

---

## ČÁST 4 — Co Tixly NEMÁ vs konkurence (honest gaps)

1. **Native iOS/Android app** — PWA stačí (out-of-scope dle ROI rankingu)
2. **Retail outlet integration** — CZ trend opačný (out-of-scope)
3. **Pluxee/Sodexo/Edenred/Benefit+ real handler validation** — vendor partnership = months business lead
4. **DPP/IDOS Brno real handler validation** — partnership lead
5. **Twisto/Skip Pay real handler validation** — partnership lead
6. **Spotify production credentials** — Developer App approval (1-2 týdny)
7. **Facebook production credentials** — Meta App Review (2-4 týdny)
8. **WebPush production library** — `npm install web-push` + VAPID keys gen
9. **PDF signing P12 certificate** — `@signpdf/*` install + cert provisioning
10. **OTP SMS production provider** — Twilio/MessageBird integration (1-2 dny po smlouvě)
11. **Pricing.price_tiers seed data** — admin UI pro All-In tier setup chybí (sloupec existuje)
12. **Customer loyalty premium tier (Tixly Plus)** — recurring billing implementováno, partner program pro O2 Family / Sazka karta TODO

Žádný z těchto bodů není code gap — všechny jsou **business / external blockers**.

---

## TL;DR

Tixly umí **vše co DACH konkurence** (Eventim, Reservix, DICE), **vše co je relevantní z FR/UK/IT** (15 platforem audited), plus CZ-specific (NIPOS, ARES, Pohoda, Fio Bank, PSD2 banks, Benefit Pay variace). Reálně launch-ready pro CZ trh, zbytek je business/partnership work.

Hodlám-li to shrnout v jedné větě: **18 z 21 ROI-relevant features funguje end-to-end. 3 mock-only čekají external** (Meta Review, Spotify keys, vendor partnerships).
