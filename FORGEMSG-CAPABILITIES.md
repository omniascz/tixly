---
title: "ForgeMsg × Tixly — co umí mailingová platforma a kam co patří"
date: "2026-06-22"
---

# ForgeMsg × Tixly

**Referenční dokument: co umí mailingová platforma ForgeMsg, jak ji Tixly využije, a kde která logika žije.**

> Účel: abychom nezapomněli, co ForgeMsg dokáže, a měli jasno v architektuře dřív, než systémy propojíme. ForgeMsg = horizontální messaging/marketing engine (multi-tenant). Tixly = první vertikála (ticketing). Stejný engine půjde prodat i e-shopům, hotelům, fitness…

---

## 1. Základní princip — kde co žije

| | Tixly | ForgeMsg |
|---|---|---|
| **Vlastní** | DOMÉNU: co se prodává, kdy je akce, co je neprodané, jaká je cena, kdo co koupil | MARKETINGOVÝ MOZEK: komu, kdy, jakým kanálem, jaký subject, segmentace, automatizace, deliverability, AI |
| **Role** | zdroj **dat a triggerů** | generický, **znovupoužitelný** engine |
| **Švov** | emituje **události** + syncuje **data** → | konzumuje a dělá marketing |

**Pravidlo palce:** věta obsahuje „kdo / kdy / jaký kanál / jaká zpráva / segment" → **ForgeMsg**. Věta obsahuje „co je na skladě / jaká cena / kdy akce / kdo co koupil" → **Tixly** (a pošli jako event).

**Antipattern (nedělat):** marketingovou logiku (segmenty, kampaně, send-time, A/B, churn) zapisovat do Tixly. Duplikoval by ForgeMsg, zamkl by to na ticketing a nešlo by to prodat dál.

---

## 2. Co ForgeMsg umí (ověřený inventář modulů)

**Kanály:** Email (vlastní MTA engine + DKIM/SPF/DMARC), SMS, WhatsApp, Push, Viber, RCS · channel-fallback (email bounce → SMS).

**Kampaně & automatizace:** kampaně, segmenty (dynamický query-builder), workflow/automation engine (triggery → akce, wait, branch, goal), A/B testy, holdout, multivariate.

**AI:** per-recipient generování obsahu, AI subject-line scorer + bandit A/B, Next-Best-Action engine, send-time optimization (per-kontakt, empirical-Bayes), brand-voice, brand-guidelines checker, dark-pattern detector, accessibility-fixer + alt-text, deliverability coach.

**Prediktivní vrstva (statistická):** RFM (org-relativní kvintily), CLV + churn (Gamma-Poisson buy-till-you-die + exponenciální survival), purchase-likelihood, lead-scoring (logistická regrese z dat).

**Deliverability:** vlastní MTA, DKIM keygen, SPF/DMARC verifikace, IP warmup, per-ISP throttle vč. **Seznam.cz + CZ ISP**, bounce/FBL processing, suppression list, DNSBL monitor, inbox-placement.

**Růst & monetizace:** referral programy, newsletter ads + paywall, co-marketing mezi tenanty, abandoned-cart recovery, signup forms.

**Data:** CDP, identity resolution, ClickHouse analytics pipeline, attribution (multi-touch), warehouse-sync (S3/BigQuery).

**Compliance/CZ:** GDPR (double opt-in, preference center, kompletní erasure), per-org consent, CZ/SK i18n + skloňování, jmeniny + státní svátky, ISDOC/SPAYD.

**Transakční:** transactional API (`/api/v1/transactional/email`) s **přílohami** (e-ticket PDF) i bez (link-only) — fronta → engine → DKIM → SMTP, s retry + bounce + suppression.

---

## 3. Sedm feature skupin pro Tixly

Každá: co dělá · který ForgeMsg modul ji pohání · co musí Tixly emitovat · hodnota.

### 1) Yield management — „naplnit sál" 💰
Mailing jako prodejní motor neprodaných sedadel.
- **Fill-the-house cascade** — T-mínus k akci s neprodanými sedadly → automat rozesílá slevy rankovaným segmentům (lokální → lapsed → genre-match), dokud se nedoprodá.
- Price-drop alert (Tixly `dynamic_pricing_rules`), early-bird countdown timer v emailu, last-minute SMS, upsell (VIP/parking/merch/commemorative).
- **ForgeMsg:** workflows, price-drop/back-in-stock, countdown-gif, segmenty, multikanál.
- **Tixly emituje:** `seats_unsold` (event_id, počet, tier, cena), `price_changed`.
- **Hodnota:** přímo zvyšuje GMV portálu (yield).

### 2) Retence & lifecycle 🔁
Divadla žijí z opakované návštěvy.
- Post-event: poděkování + NPS/recenze + „mohlo by se ti líbit"; win-back dormantních (churn model); season „Wrapped"; renewal dunning permanentek; jmeniny/narozeniny.
- **ForgeMsg:** workflows, surveys/NPS, churn/CLV model, loyalty, jmeniny/svátky (CZ/SK).
- **Tixly emituje:** `order_paid`, `event_attended` (ticket used), `subscription_past_due`.
- **Hodnota:** retence + opakovaný prodej.

### 3) AI personalizace 🤖
- „Discover Weekly" pro živé akce (personalizovaný digest show); per-kontakt send-time; NBA (nejlepší kanál+nabídka); AI subject lines; affinity profily (Spotify žánry + co-attendance).
- **ForgeMsg:** per-recipient generation, STO, NBA, subject-scorer, recommendations — **z velké části hotové**.
- **Tixly emituje/syncuje:** žánr/venue affinity data, co-attendance.
- **Hodnota:** vyšší open/CTR/konverze.

### 4) Multikanál „day-of" orchestrace 📱
- -24 h email → -2 h SMS s magic-link QR → po akci push na recenzi; SMS pro kritické (doors open, změna brány, doprava/počasí); WhatsApp/Viber rich; event-change blast (zrušení/přesun) s refund/rebook.
- **ForgeMsg:** workflow journeys, email/SMS/WhatsApp/push/Viber/RCS, channel-fallback.
- **Tixly emituje:** `event_T-24h`, `event_T-2h`, `event_changed` (cancel/reschedule/venue).
- **Hodnota:** zážitek + snížení no-show + krizová komunikace.

### 5) B2B produkt pro divadla 🏛️ (třešnička, nový revenue stream)
- Co-marketing mezi scénami (revenue share); newsletter monetizace (sponzorované placementy); audience insights (RFM/CLV/churn) v promotér dashboardu; white-label (per-divadlo doména + DKIM + brand); attribution (ROI kampaní).
- **ForgeMsg:** co-marketing modul, newsletter ads/paywall, prediktivní vrstva, per-org domény, attribution.
- **Tixly:** mapování promotér → ForgeMsg org.
- **Hodnota:** nový SaaS revenue stream (per-divadlo balíčky).

### 6) Akvizice & růst 📈
- Referral („přiveď kamaráda"); abandoned-cart recovery; waitlist/lottery jako leadgen; lookalike přes CDP.
- **ForgeMsg:** referral engine, cart-recovery automat, CDP/lookalike, signup forms.
- **Tixly emituje:** `cart_abandoned`, waitlist/lottery state.
- **Hodnota:** nový buyeři + záchrana opuštěných košíků.

### 7) Signature / leapfrog ✨
- Post-event „Memories" (fotky, commemorative/NFT, share-to-social); AMP emaily (výběr sedadla/RSVP/anketa v emailu); přístupné emaily (A11y synergie); **Seznam.cz deliverability moat** pro CZ trh.
- **ForgeMsg:** AMP rendering, accessibility-fixer, Seznam/CZ ISP deliverability, memories šablony.
- **Tixly emituje:** event fotky/commemorative data.
- **Hodnota:** odlišení + důvěra + doručitelnost.

---

## 4. Co musí dodat Tixly — tenká event/sync vrstva

Jediná Tixly práce: **outbox** — emitovat události a syncovat kontakty/nákupy do ForgeMsg. Žádná marketingová logika.

**Sync (data):**
- `contact upsert` — buyer profil (email, jméno, telefon, město, jazyk z poslední objednávky) → ForgeMsg contact (scoped per promotér = org).
- `revenue_event` — zaplacená objednávka (částka, měna, event, kategorie, venue) → ForgeMsg.

**Eventy (triggery):**
| Event | Kdy | Pohání feature |
|---|---|---|
| `order_paid` | platba potvrzena | 2, 3, e-ticket |
| `cart_abandoned` | cron / expirace | 6 |
| `seats_unsold` | denní cron / T-mínus | 1 |
| `price_changed` | změna tieru | 1 |
| `event_T-24h` / `event_T-2h` | scheduler | 4 |
| `event_changed` | zrušení/přesun/venue | 4 |
| `event_attended` | ticket used | 2, 7 |
| `subscription_past_due` | billing | 2 |
| `waitlist_freed` / `lottery_winner` | draw/free | 6 |

**Realizace:** webhook nebo outbox tabulka v Tixly → ForgeMsg CDP/workflow trigger endpoint. ~1-2 dny práce, neztratí se.

---

## 5. E-ticket doručení — už postaveno (obě varianty)

| Varianta | Jak | Doporučení |
|---|---|---|
| **(A) PDF příloha** | `/transactional/email` s `attachments[]` | volba „stáhnout PDF" |
| **(B) Link-only** | stejný endpoint bez příloh, magic-link/wallet v HTML | **default** (lepší deliverability + rotující QR) |

ForgeMsg MTA teď umí multipart/mixed přílohy (base64 → engine). Lze A/B testovat.

---

## 6. Znovupoužitelnost — ForgeMsg jako horizontální produkt

~90 % hodnoty je generické. Ticketing-specifická je jen tenká slupka. Stejné featury prodáš jinam:

| Feature | Generická podstata | Další vertikály |
|---|---|---|
| 1 Yield cascade | inventory-driven doprodej | e-shopy, hotely, restaurace, fitness, kurzy, aerolinky |
| 2 Lifecycle | opakovaný zákazník | retail, SaaS, předplatné, gastro |
| 3 AI personalizace | generické | kdokoliv |
| 4 Day-of journey | time-relative reminder | rezervace (doktor/salon/servis), doručení, webináře |
| 5 B2B/marketplace | multi-tenant marketing | franšízy, marketplaces, agentury |
| 6 Růst | referral/cart/lookalike | kdokoliv s online prodejem |
| 7 AMP/A11y/deliverability | generické messaging | kdokoliv |

**Strategie:** generické postavit v ForgeMsg → Tixly je první vertikála + reference → stejný engine pak prodat e-shopům, hotelům, fitness.

---

## 7. Poctivé caveaty
- **Identita zákazníka:** Tixly buyer je globální (portál), ForgeMsg org je per-divadlo — sync musí scopovat kontakty per promotér; stejný email u více divadel ForgeMsg zvládá (per-org izolace).
- **Žánrová granularita:** best-effort (Tixly nemá žánrovou taxonomii v DB, jen format/venue + Spotify/AI tagy) — týká se feature 1 a 3.
- **Consent bridge:** Tixly per-promotér newsletter consent + globální `notification_preferences` → mapovat na ForgeMsg per-org consent.
- **Live integrace:** Seznam/Viber/WhatsApp/DKIM postavené + unit-tested, ale staging smoke s reálnými doménami zatím neproběhl.

---

## 8. Doporučené pořadí
1. **Event/sync vrstva** Tixly → ForgeMsg (bez ní nic nepojede) — Tixly outbox.
2. **Zapojit ForgeMsg workflows** na Tixly eventy (engine z velké části hotový).
3. **Tenká ticketing slupka** — pár šablon/segmentů specifických pro akce.
4. **Per-divadlo SaaS** (feature 5) jako nový revenue stream.

---

*Tento dokument je referenční přehled schopností ForgeMsg pro Tixly. ForgeMsg kód je hotový a otestovaný (1846 unit testů + Go engine); zbývají integrační/provozní kroky.*
