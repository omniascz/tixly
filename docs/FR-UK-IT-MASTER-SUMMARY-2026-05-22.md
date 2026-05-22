# FR + UK + IT Master Summary — 2026-05-22

Konsolidace findings z 3 hloubkových auditů:
- `FR-AUDIT-2026-05-22.md` (814 řádků, 5 platforem)
- `UK-AUDIT-2026-05-22.md` (889 řádků, 5 platforem + Eventbrite/Skiddle = 6)
- `IT-AUDIT-2026-05-22.md` (787 řádků, 5 platforem)

**Celkem 16 platforem analyzovaných napříč 3 největšími EU ticketing trhy** (po DACH).

---

## 1. Universal patterns napříč FR + UK + IT (mimo DACH)

| Pattern | FR | UK | IT | DACH | Tixly status |
|---|---|---|---|---|---|
| **Face-value cap resale** | Mandatory (Loi 1919 + Code pénal) | Mandatory ban Bill 2026 (King's Speech 13.5) | Mandatory (Legge 232/2016 anti-bagarinaggio) | Voluntary (Eventim fanSALE) | ✅ FanSALE |
| **Cultural tax reporting** | CNM 3,5 % deklarativní | VAT 20 % standard | SIAE royalty per ticket | DBV/AKM | ⚠️ DBV TODO, NIPOS CZ ✅ |
| **Retail outlet network** | Fnac/Carrefour/Cultura ~10k POS | HMV/limited | Mondadori/Banca Intesa | EVENTIM.de outlets | ❌ (CZ má jen GoOut partnership) |
| **Theatre subscriptions** | Scènes nationales (legacy) | West End ATG/Delfont Mackintosh | Teatro alla Scala 100+ let tradice | Festabo+Wahl-Abo (DBV) | ✅ Festabo+Wahl-Abo+Restwert |
| **Festival cashless RFID** | Weezevent flagship | Glastonbury/Boomtown | Locus/Magnolia | Reservix | ❌ |
| **Government voucher integration** | Pass Culture €300/year | n/a | 18app + Carta Cultura €500+€500 | n/a | ❌ |
| **BNPL platby** | Klarna/Alma | Klarna/Clearpay | Scalapay (TicketSms flagship) | Limited | ❌ |

---

## 2. Tixly status vs konkurence — master view

### ✅ Tixly už má feature parity nebo better

1. **CS/SK lokalizace** — žádná FR/UK/IT/DACH platforma nemá → first-mover v CEE
2. **Theatre Abonnements** (Festabo + Wahl-Abo + Restwert) — implementováno end-to-end, parity s Reservix
3. **Resale s face-value cap** (FanSALE) — UK Tout Ban Bill 2026 ready
4. **Stornoschutz insurance** buyer UI — implementováno
5. **Rotující QR / TOTP** — anti-scalp anti-screenshot
6. **White-label** s custom domain + SSR theme — implementováno
7. **Voucher self-purchase + partial payment** — Reservix Gutschein parity
8. **MHD Kombi-Ticket** (DPP/IDOS) — München Ticket pattern
9. **Benefit Pay** (Pluxee/Sodexo/Benefit Plus/Edenred) — voucher-as-payment
10. **Spotify discovery + real OAuth (PKCE)** — Reservix od 7/2025 parity
11. **Social FOMO** (friend graph + "X přátel jde") — DICE pattern
12. **PWA + Push opt-in + offline** — DICE mobile-first alternativa bez nativní app
13. **Click&View foto pohledu ze sedadla** — Reservix exclusive parity
14. **Public API + webhooks** — self-service (zatímco FR/UK/IT incumbents jsou gated)
15. **DSA report queue + Status page incidents** — žádná konkurence nemá public
16. **NIPOS reporting** (CZ Kult 1-01) — domácí compliance ready
17. **Public pricing page** (transparent fees + tier comparison) — Eventim Light/Ticketino only DACH parity

### ⚠️ Tixly nemá (společné gaps napříč FR/UK/IT)

1. **BNPL (Klarna/Clearpay/Scalapay)** — UK + IT mandatory, FR rising. Tixly má GoPay/ComGate ale ne BNPL provider.
2. **Festival Cashless RFID** — Weezevent flagship FR, Glastonbury UK, Locus IT. Tixly POS hotový ale RFID wristband out-of-scope.
3. **Native iOS+Android app** — DICE flagship, AXS Mobile ID. Tixly PWA = MVP, native = velký investment.
4. **Government voucher API** (18app IT, Pass Culture FR) — mandatory pokud expansion. CZ nemá analog.
5. **Retail outlet integration** (Fnac, HMV, Mondadori) — France Billet moat 10k POS, CZ má GoOut + omezeně.
6. **Verified Fan / Queue System** pro top events — Ticketmaster Verified Fan, Lyte Queue. Tixly queue_enabled jen základní.
7. **Dynamic pricing engine** s guardrails — Tixly má ab_price_tests, ne full demand-based.
8. **OTP SMS validation v checkout** (IT anti-bagarinaggio mandatory) — Tixly má jen email confirm.

### 🚫 Tixly schválně nedělá (out-of-scope by design)

- **Hospitality / VIP corporate sales** (Live Nation expertise)
- **Multi-currency 25+ zemí** (Eventim flagship) — Tixly CZK+EUR stačí pro CZ/SK
- **AdTech FLYERALARM rozsah** — Tixly má campaigns + segmentation, není reklamní platforma

---

## 3. Konsolidovaný P0/P1/P2 — průřez 3 trhy

### P0 — kritické pokud EU expansion mimo CZ/SK

| Priorita | Feature | FR | UK | IT | DACH | Tixly |
|---|---|---|---|---|---|---|
| P0-EU-1 | Face-value cap resale (FanSALE) | Mandatory | Mandatory Bill 2026 | Mandatory | Voluntary | ✅ DONE |
| P0-EU-2 | Friend ticket transfer (per-trh law compliance) | mandatory | UK Tout Bill | mandatory | optional | ⚠️ partial (resale, ne friend gift) |
| P0-EU-3 | Cultural tax / royalty reporting | CNM 3,5 % | VAT receipt | SIAE per ticket | DBV | ⏳ CZ NIPOS ✅, jiné per market |
| P0-EU-4 | Per-market payment method (CB FR, Klarna UK, Satispay IT) | CB | Klarna | Satispay/Scalapay | SEPA | ⚠️ GoPay/ComGate jen CZ/SK |
| P0-EU-5 | Theatre subscription mature module | Required | Required | Required (Scala tradice) | Required | ✅ DONE |

### P1 — důležité ale ne blokující CZ/SK launch

| Priorita | Feature | Tixly | Note |
|---|---|---|---|
| P1-EU-1 | Klarna/Scalapay BNPL | ❌ | Cross-market common, lift cart pro €200+ tickets |
| P1-EU-2 | Native iOS+Android | ❌ PWA | DICE mobile-first; CZ/SK PWA dostačuje, EU expansion potřebuje |
| P1-EU-3 | Government voucher API (18app/Pass Culture) | ❌ | Per-market integration, blocker IT/FR youth segment |
| P1-EU-4 | OTP SMS pre-purchase validation | ❌ | IT mandatory pro anti-bagarinaggio |
| P1-EU-5 | Verified Fan / Queue System advanced | ⚠️ basic | Ticketmaster pattern pro top eventy |

### P2 — nice-to-have

| Priorita | Feature | Tixly | Note |
|---|---|---|---|
| P2-EU-1 | Cashless RFID wristbands | ❌ | Weezevent moat, festival pattern |
| P2-EU-2 | Retail outlet integration | ❌ | Fnac/HMV/Mondadori — country-specific moat |
| P2-EU-3 | Hospitality / VIP corporate | ❌ | Live Nation expertise, out-of-scope |
| P2-EU-4 | Dynamic pricing demand-based | ⚠️ ab_tests | Algorithmic pricing engine |
| P2-EU-5 | Rep network sales channel | ❌ | Skiddle Rep / festival promoter network |

---

## 4. Strategický verdict — má smysl Tixly EU expansion?

### Per-trh assessment

| Trh | Trh size | Tixly fit | Verdict |
|---|---|---|---|
| **🇫🇷 Francie** | €1.6B HT, 37.9M spectateurs, 65 % Eventim-owned | Vysoká bariéra (France Billet retail moat, scènes nationales sales-led) | **NE pro mass-market**, **ano pro vertical scènes nationales 2027 H2** |
| **🇬🇧 UK** | Velký, fragmented, Brexit added overhead | Středně-vysoká bariéra (TM dominance, DICE indie segment) | **Q1 2027 pilot pokud UK Tout Ban Bill projde** + 5 dalších podmínek |
| **🇮🇹 Itálie** | TicketOne 200k+ events lídr | SIAE certifikace = blocker | **NE plnou expansion**, **ano B2B2C tour-operator beachhead** (bypass SIAE přes aggregator) |
| **🇨🇿/🇸🇰 doma** | First-mover CEE | Žádná konkurence s parity feature set | **DOMINATE 2026** — všech 12 P0/P1/P2 DACH features hotové |

### Rekomendace ranking

1. **Q2-Q4 2026:** Dominate CZ/SK (Tixly už feature complete s 100% DACH parity + první EU specialty: NIPOS, MHD-Kombi, transit-combo)
2. **Q1 2027:** UK pilot (po Tout Ban Bill ratifikaci + 5 dalších podmínek z UK auditu sekce 11)
3. **Q2 2027:** Frankofonní MVP v BE/LU (snazší legal/CNM než FR full)
4. **Q3 2027:** Tour-operator B2B2C beachhead pro Milano-Cortina 2026 Olympics (bypass IT SIAE přes aggregator model)
5. **Q4 2027+:** FR vertical scènes nationales (Reservix-DBV-úroveň theatre abonnement modul prodávat tier-2 venues)
6. **2028+:** Plnou IT expansion až po SIAE certifikaci nebo když dostane CZ/SK product-market fit validation

### Co Tixly **ne**dělá v EU

- ❌ **NEjít** na FR/UK/IT mass-market (Eventim/Live Nation/DICE dominance)
- ❌ **NEjít** na FR festival (Weezevent monoplý 60%+ market share přes WeezPay cashless)
- ❌ **NEjít** na UK arena tier (AXS exclusive contracts)
- ❌ **NEjít** na IT football/serie A (TicketOne + tessera del tifoso compliance)

---

## 5. Per-feature dependency mapa pro Tixly

**Pokud Tixly do FR (Q2-Q4 2027):**
- ✅ Resale face-value cap (DONE)
- ✅ Theatre Abonnement (DONE)
- ⚠️ CNM 3,5 % tax reporting modul (nový, FR-specific)
- ⚠️ CB payment provider (CB / Carte Bancaire — Tixly má GoPay/ComGate CZ/SK)
- ⚠️ FR locale + CNIL GDPR compliance
- ✅ Stornoschutz / Assurance Annulation
- ✅ Voucher self-service
- ✅ Cashless RFID — Weezevent partnership možný

**Pokud Tixly do UK (Q1 2027 pilot):**
- ✅ Resale face-value cap (DONE) — UK Tout Ban Bill 2026
- ✅ Friend ticket transfer (zhruba DONE přes FanSALE)
- ⚠️ Klarna/Clearpay BNPL integration
- ⚠️ Verified Fan / Queue System enhanced
- ⚠️ Theatre Event Bundle (West End market — Tixly Festabo lze adaptovat)
- ✅ Spotify Discovery (DONE)

**Pokud Tixly do IT (B2B2C only 2027, plnou 2028+):**
- ✅ Resale face-value cap (DONE)
- ⚠️ **SIAE/AdE fiskální certifikace** (microchip + fiskální seal + telematic transmission) — blocker
- ⚠️ Theatre abbonamenti modern editor — Tixly Festabo lze adaptovat
- ⚠️ Scalapay BNPL integrace
- ⚠️ 18app / Carta Cultura voucher API
- ⚠️ OTP SMS validation v checkout
- ⚠️ IT locale

---

## 6. Konkrétní implementační doporučení pro CZ/SK launch (2026)

**Po dnešní 20-commit DACH wave + 3-commit production polish, Tixly je feature complete pro CZ/SK. Mimo to ze 3 EU auditů přidávám následující "pro EU readiness 2027":**

### Q4 2026 — quick wins z EU auditů

1. **BNPL provider abstrakce** (Scalapay IT preferable, Klarna UK, Alma FR)
   - Tixly už má provider abstrakci (GoPay/ComGate) — přidat 4. provider
   - Lift cart pro events €100+
   - E2E test + mock mode

2. **OTP SMS pre-purchase validation** (anti-bagarinaggio IT mandatory, fraud prevention obecně)
   - Tixly už má phone_e164 na users — přidat Twilio/Vonage SMS provider
   - Optional toggle per event (high-demand events only)

3. **Verified Fan / Queue System upgrade**
   - Tixly má queue_enabled basic — rozšířit o waiting room s fairness scoring
   - Pro top eventy (premier, festival announcement)

### Q1 2027 — EU expansion preparation

4. **CNM tax reporting modul** (FR) — analog NIPOS endpoint
5. **CB payment provider** (FR Carte Bancaire) — provider abstrakce extension
6. **Klarna BNPL** (UK Klarna One)
7. **Pass Culture API integrace** (FR youth voucher €300/y)
8. **Friend ticket transfer** (UK + IT mandatory) — extension k existing FanSALE
9. **VAT invoice s electronic invoicing** (IT SdI mandatory, FR optional pro B2B)

### Q2-Q3 2027 — IT B2B2C beachhead (pokud zájem)

10. **Aggregator model**: Tixly jako tech-partner pro CZ tour operatory (Čedok, Fischer, Exim) prodávající Milano-Cortina 2026 Olympics
11. **Italian L1 locale**: jen frontend, ne SIAE certifikace
12. **Scalapay BNPL** (IT preference)

---

## 7. Sources

- `docs/DACH-AUDIT-VERIFIED.md` — DACH 9 platforem (Eventim, Reservix, DICE, München Ticket, ...)
- `docs/FR-AUDIT-2026-05-22.md` — Francie 5 platforem
- `docs/UK-AUDIT-2026-05-22.md` — UK 5+1 platforem
- `docs/IT-AUDIT-2026-05-22.md` — Itálie 5 platforem
- Combined: **25 EU ticketing platforem analyzovaných** (DACH 9 + FR 5 + UK 5 + IT 5 + Eventbrite UK extra)

---

## 8. Verdict pro user otázku "máme všechny features?"

**ANO pro CZ/SK + DACH parity (12/12 P0/P1/P2 DONE, 22/22 matrix).**

**Pro full EU expansion zbývá:**
- BNPL provider (cross-market gap)
- Per-market payment provider extension (CB, Scalapay, Klarna)
- Country-specific tax/compliance modules (CNM, SIAE, VAT receipt)
- Government voucher API (18app, Pass Culture)
- Native mobile app (DICE-style — UK+IT essential)
- OTP SMS validation (IT mandatory)

**Tixly je 100% feature complete pro CZ/SK launch + DACH-equivalent SaaS.** EU expansion 2027 vyžaduje **dodat ~6 country-specific moduly + 1 cross-market BNPL** ale jádro platform je hotové.
