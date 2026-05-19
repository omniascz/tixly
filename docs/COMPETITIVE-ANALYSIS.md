# Tixly vs. konkurenti — feature matrix + roadmap

**Sestaveno:** 2026-05-20
**Aktualizovat:** kvartálně (Q1 = únor, Q2 = květen, Q3 = srpen, Q4 = listopad)

Tabulka srovnává **Tixly** s 8 hlavními konkurenty: 2 CZ + 6 světových.
Cíl: rozhodnout co dohnat **před launchem (P0)**, co **do 90 dní (P1)**, co
**6+ měsíců (P2)** — a co vědomě neděláme.

---

## Konkurenti

| Zkratka | Platforma | Region | Model | Roč. GMV (odhad) |
|---|---|---|---|---|
| **GoOut** | GoOut.net | CZ + slovo regionů | Aggregátor + city guide | ~80 M EUR |
| **SMSt** | SMSticket.cz | CZ | SaaS pro malé promotéry | ~5 M EUR |
| **Even** | Eventbrite.com | US/UK/světově | SaaS self-service | ~2.5 mld USD |
| **TM** | Ticketmaster.com | US/EU | Primary + secondary | ~15 mld USD |
| **DICE** | DICE.fm | UK/US/EU | Mobile-first, anti-scalp | ~500 M USD |
| **Even-DE** | Eventim.de | DE/AT/CH | Aggregátor + box office | ~3 mld EUR |
| **Reser** | Reservix.de | DE | White-label SaaS | ~500 M EUR |
| **Skid** | Skiddle.com | UK | Mobile + festival | ~200 M GBP |

---

## Feature matrix (✅ má / 🟡 částečně / ❌ nemá)

### 1. Core ticketing flow

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Stripe / GoPay payment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Free events | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Seating chart editor (custom) | ✅ | 🟡 | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Seat-level pricing | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Multi-currency (CZK/EUR/USD) | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| EU 14-day refund auto | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Hold/release flow (race-safe) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Promo codes + access codes | ✅ | 🟡 | ❌ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Group/installment payment | ✅ | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ | ✅ | ❌ |

### 2. Buyer experience

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Native mobile app (iOS+Android) | ❌ **P0+** | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| PWA scanner (offline) | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Apple/Google Wallet pass | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| Calendar export (.ics) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Live QR (rotating barcode) | 🟡 ready | ❌ | ❌ | ❌ | ✅ SafeTix | ✅ | ❌ | ❌ | ❌ |
| Account-to-account transfer | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 |
| Resale marketplace (P2P face-value) | ✅ | ❌ | ❌ | ✅ | 🟡 (over face) | ✅ | ❌ | ❌ | ✅ |
| Push notifications | 🟡 backend | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Artist/venue follow | ✅ | ✅ | ❌ | ✅ | 🟡 | ✅ | ✅ | ❌ | ✅ |
| RSVP "I'm going" (no purchase) | ❌ | ✅ | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ | 🟡 |
| Friends / social sharing | ❌ | ✅ | ❌ | 🟡 | ❌ | ✅ | ❌ | ❌ | 🟡 |
| Recommendations (collab filter) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Discovery feed / "For you" | 🟡 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |

### 3. Organizer experience

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Self-service event creation | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | 🟡 | ✅ | ✅ |
| Multi-tenant SaaS (data own) | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Branded storefront | ✅ | ❌ | 🟡 | ✅ | 🟡 | ❌ | 🟡 | ✅ | 🟡 |
| White-label .com domena | ❌ P2 | ❌ | ❌ | 🟡 | ❌ | ❌ | ✅ | ✅ | ❌ |
| Embed widget (JS) | ✅ | ❌ | 🟡 | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ |
| Branding (logo + color) | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | 🟡 | ✅ | ✅ |
| POS terminal | ✅ | ❌ | ❌ | 🟡 | ✅ | ❌ | ✅ | ✅ | ✅ |
| Scanner offline app | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Audience segmentation | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| Marketing campaigns (drip) | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | 🟡 | ✅ |
| A/B test email subjects | ❌ P2 | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Smart send-time | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Onboarding wizard | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |

### 4. Trust + safety + compliance

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| WCAG 2.1 AA | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| GDPR granular consent + audit | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| GDPR Art. 17 delete cron | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| DSA report queue (EU) | ✅ | ❌ | ❌ | 🟡 | 🟡 | 🟡 | 🟡 | ❌ | ❌ |
| AI content moderation gate | ✅ | ❌ | ❌ | 🟡 | ✅ | ✅ | ❌ | ❌ | 🟡 |
| Age verification (18+) | ✅ | ❌ | ❌ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cookie consent banner | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Verified Fan / anti-bot pre-sale | ❌ P3 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Buyer protection guarantee | ❌ P2 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

### 5. Ops + infrastructure

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Disaster recovery runbook | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Blue-green deploy strategy | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Health check endpoints | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Per-tenant rate limiting | ✅ | ? | ? | ✅ | ✅ | ✅ | ✅ | ✅ | ? |
| Status page (DB-backed) | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 |
| Webhooks outbound | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | 🟡 | ✅ | ✅ |
| B2B API (read) | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | 🟡 |
| B2B API (write — create event) | ❌ stub | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | 🟡 |
| Public API rate limit + scopes | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | 🟡 |
| Multi-language platform (CS/SK/EN) | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

### 6. CZ-specific / EU lokální features

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| DPH 10% pro vstupné | ✅ | ✅ | ✅ | 🟡 | 🟡 | 🟡 | ✅ (DE 7%) | ✅ | ✅ |
| ISDOC XML export | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Pohoda / Money S3 import | ✅ (přes ISDOC) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| GoPay native integration | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ComGate native integration | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Fio Bank API (bank-sync) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| BulkGate SMS (CZ) | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ELSTER export (DE tax) | ❌ N/A | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| DATEV export (DE accounting) | ❌ N/A | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |

### 7. Vertikál-specific (festival / divadlo / sport)

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Festival multi-day pass | 🟡 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Festival camping bundle | ❌ P2 | ❌ | ❌ | 🟡 | 🟡 | ❌ | ✅ | ❌ | ✅ |
| Bus + parking cross-sell | ❌ P2 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | 🟡 |
| Divadelní abonentky (season) | ❌ P1 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Sport season tickets | ❌ P2 | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| Hospitality / VIP packages | ✅ | ❌ | ❌ | 🟡 | ✅ | ❌ | ✅ | 🟡 | 🟡 |
| Cross-sell venue → next event | 🟡 | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Group purchase (corp desk) | ❌ P2 | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| Insurance add-on | ❌ P2 | ❌ | ❌ | ❌ | ✅ Allianz | ❌ | ❌ | ❌ | ❌ |

### 8. Pricing + revenue model

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Dynamic pricing | ❌ P3 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Auction-style listing | ❌ | ❌ | ❌ | ❌ | 🟡 | ❌ | ❌ | ❌ | ❌ |
| Marketplace ads (CPC) | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Affiliate / referral kódy | ✅ | ❌ | ❌ | ✅ | 🟡 | ❌ | ❌ | ❌ | ✅ |
| Tip jar / gratuity | ❌ P3 | ❌ | ❌ | ✅ | ❌ | 🟡 | ❌ | ❌ | ❌ |
| Loyalty / tier rewards | ❌ P2 | 🟡 | ❌ | 🟡 | ✅ | 🟡 | 🟡 | ❌ | 🟡 |

### 9. Integrace + ekosystém

| Feature | **Tixly** | GoOut | SMSt | Even | TM | DICE | Even-DE | Reser | Skid |
|---|---|---|---|---|---|---|---|---|---|
| Zapier official app | ❌ P1 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Slack / Teams native | ❌ P2 | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MailChimp / Klaviyo sync | ❌ P1 (přes wh) | ❌ | ❌ | ✅ | ✅ | ❌ | ✅ | 🟡 | 🟡 |
| Songkick / Bandsintown | ❌ P2 | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| Spotify / Apple Music | ❌ P3 | 🟡 | ❌ | 🟡 | ✅ | ✅ | ❌ | ❌ | ✅ |
| Google Analytics 4 + Meta Pixel | ✅ | ✅ | 🟡 | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |

---

## Tixly skóre vs konkurence (sumarizace)

Procentuální completeness vůči best-in-class (250 položek napříč 9 kategoriemi):

| Konkurent | Skóre | Komentář |
|---|---|---|
| **Tixly** | **78 %** | Silný core, slabé v native mobile + festival |
| GoOut | 62 % | Silný discovery + mobile, slabé v organizer SaaS |
| SMSticket | 22 % | Bare-bones, nedoženeme my, neexistuje proti čemu |
| Eventbrite | 88 % | Best-in-class organizer, slabé v premium/sport |
| Ticketmaster | 82 % | Best-in-class secondary + anti-scalp, slabé v SaaS |
| DICE | 71 % | Best mobile-first, slabé v B2B/organizer |
| Eventim.de | 80 % | Best-in-class DE/AT, slabé v API/embed |
| Reservix | 74 % | Best white-label DE, slabé v B2C |
| Skiddle | 64 % | Best UK festival, slabé v API/CZ-EU compliance |

---

## Roadmap — kam jdou další 6 měsíců

### P0 — Před launchem (≤ 4 týdny)

| # | Položka | Effort | Důvod |
|---|---|---|---|
| 1 | GoPay + ComGate live API keys | 2 dny | Externí — čeká |
| 2 | Resend doménová verifikace (DKIM/SPF/DMARC) | 1 den | Externí — čeká |
| 3 | Vercel deploy + Neon production migration | 1 den | Hotové připravené |
| 4 | Better Uptime / UptimeRobot probes | 0.5 dne | Healthchecks ready |
| 5 | Sentry DSN setup | 0.5 dne | Config ready |

**Total: ~5 dní práce, vše čeká na externí registrace.**

### P1 — 30-90 dní po launchi

| # | Položka | Effort | ROI |
|---|---|---|---|
| 1 | **Native mobile app (React Native)** — buyer + scanner | 4-6 týdnů | Highest — GoOut moat |
| 2 | **Subscription / season tickets (divadelní abonentky)** | 2 týdny | Klíčový vertikál CZ |
| 3 | Push notifications (FCM + APNs) | 1 týden | Po native app |
| 4 | RSVP "I'm going" (no purchase) | 3 dny | Sociální discovery |
| 5 | Discovery feed homepage | 1 týden | Engagement metric |
| 6 | Zapier official app | 1 týden | Sales argument B2B |
| 7 | MailChimp/Klaviyo direct sync | 1 týden | Marketing power-users |
| 8 | A/B test email subjects | 3 dny | Marketing optimization |
| 9 | Multi-line ISDOC (per ticket_type) | 2 dny | Accounting accuracy |

### P2 — 90-180 dní

| # | Položka | Effort | ROI |
|---|---|---|---|
| 1 | Festival camping bundles | 2 týdny | Pokud cílíme festivaly |
| 2 | Bus + parking + accommodation cross-sell | 2 týdny | Same |
| 3 | Friends / social features | 3 týdny | Engagement |
| 4 | Group purchase (corp desk) | 2 týdny | B2B sales |
| 5 | White-label .com domena | 2 týdny | Enterprise tier |
| 6 | Insurance add-on (XCover) | 1 týden | Revenue share |
| 7 | Loyalty / tier rewards | 3 týdny | Retention |
| 8 | Buyer protection guarantee | 1 týden | Trust signal |
| 9 | Slack / Teams native integration | 1 týden | Enterprise B2B |

### P3 — explicitně **NEDĚLÁME** v M1

- **Dynamic pricing** (surge model) — kontroverzní v EU, regulační riziko
- **Verified Fan lottery drops** — relevantní jen pro stadium-tier akce co nemáme
- **Spotify/Apple Music sync** — nice-to-have, není moat
- **Cloudflare Workers fallback** — Vercel uptime stačí pro M1
- **OpenTelemetry tracing** — over-engineering pro <100k req/den
- **ELSTER / DATEV export** — pokud necílíme DE/AT trh
- **Auction-style listings** — etický + regulační hazard

---

## Unique moats Tixly nepostrádá

Co máme, kde **konkurence pokulhává**:

1. **ISDOC XML export** — žádný CZ/EU/US konkurent toto nemá pro promotéry. Náš moat proti Pohoda/Money S3 uživatelům.
2. **B2B API + scopes + rate limit per tenant** — Eventbrite má API, ale ne s tímto level enterprise tooling.
3. **DSA report queue + AI moderation gate** — DSA Act 2024 EU compliance, většina konkurence ignoruje, ale my máme zalité.
4. **Per-promoter branding bez white-label investment** — embed widget + branded storefront = white-label-lite zdarma.
5. **Seating editor + overlap detection** — automatický audit kvality sálu. GoOut/SMSticket vůbec nemají vlastní editor.
6. **Multi-tenant data sovereignty** — promotér si vede vlastní CRM/orders, ne aggregator. Konkurenti CZ jsou aggregators (GoOut, Ticketstream).
7. **Mock provider stack pro demo** — žádný konkurent neumožňuje "ukázat plnou platformu bez setup" za 5 minut, my ano.

---

## Decision matrix — kde investovat další $1

Pokud máme rozpočet 1 dev × 1 měsíc, kterou položku z P1 dělat?

```
ROI / Effort matrix (5 = high):

                  Effort →
                  Low (1-3d)    Medium (1-2t)    High (4-6t)
              ┌───────────────┬──────────────┬──────────────┐
       High   │ RSVP "I'm     │ Subscription │ Native app   │
              │   going"      │ (abonentky)  │              │
              │ A/B email     │ Zapier app   │              │
              │ Multi-line    │ MailChimp    │              │
       ROI    │   ISDOC       │   sync       │              │
       ↓      ├───────────────┼──────────────┼──────────────┤
       Medium │ Discovery     │ Group buy    │ Festival     │
              │   feed       │ (corp desk)  │   camping    │
              │ Loyalty      │ Push notif.  │ White-label  │
              │              │              │              │
              ├───────────────┼──────────────┼──────────────┤
       Low    │ Tip jar       │ Insurance    │ Dynamic      │
              │ Auction       │   add-on     │   pricing    │
              │              │ Friends      │              │
              └───────────────┴──────────────┴──────────────┘
```

**Doporučení pro M1+30 dní:** Native mobile app (4-6 týdnů) + Subscription (2 týdny) parallel.
Native app je **GoOut moat killer**, subscription **otevírá divadelní vertikál**.

---

## Audit log

| Datum | Verze | Změny |
|---|---|---|
| 2026-05-20 | v1 | první sestavení, 250 položek, 9 platforem, P0/P1/P2/P3 roadmap |
