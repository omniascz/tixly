# Input Validation Audit — 2026-04-08

Scanned all `route.ts` files for `await request.json()` usage.
Total files with JSON body parsing: **269**

---

## Routes WITHOUT Zod validation (fix needed)

168 routes do `await request.json()` with no Zod schema. Highest-risk subset listed first.

### Priority 1 — Fixed in this audit (see below)

| Module | Route | Method | Risk |
|---|---|---|---|
| `gopay-payments` | `/api/gopay/payments` | POST | Creates payment, calls external GoPay API with unvalidated amounts/emails |
| `stripe-payments` | `/api/payments/stripe/checkout` | POST | Initiates Stripe PaymentIntent with unvalidated orderId/userId |
| `stripe-payments` | `/api/payments/stripe/orders/:orderId/refund` | POST | Issues refund with unvalidated amountHellers — no max cap, no UUID check |
| `b2b-api` | `/api/v1/orders` | POST | B2B order creation — partial manual validation only, no depth checks |
| `slot-engine` | `/api/reservations/bookings` | POST | Confirms booking hold — no UUID validation on holdId |

### Priority 2 — Needs fix (not yet addressed)

| Module | Route | Method | Risk |
|---|---|---|---|
| `buyer-blacklist` | `/api/blacklist` | POST | Bans users by email — manual type checks only |
| `b2b-api` | `/api/v1/webhooks` | POST | Registers webhook URL — URL validation via `new URL()` only |
| `b2b-api` | `/api/v1/webhooks/:endpointId` | PUT/PATCH | Updates webhook, unvalidated fields |
| `b2b-api` | `/api/v1/keys` | POST | Creates API keys — unvalidated name/scopes |
| `cinema` | `/api/cinema/screenings` | POST | Creates screenings, writes to DB unvalidated |
| `cinema` | `/api/cinema/films` | POST | Creates films, writes to DB unvalidated |
| `conference` | `/api/conferences/:id/sessions` | POST | Writes sessions unvalidated |
| `conference-exhibitors` | `/api/conferences/:id/exhibitors` | POST | Writes exhibitors unvalidated |
| `slot-engine` | `/api/reservations/resources` | POST | Creates booking resources unvalidated |
| `slot-engine` | `/api/reservations/resources/:id/slots` | POST | Creates slots unvalidated |
| `wellness-entry` | `/api/wellness/bookings/:id` | PUT | Updates bookings unvalidated |
| `timed-entry` | `/api/entry/venues` | POST | Creates cultural venues unvalidated |
| `ski-resort` | `/api/ski/resorts` | POST | Creates resort records unvalidated |
| `affiliate-tracking` | `/api/affiliate/payout` | POST | Triggers payout unvalidated |

### Full list of unvalidated routes

168 routes total — see the grep output for the complete list. The modules with the most unvalidated routes are:

| Module | Count |
|---|---|
| `cinema` + `cinema-program` | 16 |
| `conference` + `conference-badges` + `conference-exhibitors` | 15 |
| `slot-engine` | 9 |
| `branch-management` | 9 |
| `service-catalog` | 9 |
| `timed-entry` | 8 |
| `ski-resort` | 7 |
| `sport-season-tickets` | 5 |
| `b2b-api` | 4 |
| `escape-rooms` | 7 |

---

## Routes WITH validation (OK)

101 routes have Zod validation. Examples:

- `nextjs-boilerplate/api/checkout` — full `CheckoutSchema` with UUID, quantity, promo code ✅
- `micro-organizer/api/micro/register` — `RegisterMicroOrganizerSchema` ✅
- `micro-organizer/api/micro/verify-email` — schema validation ✅
- `fraud-queue/api/platform/admin/fraud/ingest` — `SignalSchema` ✅
- `payout-management/api/promoters/:id/payout-settings` — `UpdateSettingsSchema` ✅
- `promoter-onboarding/api/onboarding/register` — `RegisterUserSchema` ✅
- `event-management` routes — validated ✅
- `gopay-payments/api/gopay/payments/:id/refund` — validated ✅

**Total: 101 routes have Zod validation ✅**

---

## Fixes Applied

The following 5 routes were fixed with Zod schemas (see individual files):

1. `gopay-payments/src/app/api/gopay/payments/route.ts` — added `CreateGopayPaymentSchema`
2. `stripe-payments/src/app/api/payments/stripe/checkout/route.ts` — added `StripeCheckoutSchema`
3. `stripe-payments/src/app/api/payments/stripe/orders/[orderId]/refund/route.ts` — added `StripeRefundSchema`
4. `b2b-api/src/app/api/v1/orders/route.ts` — added `B2BCreateOrderSchema`
5. `slot-engine/src/app/api/reservations/bookings/route.ts` — added `ConfirmBookingSchema`

---

## Recommendations

1. **Highest priority:** Add Zod to all routes that write to the database or call external payment/fraud services. Start with `cinema`, `conference`, and `slot-engine` modules (32 routes combined).

2. **Create a shared validation library** at `shared/zod-schemas/` with common schemas: `UUIDSchema`, `EmailSchema`, `HellersSchema` (positive integer), `PaginationSchema`, etc.

3. **Lint rule:** Add a custom ESLint rule (or Biome rule) that flags `await request.json()` without a subsequent `.parse()` or `.safeParse()` in the same function.

4. **Middleware approach:** For modules with many routes, consider a `withValidation(schema, handler)` HOC so validation is enforced at the call site rather than inline.
