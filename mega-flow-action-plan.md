# Mega-Flow → Akční plán

Source: `mega-flow-analyza-master-level.md` × inventura `nextjs-boilerplate/` k 2026-05-14

**Legenda stavu:** ✅ EXISTS · 🟡 PARTIAL · ❌ MISSING

---

## P0 — BLOCKERY pro reálný launch (peníze + delivery)

| # | Co | Stav teď | Cíl |
|---|---|---|---|
| 1 | **Stripe / GoPay produkční brána** | 🟡 jen mock (`/src/lib/gopay-mock`, `/api/mock-gopay`) | Reálná tokenizace, 3DS, webhook handler s idempotency |
| 2 | **Produkční SMTP** | 🟡 nodemailer → MailHog `localhost:1025` | Resend / Postmark / AWS SES + DKIM/SPF, bounce handling |
| 3 | **Produkční SMS provider** | 🟡 BulkGate mock (`/src/lib/sms/bulkgate-mock.ts`) | Real BulkGate / Twilio API + audit log + cost tracking |
| 4 | **Reálná CAPTCHA** | 🟡 mock scoring (`/src/lib/bot-detection/detect.ts`) | hCaptcha / reCAPTCHA enterprise + threshold config |

→ Bez P0 se nedá pustit reálný traffic ani vybírat peníze.

---

## P1 — Mezery v core flow

| # | Co | Stav | Akce |
|---|---|---|---|
| 5 | **Self-service refund UI** | 🟡 API existuje (`/api/buyer/orders/[orderId]/refund`), UI chybí | Tlačítko v `/my-tickets`, validace pravidel, potvrzovací modal |
| 6 | **Částečná refundace** | ❌ jen full refund | Per-ticket refund + per-quantity, propagace do Stripe |
| 7 | **Transfer vstupenky (uživatelský)** | ❌ jen admin support actions | UI „Přeposlat na email", deaktivace orig. QR, nová TOTP, audit |
| 8 | **WebSocket / SSE real-time sedadla** | ❌ | SSE endpoint per event, broadcast po hold/release/buy, debounce 500ms |
| 9 | **„Best available" auto-select** | ❌ | Algoritmus: max contiguous block v cenové úrovni, fallback split |
| 10 | **Holds & Kills** | ❌ | Tabulka `seat_holds (event_id, seat_id, reason, release_at)` + admin UI |
| 11 | **Volume discount (skupinová sleva)** | ❌ | Pravidla per ticket type: od 5 ks −10 %, od 10 ks −15 %, atd. |
| 12 | **Push notif infra** | ❌ jen `push_enabled` flag | Firebase admin SDK, registrace tokenu, broadcast služba |

---

## P2 — Růstové / revenue features

| # | Co | Stav | Akce |
|---|---|---|---|
| 13 | **Marketplace Ads (CPC)** | ❌ | Sponsored slots na homepage + kategorii, self-serve dashboard, billing |
| 14 | **Tier systém pořadatelů (1–4)** | ❌ | Auto-approve podle tieru, limity tix/akce, upgrade na základě objemu |
| 15 | **Sub-účty s rolemi** | ❌ | Box office, entry staff, akreditační manager — RBAC + invite flow |
| 16 | **Personalizované vstupenky** | ❌ | Per-ticket jméno (povinné/volitelné), tisk na PDF, scanner check |
| 17 | **Apple Pay / Google Pay native** | ❌ | Stripe Payment Request API v checkoutu (po P0) |
| 18 | **Twisto / payment plan** | 🟡 jen UI shell `/api/admin/events/[id]/payment-plans` | Splátkový engine, cron strhávání, grace period, auto-cancel |
| 19 | **Benefitní systémy** | ❌ | Pluxee + Benefit Plus + Gallery Beta — redirect flow + callback |
| 20 | **Dynamický barcode (anti-screenshot)** | 🟡 statický TOTP v PDF | Mobile-only rotující QR (TOTP 30s window), scanner tolerance ±1 |
| 21 | **WYSIWYG email editor** | 🟡 templates per promoter, ne editor | TipTap / Unlayer + variable insertion + preview |

---

## P3 — Vertikály a edge cases

| # | Co | Stav | Akce |
|---|---|---|---|
| 22 | **Timed entry (muzeum/ZOO/hrad)** | ❌ | Slot generator, kapacita per slot, buffer, kalendář-picker UI |
| 23 | **Bank transfer matching** | ❌ | Variabilní symbol generátor, KB/ČS API, auto-pair, manuální fallback |
| 24 | **Chargeback workflow** | 🟡 typ existuje, no flow | Stripe webhook `charge.dispute.*`, holdback v settlement |
| 25 | **Re-entry + exit scan** | 🟡 gates CRUD, no logic | Exit scan endpoint, časový limit, multi-entry counter |
| 26 | **Loyalty program** | ❌ | Body za nákup, tier/level, redemption v checkout |
| 27 | **Akreditace** | ❌ | Žádost → schvalování → akreditační průkaz s odlišným QR |
| 28 | **AI generování popisů akcí** | ❌ | Anthropic API: keywords → popis, šablony per kategorie |

---

## Doporučené pořadí implementace

**Sprint 1 (2 týdny)** — P0 #1, #2 → reálný launch-ready stav
- Stripe integrace s 3DS + webhook + idempotency
- Resend SMTP + transactional šablony

**Sprint 2** — P1 #5, #6, #7 → reklamace bez supportu
- Self-service refund UI + částečná refundace + transfer

**Sprint 3** — P0 #3, #4 + P1 #8 → škálování + UX
- Real SMS, hCaptcha, SSE real-time seats

**Sprint 4+** — výběr z P2 podle business priority (revenue: Marketplace Ads, retention: Loyalty, B2B: Sub-účty)

---

## Co NEdělat (mimo scope MVP)

- Multi-currency settlement (zůstaneme CZK-only)
- Camping / RFID cashless (je to vlastní produkt)
- Native iOS/Android scanner app (PWA stačí)
- Multi-stage festival management v plné šíři (festival = jeden event s více dny)
