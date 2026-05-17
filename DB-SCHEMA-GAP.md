# DB schema vs UI/API gap audit

> Cíl: najít features, kde **migrace existuje** (tj. DB struktura je v základech), ale **UI nebo API endpoint chybí**. To jsou rozpracované features — z pohledu effortu zlomek nákladů, protože schéma už je.
>
> Repo má **170 migrací** v `migrations/` (root) a **237 API routes** v `nextjs-boilerplate/src/app/api/`. Spot-checked klíčové migrace (220–263) přes grep proti `nextjs-boilerplate/src/`.

---

## 🔴 DB-ONLY — migrace existuje, kód NIKDE

Tyto features mají schéma, ale žádný service / API / UI. **Effort zbytek: 3–10 dní per feature**.

| # | Migrace | Feature | Co chybí | Effort |
|---|---|---|---|---|
| 1 | `241_push_notifications.sql` | Push notifikace (Firebase) | Firebase admin SDK + register endpoint + broadcast service + UI v `/cs/profile` | 3-4 dny |
| 2 | `243_promoter_tiers.sql` | Tier systém promotérů (1–4) | Auto-approve logika, limit checks, upgrade workflow, admin UI | 3-5 dní |
| 3 | `245_marketplace_ads.sql` | CPC marketplace pro promotéry | Self-serve dashboard, billing, slot allocation, ad serving v homepage/kategorii | 7-10 dní |
| 4 | `244_ticket_personalization.sql` | Per-ticket jméno kupujícího | UI v checkoutu pro zadání, validace, tisk na PDF, scanner check | 2-3 dny |
| 5 | `167_fan_social_graph.sql` | Sociální graf (follows, friends) | API + UI: artist follow, venue follow, friend share, feed | 5-7 dní |
| 6 | `238_gamification.sql` | Body, badge, XP | Achievement engine, badge UI, leaderboard, XP per action | 5 dní |
| 7 | `230_bot_proof_queue.sql` | Post-purchase verifikace lidskosti | Queue worker, captcha challenge, auto-cancel po X failed | 2-3 dny |
| 8 | `234_event_insurance.sql` | Allianz / Twisto pojištění lístku | Provider integration, checkout add-on, claim flow | 5 dní (po API key) |
| 9 | `247_reentry_rules.sql` | Re-entry pravidla per gate | Logika v scanneru, multi-counter, časový limit | 2-3 dny |

**Suma: 9 features, 34–50 dní práce.** Z toho 3 mají gap matrix priority TOP 10 (push, marketplace ads, ticket personalization).

---

## 🟡 PARTLY-WIRED — schéma + backend, ale UI dílem

| # | Migrace | Feature | Stav backendu | Co dotáhnout |
|---|---|---|---|---|
| 10 | `232_payment_plan_tickets.sql` + `253_payment_plan_stripe.sql` | Splátky (Twisto-style P2 #18) | Cron na strhávání existuje, Stripe wiring částečné | UI v checkoutu, grace period, auto-cancel, statement |
| 11 | `252_benefit_payments.sql` | Pluxee / Benefit Plus / Gallery Beta | Callback route + lib existuje | Checkout selector, redirect flow, retry handling |
| 12 | `233_checkout_addons.sql` | Addony v checkoutu (parking, merch, ins.) | Checkout API to zná | Admin UI pro správu addonů, public UI pro výběr |
| 13 | `240_seat_holds_kills.sql` | Holds & Kills | `seat-lock.ts` má hold mechanismus | Kills (trvalá rezervace pro VIP), admin UI per event, bulk import |
| 14 | `239_volume_discount.sql` | Skupinová sleva | ✅ Admin UI + API existuje | Checkout integration ověřit, public messaging „od 5 ks −10 %" |
| 15 | `225_permanentky_checkout.sql` | Sezónky / permanentky | Subscriptions route existuje | Auto-renewal, sport-specific UX, season schedule view |
| 16 | `223_refund_engine.sql` | Refund engine | API existuje (`/api/buyer/orders/[orderId]/refund`) | **P1 #5 self-service UI**, partial refund (P1 #6) |
| 17 | `229_verified_fan_v2.sql` | Verified Fan v2 | v1 wired (catch-up #14) | v2 zlepšení (algorithmic scoring, identity link) — neutralizovat duplicitu |
| 18 | `237_group_payment.sql` | Skupinová platba | DB ano | Split-checkout UI, per-člen tracking, „kompletní když všichni zaplatí" |
| 19 | `236_wero_payments.sql` | Wero (A2A SEPA) | mock provider ano | Real wero API integration, fee structure |
| 20 | `261_editorial_articles.sql` | Blog (catch-up #15) | Blog routes existují | Připojit do migrace, ověřit RLS, editor UI v `/admin` |
| 21 | `262_event_reviews.sql` | Reviews & ratings | Catch-up #20 done | Promotér respond UI, moderace nevhodných |
| 22 | `259_event_rsvps.sql` | RSVP „půjdu" | Catch-up #13 done | Social proof na public event detail (badge „X přátel jde") |
| 23 | `260_verified_fan.sql` | Verified Fan v1 | Catch-up #14 done | Drying out duplicit s v2 (#229) |

---

## ✅ FULLY-WIRED — migrace + service + UI + API

Spot-checked, vše tří vrstev je v kódu. Tady **NEINVESTOVAT** dál (kromě UX polish):

- `accreditation` — admin UI + public form + 3 routes
- `chargeback` — admin UI + Stripe webhook
- `timed_entry` — public + admin UI, 2 routes
- `volume_discount` — admin UI + 2 routes
- `gift_vouchers` — checkout integration (catch-up #4)
- `tap_to_pay` (162) — POS commit (catch-up #10)
- `paypal` (165) — pravděpodobně mock, ověřit
- `bank_api_credentials` (258) — PSD2 OAuth (Tier-1 #4)
- `wcag_audit_log` (222) — Tier-1 #2
- `psd2_oauth` (263) — Tier-1 #4
- `feature_flags` (224) — wired do admin sidebar

---

## 🆕 LATEST MIGRATIONS bez ověřitelného kódu (otestovat ručně)

Migrace 161 a výš, kde jsem nestihl ověřit:

| Migrace | Předpoklad |
|---|---|
| `162_tap_to_pay.sql` | POS catch-up #10 wired |
| `163_event_ticket_defaults.sql` | Default values pro nové ticket types — neznámé UI |
| `164_daily_stats_email.sql` | Denní email s prodeji — cron + template? Ověřit. |
| `165_paypal.sql` | PayPal payment — wired nebo stub? |
| `166_promoter_profile.sql` | Branding fields — wired (víme z catch-up commitů) |
| `226_wallet_passes_db.sql` | DB pro Apple/Google Wallet — kód CHYBÍ (gap TOP 4) |
| `227_master_admin.sql` | Platform admin enhancement — pravděpodobně wired |
| `228_onboarding_wizard.sql` | Promotér onboarding — wired (`promoter-onboarding` v archive 🟢) |
| `242_team_invites.sql` | Sub-account invites — wired částečně |
| `248_loyalty_program.sql` | Body za nákup — UI částečné (`/cs/loyalty`) |
| `249_chargebacks.sql` | ✅ wired |
| `250_accreditation.sql` | ✅ wired |
| `251_bank_transfers.sql` | Bank transfer matching — KB/ČS Open API (P3 #23, partly wired via PSD2) |
| `254_accreditation_ticket_kind.sql` | Extension wired |
| `255_ticket_discount_kinds.sql` | catch-up #3 commit `7bdd116` |
| `256_gift_vouchers.sql` | catch-up #4 ✅ |
| `257_partner_pos.sql` | catch-up #6 commit `a8597d1` ✅ |

---

## TOP 5 quick-win (best ROI: migrace už hotová → málo práce na UI)

Z DB-only seznamu vybrat podle **effort × business value**:

| Rank | Co | Effort | Proč quick-win |
|---|---|---|---|
| 1 | **Ticket personalization** (#244) | 2-3 dny | Promotéři očekávají, scanner už umí name check, jen UI v checkoutu chybí |
| 2 | **Bot proof queue** (#230) | 2-3 dny | hCaptcha už P0 #4 — bot queue navíc je „belt-and-suspenders" |
| 3 | **Re-entry rules** (#247) | 2-3 dny | Scanner už má scan logs, jen logika multi-counter chybí |
| 4 | **Push notif** (#241) | 3-4 dny | DB flag existuje, Firebase SDK pak rychlý wireout |
| 5 | **Wallet passes DB** (#226) | 1-2 dny + ARCHIVE port | `wallet-passes` archive 🟢 + DB schéma + 1 lib v paměti |

---

## Závěr

- **9 čistých DB stubů** = 34–50 dní práce. Jsou to **rozpracovaná dluha** ze starých sessions, ne nový feature creep.
- **14 partly-wired** = 1–3 dny per feature, většinou jen UI/checkout integration.
- Celkový „dluh na hotovo" v migracích vs kódu = **~80 dní zbývající práce** ze starých sessions.

Toto je důležitý insight: **nemusíme přidávat features, máme 23 z nich rozpracovaných**. Lepší dotáhnout než přidávat.
