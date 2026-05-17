# `_archive/` inventura — co stojí za resurrekci

> Skenováno: 187 modulů v `_archive/`. Pro každý spočítáno: počet service souborů, migrací, testů, API routes, lib utils, tsx komponent (bez `node_modules`).
>
> **Klasifikace:**
> - 🟢 **RESURRECT** — mature (multi-service + migrace + 4+ tests + ≥3 routes). Stačí port do `nextjs-boilerplate/` + napojit DB schema.
> - 🟡 **SELECTIVE** — partial scaffolding. Vzít service vrstvu, dopsat UI a API.
> - 🔴 **DUMP** — jen stub (1 service, 1 test, 0 routes). Nemá smysl, znovu napsat rychleji než portovat.
> - ⚪ **JIŽ V CORE** — duplicita s aktuálním nextjs-boilerplate kódem.

---

## 🟢 RESURRECT NOW (high-leverage moduly)

Tyto jsou kompletní balíčky a řeší **konkrétní gap z GAP-MATRIX.md**. Doporučené pořadí podle business value:

| Modul | Svc | Mig | Tst | API | Lib | Tsx | Řeší gap | Effort |
|---|---|---|---|---|---|---|---|---|
| **wallet-passes** | 4 | 1 | 5 | 1 | 2 | 1 | Apple/Google Wallet — TOP 4 gap | 1-2 dny |
| **bulkgate-sms** | 3 | 5 | 4 | 8 | 6 | 0 | Produkční SMS (P0 #3) — pak P1 #12 push | 2 dny (+ API key) |
| **identity-verification** | 4 | 2 | 12 | 7 | 5 | 0 | KYC promotér + age verify (18+) | 2 dny |
| **accreditation** | 1 | 2 | 6 | 7 | 1 | 0 | P3 #27 — odlišný QR pro akreditovaný vstup | 1 den |
| **loyalty-points** | 2 | 2 | 6 | 4 | 3 | 0 | P3 #26 — body, tier, redemption v checkoutu | 2 dny |
| **branch-management** | 6 | 2 | 4 | 13 | 1 | 0 | P2 #15 — sub-účty + RBAC pro box office/staff | 3 dny |
| **scanner-pwa** | 5 | 0 | 8 | 4 | 5 | 4 | Standalone PWA pro skener — momentálně /t je v hlavní app | 2 dny |
| **resale-api** | 10 | 0 | 13 | 5 | 6 | 0 | Rozšíření aktuálního /resale o broker API + advanced rules | 2 dny |
| **inventory-holdback** | 1 | 0 | 10 | 1 | 1 | 0 | P1 #10 — Holds & Kills (10 testů!) | 1 den |
| **device-fingerprinting** | 2 | 2 | 8 | 3 | 4 | 0 | Anti-bot ML — buyer device tracking | 2 dny |
| **referral-system** | 6 | 0 | 7 | 5 | 3 | 0 | Affiliate / „přiveď kamaráda" — retention | 2 dny |
| **server-side-tracking** | 3 | 0 | 5 | 4 | 4 | 0 | Server-side GA/FB tracking — atribuce v iOS 17+ | 2 dny |
| **mobile-buyer** | 3 | 0 | 3 | 0 | 2 | 11 | Mobilní UI komponenty (11 tsx!) — vylepšit PWA | 2 dny |
| **mobile-scanner** | 3 | 0 | 3 | 0 | 3 | 8 | Mobilní scanner UI komponenty (8 tsx) | 1 den |
| **event-staff** | 7 | 4 | 20 | 1 | 4 | 0 | P2 #15 součást — staff invite, gate assign | 2 dny |
| **promoter-onboarding** | 3 | 1 | 5 | 7 | 6 | 0 | Vylepšit current onboarding pro tier-based auto-approve | 2 dny |
| **cookie-consent** | 2 | 3 | 4 | 4 | 3 | 0 | GDPR compliance — TCF v2.2 ready | 1 den |
| **jwt-auth** | 2 | 2 | 8 | 5 | 4 | 0 | Public API auth pro Tier-1 #3 GraphQL | 1 den |

Suma: **18 modulů**, ~32-36 dní práce. Pokrývá **6 z TOP 10 gapů** z GAP-MATRIX.md.

---

## 🟡 SELECTIVE — porty vrstvy, dopsat UI

Mají solidní service logiku, ale chybí jim UI nebo testy. Vzít core, dopracovat.

| Modul | Svc | Mig | Tst | API | Lib | Tsx | Co s tím | Effort |
|---|---|---|---|---|---|---|---|---|
| **stripe-payments** | 6 | 0 | 6 | 3 | 2 | 0 | Pro P0 #1 — pravděpodobně outdated, použít jen jako referenci pro nový integration | 3 dny |
| **gopay-payments** | 1 | 2 | 3 | 2 | 4 | 0 | Migrace ano, service vyměnit za current SDK | 3 dny |
| **wero-payments** | 1 | 0 | 4 | 3 | 2 | 0 | Wero je SEPA SCT Instant — A2A platba, CZ early adopter | 2 dny |
| **ai-fraud-detection** | 1 | 1 | 5 | 3 | 5 | 0 | Doplnit current rules-based engine ML vrstvou (W.6) | 3 dny |
| **ticket-insurance** | 1 | 0 | 2 | 3 | 2 | 0 | Allianz / Twisto pojištění při checkoutu (P3 typ) | 2 dny |
| **white-label** | 2 | 0 | 6 | 2 | 5 | 0 | Vlastní doména pro promotéra (high-tier feature) | 4 dny |
| **timed-entry** | 3 | 0 | 2 | 2 | 1 | 0 | P3 #22 — muzeum/ZOO sloty | 2 dny |
| **re-entry** | 1 | 0 | 3 | 1 | 1 | 0 | P3 #25 — exit scan, multi-day | 1 den |
| **sms-barcode** | 2 | 1 | 4 | 2 | 3 | 0 | SMS QR — SMSticket 🆕 funkce, závisí na bulkgate-sms | 1 den |
| **season-passes** | 3 | 1 | 2 | 4 | 2 | 2 | Doplnit current /subscriptions o sportovní permanentky | 2 dny |
| **upsell-engine** | 3 | 1 | 3 | 1 | 4 | 0 | Cross-sell merch/parking/F&B v checkoutu | 2 dny |
| **group-tickets** | 1 | 0 | 4 | 0 | 1 | 0 | Volume discount engine (P1 #11) | 1 den |
| **group-payment** | 1 | 0 | 2 | 6 | 1 | 0 | Skupinová platba „rozdělit fakturu" | 2 dny |
| **installments** | 1 | 0 | 4 | 1 | 1 | 0 | Splátky (Twisto-style, P2 #18) | 2 dny |
| **flash-sales** | 1 | 0 | 4 | 1 | 2 | 0 | Time-limited sleva — marketing tool | 1 den |
| **landing-pages** | 2 | 2 | 6 | 0 | 5 | 0 | Custom event landing pages per kampaň | 2 dny |
| **lead-capture** | 1 | 2 | 2 | 1 | 2 | 0 | Pre-launch waitlist (před onsale) | 1 den |
| **churn-prediction** | 1 | 0 | 8 | 1 | 2 | 0 | ML „kupec neaktivní X měsíců → notif" | 2 dny |
| **presale-access** | 2 | 0 | 3 | 1 | 2 | 0 | Pre-sale kódy pro VIP/sezónky | 1 den |
| **refund-policy** | 2 | 1 | 3 | 1 | 3 | 0 | Per-event refund pravidla (deadline, fee) | 1 den |
| **cs-dashboard** | 2 | 0 | 4 | 3 | 2 | 0 | Customer support admin panel | 2 dny |
| **customer-portal** | 5 | 0 | 2 | 0 | 1 | 0 | Rozšířený /my-tickets — historie, faktury, profil | 2 dny |
| **delayed-delivery** | 1 | 0 | 4 | 1 | 3 | 0 | Doručení vstupenek X dní před akcí (anti-resale, anti-leak) | 1 den |
| **developer-portal** | 3 | 0 | 2 | 4 | 2 | 0 | Doplnit Tier-1 #3 GraphQL o dokumentační portál | 2 dny |
| **event-cloning** | 2 | 0 | 4 | 1 | 2 | 0 | „Duplikovat akci" — UX win pro turné | 1 den |
| **multi-currency** | 3 | 0 | 4 | 2 | 2 | 0 | EUR pro SK/AT/DE, optional (➖ paměť říká CZK-only) | 3 dny |
| **oauth2-provider** | 2 | 1 | 1 | 5 | 2 | 0 | Vystavit OAuth pro 3rd party apps | 2 dny |
| **post-event-report** | 1 | 1 | 4 | 1 | 1 | 0 | Auto-report po akci promotérovi (revenue + skenování) | 1 den |
| **marketing-attribution** | 1 | 0 | 6 | 1 | 5 | 0 | Multi-touch atribuce kampaní | 2 dny |
| **pdf-ticket** | 4 | 0 | 5 | 0 | 1 | 0 | Současný PDF generator + branding from this module | 1 den |
| **packages-v2** | 4 | 0 | 3 | 1 | 1 | 0 | Vylepšit cross-passes flex packages | 2 dny |
| **sandbox** | 3 | 1 | 1 | 5 | 1 | 0 | Testovací akce „nanečisto" (SMSticket „Festival v Parku") | 2 dny |
| **platform-fees** | 1 | 2 | 4 | 4 | 4 | 0 | Per-promoter fee config + auto-faktura | 2 dny |
| **audience-segmentation** | 1 | 0 | 4 | 4 | 3 | 0 | Per-segment marketing kampaně | 2 dny |
| **cart-abandonment** | 2 | 0 | 6 | 3 | 3 | 0 | Email „vrať se do košíku" — průmyslový standard | 1 den |
| **affiliate-tracking** | 1 | 0 | 5 | 2 | 4 | 0 | Komplexnější referral než `referral-system` | 2 dny |
| **dynamic-cashback** | 1 | 2 | 6 | 1 | 4 | 0 | Body za chování (engagement loyalty hybrid) | 2 dny |
| **guest-list** | 1 | 2 | 8 | 0 | 3 | 0 | VIP guest list per akce | 1 den |
| **merchandise** | 1 | 2 | 8 | 0 | 3 | 0 | Merch (tričko, plakát) prodej k vstupence | 2 dny |
| **service-catalog** | 5 | 0 | 1 | 2 | 1 | 0 | Doplňkové služby promotérů (na pozdější fáze) | 2 dny |
| **venue-ownership** | 1 | 1 | 3 | 2 | 4 | 0 | Vyřeší vlastnictví sálu vs nájem (komplexní permissions) | 2 dny |
| **web-content-cms** | 1 | 1 | 1 | 0 | 3 | 0 | CMS pro statické stránky (kromě editorial blogu) | 2 dny |
| **fnb-preorder** | 1 | 0 | 1 | 0 | 1 | 0 | F&B objednávky v aréně (long-tail) | 2 dny |
| **age-verification** | 1 | 0 | 1 | 1 | 1 | 0 | UI dialog pro 18+ akce | 1 den |
| **channel-distribution** | 1 | 0 | 2 | 2 | 0 | 0 | Distribuce do prodejní sítě (smsticket Bandzone-style) | 3 dny |
| **corporate-benefits** | 4 | 2 | 2 | 3 | 1 | 0 | Pluxee/Benefit Plus B2B (P2 #19) | 2 dny |

Suma: **44 modulů**, ~85-100 dní práce. Selective port — nikoli komplet drag-and-drop.

---

## 🔴 DUMP — netáhnout, raději napsat čistě nebo nedělat

Jen service shell + 1 test, žádné routes ani UI. Effort přepisu < effort portu.

```
ad-platform           ai-ad-copy            ai-event-assist
artist-follows        ballot-system         biometric-entry
cashless-payments     comp-tickets          corporate-suites
event-insurance       fan-share             fan-social-graph
fan-surveys           ignite-cms            master-admin
nft-tickets           onboarding-wizard     pre-entry-validator
promoted-ads          recommendation-engine resale-price-prediction
revenue-calculator    single-customer-view  sponsor-analytics
status-page           subscription-ticketing tour-management
ticket-reissue        ticket-transfers      venue-features
venue-rental          verified-fan          verified-fan-v2
waiting-room          wcag-compliance       zapier-integration
zone-access (1 svc, 0 mig, 4 tst, 1 api, 1 lib) — možná hybrid
```

**Poznámka k překvapení:** Některé „velké features" jsou v archivu skoro **prázdné** — biometric-entry, cashless-payments, nft-tickets, ticket-transfers. Buď byly vyháknuté předčasně, nebo to byl jen wishful naming.

---

## ⚪ JIŽ V CORE — duplicita, neresurrektovat

Tyto features už jsou plně v `nextjs-boilerplate/src/app`:

| Archive | V core jako |
|---|---|
| `recommendation-engine` | `src/lib/recommendations/engine.ts` (W.2) |
| `ai-dynamic-pricing` | `src/lib/dynamic-pricing/compute.ts` (W.1) |
| `verified-fan` + `verified-fan-v2` | catch-up #14 commit `d30aa91` |
| `embed-widget` | `src/app/embed` (Tier-1 #1) |
| `waiting-room` | `src/app/[locale]/queue` |
| `ballot-system` | `src/app/[locale]/lottery` |
| `gift-vouchers` | catch-up #4 commit `f6a2cf8` |
| `master-admin` | `src/app/platform` |
| `feature-flags` | live v `src/lib/feature-flags` |
| `pricing-engine` | nahrazeno W.1 dynamic-pricing |
| `wcag-compliance` | Tier-1 #2 commit `fde40aa` |
| `subscription-ticketing` | `src/app/[locale]/subscriptions` |
| `rsvp` | catch-up #13 commit `f97b564` |
| `pdf-ticket` | core + PAdES Tier-1 #2 |
| `accessibility` | Tier-1 #2 |

---

## TOP 5 RESURRECT priorit — pořadí na následující vlnu

Pokud z toho dělat jen jednu vlnu, vzít tyto:

1. **wallet-passes** — Apple/Google Wallet je standard, kupci ho očekávají. 1-2 dny, výrazný UX boost.
2. **inventory-holdback** — Holds & Kills (P1 #10). 1 den. Bez toho festivaly/divadla neumí pracovat.
3. **branch-management** — Sub-účty + RBAC (P2 #15). 3 dny. Box office, entry staff, akreditace — všechno tohle závisí.
4. **bulkgate-sms** — Produkční SMS (P0 #3). 2 dny po API key. Odemkne sms-barcode + push notifs.
5. **identity-verification** — KYC + age. 2 dny. Compliance must-have.

**Celkem: 9-11 dní práce + 1 API key (BulkGate)** → 5 velkých featur dotažených.

---

## Příští krok pro mě (bez tvého inputu)

Můžu rovnou připravit **plně specifikované PR plány** pro top 5 modulů: kam co kopírovat, jaké migrace pustit, jaké env vary doplnit, jaké testy adaptovat. Stačí říct.
