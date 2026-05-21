# Real Feature Inventory — co skutečně funguje vs co je jen schránka

> **Cíl:** identifikovat features kde DB schema + API existuje, ale UI / flow / linking chybí.
>
> Stav: po 15 parita fázích (TM 1-8 + EB 1-3 + DB cleanup + Audit)

## Legend

- ✅ Existuje a funguje
- ⚠️ Existuje ale nepřístupné (chybí link/UI)
- ❌ Neexistuje
- 🔴 Bug / broken
- 🟡 Skeleton (DB+API ale UI ne)

## Per-feature audit (60+ features)

### 🎯 TM Parity Fáze 1 — Smart Queue + Verified Fan + All-In Pricing

| # | Feature | DB | API | Admin UI | Buyer UI | Sidebar | Funkční flow |
|---|---------|-----|-----|----------|----------|---------|--------------|
| 1 | Smart Queue | ✅ | ✅ | ⚠️ | ✅ | ❌ | ✅ |
| 2 | Verified Fan | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ |
| 3 | All-In Pricing | ✅ | ✅ | ✅ | ✅ | — | ✅ |
| 4 | Top Picks API | ✅ | ✅ | ❌ | ⚠️ | — | 🟡 (jen API) |
| 5 | Discovery Feed CSV/JSON | ✅ | ✅ | ❌ | — | — | 🟡 (jen feed) |
| 6 | Chain of Custody UI | ✅ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ link chybí |

### 🎯 TM Fáze 2 — Event Groups + Bulk Edit

| # | Feature | DB | API | Admin UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|---------|---------|
| 7 | Event Groups | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Bulk Edit | ✅ | ✅ | ✅ | — | ✅ |
| 9 | Coordinated Onsale | ✅ | ✅ | ✅ | — | ✅ |
| 10 | Artists DB | ✅ | ✅ | ❌ | ❌ | 🟡 |
| 11 | Cross-org Shares | ✅ | ✅ | ⚠️ | — | ⚠️ |

### 🎯 TM Fáze 3 — Live Sales + Cross-Promo + Pricemaster v1

| # | Feature | DB | API | Admin UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|---------|---------|
| 12 | Live Sales SSE | ✅ | ✅ | ✅ | ✅ | ✅ |
| 13 | Cross-promo bidding | ✅ | ✅ | ✅ (toggle v /admin/ads) | — | ✅ |
| 14 | Pricemaster price scenarios | ✅ | ✅ | ✅ | ✅ | ✅ |
| 15 | Scan log export | ✅ | ✅ | ❌ (button chybí) | — | 🟡 |

### 🎯 TM Fáze 4 — Mobile + Wallet + Passkeys

| # | Feature | DB | API | Admin UI | Buyer UI | Funkční |
|---|---------|-----|-----|----------|----------|---------|
| 16 | PWA mobile /m/ticket | ✅ | ✅ | — | ✅ | ✅ |
| 17 | Apple Wallet pass | ✅ | ✅ | — | ✅ | ✅ |
| 18 | Google Wallet pass | ✅ | ✅ | — | ✅ | ✅ |
| 19 | Transfer invite (P2P) | ✅ | ✅ | — | ✅ | ✅ |
| 20 | WebAuthn passkeys | ✅ | ✅ | — | ⚠️ | 🟡 skeleton |
| 21 | Native push tokens | ✅ | ❌ | — | ❌ | ❌ jen schema |
| 22 | Expo skeleton | — | — | — | — | 🟡 |

### 🎯 TM Fáze 5 — SafeTix grade

| # | Feature | DB | API | Admin UI | Buyer UI | Funkční |
|---|---------|-----|-----|----------|----------|---------|
| 23 | NFC tap-to-enter | ✅ | ✅ | ✅ (scanner) | ✅ | ✅ |
| 24 | Wallet push updates | ✅ | ✅ | ✅ | — | ✅ |
| 25 | PassKit Web Service | ✅ | ✅ | — | — | ✅ |
| 26 | Device binding | ✅ | ✅ | — | ✅ | ✅ |
| 27 | Live watermark | — | — | — | ✅ | ✅ |

### 🎯 TM Fáze 6 — Pricing engine + Vickrey + Pricemaster v2

| # | Feature | DB | API | Admin UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|---------|---------|
| 28 | Pricing windows | ✅ | ✅ | ❌ | — | 🟡 |
| 29 | A/B price tests | ✅ | ✅ | ❌ | ❌ | 🟡 |
| 30 | Vickrey ad auction | ✅ | ✅ | — | — | ✅ |
| 31 | Pricemaster elasticity | ✅ | ✅ | ✅ | ✅ | ✅ |
| 32 | Pricing cron | — | ✅ | — | — | ✅ |

### 🎯 EB1 — Donation + Group + Changes + Clone

| # | Feature | DB | API | Admin UI | Buyer UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|----------|---------|---------|
| 33 | Donation tickets | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 |
| 34 | Group discounts | ✅ | ✅ | ❌ | ⚠️ | ❌ | 🟡 |
| 35 | Ticket changes (swap) | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 |
| 36 | Attendee info edit | ✅ | ✅ | — | ❌ | — | 🟡 |
| 37 | Event clone | ✅ | ✅ | ❌ (button chybí) | — | — | 🟡 |

### 🎯 EB2 — Collections + Cancel + Pre-event + Music

| # | Feature | DB | API | Admin UI | Buyer UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|----------|---------|---------|
| 38 | Event collections | ✅ | ✅ | ❌ | ❌ | ❌ | 🟡 |
| 39 | Buyer cancel order | ✅ | ✅ | — | ❌ | — | 🟡 |
| 40 | Advance/pre-event payouts | ✅ | ✅ | ❌ | — | ❌ | 🟡 |
| 41 | Music auto-post | ✅ | — | ❌ | — | — | 🟡 jen lib |

### 🎯 EB3 — OAuth 2.0 + Public API v3

| # | Feature | DB | API | Admin UI | Funkční |
|---|---------|-----|-----|----------|---------|
| 42 | OAuth /authorize page | ✅ | ✅ | ✅ | ✅ |
| 43 | OAuth /token endpoint | ✅ | ✅ | — | ✅ |
| 44 | OAuth apps registration | ✅ | ✅ | ❌ | 🟡 |
| 45 | Public API v3 endpoints | ✅ | ✅ | — | ✅ |

### 🎯 TM7 — 10 finálních features

| # | Feature | DB | API | Admin UI | Sidebar | Funkční |
|---|---------|-----|-----|----------|---------|---------|
| 46 | Postponed event status | ✅ | ✅ | ❌ | — | 🟡 |
| 47 | Will Call mode | ✅ | ✅ | ❌ | — | 🟡 |
| 48 | Reusable templates | ✅ | ✅ | ❌ | ❌ | 🟡 |
| 49 | Tracking pixels | ✅ | ✅ | ❌ | ❌ | 🟡 |
| 50 | Customizable dashboards | ✅ | ✅ | ❌ | — | 🟡 |
| 51 | Wallet Content Modules | ✅ | ✅ | ❌ | — | 🟡 |
| 52 | Money-back guarantee | ✅ | — | — | ❌ | 🟡 jen DB |
| 53 | Face Value badges | ✅ | — | — | ❌ | 🟡 jen DB |
| 54 | GA Best Available | ✅ | — | — | — | 🟡 jen DB |
| 55 | Live ticket animations | ✅ | — | — | ❌ | 🟡 jen DB |

### 🎯 TM8 — Developer SDK

| # | Feature | DB | API | SDK doc | Funkční |
|---|---------|-----|-----|---------|---------|
| 56 | Secure Entry SDK | ✅ | ✅ | ❌ | 🟡 |
| 57 | Presence SDK | ✅ | ✅ | ❌ | 🟡 |
| 58 | Testing Harness | ✅ | — | ❌ | 🟡 jen flag |
| 59 | Inventory Status API | ✅ | ✅ | — | ✅ |
| 60 | Buyer demographics | ✅ | ✅ | — | 🟡 |

## Souhrn

| Stav | Počet | Procent |
|------|-------|---------|
| ✅ Plně funkční (DB + API + UI + sidebar) | **18** | 30 % |
| 🟡 Skeleton (DB + API, ale chybí UI nebo flow) | **34** | 57 % |
| ⚠️ Existuje ale nepřístupné | **6** | 10 % |
| ❌ Broken nebo jen schema | **2** | 3 % |

## Action plan — co je třeba pro každý 🟡 dokončit

### Priorita P0 (kritické pro UX — user vidí broken feature)

1. **Donation tickets** — buyer UI pro pay-what-you-want widget v checkoutu
2. **Group discounts** — buyer vidí "5+ = 10 %" v ticket pickeru
3. **Ticket changes** — buyer self-service swap UI v /my-tickets
4. **Attendee info edit** — buyer edit jména/emailu post-purchase
5. **Buyer cancel order** — tlačítko "Zrušit objednávku" v /my-orders
6. **Event clone** — tlačítko "Duplikovat" v /admin/events/[id]
7. **Postponed event status** — Admin tlačítko "Postpone event"
8. **Will Call mode** — Admin UI pro pickup management

### Priorita P1 (admin features pro promotéra)

9. **Tracking pixels** — Admin UI pro Meta/Google pixel placement
10. **Reusable templates** — list + apply UI
11. **Collections** — curator UI pro promotér
12. **OAuth apps** — UI pro registraci 3rd party apps
13. **Wallet Content Modules** — editor pro Apple Music/parking/...
14. **Advance payouts** — schedule setup UI
15. **Customizable dashboards** — drag&drop widget config
16. **A/B price tests** — admin UI pro setup
17. **Pricing windows** — admin UI

### Priorita P2 (sidebar + linking)

18. **Sidebar links** pro: Templates, Collections, OAuth apps, Tracking Pixels
19. **Admin event sub-menu** v /admin/events/[id]/page.tsx tabs
20. **/my-account/connected-apps** (buyer OAuth dashboard)
21. **/my-tickets/[id]/attendee** + **/cancel** + **/change** buttons

### Priorita P3 (developer tooling)

22. **Secure Entry SDK docs** + sample code
23. **Presence SDK docs**
24. **Testing Harness UI** pro sandbox switching

## Co dál

Z 60 features:
- **18 (30 %) jsou production-ready** — user může otevřít a používat
- **34 (57 %) jsou skeleton** — DB + API existují, ale chybí UI / button / link
- **6 (10 %) existují ale nedostupné** — UI je, ale sidebar/menu link chybí
- **2 (3 %) jsou nedokončené** — jen DB schema nebo jen lib

**To je realita.** Nejsme 100 % production-ready, jsme "100 % DB schema parita" + ~30 % end-to-end UX parita.

Pro skutečnou 100 % UX paritu je třeba **dokončit ~22 UI úkolů** (P0 + P1).
