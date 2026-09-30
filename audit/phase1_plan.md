# Phase 1 — The plan: planned features, requirements, sources, claimed status

Worktree: `C:\Users\omnia\Documents\tixly-audit`, branch `audit/2026-09-30`, HEAD `d4b43f4` (2026-08-14).
Method: read-only. I read the docs directly (`cat -n`/`awk` with line numbers), ran `git log`
(665 commits, 342 of them `feat…`), grepped `nextjs-boilerplate/src` for TODO/FIXME, and listed the
route tree (`src/app/api/**/route.ts`: 696 routes). No DB or network access.

**Status column semantics:** "Claimed status" is what the **source document says**. Nothing here has been
verified at runtime. `INFERRED:` means the item comes from code structure (a route/lib file exists),
not from a planning doc. When I checked code to test a doc claim, the row says so explicitly.

---

## 0. Source inventory & reliability (read this first)

| Source | Last commit touching it | Reliability note |
|---|---|---|
| `GO-LIVE-CHECKLIST.md` | d4b43f4 2026-08-14 | **Primary go-live list.** Header says "Aktualizováno 2026-06-08" (:3), but the body was edited up to §209 (Aug). Preamble :6-10 ("fixes NOT on prod") is contradicted by :46-56 (deploy done). |
| `nextjs-boilerplate/REMEDIATION.md` | d4b43f4 2026-08-14 | **Live continuity doc** (it says so at :7-8). R-tickets R-12…R-59. |
| `REMEDIATION.md` (root) | 1789c7f 2026-08-04 | Stale; the live one explicitly says do not use it. |
| `HANDOFF.md` | 5b214d5 2026-07-30 (content dated 2026-07-04) | Schema-drift/concurrency findings #1-#11, file:line precise. |
| `TESTING_MAP.md` | 5b214d5 2026-07-30 | Roles, state machines and invariants, marked [OVĚŘENO]/[MEZERA]. The best statement of the core model. |
| `LAUNCH-CHECKLIST.md` | 4e8d26a 2026-06-12 | Tier 0/1 go-live list; every box unchecked. |
| `LAUNCH-CZ-SK.md` | b7ab1d4 2026-06-08 | CZ/SK scope + business decisions CZ-SK-1..6. |
| `PRODUCTION-READINESS.md` | c3506a6 2026-05-17 | **Stale** (Stripe-centric, 2026-05-15). Every box unchecked, including the hard gates. |
| `GAP-MATRIX.md`, `BUG-INVENTORY.md`, `NEXT-SESSION.md` | c3506a6 2026-05-17 | Stale. **The commit hashes they cite do not exist in this repo** (see §5). |
| `TODO.md`, `platform-vision.md`, `architecture.md`, `openapi.yaml` | a402161 2026-04-29 (initial snapshot) | Very stale. TODO "done" items often refer to **standalone modules**, many archived in `_archive/` (commit 0020d8c "archive 187 dead modules"). `openapi.yaml` has 23 paths (`/scan/sync`, `/scan/override`, …) that do not match the current route tree. |
| `docs/*` | 2026-05-19 … 2026-05-23 | Feature maps/audits. `EMPTY-SHELLS-AUDIT-2026-05-23.md` is the only self-critical one. |
| `db/DEPLOY-RUNBOOK.md`, `db/ONSALE-PLAYBOOK.md`, `db/RLS-FLIP-RUNBOOK.md` | 2026-08-04 / 2026-08-13 / 2026-06-09 | Deploy gates. |
| README / CHANGELOG / ADR | — | **None exist** (checked with `find`; only an archived developer-portal changelog service). |

---

## 1. CORE ticketing requirements

| ID | Feature / requirement | Source (file:line or commit) | Claimed status in source | Core? |
|---|---|---|---|---|
| C-01 | Buyer registration + login (email/password, JWT access+refresh, logout) | `openapi.yaml:54-169` (plan); `DEPLOY-RUNBOOK.md:89-90` (smoke items); INFERRED: `api/auth/{register,login,refresh,logout,me,sessions}` | GO-LIVE:27 "login funguje" [x]; DEPLOY-RUNBOOK:89-90 smoke boxes unchecked | Y |
| C-02 | E-mail verification + password reset (rate-limited, force-logout) | commit 1461da6; `NEXT-SESSION.md:60`; commit 84ca76e (2026-07-30: "reset hesla byl rozbitý na DVOU vrstvách — restore"); INFERRED: `api/auth/{verify-email,send-verification-email,forgot-password,reset-password}` | Built 2026-05-17, broken, restored 2026-07-30 per commit message | Y |
| C-03 | Promoter self-registration (e-mail + password only; the rest later from admin) + KYC/ARES + platform approval | commits 790762e, b4653a6, 3db66ab, aa046ff; `GO-LIVE-CHECKLIST.md:52-53,196`; INFERRED: `api/auth/register-promoter`, `api/platform/promoters/[id]/approve`, `api/platform/kyc/[promoterId]` | Prod registration returns 200 (GO-LIVE:52 [x]); E2E [x] :196 | Y |
| C-04 | 2FA for promoter/admin | `PRODUCTION-READINESS.md:79` ("povinné… vynutit"); `docs/COMPLETE-FEATURE-MAP-2026-05-23.md:377` (claims setup/verify/disable) | Enforcement: open (PR:79). Map claims 3 endpoints, but **the tree has only `api/admin/2fa/setup` and `/disable`**. Whether verification happens inside login was not checked. AMBIGUOUS | Y |
| C-05 | Role: **platform admin** (`identity.users.is_platform_admin`, `/platform`, `runAsPlatformAdmin`) | `TESTING_MAP.md:62`; commit e93cd98 (clean /admin vs /platform split) | [OVĚŘENO] in TESTING_MAP | Y |
| C-06 | Role: **promoter members** owner / non-staff / staff (route guards) | `TESTING_MAP.md:63,77-97` | [OVĚŘENO]: 7 guard variants with counts | Y |
| C-07 | Role: specialised sub-roles `gate`, `box_office`, `finance`, `marketing`, `accreditation_manager` | commit 069a48d "specializované role pro sub-účty (P2-15)"; commit b5df140 "produkční role-scoped pohled"; `BUG-INVENTORY.md:22` ✅ | **CONFLICT:** `TESTING_MAP.md:99-105` says no guard branches on these values and there is no DB CHECK, so `gate`/`box_office` have manager-level API power [OVĚŘENO — absence] | Y |
| C-08 | Role: **buyer/customer** (JWT → `x-user-id`, RLS `app.current_user_id`); guest checkout | `TESTING_MAP.md:64`; commit be8e1ca (guest purchase) | [OVĚŘENO] | Y |
| C-09 | Role: **scanner/gate** (in-app promoter JWT; HW turnstile `X-Device-Key tixly_dev_*`; RFID reader key) | `TESTING_MAP.md:69-71`; commit ea0d5ac | [OVĚŘENO] | Y |
| C-10 | Role: **box office / POS** operator (active promoter, staff allowed) | `TESTING_MAP.md:96-97`; `PRODUCTION-READINESS.md:251-252` | Guard [OVĚŘENO]; PR boxes open | Y |
| C-11 | Event CRUD + create wizard + publish (sale only when `status='published'`) | `TODO.md:327` (#100); `TESTING_MAP.md:356`; commit 4d1f344 (ticket-type CRUD, templates); INFERRED: `api/admin/events`, `api/admin/events/[id]` | "HOTOVO" (TODO); E2E [x] GO-LIVE:189 | Y |
| C-12 | Event content moderation before publish (blocklist → AI text+poster → human queue; master admin clicks publish) | `GO-LIVE-CHECKLIST.md:103-108`; `TODO.md:30` (#217 "P0 blocker"); commit d72f262 | Built [x] :103,:104,:107; **open**: `ANTHROPIC_API_KEY` :105, `MODERATION_PROVIDER≠mock` :106, live smoke :108 | Y |
| C-13 | Event postpone / reschedule (buyers notified; accept/refund) | commits a908ded, 69d8051; INFERRED: `api/admin/events/[id]/postpone` | Built; `nextjs-boilerplate/REMEDIATION.md:151` lists `reschedule` (`reschedule_responses.user_id` missing) as **broken, NEOPRAVENO** | Y |
| C-14 | Event cancellation → refund everyone | `PRODUCTION-READINESS.md:162` ("zrušení akce = vždy ano"); `TODO.md:28` (#198 `processEventCancellationRefunds` in the `refund-engine` module) | AMBIGUOUS: no dedicated event-cancel route was found; the closest is INFERRED `api/admin/orders/bulk-refund` with reason `event_cancelled`. Whether the TODO #198 module is live code was not checked | Y |
| C-15 | Venues + seating-chart editor (platform admin draws the hall; promoter mapping presets) | `GAP-MATRIX.md:58`; commits d0ec6d6, cc91db2, 0c083d4, 7e18274; INFERRED: `api/platform/venues/[id]/seating-chart/*`, `api/admin/venues/[venueId]/seating-chart` | ✅ (GAP-MATRIX) | Y |
| C-16 | Seated inventory: layout → `catalog.event_seats` (available/held/sold/blocked) | commit d6e8afa; `TESTING_MAP.md:117-120` (two seat models; golden path uses `event_seats`) | HANDOFF:80-83: **seated checkout dead** (`x,y` vs `x_coord,y_coord`); fix commit 3c53e84 (message says "sociální-odstup" branch). Whether *all* seated paths are fixed is AMBIGUOUS | Y |
| C-17 | GA capacity: no oversell (`remaining_qty >= qty` atomic UPDATE + `CHECK >= 0`) | `TESTING_MAP.md:297-301`; `HANDOFF.md:116`; `GO-LIVE-CHECKLIST.md:128-131` | [OVĚŘENO] 20 concurrent on stock=5 → 5 | Y |
| C-18 | Seat sold at most once per event | `TESTING_MAP.md:302-306` | APP-only (row lock). No DB partial-unique on "one sold per seat". Double-sell re-test was deferred (`HANDOFF.md:132`) | Y |
| C-19 | Cart/seat **hold with expiry** (15 min TTL, `holdToken`) + release cron | `TESTING_MAP.md:280,350-351`; INFERRED: `api/events/[id]/seats/hold`, cron `release-expired-seat-holds` (vercel.json) | [OVĚŘENO]; old open item `TODO.md:77` B14 "seat holds vs locks bez koordinace" 🔴 (April, never closed in TODO) | Y |
| C-20 | Pending order expiry (15 min) → restore qty + free seats | `TESTING_MAP.md:281,287`; commit 36a7666; INFERRED: cron `expire-pending-orders` (vercel.json) | Described as working | Y |
| C-21 | Ticket types per event (multiple, capacity adjustment, guard against a new type once sales exist) | `GAP-MATRIX.md:67`; commits 4d1f344, c5b7f05; INFERRED: `api/admin/events/[id]/ticket-types[/ttId]` | ✅ | Y |
| C-22 | **Server-side price authority** (never trust client price) | `TODO.md:76` B13 🔴 (checkout accepted `unitPriceHalire` from the frontend); `docs/EMPTY-SHELLS-AUDIT-2026-05-23.md:43` ("`lib/pricing/resolve-price.ts` single price authority") | AMBIGUOUS: B13 was never closed in TODO.md. `REMEDIATION.md:125` (R-39) says `resolve-price` references missing tables | Y |
| C-23 | Fees: buyer service fee + platform commission; per-promoter override | commit 67fd5b8; `LAUNCH-CZ-SK.md:107-128` (7/5/4 %, 10-15 Kč); `TESTING_MAP.md:366-370` (code default `PLATFORM_FEE_BPS=500` = 5 %); commit 35c14ca | **CONFLICT:** plan says 7/5/4 % tiers, code default is 5 %, project memory says 2.5–3 %. Needs a product decision | Y |
| C-24 | VAT per country/category (CZ 10/21 %, SK 5/23 %) on documents | `GO-LIVE-CHECKLIST.md:25-26` [x], `:100` [ ] verify; `LAUNCH-CZ-SK.md:85-88,222-238` | Code "HOTOVO, 15 testů"; business verification open (GO-LIVE:100, LAUNCH-CHECKLIST:55) | Y |
| C-25 | Promo codes (validity, `max_uses` atomic, rate-limited validation) | `TODO.md:160` (#19); `PRODUCTION-READINESS.md:245` [ ]; commits 53c6d76 (clock-skew fix), bd6e363; INFERRED: `api/admin/promo-codes`, `api/promo-codes/validate` | "hotov"; E2E [x] GO-LIVE:197 | Y |
| C-26 | Discounts: volume tiers, group discounts, student/senior verified, BOGO, member pricing | commits 55714ac, 8241f77, 96e1b5f, 6edf552; `GAP-MATRIX.md:75-77` | ✅ per commits/GAP | Y |
| C-27 | Per-buyer purchase limits (`max_tickets_per_buyer`, `max_per_buyer`, `max_per_user`) | `TESTING_MAP.md:328-332`; `HANDOFF.md:85-90` (#8 500 error); commit 8af3b08; `REMEDIATION.md:762` (R-48 resolved, harness 5/5) | Claimed fixed 2026-07-15 / R-48 | Y |
| C-28 | Checkout: single endpoint `POST /api/checkout` (hold, queue, presale, OTP, price, promo, addons) | `TODO.md:135` (#2); `docs/COMPLETE-FEATURE-MAP-2026-05-23.md:86`; INFERRED: `api/checkout` | Working. The foyer sub-feature was disabled (aa62538), then declared "ŽIVÝ" and fixed to read `items` jsonb (0be06d9, 9cd730d). The program booklet was removed (fbd0475, f049fe9, fdecbf5) | Y |
| C-29 | Sales cutoff (no sale after event start / closed window) | `TESTING_MAP.md:357-358` | **[MEZERA]:** no cutoff exists in checkout | Y |
| C-30 | **GoPay** payment (create + redirect + webhook `/api/payments/gopay/webhook`) | `GO-LIVE-CHECKLIST.md:70-77`; `LAUNCH-CHECKLIST.md:21-27`; `TODO.md:87` (A1); commit f4d9031; INFERRED: `lib/payment/gopay-real.ts`, `api/payments/gopay/webhook` | Code "kompletní" (NEXT-SESSION:63); **merchant/KYC/keys open** (GO-LIVE:70,74) | Y |
| C-31 | **ComGate** (SK/EUR) | `GO-LIVE-CHECKLIST.md:75-76`; commit f4d9031; INFERRED: `api/payments/comgate/webhook` | "Provider abstrakce hotová, stačí klíče"; open | Y |
| C-32 | Mock gateway disabled in production (fail-closed) | INFERRED: `lib/payment/mock-guard.ts:11-13` (`NODE_ENV!=='production' \|\| ALLOW_MOCK_PAYMENTS==='1'`); `GO-LIVE-CHECKLIST.md:77` ("Vypnout `GOPAY_MOCK`") | **Doc/code mismatch (checked in code):** `GOPAY_MOCK` appears only in `.env.example:61`. No code reads it. Selection is `PAYMENT_PROVIDER` (default `'mock'`, `lib/payment/provider.ts:67`) | Y |
| C-33 | Webhook idempotency + signature verification | `TESTING_MAP.md:310-313` (conditional UPDATE `WHERE status='pending'`); `LAUNCH-CHECKLIST.md:27` [ ] "Ověřit podpis callbacku na ostro"; `PRODUCTION-READINESS.md:88-89` [ ]; `TODO.md:109` (A13 IP allowlist) | Idempotency [OVĚŘENO] (code); live signature open | Y |
| C-34 | Bank transfer with variable symbol + Fio auto-reconciliation | commits 84f00b0, 661f4e7, 984fbe0; `LAUNCH-CZ-SK.md:89-90,130-166`; INFERRED: cron `bank-sync-fio` | ✅ claimed. VS format **CONFLICT**: LAUNCH-CZ-SK:164 proposes B (`EEEEEENNNN`); NEXT-SESSION:13 says implemented per-event 10-digit | Y |
| C-35 | Ticket issuance after payment, idempotent, exactly M tickets | `TESTING_MAP.md:310-317`; `HANDOFF.md:44-59` (#4 race: 6 tickets for M=3); commits b45683e (advisory lock + ON CONFLICT), 75e5b52 (mig 450 UNIQUE) | Claimed fixed 2026-07-04. Whether mig 450 is on prod was not established | Y |
| C-36 | Free (0 Kč) orders issue tickets + e-mail | `TODO.md:49` (B1) | "HOTOVO" (April) | Y |
| C-37 | QR codes: static + rotating TOTP (RFC 6238), secrets AES-256-GCM; per-event `qr_policy` | `TODO.md:172` (#23); `LAUNCH-CZ-SK.md:203-220`; `docs/COMPLETE-FEATURE-MAP-2026-05-23.md:123-124`; commit 609bcc8; INFERRED: `lib/totp/verify.ts`, `api/buyer/tickets/[ticketId]/totp`, `api/public/tickets/[token]/totp` | ✅ (EMPTY-SHELLS:30 "genuinely functional") | Y |
| C-38 | **ENCRYPTION_KEY stability** (if it changes, no ticket scans) | `GO-LIVE-CHECKLIST.md:59-63`; `LAUNCH-CHECKLIST.md:44` | **OPEN** [ ] | Y |
| C-39 | PDF ticket (owner-only download; lazy issue) | `TODO.md:50` (B2); INFERRED: `api/buyer/orders/[orderId]/ticket-pdf`; `HANDOFF.md:53` (lazy issuance path) | "HOTOVO" | Y |
| C-40 | Transactional e-mail: order confirmation with PDF + QR | `GO-LIVE-CHECKLIST.md:80-84` ("bez emailu kupec nedostane lístek"); `LAUNCH-CHECKLIST.md:30-33`; commit bee793f; INFERRED: `lib/email/mailer.ts`, `internal/order-completed/route.ts:752-762` (`sendMail`) | Code built; **Resend domain/DNS/API key OPEN** | Y |
| C-41 | Other e-mails (password reset, team invite, waitlist, lottery, reminders cs/sk/en) | commit 545d0b8; INFERRED: `api/internal/{team-invite-email,waitlist-email,lottery-winner-email}` | Built | Y |
| C-42 | E-mail failure must not leave the order stuck | `TODO.md:58` (B5) | "HOTOVO" (April) | Y |
| C-43 | Sold-out handling + waitlist notify | commit c0cbf32 (waitlist sold-out check queried a non-existent column); INFERRED: `api/events/[id]/waitlist`, cron `waitlist-notify` | Fixed 2026-06-30; permanently failing test `T-WAITLIST-PROVIDER` (`REMEDIATION.md:165`) | Y |
| C-44 | Admin refund (full, from `paid`, revokes tickets, restores stock) + bulk refund | `TESTING_MAP.md:318-324`; `GO-LIVE-CHECKLIST.md:194` [x]; INFERRED: `api/admin/orders/[orderId]/refund`, `api/admin/orders/bulk-refund` | E2E [x]. **[MEZERA]:** refunds already-scanned (`used`) tickets (TESTING_MAP:323-324) | Y |
| C-45 | Buyer self-service cancel/refund with per-event policy (deadline, fee %) | commit ba31685; `LAUNCH-CZ-SK.md:168-188` (7 days + 5 % proposal); `HANDOFF.md:15-26` (#1 FALSE SUCCESS); fix commit 63b52ec | Claimed fixed. **Doc/code mismatch (checked in code):** `COMPLETE-FEATURE-MAP:143` says "pending only", but `buyer/orders/[orderId]/cancel/route.ts:82` accepts `pending`,`paid`,`paid_partial` | Y |
| C-46 | Refund money actually returned via gateway (GoPay/ComGate refund API) | `TODO.md:28` (#198 refund-engine "processRefund GoPay+Stripe"); `TODO.md:110` (A14 `refundGopayPayment`) | AMBIGUOUS: the docs do not show whether the current `nextjs-boilerplate` refund routes call the gateway refund API or only mark DB state. Must be tested | Y |
| C-47 | Refund requests queue (buyer → promoter approve) | `NEXT-SESSION.md:20` (mig 266); INFERRED: `api/admin/refund-requests`, `api/buyer/refund-requests` | Built. Stale comment in code: `buyer/orders/[orderId]/refund/route.ts:12` "TODO: tabulka refund_requests" | Y |
| C-48 | Chargebacks + tiered holdback (5 %/90 d, 3 %/60 d, 0) | commits e3c3172, a567df6; `LAUNCH-CZ-SK.md:190-201`; `NEXT-SESSION.md:14` | Built | Y |
| C-49 | Gate scan: `valid→used` exactly once, promoter owns the ticket; multi-day redemptions | `TESTING_MAP.md:307-309,69`; `HANDOFF.md:118`; `GO-LIVE-CHECKLIST.md:195` [x]; INFERRED: `api/admin/scanner/validate` | [OVĚŘENO] | Y |
| C-50 | **Offline scanning** (IndexedDB queue + pre-downloaded manifest whitelist, sync later) | `GAP-MATRIX.md:139` ✅; `PRODUCTION-READINESS.md:249` [ ] "otestován"; commit b5df140 ("bezpečný offline skener"); `BUG-INVENTORY.md:148` (TODO whitelist); INFERRED: `lib/scanner/offline-queue.ts:2-26`, `api/admin/scanner/manifest` | Claimed done. The old TODO no longer appears in the file (header :15-17 describes the manifest). Never field-tested per PR:249 | Y |
| C-51 | Multi-gate, per-gate stats, re-entry/exit, anti-passback, scan logs | commits f542baf, 883851d, 8ce3d10; `GO-LIVE-CHECKLIST.md:195` | ✅/E2E | Y |
| C-52 | Guestlist check-in, comps/press, cross-pass scan | `HANDOFF.md:28-42` (#2, #3 GATE OUTAGE); fixes 3283d45, d29d435 | Claimed fixed 2026-07-04/09 | Y |
| C-53 | Box office / POS walk-in sale (cash/card, thermal receipt) | `GO-LIVE-CHECKLIST.md:195` [x]; `PRODUCTION-READINESS.md:251-252` [ ]; commits beb00e9, 73c2a5c, 5225eb7; `HANDOFF.md:146` (POS not drift-swept); INFERRED: `api/admin/pos/sale`, `api/admin/events/[id]/box-office/sell` | E2E [x]; permanently failing test `T-BOXOFFICE-EXPIRES 23502 expires_at` (`REMEDIATION.md:166`) | Y |
| C-54 | Invoices / tax documents (buyer invoice, promoter invoices PDF, ISDOC, company data) | `LAUNCH-CHECKLIST.md:55` [ ] "Ověřit fakturu/účtenku + DPH"; `PRODUCTION-READINESS.md:208` [ ]; commits 1a8f816, 26302b1, 3a99eba; `docs/LEGAL-REVIEW-PACKET.md:26-29` (IČO/DIČ placeholders on invoices); INFERRED: `api/buyer/orders/[orderId]/invoice`, `api/admin/invoices/{[id]/pdf,[id]/isdoc,export}` | Built; content/legal correctness **open** | Y |
| C-55 | Organizer exports & reports (orders CSV, customers, sales report, scan export, Pohoda/ISDOC, NIPOS, 200-report registry) | commits 016793e, 7978a0d, ba83690; `REMEDIATION.md:59` (198 defs, **152 active, 46 disabled**); INFERRED: `api/admin/orders/export`, `api/admin/events/[id]/sales-report`, `api/admin/reports/{run,pohoda,nipos}` | 46 reports disabled as broken; R-45 open (:131) | Y |
| C-56 | Organizer dashboards / real-time sales | `GAP-MATRIX.md:184-189` | ✅ | Y |
| C-57 | **Payouts / settlement** (per currency, fee, holdback, weekly auto-settle, execute) | `PRODUCTION-READINESS.md:154,207,257` [ ]; `LAUNCH-CZ-SK.md:95-96` ✅; commits 880c7b2, e47004b; `nextjs-boilerplate/REMEDIATION.md:171-177` (**R-59 "VYPLATY NEFUNGUJI VUBEC"**); commits 4779f45 (SELECT fixed), 776358b ("šestá vrstva je DEPLOY"), 4f73315 (mig 468) | **Not working on prod per the live doc.** Code partly fixed; `ENABLED_PAYOUT_CHANNELS` not implemented (:177). INFERRED (grep): cron `payouts-execute` is in neither `vercel.json` nor the dispatcher | Y |
| C-58 | GDPR: export, erasure (30-day grace), consent log, purge crons, cookie banner | commit df58657; `docs/COMPLETE-FEATURE-MAP-2026-05-23.md:374`; `LAUNCH-CHECKLIST.md:12`; `GO-LIVE-CHECKLIST.md:99` [ ] (legal); commit cdfec6d (GDPR purge fix); INFERRED: `api/buyer/gdpr/{export,delete}`, cron `process-gdpr-deletions` | Built; E2E [x] GO-LIVE:197. Failing test `consent-log-purge` returns `ok:true` on permission denial (`REMEDIATION.md:167`) | Y |
| C-59 | Legal texts ToS/Privacy CZ+SK with real operator data | `LAUNCH-CHECKLIST.md:52-54` [ ]; `GO-LIVE-CHECKLIST.md:95-99` [ ]; `docs/LEGAL-REVIEW-PACKET.md:22-52` | Drafts exist; placeholders + lawyer review **open** | Y |
| C-60 | Multi-tenant isolation (RLS, `tixly_app` role) | `GO-LIVE-CHECKLIST.md:21-24` [x], `:142-148` [ ] 🔴, `:210` [ ]; `nextjs-boilerplate/REMEDIATION.md:34-42` | **CONFLICT:** GO-LIVE:21 "RLS Fáze 2 DOKONČENA" vs :143-145 / REMEDIATION:36-38 "prod runs as `neondb_owner` → 596 policies INERT, RLS not enforced". App-layer filters still apply | Y |
| C-61 | Rate limiting + anti-bot on login/register/checkout (hCaptcha) | commits 90ba293, bd6e363, 695d678, e12459f; `PRODUCTION-READINESS.md:81,93` [ ] | Built; hCaptcha keys are a soft gate (PR:280) | Y |
| C-62 | Hot-onsale virtual queue | `GO-LIVE-CHECKLIST.md:132-134` [x]; commit 3182f77 | Verified 10/10 (claim) | Y |
| C-63 | DB pooling correctness (R-56 two pools: direct for `connect()`) | `GO-LIVE-CHECKLIST.md:149-159` [ ]; `REMEDIATION.md:65-94` | Fixed in `master`; **prod env confirmation open** | Y |
| C-64 | i18n CS/SK/EN | commit be9573c; `LAUNCH-CZ-SK.md:70` | ✅ | Y |
| C-65 | Age verification (18+) | `TODO.md:29` (#199 🔴); `docs/FINAL-WORK-MAP.md:30` 🔴 "zbývá"; `GAP-MATRIX.md:263` ✅ (points to `_archive/age-verification`) | **CONFLICT** (FWM says missing; GAP-MATRIX cites archived module) | N (compliance-adjacent) |

---

## 2. Go-live blockers — `GO-LIVE-CHECKLIST.md` (the key doc)

### 2a. OPEN items `[ ]` (line numbers)
| Line | Item | Phase / doc's own severity |
|---|---|---|
| 59 | ENCRYPTION_KEY stable forever (backup in 1Password) | 1A "Kritická operační poznámka" |
| 70 | GoPay merchant contract + KYC (~14 days) | **FÁZE 1 — "bez tohoto nelze brát peníze"** |
| 74 | Send GoPay credentials → set `GOPAY_GOID/CLIENT_ID/CLIENT_SECRET/API_URL` | FÁZE 1 |
| 75 | ComGate (SK/EUR), only if SK promoters immediately | FÁZE 1 (conditional) |
| 77 | Turn off `GOPAY_MOCK` on prod (**the code never reads this var**, see C-32) | FÁZE 1 |
| 80 | Resend domain + API key | FÁZE 1 ("bez emailu kupec nedostane lístek") |
| 82 | SPF/DKIM/DMARC DNS records | FÁZE 1 |
| 83 | API key → `SMTP_*`, `EMAIL_FROM` | FÁZE 1 |
| 89 | CNAME `app` → `cname.vercel-dns.com` | FÁZE 1 |
| 92 | Verify HTTPS + `NEXT_PUBLIC_APP_URL=https://app.tixly.cz` | FÁZE 1 |
| 95 | Confirm Tixly s.r.o. + IČO + DIČ | FÁZE 1 legal |
| 96 | Confirm Fio account CZK + EUR | FÁZE 1 legal |
| 97 | ToS CZ | FÁZE 1 legal |
| 98 | ToS SK | FÁZE 1 legal |
| 99 | GDPR / processing (CZ 110/2019, SK 18/2018) | FÁZE 1 legal |
| 100 | VAT settings verification (CZ 21/10, SK 23/5) | FÁZE 1 legal |
| 105 | `ANTHROPIC_API_KEY` on prod (poster vision moderation) | FÁZE 1 security |
| 106 | `MODERATION_PROVIDER ≠ mock` on prod | FÁZE 1 security |
| 108 | Live smoke: problematic poster → queue | FÁZE 1 security |
| 114 | Sentry | FÁZE 2 "silně doporučeno" |
| 115 | Better Uptime on `/api/health/ready` | FÁZE 2 |
| 116 | Apple Wallet PassType cert (passes unsigned today) | FÁZE 2 |
| 117 | Google Wallet issuer | FÁZE 2 |
| 118 | Backup/DR: Neon PITR retention ≥ 7 days | FÁZE 2 |
| 137 | 🔴 Rotate `neondb_owner` password (value was exposed outside the repo) | FÁZE 2B, marked 🔴 |
| 142 | 🔴 `ALTER ROLE tixly_app PASSWORD` + switch prod `DATABASE_URL` to `tixly_app`. "Jediná věc, která policies zapne". Fixed order: deploy R-56 first | FÁZE 2B, marked 🔴 |
| 149 | R-56 two pools: confirm env (`PG_DIRECT_POOL_MAX=4`, `PG_DIRECT_IDLE_TIMEOUT_MS=10000`) | FÁZE 2B |
| 160 | Load test on deployed prod | FÁZE 2B |
| 162 | Vercel spending limit + concurrency alert | FÁZE 2B |
| 163 | (optional) Lighten fraud-ML scoring in checkout | FÁZE 2B optional |
| 172-178 | FB publish, Spotify, MHD transit, benefit cards, BNPL, SMS, B2B API write (stub) | FÁZE 3: "**Nejsou launch blocker**" (:170) |
| 200 | 🔴 Golden path with **real payment** (real card → e-mail with QR → scan) | FÁZE 4, marked 🔴 |
| 202 | Wallet (Apple/Google) signed passes | FÁZE 4 |
| 208-211 | Native app, pricing page, RLS flip `NOBYPASSRLS`, first 1-3 real promoters | FÁZE 5 post-launch |

### 2b. CHECKED items `[x]` (claims to verify)
:16 Vercel + auto-deploy · :17 build fixed (Root Directory) · :18 Neon prod migrated to 339 · :19 Upstash Redis ·
:20 secrets on Vercel · :21 RLS Phase 2 done (42/42 E2E, 166-endpoint smoke) · :25 CZ/SK code done (VAT, VS, EUR payouts, SK texts) ·
:27 prod runs, `health/ready` ok, login works · :28 re-verified 2026-06-03 · :29 moderation vision · :30 deep E2E 30 functions, ~24 bugs fixed ·
:33 smoke 429 endpoints · :46 mig 340-348 on prod · :49 merge to master (`99ca26c`, exists) · :51 deploy READY · :52 promoter registration on prod 200 ·
:87 `app.tixly.cz` added to Vercel · :88 deployment protection · :103 3-layer moderation · :104 blocklist seeded · :107 auto-publish disabled ·
:128 checkout lock shortened (0 oversell at 600 concurrent) · :132 virtual queue verified 10/10 · :135 Neon pooler already in `DATABASE_URL` ·
:188-199 E2E: golden path (mock payment), event+moderation, festival, subscriptions, resale, insurance, refund, POS+scanner, onboarding, and a batch list (promo, loyalty, group, vouchers, gift, bank transfer, BNPL, lottery, GDPR, payment plans, entry slots, waitlist, accreditation, will-call, affiliate, RFID, white-label, charity, NFC).

### 2c. Internal contradictions inside GO-LIVE-CHECKLIST
- :3 "Aktualizováno 2026-06-08" vs content referencing FINDINGS §209 (Aug 2026).
- :6-10 and :231-232 still say "fixes NOT on prod, 2 blockers incl. deploy", while :46-56 and :222 say deploy DONE.
- :135 `[x]` "pooler is fine" vs :149-154 "R-56 was a LIVE production defect caused by `-pooler`".
- :21-24 `[x]` "RLS Phase 2 done" vs :142-145 "prod runs as `neondb_owner`, 596 policies inert".
- :228 "remaining: queue + Neon pooler" vs :132/:135 `[x]`.
- The project memory claims "prod bypassrls=false, RLS active". :143 (§209) says the opposite.

### 2d. Launch gates in other docs
- `LAUNCH-CHECKLIST.md` (2026-06-12). **All unchecked:** Tier 0 :21-27 (GoPay merchant, env, `GOPAY_MOCK=0`, **one real sandbox payment end-to-end :26**, live callback signature :27), :30-33 (Resend, e-mail with PDF+QR test), :36-40 (prod DB, `tixly_app` not superuser, daily backup), :43-46 (fresh secrets). Tier 1 :52-57 (legal operator data, invoice + VAT on a real order, Sentry alert "paid but no ticket", webhook URLs registered).
- `PRODUCTION-READINESS.md:267-276` hard gates (stale, Stripe-era, all open): B1 payment prod + webhook idempotency, B2 Resend, B5 IČO/DIČ/bank, GDPR ToS published, WCAG audit, **backup restore drill**, **load test**, webhook signature, **hands-on golden path in prod (video)**.
- `db/DEPLOY-RUNBOOK.md:51` prod backup [ ]; `:88-95` post-deploy smoke [ ] (login, registration, buyer checkout → ticket, admin, platform, embed).
- `db/RLS-FLIP-RUNBOOK.md:37-47` prerequisites [ ] (incl. `DATABASE_URL` → `tixly_app`, PITR ≥ 7 days).
- `db/ONSALE-PLAYBOOK.md:90-95` onsale-day checklist [ ].
- `nextjs-boilerplate/REMEDIATION.md:34-35` "**Deploy requirement**: prod `DATABASE_URL` uses `tixly_app`"; `:196` migrations 470 and 471 are **not on prod**, and nothing has been pushed (150+ commits ahead of origin).
- `docs/FINAL-WORK-MAP.md:12-17` (May): #8 GoPay creds, #1 SMTP, #4 migrations, #6 deploy, #12 GO LIVE blocked; `:30` age verification 🔴.

---

## 3. Items the docs claim DONE (verification targets for later phases)
Core claims with the highest audit value (source → claim):
1. `GO-LIVE-CHECKLIST.md:188` golden path browse → checkout → mock pay → ticket → scan, "E2E 30/30".
2. `TESTING_MAP.md:297-301` no GA oversell; `HANDOFF.md:116` 20 concurrent → exactly 5.
3. `HANDOFF.md` #1-#11 fixed by commits 63b52ec, 3283d45, b45683e, 75e5b52, aa62538, fbd0475, 3c53e84, 8af3b08, d29d435 For #9 (parking `bundle_items`) and #10 (`lottery_entries.updated_at`), grepping the commit messages found **no fix commit** (a9f1ba4 "lottery: promoter_id" is a different defect). Treat them as UNVERIFIED/possibly open.
4. `LAUNCH-CZ-SK.md:85-99` VAT per market, VS, EUR payouts, SK ToS; "Tax+accounting 25/25".
5. `GO-LIVE-CHECKLIST.md:132` virtual queue gates checkout 10/10.
6. `REMEDIATION.md:49-61` "Hotovo a ověřené chováním": RLS promoter dimension 64 patterns, buyer dimension 93 policies 0 leaks, dynamic SQL 257/30/0 vulnerable, concurrency harness 5/5, 46 cron routes audited, 152 active reports.
7. `LAUNCH-CHECKLIST.md:10-14` payment abstraction GoPay+ComGate+Stripe, SMTP mailer, legal pages + GDPR API + deletion cron, clean-DB provisioning, app not superuser (**contradicted** by §209 for prod).
8. `docs/EMPTY-SHELLS-AUDIT-2026-05-23.md:17-33` 13 "genuinely functional" features (TOTP, resale, insurance, …).
9. `BUG-INVENTORY.md:12-51` "P0 4/4, P1 8/8 done" (hashes unverifiable, see §5).
10. `TODO.md:5` "Hotovo: 211"; phases 2/4-14 "(vše hotovo)". Many rows cite standalone modules and test counts (e.g. "#61 biometric entry 39/39 testů") that are in `_archive/`, not the live app. **Treat as unreliable.**

---

## 4. NON-core features claimed (compact, by domain)

| ID | Domain | Features claimed | Source | Claimed status |
|---|---|---|---|---|
| N-01 | Resale & transfer | FanSALE face-value-capped resale + reissue; P2P transfer (invite link); direct transfer; ticket exchange/upgrade | commits 77ddc88, cf35c64, 893565a, 29bb894; `GO-LIVE-CHECKLIST.md:192`; `HANDOFF.md:102-108` (#11 token P2P dead; fix R-40 `REMEDIATION.md:682`) | E2E [x]. **Resale cap CONFLICT:** `COMPLETE-FEATURE-MAP:139` says "EU 110 %", while code `buyer/resale/list/route.ts:24` has `PRICE_CAP_BPS = 10000` (100 %) and `LEGAL-REVIEW-PACKET:49` says 100 % (checked in code) |
| N-02 | Subscriptions / passes | Theatre abonnement (Festabo/Wahl-Abo, restwert), season passes, subscription plans, modular festival pass, cross-pass | commits 5c214fa, 44afe1e, ac1073d, 31217e1, e6ddbd6; `GO-LIVE:190-191` | E2E [x]; subscriptions/cross-pass not drift-swept (`HANDOFF.md:145`); `my-memberships` broken (`REMEDIATION.md:149`) |
| N-03 | Stored value | Gift vouchers (3-year), gift cards, loyalty points, FanBonus cashback, restwert credit | commits d9152b3, e6426a5, a577657, 659b8e2, 65f4890 | Built; E2E list GO-LIVE:197 |
| N-04 | Payment extras | Payment plans/installments, BNPL Twisto/Skip Pay, benefit cards (Pluxee/Edenred…), Party Pay split, crypto (Triple-A), Wero, Stripe/Mollie/P24/PayPal, Apple/Google Pay (mobile) | commits 3d4b5ec, 29bb894, e8f6542, 0b80579, e94ca0e, 905ed90, 584cef1, 4ff2bd5; `GO-LIVE:175-176` | BNPL UI seam broken (`EMPTY-SHELLS:39`); benefit is mock-only (`EMPTY-SHELLS:50`); external contracts are FÁZE 3 |
| N-05 | Insurance | Ticket cancellation insurance (Stornoschutz) + claim → refund | commit 4944fe0; `GO-LIVE:193` | E2E [x]; ToS clause missing (`LEGAL-REVIEW-PACKET:37`) |
| N-06 | Fair-sale / anti-scalp | Verified Fan, lottery/ballot, presale codes, OTP SMS gate, device binding, phone verification, fair queue, no-surge pledge | commits 789166b, d711fa0, 597d628, bb7462b, a10d59f, 757b49a, 0e7715d | Verified Fan and OTP UI seams broken (`EMPTY-SHELLS:40-41`); VF code not user-bound (`checkout/route.ts:410` TODO) |
| N-07 | Dynamic pricing / AI | Demand-based dynamic pricing + cron, AI price suggest, AI event descriptions, AI seating from text/image, demand forecast | commits 7f252a4, 546e06a, 86e7599, 5e73ab2, 0c083d4 | Dynamic price not read by the price authority (`EMPTY-SHELLS:43`); demand-forecast disabled (R-21/R-47) |
| N-08 | Festival / on-site | RFID wristbands + cashless, NFC tap, will-call, accreditation, entry slots/timed entry, group admission QR, printed 104 mm tickets, hardware scanner API | commits 9c9fbe7, 1c9ebee, baf5238, fad7ec8, c843680, c41ba1a, 4b990a0, ea0d5ac | E2E list GO-LIVE:197-198; RFID service layer "dead" per R-58 (`REMEDIATION.md:106-108`) |
| N-09 | Wallet / mobile | Apple/Google Wallet passes, PWA, native Expo apps (buyer + promoter) | commits db30969, c2fb721, b770f92 | Wallet unsigned (GO-LIVE:116-117,202); native app post-launch (:208) |
| N-10 | Marketing | Campaigns email/SMS/push, segmentation, smart send, newsletter digest, Meta Pixel/CAPI per promoter, GTM, TikTok CAPI, 30-pixel manager, marketplace ads CPC, marketing QR, affiliate, referral, Brand Connect, sponsors | commits 639a2f0, bd3908b, c80405f, d5d3895, d74b16c, 34c4a64, cb57ba2, 8f82fcf, 9c9fbe7, acee55c | Affiliate cookie seam broken (`EMPTY-SHELLS:44`) |
| N-11 | Discovery / social | Map/geo, recommendations, RSVP, friends-going, follow promoter, reviews, editorial, Spotify discovery, iCal/RSS feeds, search pg_trgm | commits f5e25ed, fa81657, 6ab409c, 24fb51a, 7aa6f98, 397ac90, ef78de9, 441edcd | Built; `reviews/[token]` broken (`REMEDIATION.md:148`) |
| N-12 | Distribution / API | B2B API keys (write = stub), public GraphQL, OAuth2 + REST v3, SDK, developer portal, embed widget (inline checkout + seat picker), kiosk, partner POS, resellers, Publish API, Agent Lane, Meta/TikTok catalog feeds | commits a0a07a2, c627b40, 52c56b7, c4c6996, c193220, 8a2b5c6, e61faf6, 5c6a2a3, dcdd38d, af7a445; `GO-LIVE:178` | B2B write is a stub (GO-LIVE:178); per-key rate limit TODO (`lib/b2b-auth.ts:11,75`); b2b RLS decision open (R-17) |
| N-13 | Verticals | Cinema, sports, museums/timed entry, theatre ops (14 features mig 357-371), memory ticket, bulk reschedule, travel/hotel bundle, parking bundle, livestream tickets | commits 1aa4f13, 28f7436, 11c3051, 043f734, 31f4e76, e71956d, 871bdcc | Parking bundle 500 (HANDOFF #9, no fix commit found); foyer re-enabled and fixed 9cd730d, but its writer is still a product decision (R-25); program booklet removed (R-26/R-28) |
| N-14 | Finance extras | Advance payout (factoring), rolling reserves, artist royalties, SEPA/Wise/PayPal payouts, B2B credit, EU reverse charge + VIES, PSD2 bank OAuth | commits e58b626, 880c7b2, 7750e90, e47004b, 597d628, 5c78646, 41a02d1 | Wise/PayPal payout columns missing, "nenarozený subsystém" (`REMEDIATION.md:144-147`); royalty service layer dead (R-58) |
| N-15 | Compliance extras | DSA report button + queue + transparency, eIDAS QES contracts, EUDI wallet verification, AML/sanctions, NIPOS stats, WCAG helpers, GDPR DPA | commits 5b59088, 6a97788, 7ae46c3, 3d2fd30, ba83690, a80c80d, 66f9674 | Built; DPA text itself still to be created (`LEGAL-REVIEW-PACKET:47`) |
| N-16 | Integrations | ForgeMsg outbox, FB event publish, Bandsintown/Songkick, MHD transit (DPP), status page, provider health | commits 3a34c4e, 45813d2, 50c4e38, e26269d, 031807c | FB is mock; the transit real path throws (`EMPTY-SHELLS:51`); FÁZE 3 |
| N-17 | Ops / platform | Sentry, weekly S3 backup workflow + restore drill, CI (ci, rls-gate, schema-drift-guard, security, deploy), feature flags, promoter tiers | commits 5d07ded, b49649e, abb7d29, 5bc85b5, d5ad7b1, c27504e; `.github/workflows/*.yml` exist | Sentry DSN open (GO-LIVE:114); `docs/RESTORE-DRILL-LOG.md` (28 lines) not reviewed |
| N-18 | Vision (not started / out of scope) | 21 non-ticketing verticals (escape rooms … airports), access-control-as-a-service, sharing economy | `platform-vision.md:67-451`; `TODO.md:422` (#146-159 "✅" as modules) | Vision only; the TODO ✅ refers to archived modules |

---

## 5. Cross-cutting findings from Phase 1 (facts, not guesses)
1. **Cited commit hashes don't exist.** `GAP-MATRIX.md` (e.g. `98a5db3`, `e69b62f`, `fde40aa`, `6b389d3`), `LAUNCH-CZ-SK.md:70-77` (`c8a4458`, `b05c9a9`, `6d3f282`, `d90fdfd`, `cdcf23e`, `01d2b6b`) and `BUG-INVENTORY.md:13-51` (`2941aa6`, `dbb4194`, `236a6ae`, `c7379a4`, `3f47cce`, `72ee6a9`, `420e9f6`, `5551762`) all return MISSING from `git cat-file` (`git log --all` has 665 commits too). History starts with snapshot `a402161` (2026-04-29). The equivalent work exists under other hashes (e.g. catch-up #11 = `f5e25ed`). Cause (probably a rewrite or re-import) is not proven.
2. **`GOPAY_MOCK` is a dead switch.** Docs tell the operator to set it (`GO-LIVE:77`, `LAUNCH-CHECKLIST:24`), but code only reads `PAYMENT_PROVIDER` (default `'mock'`) plus the `ALLOW_MOCK_PAYMENTS` prod guard.
3. **The RLS state on prod is contested:** it is "done" in one place and "inert" in another (see C-60, §2c).
4. **Payouts are broken per the latest live doc** (R-59). Earlier docs claim them done (LAUNCH-CZ-SK:95, NEXT-SESSION:16).
5. **Commission rate is undecided** (7/5/4 % plan vs 5 % code default vs 2.5–3 % memory).
6. **Known permanently failing tests** (`REMEDIATION.md:162-169`): waitlist walk-in, box-office `expires_at`, consent-log-purge, `upgrade-options` (`catalog.seat_maps` missing).
7. **Unswept areas** (`HANDOFF.md:141-149`): subscriptions, POS/box-office, kiosk, comps/guestlist/press create, RFID CRUD, gift/voucher/loyalty writes.
8. **In-code TODOs in `nextjs-boilerplate/src`** (complete grep list, 8 real ones):
   `api/checkout/route.ts:410` (presale code not bound to user); `api/buyer/orders/[orderId]/refund/route.ts:12` (refund_requests); `api/buyer/subscriptions/[id]/route.ts:8` (prorata refund, while route `refund-prorata` exists); `api/admin/ticket-changes/[changeId]/route.ts:7` (price-diff invoice "TODO real payment"); `lib/b2b-auth.ts:11,75` (per-key rate limit; `remaining: 999` hardcoded); `api/v1/publish/events/[externalId]/route.ts:120`; `app/r/[code]/route.ts:11`; `admin/events/[id]/member-pricing/page.tsx:85`. The other grep hits are `XXX` placeholders in docs/tests.
