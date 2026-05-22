# Tixly CZ trh — priority ranking features z FR/UK/IT auditů

Z 8 cross-market gaps + 3 mid-impact features identifikovaných v master summary,
**seřazeno podle relevance pro CZ trh + Tixly current architecture**.

Skóre: **Impact × (1 / Effort)** = ROI ranking. Vyloučeno co je výhradně country-specific (CNM FR, SIAE IT, Pass Culture, 18app, CB Carte Bancaire).

---

## 🥇 TOP TIER — vysoký impact, nízký/střední effort (Q4 2026)

### #1 — Friend ticket transfer s face-value enforcement
- **Impact:** 🔥🔥🔥 Vysoký — EU Directive coming, UK Tout Ban Bill 2026 už ratified, IT Legge 232/2016, FR Code pénal. Tixly FanSALE už má anti-scalping, friend transfer je natural extension.
- **CZ relevance:** CZ trh roste s top events (O2 Aréna sold-out koncerty), buyer chce dát lístek příteli bez prodat — bez face-value cap by se to mohlo zneužít.
- **Effort:** 🟢 LOW — rozšíření existující FanSALE logiky o "no payment" varianta s recipient email + email confirm.
- **Tixly status:** ⚠️ Partial — FanSALE má face-value cap, ale friend gift transfer není separate flow.
- **ROI:** 9/10.

### #2 — BNPL (Twisto / Skip Pay) provider abstrakce
- **Impact:** 🔥🔥🔥 Vysoký — UK Klarna +30% cart hodnota, IT Scalapay +25%. CZ ekvivalent **Twisto** (Mastercard owned) + **Skip Pay** (ČSOB) má 1M+ uživatelů.
- **CZ relevance:** Festivalové permanentky 3-5k Kč, abonementy 2-10k Kč, family tickets — splátky odbourávají barriér.
- **Effort:** 🟡 MEDIUM — Tixly už má provider abstrakci (GoPay/ComGate), Twisto API je REST + webhook. ~3-5 dní práce.
- **Tixly status:** ❌ Není.
- **ROI:** 8/10.

### #3 — OTP SMS validation v checkout (anti-bot)
- **Impact:** 🔥🔥 Střední — anti-scalping + anti-bot prevention. CZ events s vysokou poptávkou (Karel Gott reissue, Roxette, Helena Vondráčková) mají bot problém.
- **CZ relevance:** IT mandatory (anti-bagarinaggio), CZ by mělo voluntary toggle per event "vyžadovat SMS verifikaci".
- **Effort:** 🟢 LOW — Tixly už má `users.phone_e164` field, SMS provider (Twilio/Vonage/CZ Vivantis) integrace ~1-2 dny.
- **Tixly status:** ❌ Není (jen email confirmation).
- **ROI:** 7/10.

### #4 — Verified Fan / Queue System upgrade
- **Impact:** 🔥🔥 Střední — pro top eventy (Slavia/Sparta derby, festival announcement, Vondráčková farewell tour). TM Verified Fan pattern + Lyte Queue.
- **CZ relevance:** O2 Aréna, Sazka, Tipsport — top eventy mají bot scalping. Queue + Verified Fan filtruje genuine buyers.
- **Effort:** 🟡 MEDIUM — Tixly má `queue_enabled` basic, rozšířit o waiting room s fairness scoring + Verified Fan opt-in.
- **Tixly status:** ⚠️ Basic queue, není Verified Fan pre-registration.
- **ROI:** 7/10.

---

## 🥈 SECOND TIER — středně-vysoký impact, středně náročný (Q1-Q2 2027)

### #5 — Group bookings + payment splitting
- **Impact:** 🔥🔥 Střední — DICE flagship, +20% conversion na klubových a festivalových akcích (party 4-8 lidí).
- **CZ relevance:** Kluby (Lucerna, Rock Café, Roxy), festivaly (Beats for Love, Rock for People) — buyer organizuje skupinu, ale platba se rozděluje.
- **Effort:** 🟡 MEDIUM — extension orders schema (parent_order_id + split shares), Stripe Connect / GoPay split possible.
- **Tixly status:** ❌ Není (jen single-payer + holder_names array).
- **ROI:** 6/10.

### #6 — Loyalty / cashback (Eventim FanBonus / OVO Live pattern)
- **Impact:** 🔥🔥 Střední — repeat customer retention. Eventim FanBonus má 4M+ users.
- **CZ relevance:** O2 Family / Sazka karta — partner program možný. Buyer dostane bonus po N nákupech.
- **Effort:** 🟡 MEDIUM — nový schema `marketing.loyalty_points`, redemption flow v checkout, partner API.
- **Tixly status:** ❌ Není.
- **ROI:** 6/10.

### #7 — Dynamic pricing demand-based engine
- **Impact:** 🔥🔥 Střední — revenue lift +5-15% (Eventim, AXS reporting). Pro venues s velkou kapacitou (O2 Aréna 20k seats) je critical.
- **CZ relevance:** Top eventy v O2 Aréně, Tipsport, Slavia, Sazka. Dynamic pricing s buyer-friendly guardrails (ne over Ticketmaster excess).
- **Effort:** 🟡 MEDIUM — Tixly už má `ab_price_tests` schema, doplnit time-based + occupancy-based formuly.
- **Tixly status:** ⚠️ A/B price tests existují, ne full algorithmic engine.
- **ROI:** 6/10.

---

## 🥉 THIRD TIER — středně-nízký impact nebo vysoký effort (2027 H2+)

### #8 — Festival cashless RFID wristbands (Weezevent pattern)
- **Impact:** 🔥🔥🔥 Vysoký pro festivaly — Weezevent monopol FR. CZ festivals (Colours of Ostrava, Rock for People, Beats for Love) by chtěly.
- **CZ relevance:** 5-10 velkých CZ festivalů. Cashless RFID = revenue lift +25% bar/food + UX upgrade.
- **Effort:** 🔴 HIGH — HW partnership s RFID provider (Intellitix, Glownet), per-event setup, multi-day wallet management.
- **Tixly status:** ❌ Není (POS existuje, ne RFID).
- **ROI:** 5/10 — high impact ale enterprise sales motion, ne SaaS.

### #9 — Tickets for Good charity allocation API
- **Impact:** 🔥 Nízký-střední — PR+brand value. UK Tickets for Good UK launched 02/2026, AXS partnership.
- **CZ relevance:** CZ charity (Linka bezpečí, Paměť národa) by mohla dostat unsold tickets. Promotér tax write-off.
- **Effort:** 🟢 LOW — new endpoint pro charity-flagged tickets, redemption flow.
- **Tixly status:** ❌ Není.
- **ROI:** 5/10.

### #10 — Skiddle Rep network sales channel
- **Impact:** 🔥 Nízký-střední — affiliate sales pro indie kluby/festivaly.
- **CZ relevance:** CZ má méně rep/affiliate kulturu než UK, ale promoter network (Heart of Noise, Forbidden Sounds) by mohlo využít.
- **Effort:** 🟢 LOW — affiliate codes + tracking + payout per ticket sold.
- **Tixly status:** ❌ Není.
- **ROI:** 4/10.

### #11 — Native iOS+Android mobile app
- **Impact:** 🔥🔥🔥 Vysoký dlouhodobě — DICE flagship, AXS Mobile ID.
- **CZ relevance:** Buyer expectations sice rostou, ale Tixly PWA je dostačující MVP. Native app vyžaduje deeper iOS Wallet + Apple Pay v1 + push.
- **Effort:** 🔴 VERY HIGH — React Native / Capacitor rebuild, App Store + Google Play submission, dual codebases maintenance.
- **Tixly status:** ⚠️ PWA implementováno (install prompt + offline + push).
- **ROI:** 4/10 — high impact ale enormous effort, PWA postačí pro 2026.

### #12 — Retail outlet integration (GoOut / Ticketportal partnership)
- **Impact:** 🔥 Nízký-střední — CZ má méně retail-driven sales než FR/IT. GoOut + Ticketportal jediná možnost.
- **CZ relevance:** Existuje, ale CZ trh přechází na online; retail klesající trend.
- **Effort:** 🟡 MEDIUM — partnership negotiation + API integration per partner.
- **Tixly status:** ❌ Není.
- **ROI:** 3/10.

---

## 🚫 OUT-OF-SCOPE pro CZ trh (country-specific)

| Feature | Důvod proč ne pro CZ |
|---|---|
| SIAE/AdE fiskální certifikace | IT-only, blocker tam, irrelevant CZ |
| CNM 3,5 % taxe sur les spectacles | FR-only government tax |
| CB / Carte Bancaire payment | FR-specific payment scheme |
| Pass Culture API integrace | FR government youth voucher €300/y, CZ analog neexistuje |
| 18app + Carta Cultura | IT government voucher €500+€500, CZ analog neexistuje |
| Tessera del tifoso compliance | IT football-specific |
| Klarna BNPL specifically | UK preferred — CZ má Twisto (lepší fit) |
| Scalapay BNPL specifically | IT preferred — CZ má Twisto / Skip Pay |
| Alma BNPL specifically | FR preferred — CZ má Twisto / Skip Pay |
| AXS-style only-app Mobile ID | Vyžaduje native app + AEG-level event scale |
| Hospitality / VIP corporate | Live Nation / TM expertise |

---

## Doporučená implementační roadmap pro CZ

### Q4 2026 (Tixly už feature complete pro CZ launch, polish phase)
1. **Friend ticket transfer** s face-value enforcement (#1)
2. **Twisto / Skip Pay BNPL** provider abstrakce (#2)
3. **OTP SMS validation** v checkout (toggle per event) (#3)

### Q1 2027 (early growth, top-tier events)
4. **Verified Fan / Queue System** upgrade (#4)
5. **Group bookings + payment splitting** (#5)
6. **Dynamic pricing engine** rozšíření z A/B testů (#7)

### Q2-Q3 2027 (mid-term, festival expansion)
7. **Festival cashless RFID** pilot s 1-2 CZ festivaly (#8)
8. **Loyalty / cashback** program (#6)

### Q4 2027+ (long-tail, opportunistic)
9. **Tickets for Good** charity allocation (#9)
10. **Skiddle Rep** affiliate network (#10)

### NE pro 2026-2027
- Native iOS+Android app (#11) — PWA dostačuje, ROI nestojí za effort
- Retail outlet integration (#12) — CZ trend opačný

---

## Souhrn tabulkou

| # | Feature | Impact CZ | Effort | ROI | Quarter |
|---|---|---|---|---|---|
| 1 | Friend ticket transfer (face-value) | 🔥🔥🔥 | 🟢 | 9/10 | Q4 2026 |
| 2 | Twisto/Skip Pay BNPL | 🔥🔥🔥 | 🟡 | 8/10 | Q4 2026 |
| 3 | OTP SMS validation | 🔥🔥 | 🟢 | 7/10 | Q4 2026 |
| 4 | Verified Fan / Queue upgrade | 🔥🔥 | 🟡 | 7/10 | Q1 2027 |
| 5 | Group bookings + payment splitting | 🔥🔥 | 🟡 | 6/10 | Q1 2027 |
| 6 | Loyalty / cashback | 🔥🔥 | 🟡 | 6/10 | Q2 2027 |
| 7 | Dynamic pricing engine | 🔥🔥 | 🟡 | 6/10 | Q1 2027 |
| 8 | Festival cashless RFID | 🔥🔥🔥 | 🔴 | 5/10 | Q3 2027 |
| 9 | Tickets for Good charity | 🔥 | 🟢 | 5/10 | Q4 2027 |
| 10 | Skiddle Rep affiliate | 🔥 | 🟢 | 4/10 | 2028 |
| 11 | Native iOS+Android app | 🔥🔥🔥 | 🔴 | 4/10 | — |
| 12 | Retail outlet integration | 🔥 | 🟡 | 3/10 | — |

---

## TL;DR

**Pro CZ trh tři quick-wins do Q4 2026 (low effort + high impact):**
1. Friend ticket transfer (rozšíření FanSALE)
2. Twisto/Skip Pay BNPL (provider abstrakce extension)
3. OTP SMS validation v checkout

**Mid-term 2027:**
- Verified Fan, Group splitting, Loyalty, Dynamic pricing engine, Festival RFID

**Out-of-scope:**
- Native app (PWA stačí), Retail outlets (trend opačný), všechny FR/UK/IT government voucher / tax / payment scheme integrace.
