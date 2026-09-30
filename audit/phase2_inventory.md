# Phase 2 — Code inventory (Tixly, branch audit/2026-09-30, HEAD d4b43f4)

Method: static reading only (grep/rg + reading source) of `nextjs-boilerplate/src`. No DB, no network, no app run.
All paths relative to `nextjs-boilerplate/src/` unless stated. "UNSURE" = not determinable statically.
Nothing here is runtime-verified; every "is broken / is reachable" statement is a reading of code.

---

## A. Core capability map

### A.0 Middleware / request auth model (`middleware.ts`)
- JWT verify (HS256, jose) `middleware.ts:31-42`. **Does not check `type`** — the refresh token (`sub`, `type:'refresh'`, 7d TTL, `lib/auth.ts:129-135`) passes `verifyTokenEdge`; on optional-auth prefixes it yields `x-user-id` (`middleware.ts:130-142`). On promoter/platform APIs it lacks `roles` → 403.
- Strips spoofed `x-user-id`, `x-is-admin`, `x-is-platform-admin` on ALL `/api/*` (`middleware.ts:98-101`).
- Public (no auth, headers stripped): `/api/auth/`, `/api/health`, **`/api/internal/`**, `/api/mock-gopay`, `/api/mock-bnpl/`, `/api/team/accept`, `/api/lottery/`, `/api/gift/`, `/api/newsletter/`, `/api/support/chat`, `/api/group-invitations/`, `/api/charity/claim/`, `/api/payments/benefit/`, `/api/reseller/` (`middleware.ts:75`). Public GET: `/api/events/`, `/api/search`, `/api/cross-passes/`, `/api/subscriptions/plans`, `/api/public/` (`:56`).
- Required auth: `/api/admin/`, `/api/orders/` (platform admin OR ≥1 promoter membership, `:59,178-187`); `/api/platform/` (isPlatformAdmin, `:60,172-177`).
- Optional auth (x-user-id injected only if valid token): `/api/buyer/`, `/api/checkout`, `/api/subscriptions/`, `/api/queue/`, `/api/transfer/accept/` (`:64`).
- **Everything else falls through `passThrough()` with identity headers stripped** (`:125-127`). Consequence: any route outside the lists above that relies on `x-user-id` (via `runAsUser`/`requirePromoter`/`runAsActivePromoter`) can **never** see a user → always 401 (fail-closed but dead). Found (static): `auth/login-history`, `auth/sessions`, `auth/send-verification-email`, `foyer-orders`, `foyer-orders/[id]/status`, `mobile/order-confirm`, `mobile/payment-intent`, `my/identity-verification`, `my/orders/[id]/upgrade(-options)`, `my/superfan-bookings`, `my/tickets/[ticketId]/transfer`, `resale/purchase/[listingId]`, `school-bookings` (POST), `social/*`, `tickets/transfer/[token]`, `tickets/[id]/memory`, `events/[id]/verified-fan`, `events/[id]/alert` (none contain jwtVerify/verifyToken — checked by grep).
- Frontend: `/admin` requires promoter membership, `/platform` requires isPlatformAdmin (`middleware.ts:196-239`), silent refresh via `/api/auth/refresh` (`:206-211`).

### A.1 Auth
| Function | Route → file | Notes / tables |
|---|---|---|
| Register | `POST /api/auth/register` → `app/api/auth/register/route.ts` (INSERT `:44`) | bcrypt(12) `lib/auth.ts:142-144`; `identity.users` (password moved to `identity.user_secrets` by trigger `identity.move_password_to_secrets`, `migrations/000_baseline_20260730.sql:697-711`) |
| Register promoter | `app/api/auth/register-promoter/route.ts:76` | identity.users, platform.promoters/promoter_members |
| Login | `app/api/auth/login/route.ts` | reads `identity.users JOIN identity.user_secrets` `:56-60`; rate limit IP+acct `:44,51`; 2FA enforced if `identity.user_2fa.enabled` `:76-116` (TOTP or backup codes) |
| JWT sign/verify | `lib/auth.ts:108-140`; access TTL 900s, refresh 604800s `:6-7`; cookies httpOnly `:150-173`; prod requires JWT_SECRET ≥32 `:15-24` |
| Refresh | `app/api/auth/refresh/route.ts` (checks `type==='refresh'` `:30,76`) |
| Logout | `app/api/auth/logout/route.ts` (cookie clear; JWT stateless, no server revocation — `auth/sessions` is unreachable, see A.0) |
| Forgot / reset password | `app/api/auth/forgot-password/route.ts` (token bcrypt-hashed into `identity.password_reset_tokens` `:116`, 1h TTL, `sendMail` `:131`); `app/api/auth/reset-password/route.ts` (scans up to 200 unused tokens with bcrypt.compare `:60-80`, tx UPDATE `identity.users` `:99` + mark used `:107`, audit `:135`) |
| Magic link | `app/api/auth/magic-link/request|verify/route.ts` (atomic `UPDATE ... used_at IS NULL` `verify:53-57`) |
| OAuth | `app/api/auth/oauth/{google,apple,facebook}` + callbacks; user create `lib/oauth/provider.ts:72` |
| Email verification | `app/api/auth/verify-email`, `send-verification-email` (latter unreachable, A.0) |
| MFA (TOTP) | setup/verify/disable: `app/api/admin/2fa/{setup,verify,disable}/route.ts` (runAsUser but under `/api/admin/` → only users with promoter membership/platform admin can reach; buyers cannot enroll). TOTP impl `lib/totp/verify.ts:44-60` (SHA1, 6 digits, ±1 step) |
| Buyer OTP (SMS) / passkeys | `app/api/buyer/otp/{request,verify}`, `app/api/buyer/passkeys/*`, `lib/webauthn/challenges.ts` |

### A.2 Roles / authorization
- Role source: `identity.users.is_platform_admin` + `platform.promoter_members(role)` → baked into JWT (`lib/auth.ts:71-106,108-127`). Role changes need re-login (JWT carries roles).
- Promoter guards: `lib/admin-auth.ts` — `requirePromoter` `:133-167` (picks first membership, active first; **does not check status**), `runAsPromoter` `:51`, `runAsActivePromoter` `:67`, owner/non-staff variants `:84-124`.
- Platform admin: `lib/platform-auth.ts:32-64` (re-verifies JWT itself, checks `roles.isPlatformAdmin`).
- Buyer: `lib/auth.ts:60-69 runAsUser` (trusts x-user-id).
- RSC pages: `lib/server-session.ts:84-118`.
- Box office/POS: `app/api/admin/pos/*`, `app/api/admin/events/[id]/box-office/*` (promoter JWT; no separate cashier role found).
- Scanner/gate: `app/api/admin/scanner/*` (runAsActivePromoter, `validate/route.ts:65`); device API keys: `app/api/hardware/scan/route.ts:84` (`catalog.scanner_devices.api_key`), `app/api/rfid/scan/route.ts:86` (`catalog.rfid_devices.api_key`).
- Reseller: `lib/reseller-auth.ts` (`app/api/reseller/sale/route.ts:2`); partner: `lib/partner/auth.ts` (`app/api/partner/sales/route.ts:21,38`); B2B API key: `lib/b2b-auth.ts`.
- RLS DB layer: `lib/db/rls-pool.ts` (`runWithUserContext`/`runWithServiceContext`/`runWithPlatformAdminContext`/`runWithPromoterContext`). Note `app/api/checkout/route.ts:900-904` comment: a raw `client` from `db().connect()` does NOT carry the GUC context — UNSURE how RLS evaluates queries on such clients (belongs to R-56 investigation).

### A.3 Events, venues, ticket types, pricing, promo codes
| Capability | Routes → files | Tables |
|---|---|---|
| Events CRUD (promoter) | `/api/admin/events` → `app/api/admin/events/route.ts` (559 l.); `/api/admin/events/[id]` → `.../[id]/route.ts`; clone, batch-import, postpone, reschedule, save-as-template (109 route files under `admin/events`) | catalog.events, event_days, event_zones, ticket_types, ticket_type_access |
| Events public | `/api/events/[id]/*`, `/api/public/events`, `/api/v1/events`, `/api/v3/events/[id]` | catalog.* |
| Moderation | `/api/platform/moderation/*` | catalog.moderation_blocklist |
| Venues | `/api/admin/venues` (`admin/venues/route.ts`, runAsPromoter), `/api/platform/venues/*` | catalog.venues |
| Seat maps | `/api/platform/venues/[id]/seating-chart/*` (13 routes: import, from-image, from-text, diff, versions…), `/api/admin/venues/[venueId]/seating-chart`; libs `lib/seating/*`, `lib/seats/copy-layout-to-event-seats.ts` | catalog.venue_seating_charts, catalog.event_seats |
| Seat availability/holds | `GET /api/events/[id]/seats`, `/seatmap`, SSE `/seats/stream`, `POST|DELETE /api/events/[id]/seats/hold` (`hold/route.ts:56,184`, FOR UPDATE `:107`, 15-min hold) ; admin holds `/api/admin/events/[id]/holds` | catalog.event_seats (status/hold_user_id/hold_until) |
| Seat-lock model #2 (DEAD) | `lib/seats/seat-lock.ts` (`acquireSeatLocks` etc. on `catalog.seats`) — **no importers outside tests** | catalog.seats |
| Ticket types | `/api/admin/events/[id]/ticket-types(/[ttId])`, `/api/admin/ticket-types/*`, public `/api/events/[id]/ticket-types` | catalog.ticket_types (base_price, remaining_qty, total_qty; CHECK remaining≤total baseline `:4284`) |
| Pricing | dynamic pricing `lib/dynamic-pricing/*`, `/api/admin/events/[id]/dynamic-pricing`, pricing-windows, channel-prices, price-scenarios; cron `internal/cron/recompute-dynamic-pricing` (**no auth**, see C) | catalog.ticket_types.dynamic_price_* |
| Promo codes | admin `/api/admin/promo-codes(/[id])`; public `POST /api/promo-codes/validate` (no auth, 303 l.); consumed in checkout `app/api/checkout/route.ts:1144-1187` (FOR UPDATE + uses_count++); `lib/promo-code-handler.ts` has **no importers** (dead) | marketing.promo_codes, promo_code_usages |

### A.4 Checkout & reservation expiry
- `POST /api/checkout` → `app/api/checkout/route.ts` (2440 lines). One tx `BEGIN :290` … `COMMIT :2178`; guest user via helper `:905` (on `db()`, i.e. outside the tx); per-(buyer,event) advisory lock `:925`; inventory decrement `:1938`; order INSERT `:1659`; payment session created **after COMMIT** `:2293-2392` (if provider creation throws, order stays `pending` holding inventory until expiry cron).
- Other checkout routes: `/api/checkout/bundle`, `/api/checkout/party-split(/[token])`, `/api/checkout/pay-by-link/[orderId]`, `/api/cart/validate`, `/api/buyer/modular-pass/checkout`, `/api/subscriptions/checkout`, `/api/p/[slug]/vouchers/checkout`, `/api/buyer/cross-passes/purchase`, `/api/season-passes`.
- Payment method dispatch: crypto `:2307-2333` (early prod guard `:250-262`), BNPL twisto/skippay → always `/mock-bnpl/...` `:2334-2341` (**no prod guard at checkout**; order is created then mock page is 403 in prod → dead pending order), benefit cards `:2342-2380`, rest → `lib/payment/provider.ts createPayment` `:2382`.
- `b2b_credit`: order set `paid` inside checkout `:2143-2146`, returns at `:2245` — **order-completed is never triggered** (no tickets/e-mail until lazy ticket-pdf).
- Expiry: `internal/cron/expire-pending-orders/route.ts` (pending & expires_at<now → expired, restores remaining_qty `:62`, frees seats `:76`); seat holds `internal/cron/release-expired-seat-holds/route.ts:39-45`; both x-internal-token. Scheduled via `vercel.json` crons → `/api/cron/dispatch?job=...` every 5 min.
- Cron dispatcher `app/api/cron/dispatch/route.ts:76-93`: if `CRON_SECRET` unset, accepts any request carrying header `x-vercel-cron` (spoofable) — fail-open when env missing.

### A.5 Payment providers
- Switcher `lib/payment/provider.ts`: `selectProviderName` `:58-68` (default `'mock'` if PAYMENT_PROVIDER unset); bank transfer `:75-82`; Wero always mock `:84-93`; P24 real-or-mock `:95-123`; gopay/comgate/stripe real if configured `:189-247`; fallback mock with `assertMockPaymentsAllowed()` `:250-257`.
- Mock guard `lib/payment/mock-guard.ts:11-13` (`NODE_ENV!=='production' || ALLOW_MOCK_PAYMENTS==='1'`).
- Real clients: `lib/payment/gopay-real.ts`, `comgate.ts`, `stripe.ts`, `mollie.ts`, `paypal.ts`, `przelewy24.ts`, `triplea.ts`, `benefits.ts` + `benefit-providers/*`.
- Mock endpoints (all guarded by mock-guard): `/api/mock-gopay/[paymentId]` (`:16`), `/api/mock-wero`, `/api/mock-przelewy24`, `/api/mock-bnpl/[provider]/[paymentId]/confirm`, `/api/mock-crypto`; `/api/mock-qes` has no guard (QES signing, not payment). Pages `app/mock-*`.
- **Mock/"demo" payment paths WITHOUT mock-guard (prod-reachable, static reading):** see C.1 items 1-5.

### A.6 Payment webhooks → see F.

### A.7 Order completion / ticket issuance
- `POST /api/internal/order-completed` → `app/api/internal/order-completed/route.ts`: x-internal-token timing-safe `:282-286`; skips unless `status='paid'` `:345-350`; `issueTicketsForOrder(orderId, db())` `:426`; loyalty/fan-bonus/modular/group/party sub-tx `:431-580`; PDF + wallet `:622-718`; e-mail `:750-773` (**sent on every invocation, no idempotency guard**); SMS `:779+`; returns 200 with `failed` count `:856-869`.
- Issuer `lib/tickets/demo-issuer.ts:69-246` — advisory xact lock `:74` (no-op in autocommit), idempotent pre-check `:77-95`, INSERT ... `ON CONFLICT (order_id,ticket_type_id,ticket_seq) DO NOTHING` `:160-165` (mig `migrations/450_tickets_dedup_unique.sql`; `ticket_seq` is **absent from `000_baseline_20260730.sql`** → whether 450 is applied on prod is UNSURE; if not applied every issuance would fail 42703). Issuer does **not** check order status itself.
- Call sites → section E.

### A.8 QR / TOTP
- Per-ticket TOTP secret: `randomBytes(20)` `demo-issuer.ts:145`, stored encrypted (`lib/crypto`).
- Buyer TOTP: `/api/buyer/tickets/[ticketId]/totp` (runAsUser); public via magic token `/api/public/tickets/[token]/totp`; magic token `lib/tickets/magic-token.ts`; print token (HMAC TXP1) `lib/tickets/print-token.ts`; secure-entry `/api/v3/secure-entry/barcode`, `/api/v3/tickets/[id]/secure-entry-token`; wallet passes `/api/buyer/tickets/[ticketId]/wallet/{apple,google}`.
- Validation: `lib/totp/verify.ts:44-60`; used in `admin/scanner/validate/route.ts:160-165`, `hardware/scan/route.ts:173-175`, login 2FA.

### A.9 E-mail
- Single SMTP transport `lib/email/mailer.ts` (nodemailer): `SMTP_HOST` default `localhost`, `SMTP_PORT` default 1025 on localhost (`:43-44`) → **points at a local catcher (MailHog/Mailpit) by default**; TLS verify disabled only for localhost (`:74`). `EMAIL_FROM` default `vstupenky@tixly.local` `:49`. Resend/Postmark/SES only via SMTP host.
- Exception: `lib/notifications/platform-notify.ts:16-25` calls `https://api.resend.com/emails` directly with `RESEND_API_KEY` (platform-admin alerts; skipped if unset). `lib/notifications/promoter-notify.ts` is in-app DB notifications only.
- SMS: `lib/sms/bulkgate-mock.ts` (BulkGate or mock when tokens missing).
- 25 files reference `sendMail`.

### A.10 Refunds / cancel
| Route → file | Auth | Notes |
|---|---|---|
| `POST /api/buyer/orders/[orderId]/refund` → `.../refund/route.ts` (343 l.) | runAsUser | sets refunded `:239,247`, voids tickets, restores qty `:208,264` |
| `POST /api/buyer/orders/[orderId]/cancel` | runAsUser | status cancelled `:103`, tickets `:119`, qty `:128` |
| `POST /api/buyer/refund-requests` / `GET` | runAsUser | creates request |
| `POST /api/admin/orders/[orderId]/refund` | runAsActivePromoter | doc `:10-11` "demo … předpokládáme mock"; status refunded `:165` |
| `POST /api/admin/orders/bulk-refund` | runAsActivePromoter | `:105` |
| `PATCH /api/admin/refund-requests/[id]` | runAsActivePromoter | `:111,144` |
- **No refund route calls any provider refund API.** `refundGopayPayment` (`lib/payment/gopay-real.ts:226`), `refundComGatePayment` (`comgate.ts:163`), `refundMolliePayment` (`mollie.ts:115`), `refundPayPalCapture` (`paypal.ts:226`), `createStripeRefund` (`stripe.ts:118`) have **zero callers** outside lib/tests (grep). Refunds are DB-state only; money is not returned by code.

### A.11 Scanning
- `POST /api/admin/scanner/validate` (471 l.) — runAsActivePromoter `:65`, `FOR UPDATE OF t` `:109`, promoter ownership `:122`, TOTP `:160-165`, `UPDATE tickets.tickets SET status='used'` `:367,386`, `ticket_redemptions` `:352`, `scan_logs` fire-and-forget `:442-456`.
- Others: `validate-group`, `validate-nfc`, `reentry`, `cross-pass`, `manifest` (offline whitelist, `manifest/route.ts:20-40`), `gates`, `devices`, `export`; device endpoints `/api/hardware/scan`, `/api/rfid/scan`; `/api/scanner/school-group` (token).
- Offline sync: client-side IndexedDB queue `lib/scanner/offline-queue.ts` replays to `/api/admin/scanner/validate` — **no dedicated batch/sync endpoint**.

### A.12 Invoices / tax, reports, payouts
- Invoices: `/api/admin/invoices` (runAsPromoterNonStaff/ActiveNonStaff `:32,60`), `/[id]/pdf`, `/[id]/isdoc`, `/export`; buyer `/api/buyer/orders/[orderId]/invoice` (runAsUser); platform `/api/platform/admin/invoices`; libs `lib/accounting/invoice-pdf.ts`, `isdoc.ts`; tax `lib/tax/vat-rates.ts`, `vat-thresholds.ts`, `vies.ts`, `/api/tax/vies-check`. Tables orders.invoices.
- Reports/exports: `/api/admin/reports/run` (registry `lib/reports/registry.ts` + 10 report modules), `/reports/nipos`, `/reports/pohoda`, `/api/admin/orders/export`, `/api/admin/events/[id]/sales-report`, `/api/admin/scanner/export`, `/api/admin/payouts/export`, `/api/platform/reports`.
- Payouts: `/api/admin/payouts` (+`execute`, `settle`, `export`), `lib/payouts/executor.ts` (platform.payouts), `wise.ts`, `paypal-payouts.ts`, `holdback.ts`; crons `payouts-auto-settle`, `payouts-execute`, `event-payout-release`, `release-rolling-reserves`, `/api/cron/resale-payouts` (FIO/Stripe Connect branches `throw ..._NOT_IMPLEMENTED` `:111,114`); Wise webhook F.

---

## B. Feature surface (route/page counts)

Total API route files: **696**. Pages: `[locale]` 102, `admin` 171, `platform` 24, others below.

`src/app/api/*` (route.ts count): admin 294 · buyer 84 · platform 52 · internal 42 · events 35 · auth 21 · public 16 · v1 11 · payments 11 · v3 9 · health 6 · subscriptions 5 · my 5 · checkout 5 · reseller 4 · cron 4 · v2 3 · social 3 · lottery 3 · b2b 3 · 2 each: wallet, vouchers, tickets, sports, season-passes, resale, queue, press, partner, oauth, newsletter, mobile, graphql, gift, foyer-orders, eudi, editorial, distribution, cinema, brand-connect · 1 each: travel, transfer, team, tax, support, sellers, search, school-bookings, scanner, rfid, reviews, reschedule, qr, qes, promo-codes, postal-fees, p, organizer, orders, mock-wero, mock-qes, mock-przelewy24, mock-gopay, mock-crypto, mock-bnpl, kiosk, hardware, group-invitations, dsa, discover, cross-passes, consent, charity, cart, carbon-offset-settings, blog, backstage, artists, agent, ads · 0: og, ai.

Largest `api/admin/*` groups: events 109, scanner 10, venues 6, orders 6, event-groups 6, ai 6, pos 5, wristbands/webhooks/payouts/invoices/facebook/customers 4, ticket-types/reports/kyc/broadcasts/b2b/artist-payouts/2fa 3, then ~60 dirs with 1-2.

`src/app/*` non-API: admin (171 pages), [locale] (102), platform (24), reseller 4, b2b 2, embed 2, kiosk 2, and single pages: developer, m, oauth, offline, partner, signage, team, mock-benefit, mock-bnpl, mock-crypto, mock-gopay, mock-przelewy24, mock-qes, mock-subscription, mock-voucher, mock-wero; `r/` 1 route.

Outside a core ticketing plan (non-exhaustive): lottery, social/friends, sports, cinema/films, travel/hotels/transit/parking, eudi, qes, spotify/music-distribute, rfid/wristbands, brand-connect/ads/ad-auction, charity/carbon-offset, editorial/blog/press, agent (AI agents/mandates), backstage, fan-bonus/superfan, NFT/fan-ticket artwork, gamification/loyalty, graphql, v2 distribution, v3 (Eventbrite-style API), kiosk, signage, school-bookings, foyer (disabled), hospitality, insurance, BNPL, crypto, benefit cards, forgemsg.

---

## C. Stub / dead-code hunt

### C.0 Whole-codebase counts (`src/`, excluding `__tests__`, `*.test.*`, `*.spec.*`)
| Pattern | Hits | Files |
|---|---|---|
| `not implemented`/`NOT_IMPLEMENTED` | 3 | 2 |
| `throw new Error("TODO` | 0 | 0 |
| `// TODO` / `TODO:` | 5 | 5 |
| `FIXME` | 0 | 0 |
| `XXX` | 3 | 3 (all doc placeholders `?token=XXX`) |
| `mock`/`Mock` (any) | 457 | 88 |
| `Math.random()` | 19 | 15 |
| hardcoded `{ success: true }` | 2 | 2 (`admin/access-codes/[id]:57`, `buyer/me:139` — normal ends of handlers) |
| `NotImplemented` | 0 | 0 |
| `501` | 2 | 1 (`organizer/events/route.ts:42-48` stub, "Stub: 501 dokud nebude full implementace") |
| `.catch(() => {} / undefined / null / ({}))` | 134 | 101 (majority = `req.json().catch(()=>({}))` body fallbacks) |
| multi-line empty `catch {}` (body empty or comment-only) | 64 | 46 (none in the critical-path dirs checked below) |

TODOs: `checkout/route.ts:410` (access code not bound to user — anti-share missing), `buyer/orders/[orderId]/refund/route.ts:12` (stale), `v1/publish/events/[externalId]/route.ts:120`, `lib/b2b-auth.ts:75` (`remaining: 999` fake rate-limit counter), `admin/events/[id]/member-pricing/page.tsx:85`. NOT_IMPLEMENTED: `cron/resale-payouts/route.ts:111,114`.

### C.1 Critical-path hits (money / tickets / auth)
1. **`app/api/kiosk/order/route.ts:26-160`** — no authentication at all (path not in any middleware list → passThrough). Only checks `promoterSlug`+`eventId` are a published future event `:40-53` (both public). Inserts order `status='paid'`, `payment_provider='kiosk_card'` `:110-116` with no payment, decrements stock, calls `issueTicketsForOrder` `:134`, and **returns TOTP secrets** `:147-150`. Static reading = free valid tickets for any published non-seated event. CRITICAL.
2. **`app/api/buyer/resale/buy/route.ts:4-15,54-60,117-123`** — "Demo resale buy (mock platba)": guest with only `buyerEmail` (or any user) takes over a resale listing; creates `paid` order `payment_provider='gopay'` without any payment; no mock-guard/NODE_ENV check. CRITICAL.
3. **`app/api/buyer/tickets/[ticketId]/upgrade/route.ts:15-18,215-226`** — "Pro demo: instant payment (mock GoPay obejdeme)": ownership by `ownerEmail` in body OR x-user-id `:145-148`; creates `paid` upgrade order and changes ticket type, no payment, no guard. CRITICAL.
4. **`app/api/vouchers/holders/[paymentId]/confirm/route.ts:2,20-45,89-98`** — "voucher mock payment confirm": no auth, `action:'pay'` sets voucher `payment_status='paid'` (spendable balance) with no payment; `SET LOCAL app.is_platform_admin='true'` `:39`; no mock-guard. CRITICAL.
5. **`app/api/subscriptions/holders/[paymentId]/confirm/route.ts:17,25-45,103,165`** — "Auth: žádný — payment_id je shared secret z mock-gopay flow"; `pay` activates subscription and INSERTs tickets directly `:165`; no mock-guard; RLS bypass `:43`. CRITICAL.
6. **Refunds DB-only** — `admin/orders/[orderId]/refund/route.ts:10-11` ("nevoláme reálný GoPay refund — předpokládáme mock"); provider refund functions have 0 callers (A.10). HIGH.
7. **`app/api/payments/paypal/webhook/route.ts:40-53`** — signature enforced only `if (!verified && process.env.PAYPAL_WEBHOOK_ID)`; with PAYPAL_WEBHOOK_ID unset the event is processed unverified and `PAYMENT.CAPTURE.COMPLETED` marks the order paid from body-supplied amount `:62-117`. Fail-open (conditional on env). HIGH.
8. **`app/api/payments/wise/webhook/route.ts:42`** — `if (!secret) return true;` fail-open payout status changes (`:81-90`) when `WISE_WEBHOOK_SECRET` unset; no NODE_ENV guard. HIGH (payouts).
9. **`app/api/payments/benefit/pluxee/callback/route.ts:33`** — signature bypass env `BENEFIT_DEV_SKIP_CALLBACK_VERIFY=1` with no NODE_ENV guard. MEDIUM.
10. **`app/api/checkout/route.ts:2334-2341`** — BNPL (`twisto`,`skippay`) always routed to mock page, no early prod guard (unlike crypto `:250`) → in prod creates pending order that can only expire. MEDIUM.
11. **`app/api/checkout/route.ts:2143-2146,2245-2274`** — `b2b_credit` marks paid but never calls order-completed → no ticket e-mail. MEDIUM.
12. **`app/api/admin/events/[id]/box-office/sell/route.ts:5` vs `:97-151`** — header says tickets issued via `issueTicketsForOrder`; code creates `paid` order but never issues tickets (no import). MEDIUM.
13. **`app/api/internal/order-completed/route.ts:750-773`** — e-mail re-sent on every call (webhook retries / multiple triggers); `hasFreshSecrets` `:585` prevents PDF only. LOW.
14. **Webhook → order-completed fire-and-forget** (`gopay/webhook:162`, `comgate:176`, `stripe:127`, `mollie:136`, `paypal:128`, `p24:138`, `triplea:146`, `paypal/capture:106`): fetch errors only logged; webhook still returns 200; no reconciliation job for `paid` orders without tickets found (grep). Lazy issuance exists only in `buyer/orders/[orderId]/ticket-pdf:94`. MEDIUM.
15. **`app/api/internal/cron/recompute-dynamic-pricing/route.ts:77-80`** and **`refresh-spotify/route.ts:84-87`** — no token check at all while `/api/internal/` is public in middleware; the first rewrites ticket prices under platform-admin context. MEDIUM.
16. **`app/api/cron/dispatch/route.ts:85`** — `x-vercel-cron` header accepted as auth when `CRON_SECRET` unset (spoofable). MEDIUM (env-dependent).
17. **`app/api/mobile/order-confirm/route.ts:32,81-84`** — unreachable (401, A.0); if reached, `UPDATE ... SET status='paid'` has no `WHERE status='pending'` and no PI amount check. LOW (dead).
18. `Math.random()` in money/identifier logic: `app/api/admin/gift-cards/route.ts:26` (gift-card **bearer code** from non-CSPRNG — HIGH), `admin/reservations/route.ts:103`, `admin/events/[id]/box-office/sell/route.ts:120` (receipt no.), `checkout/route.ts:1418,1993`, `my/superfan-bookings/route.ts:79` (confirmation codes), `lib/utils.ts:59` (uuid-like; usage not traced — UNSURE).
19. Swallowed errors in scan paths: `admin/scanner/validate/route.ts:469` (`.catch(()=>{})` on commemorative trigger — non-critical), `:442-456` scan_logs insert fire-and-forget (logged); `rfid/scan/route.ts:103`, `hardware/scan/route.ts:105` (last_seen update). LOW.
20. `app/api/checkout/route.ts:1919-1921` — insurance row with `provider='mock_insurer'` hard-coded (insurance is a stub).
21. Dead code: `lib/seats/seat-lock.ts` (no importers), `lib/promo-code-handler.ts` (no importers); foyer pre-order intentionally disabled `checkout/route.ts:2225-2235`; program booklet guard `:274-286`.

---

## D. Guest-user creation (`INSERT INTO identity.users`)

Helper: `lib/identity/guest-user.ts:114-145` `createOrGetGuestUser` (ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE …). Its own header says 25 locations replicated the INSERT (`:4-5`).

**Claim "unified helper in exactly 1 place" is FALSE as a description of guest creation.** 23 `INSERT INTO identity.users` occurrences in non-test code (multiline-aware rg): 1 in the helper + **22 raw in 21 files**.

Helper call sites (8): `checkout/route.ts:905`, `checkout/party-split/[token]/route.ts:216`, `admin/events/[id]/accreditation/[reqId]/route.ts:179`, `admin/events/[id]/box-office/sell/route.ts:90`, `admin/events/[id]/comps/route.ts:182`, `admin/events/[id]/guestlist/route.ts:129`, `admin/events/[id]/press/route.ts:152`, `admin/events/[id]/waitlist/[entryId]/route.ts:87`. All pass `db()` (autocommit), not the surrounding tx client.

Raw INSERTs (not via helper):
| # | file:line | Kind | Conflict handling |
|---|---|---|---|
| 1 | `app/api/auth/register/route.ts:44` | real account | none (unique violation → error path) |
| 2 | `app/api/auth/register-promoter/route.ts:76` | real account | none |
| 3 | `app/api/team/accept/route.ts:80` | real account (invite) | none (pre-SELECT) |
| 4 | `lib/oauth/provider.ts:72` | OAuth account | none |
| 5 | `app/api/admin/import/route.ts:166` | guest (import) | ON CONFLICT … fillName-like, hash `'$2b$10$placeholder_import_hash'` |
| 6 | `app/api/admin/orders/[orderId]/support-action/route.ts:132` | guest | ON CONFLICT partial, touch |
| 7 | `app/api/admin/pos/sale/route.ts:180` | walk-in (random email) | none |
| 8 | `app/api/admin/reservations/route.ts:85` | guest | ON CONFLICT partial |
| 9 | `app/api/buyer/cross-passes/purchase/route.ts:41` | guest | ON CONFLICT partial, touch |
| 10 | `app/api/buyer/modular-pass/checkout/route.ts:162` | guest | **SELECT-then-INSERT, no ON CONFLICT** (`:153-166`; race → 23505; SELECT ignores anonymized_at) |
| 11 | `app/api/buyer/resale/buy/route.ts:99` | guest | ON CONFLICT partial |
| 12 | `app/api/charity/claim/[token]/route.ts:156` | guest | **SELECT-then-INSERT, no ON CONFLICT** (`:146-160`) |
| 13 | `app/api/gift/redeem/route.ts:105` | guest | ON CONFLICT partial, touch |
| 14 | `app/api/gift/[token]/route.ts:232` | guest | ON CONFLICT partial, touch |
| 15 | `app/api/kiosk/order/route.ts:91` | guest | **SELECT-then-INSERT** (`:83-96`) |
| 16 | `app/api/kiosk/order/route.ts:100` | walk-in (random email) | none |
| 17 | `app/api/p/[slug]/vouchers/checkout/route.ts:85` | guest | ON CONFLICT partial |
| 18 | `app/api/partner/sales/route.ts:91` | guest | ON CONFLICT partial, touch |
| 19 | `app/api/reseller/sale/route.ts:87` | guest (explicit id) | ON CONFLICT partial, overwrite name |
| 20 | `app/api/season-passes/route.ts:119` | guest | ON CONFLICT partial, touch |
| 21 | `app/api/subscriptions/subscribe/route.ts:51` | guest | ON CONFLICT partial |
| 22 | `app/api/subscriptions/checkout/route.ts:125` | guest | **`ON CONFLICT (email)` WITHOUT the partial predicate and WITHOUT `gdpr_consent_at`** (`:125-130`). Per the helper's own documented prod facts (`guest-user.ts:11-15`: gdpr_consent_at NOT NULL no default; only partial unique) this would fail 42P10/23502 → guest subscription checkout broken (static inference, not run). |

→ 18 guest/shadow-user creations bypass the helper (items 5-22), 4 are genuine account creations.

---

## E. Ticket-issuer call sites (`issueTicketsForOrder`, `lib/tickets/demo-issuer.ts:69`)

11 call sites in 11 files:
| # | file:line | Handle | In tx? | Advisory lock effective? |
|---|---|---|---|---|
| 1 | `app/api/internal/order-completed/route.ts:426` | `db()` pool | No (autocommit) | No — relies on UNIQUE(ticket_seq) only |
| 2 | `app/api/admin/events/[id]/comps/route.ts:239` | client | Yes (BEGIN `:132`) | Yes |
| 3 | `app/api/admin/events/[id]/guestlist/route.ts:164` | client | Yes (`:102`) | Yes |
| 4 | `app/api/admin/events/[id]/press/route.ts:186` | client | Yes (`:125`) | Yes |
| 5 | `app/api/admin/pos/sale/route.ts:228` | client | Yes (`:50`) | Yes |
| 6 | `app/api/kiosk/order/route.ts:134` | client | Yes (`:37`) | Yes (route unauthenticated, C.1#1) |
| 7 | `app/api/mobile/order-confirm/route.ts:85` | client | Yes (`:80`) | Yes (route unreachable, A.0) |
| 8 | `app/api/reseller/sale/route.ts:118` | client | Yes (`:54`) | Yes |
| 9 | `app/api/charity/claim/[token]/route.ts:233` | `db()` pool | No (after COMMIT `:227`) | No |
| 10 | `app/api/partner/sales/route.ts:152` | `db()` pool | No (after COMMIT `:146`) | No |
| 11 | `app/api/buyer/orders/[orderId]/ticket-pdf/route.ts:94` | `db()` pool | No (lazy issuance on download; requires `status='paid'` `:63`) | No |

Pool callers (1, 9, 10, 11) are protected only by `ON CONFLICT (order_id,ticket_type_id,ticket_seq) DO NOTHING` (`demo-issuer.ts:165`, mig 450 — prod application UNSURE, not in baseline). Issuer itself does not verify order status.

Direct `INSERT INTO tickets.tickets` bypassing the issuer (6; `ticket_seq` NULL → no dedup): `admin/events/[id]/accreditation/[reqId]/route.ts:217`, `buyer/subscriptions/[id]/pick/route.ts:239`, `gift/[token]/route.ts:256`, `season-passes/[passToken]/route.ts:231`, `subscriptions/holders/[paymentId]/confirm/route.ts:165`, `lib/resale/reissue.ts:92`.
Box office sell (`admin/events/[id]/box-office/sell`) issues no tickets despite its header comment.

---

## F. Payment webhook / callback handlers

| Handler (file) | Signature / authenticity | Idempotency | Amount check | Notes |
|---|---|---|---|---|
| GoPay `app/api/payments/gopay/webhook/route.ts` (GET `:191`, POST `:199`) | No HMAC (GoPay has none); authoritative re-fetch `getGopayPaymentStatus` `:40` | `FOR UPDATE` `:60`; `WHERE status='pending'` `:126,145` | yes (`:109`) | refund → sets `refunded` `:131-136` (tickets not revoked here — UNSURE elsewhere) |
| ComGate `.../comgate/webhook/route.ts:31` | body `secret` vs `COMGATE_SECRET` timing-safe `:53`; rejects if unconfigured `:49-52`; re-fetch status `:60` | FOR UPDATE `:80`; `status='pending'` guard `:144,163` | yes `:127` | |
| Stripe `.../stripe/webhook/route.ts:34` | `verifyStripeWebhookSignature` `:40` (fail-closed w/o secret, `lib/payment/stripe.ts:222-223`) | event.id dedupe via audit.audit_log read `:57-65` (read-then-write, not locked) + `WHERE status='pending'` `:113` | **no** amount_total vs order.total_amount check (`:81-115`) | chargeback `:222` |
| Mollie `.../mollie/webhook/route.ts:23` | no signature (Mollie design); authoritative fetch `getMolliePayment` `:48` | FOR UPDATE `:74`; `status='pending'` `:114,122` | yes `:101-108` | |
| PayPal webhook `.../paypal/webhook/route.ts:36` | `verifyPayPalWebhookSignature` `:41`, **enforced only if PAYPAL_WEBHOOK_ID set** `:50` → fail-open | FOR UPDATE `:85`; `status='pending'` `:105,112` | yes but from unverified body `:69,106` | refund event flips `paid→refunded` `:153-156` (also unverified) |
| PayPal capture (return URL) `.../paypal/capture/route.ts` GET | server-side `capturePayPalOrder` `:33` | FOR UPDATE `:48`; `status!=='pending'` `:59`, `:95` | yes `:66-71` | binding of PayPal order ↔ Tixly orderId not verified in shown code — UNSURE |
| Przelewy24 `.../przelewy24/webhook/route.ts:35` | SHA-384 sign `:47-58` + mandatory P24 verify call `:100` | FOR UPDATE `:75`; `ALREADY_PROCESSED` `:86-88`; `status='pending'` `:125` | via verify | |
| Triple-A `.../triplea/webhook/route.ts:30` | HMAC over raw body `:34-36` (fail-closed w/o secret, `lib/payment/triplea.ts:182-183`) | FOR UPDATE `:71`; `status='pending'` `:122,130` | yes `:109-114` | |
| Wise (payouts) `.../wise/webhook/route.ts:55` | HMAC `:40-50`, **`if (!secret) return true`** `:42` → fail-open | `status IN ('processing','pending')` `:83` | n/a | |
| Benefit generic `.../benefit/callback/route.ts:24` | none; disabled unless `BENEFIT_MOCK=1` `:30-35` | via `handleBenefitCallback` (UNSURE) | — | |
| Pluxee `.../benefit/pluxee/callback/route.ts` | HMAC `lib/payment/benefit-providers/pluxee.ts:102-110`; bypass `BENEFIT_DEV_SKIP_CALLBACK_VERIFY=1` `:33` | shared handler (UNSURE) | UNSURE | |
| Mock callbacks (`/api/mock-gopay|wero|przelewy24|bnpl|crypto`) | mock-guard 403 in prod unless `ALLOW_MOCK_PAYMENTS=1`; otherwise **anyone knowing paymentId can mark paid** | FOR UPDATE + `status!=='pending'` early return (`mock-gopay/[paymentId]/route.ts:27-44`) | — | whether prod sets ALLOW_MOCK_PAYMENTS: UNSURE |
| Non-guarded "demo" confirmers | `vouchers/holders/[paymentId]/confirm`, `subscriptions/holders/[paymentId]/confirm` — **no auth, no guard** (C.1#4-5) | `payment_status!=='pending'` early return | none | |

All real webhooks trigger `/api/internal/order-completed` fire-and-forget (C.1#14).

---

## Open items for Phase 3 (runtime verification needed)
1. Is mig 450 (`tickets.ticket_seq` + UNIQUE) applied on prod? (issuer INSERT depends on it.)
2. Prod env: `ALLOW_MOCK_PAYMENTS`, `PAYMENT_PROVIDER`, `PAYPAL_WEBHOOK_ID`, `WISE_WEBHOOK_SECRET`, `CRON_SECRET`, `BENEFIT_DEV_SKIP_CALLBACK_VERIFY`, `SMTP_HOST`.
3. Confirm C.1#1-5 free-ticket/free-value paths end-to-end on a prod clone.
4. `subscriptions/checkout/route.ts:125` INSERT against real schema (42P10/23502 expected).
5. RLS behaviour of raw `db().connect()` clients (checkout tx) — R-56.
