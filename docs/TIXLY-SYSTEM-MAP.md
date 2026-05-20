---
title: "Tixly — kompletní mapa systému"
date: "2026-05-20"
pdf_options:
  format: A4
  margin:
    top: 25mm
    right: 20mm
    bottom: 25mm
    left: 20mm
  printBackground: true
  headerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#888;">Tixly — kompletní mapa systému</div>'
  footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#888;">Strana <span class="pageNumber"></span> z <span class="totalPages"></span></div>'
  displayHeaderFooter: true
stylesheet_encoding: "utf-8"
body_class: "markdown-body"
css: |
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; line-height: 1.55; color: #1a1a1a; max-width: 100%; }
  h1 { color: #10b981; border-bottom: 3px solid #10b981; padding-bottom: 8px; margin-top: 40px; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { color: #047857; border-bottom: 1px solid #d1fae5; padding-bottom: 4px; margin-top: 28px; }
  h3 { color: #065f46; margin-top: 22px; }
  h4 { color: #1f2937; margin-top: 18px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11px; }
  th { background: #f0fdf4; border: 1px solid #d1fae5; padding: 6px 10px; text-align: left; font-weight: 600; }
  td { border: 1px solid #e5e7eb; padding: 6px 10px; vertical-align: top; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; font-family: "Consolas", monospace; }
  pre { background: #1f2937; color: #f9fafb; padding: 12px; border-radius: 6px; font-size: 11px; overflow-x: auto; page-break-inside: avoid; }
  pre code { background: transparent; color: inherit; padding: 0; }
  blockquote { border-left: 4px solid #10b981; background: #f0fdf4; padding: 8px 16px; margin: 12px 0; font-style: italic; }
  ul, ol { padding-left: 24px; }
  li { margin: 4px 0; }
  hr { border: none; border-top: 2px dashed #d1d5db; margin: 30px 0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 600; }
  .badge-new { background: #10b981; color: white; }
  .badge-existing { background: #6b7280; color: white; }
  .step { background: #f9fafb; border-left: 4px solid #6366f1; padding: 10px 16px; margin: 10px 0; }
  .warn { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px 16px; margin: 10px 0; }
  .tip { background: #dbeafe; border-left: 4px solid #3b82f6; padding: 10px 16px; margin: 10px 0; }
  a { color: #10b981; text-decoration: none; }
  .ascii { background: #f9fafb; border: 1px solid #e5e7eb; padding: 16px; font-family: monospace; font-size: 10px; line-height: 1.2; white-space: pre; }
---

# Tixly — kompletní mapa systému

**Verze:** 2026-05-20 — po session "152 commits"
**Repo:** https://github.com/omniascz/tixly
**Stav:** Provozuschopný demo, čeká na 5 externích účtů pro produkci

---

## Obsah

1. **Úvod a architektura** — jak je platforma postavená
2. **Master admin** (TY) — co umíš jako vlastník platformy
3. **Promotér admin** — co umí pořadatel akcí
4. **Buyer** — co vidí a dělá kupec
5. **Seating editor — kompletní walkthrough** — jak založit nový sál
6. **Konkrétní use-cases** — 4 scénáře krok-po-kroku
7. **API a integrace** — pro vývojáře / B2B partnery
8. **Provoz a monitoring** — co kde najdeš v adminu
9. **Test scénáře** — co projít při manuálním testu

---

# 1. Úvod a architektura

## 1.1 Tři role v systému

| Role | Kdo to je | Login URL | Co dělá |
|---|---|---|---|
| **Master admin** | TY (provozovatel platformy) | `/cs/dev-login?as=platform` | Schvaluje promotéry, moderuje obsah, vede platformu |
| **Promotér admin** | Pořadatel akcí (divadlo, klub, agentura) | `/cs/dev-login?as=admin` | Vytváří akce, prodává lístky, dělá marketing |
| **Buyer** | Kupec lístku | `/cs/dev-login?as=buyer` | Hledá akce, kupuje lístky |

## 1.2 Hlavní stránky systému

```
https://tixly.cz/                       ← homepage (discover, kategorie)
https://tixly.cz/cs/events              ← seznam všech akcí
https://tixly.cz/cs/events/<slug>       ← detail akce + RSVP + Koupit
https://tixly.cz/cs/p/<promoter>        ← stránka promotéra (storefront)
https://tixly.cz/cs/p/<x>/subscriptions/<y>  ← abonentka detail + buy

https://tixly.cz/cs/dev-login           ← rychlý dev login (bez hesel)
https://tixly.cz/cs/my-tickets          ← moje lístky (po nákupu)
https://tixly.cz/cs/legal/cookie-settings ← GDPR consent settings
https://tixly.cz/cs/legal/privacy       ← privacy policy

/admin/*                                ← promotér admin (30+ podstránek)
/platform/*                             ← master admin (7 sekcí)
```

## 1.3 Technický stack (TL;DR pro testování)

- **Frontend + Backend:** Next.js 14 (jeden monorepo)
- **Databáze:** PostgreSQL 17 (Docker dev, Neon/Supabase prod)
- **Cache + queue:** Redis (Upstash v produ)
- **Email:** SMTP přes MailHog (dev) → Resend (prod)
- **Platby:** Mock GoPay + ComGate v dev → live API key v prod
- **DPH:** 10% pro kulturní akce (CZ), Faktura ISDOC export pro Pohoda/Money S3

---

# 2. Master admin — co umíš jako provozovatel platformy

**Login:** `http://localhost:3000/cs/dev-login?as=platform` → klik "Login as Platform Admin"

Po loginu se dostaneš na **`/platform`** dashboard. V sidebar máš 7 sekcí.

## 2.1 Promotéři (`/platform/promoters`)

**Co vidíš:**
- Seznam všech registrovaných promotérů (aktivní / pending / suspended)
- Per řádek: IČO, kontakt, počet akcí, GMV (gross merchandise value)

**Co můžeš:**
- ✅ **Schválit registraci** — nový promotér nemůže vytvářet akce, dokud neschválíš
- ✅ **Suspendovat** — promotér už nemůže prodávat, ale historie zůstává
- ✅ **Nastavit fee schedule** — kolik % bere platforma z prodaných lístků (default 5%)
- ✅ **Otevřít jejich admin** — "View as promoter" (impersonation pro debug)

**Test flow:**
```
1. /platform/promoters → klikni "Divadlo Hranice s.r.o."
2. Vidíš detail: IČO, brand color, slug, počet upcoming events (14)
3. "Settings → Fee schedule" → 5% commission + 15 Kč/order
```

## 2.2 Moderace akcí (`/platform/event-moderation`)

**Co vidíš:**
- Fronta akcí čekajících na schválení
- AI gate hodnocení (Claude moderation): allow/flag/reject + důvod

**Workflow:**
1. Promotér vytvoří akci → status `draft`
2. Promotér klikne "Publikovat" → AI gate scan:
   - **Allow** + trusted promoter → auto-publish
   - **Allow** + new promoter → `pending_review` (čeká na master admina)
   - **Flag** → vždy `pending_review` + důvod ("kontroverzní obsah")
   - **Reject** + confidence ≥ 0.8 → status `rejected` (porušení pravidel)
3. Ty schválíš nebo odmítneš

**Test flow:**
```
1. /platform/event-moderation → vidíš seznam pending akcí
2. Klikni akci → detail (title, description, ticket types)
3. AI score: "allow, confidence 0.95, reasoning: standard concert"
4. Klikni "Approve" → status = published, viditelné na /cs/events
```

## 2.3 Featured events (Tip redakce)

**Kde:** API `/api/platform/admin/events/<id>/feature` nebo UI sekce v event detail (`/admin/events/<id>` jako platform admin)

**Co dělá:**
- Označí akci jako "⭐ Tip redakce" na homepage `/cs`
- Custom blurb (italic text) zobrazí v card
- Order priority (vyšší = výše)
- Auto-expire (volitelné `editorial_until` datum)

**Test flow:**
```bash
# CLI test (curl s tvým platform admin tokenem):
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"order": 100, "blurb": "Mistrovské dílo sezóny"}' \
  http://localhost:3000/api/platform/admin/events/<event-id>/feature

# Verify: otevři /cs → "⭐ Vybráno pro tebe" sekce zobrazuje
```

## 2.4 DSA reports queue (`/platform/dsa-reports`)

**Co to je:**
- EU Digital Services Act 2024 compliance
- Uživatelé reportují závadný obsah ("akce porušuje copyright", "scam")
- Platforma má 24 hodin na reakci

**Co můžeš:**
- ✅ Triáž reportu (false positive / valid)
- ✅ Akce: takedown event (status → rejected) / no action / contact reporter
- ✅ Eskalace na právní oddělení
- ✅ Audit log všech rozhodnutí (retention 5 let, EU regulace)

## 2.5 Audit log (`/platform/audit-log`)

**Co vidíš:**
- Všechny admin akce v systému (kdo, co, kdy, IP)
- Filter: user, action type, date range, target table
- Export CSV pro compliance

**Příklady událostí:**
- `promoter.approved` — schválen Divadlo Hranice
- `event.moderation.approved` — schválena akce X
- `event.moderation.rejected` — odmítnuta akce Y (důvod: scam)
- `fee_schedule.updated` — změna provize z 5% na 7% pro promotéra Z

## 2.6 Status page (`/platform/incidents` → veřejně `/cs/status`)

**Co dělá:**
- Publikuj incident pro veřejnost ("Platby dočasně nedostupné")
- Sledování součastní status systému (databáze, redis, platby, emailing)
- Historie incidentů (uptime percentage)

**Test flow:**
```
1. /platform/incidents → klikni "New Incident"
2. Title: "Test incident", Severity: minor, Status: investigating
3. Publikovat → /cs/status zobrazí oranžový banner
4. Update status → "resolved" → banner zmizí
```

## 2.7 Payouts (`/platform/payouts`)

**Co vidíš:**
- Měsíční payout report pro každého promotéra
- Detail: hrubé tržby, provize platformy, refundy, k vyplacení

**Workflow:**
1. Promotér prodá lístky (peníze přijdou na účet platformy / Fio)
2. Konec měsíce → cron `payouts-auto-settle` (každé pondělí 7:00) spočítá:
   - Tržby – provize – refundy – chargebacks – rolling reserve = payout
3. Bank transfer SEPA/CZK na účet promotéra
4. Email notifikace promotérovi s breakdown

## 2.8 Bank transfers (`/platform/bank-transfers`)

**Co vidíš:**
- Fio Bank API sync — všechny příchozí platby od kupců (bankovní převod variant)
- Párování platby s objednávkou (variabilní symbol = order ID)

**Test flow:**
```
1. /platform/bank-transfers → vidíš seznam importovaných transakcí
2. Filter "unmatched" → manual párování pokud VS chybí/špatný
3. Match → objednávka přejde do `paid` status, lístek vystaven
```

## 2.9 Webhooks (`/platform/webhooks`)

**Co dělá:**
- Promotéři nastavují outbound webhooks (např. "při novém prodeji POST na můj endpoint")
- Master admin vidí všechny aktivní webhooks + logs
- Retry policy pro selhané delivery (exponential backoff, 7 dní)

---

# 3. Promotér admin — co umí pořadatel akcí

**Login:** `http://localhost:3000/cs/dev-login?as=admin` → klik "Login as Promoter Admin"

Po loginu jsi v **`/admin`** dashboardu. **30+ podstránek v sidebar**, rozdělené do 6 skupin:

## 3.1 Sidebar struktura

```
┌─ Přehled
│  ├─ Dashboard (KPI)
│  └─ Onboarding wizard
│
├─ Tým & nastavení
│  ├─ Personál (staff_members)
│  └─ Nastavení (brand, fakturační data, payout)
│
├─ Prodej
│  ├─ Akce ← VÝROBA AKCÍ
│  ├─ Abonentky ← NEW (divadelní permanentky)
│  ├─ Sezónní přehled
│  ├─ Objednávky
│  ├─ Zákazníci
│  ├─ Pokladna (POS)
│  └─ Scanner ← NEW (kamera QR)
│
├─ Finance
│  ├─ Výplaty
│  ├─ Faktury ← ISDOC export NEW
│  └─ Bank výpisy
│
├─ Marketing
│  ├─ Promo kódy
│  ├─ Dárkové poukazy ← NEW (branded PDF)
│  ├─ Přístupové kódy
│  ├─ Broadcasty (email)
│  ├─ SMS kampaně
│  ├─ E-mail šablony
│  ├─ Permanentky (subscription plans)
│  └─ Marketplace Ads (CPC)
│
├─ Provoz
│  └─ Chargebacks
│
└─ Audit
   ├─ Audit log
   └─ Notifikace
```

## 3.2 Akce — vytvoření nové akce (krok po kroku)

**URL:** `/admin/events/new`

### Krok 1: Základní info

| Pole | Co tam dát | Příklad |
|---|---|---|
| **Název** | Krátký, max 80 znaků | "Cigaretky a růže" |
| **Popis** | Markdown podporovaný | "Pondělní inscenace v Divadle Hranice..." |
| **Kategorie** | Dropdown (theater, concert, festival, ...) | theater |
| **Typ akce** | physical, online, hybrid | physical |
| **Min age** | 0 = bez omezení, 18 = adult only | 0 |
| **Cover image** | URL nebo upload | https://... |

### Krok 2: Datum + místo

| Pole | Co dát |
|---|---|
| **Datum začátku** | `2026-06-15 19:30` |
| **Datum konce** | volitelné (multi-day) |
| **Venue** | Dropdown z `/admin/venues` |
| **Časové pásmo** | `Europe/Prague` (default) |
| **Sale start** | Kdy spustit prodej |
| **Sale end** | Kdy ukončit prodej (default = datum začátku) |

### Krok 3: Typy lístků

```
+ Nový ticket type
  ├─ Název: "VIP"
  ├─ Cena: 1500 Kč
  ├─ Capacity: 50
  ├─ Sazba DPH: 10% (default kulturní)
  ├─ Visibility: public | access_code | hidden
  ├─ Sale window: nuance (early bird → standard → late)
  └─ Seated: ano/ne (viz §5 Seating)
```

### Krok 4: Publikace

- "Save as draft" — nikdo nevidí
- "Publish" → AI moderation gate:
  - Trusted promotér (≥5 prošlých akcí 90d) → auto-publish
  - Nový promotér → master admin approval queue (`/platform/event-moderation`)

## 3.3 Abonentky (NEW — divadelní permanentky)

**URL:** `/admin/subscriptions`

**Co to je:** Sezónní balíček X představení za zvýhodněnou cenu. Příklad: "Pondělní abonentka 2026/27" = 4 představení v ceně + permanentní místo v sále.

### Vytvoření abonentky (test už jsem připravil)

```
1. /admin/subscriptions → klikni "Nová abonentka"
2. Vyplň:
   - Název: "Pondělní abonentka 2026/27"
   - Slug: pondelni-2026-27 (auto-generated)
   - Sezóna: 2026/27
   - Kategorie: Divadlo
   - Cena: 2500 Kč
   - Kapacita: 50 míst (volitelně)
   - Early bird do: +14 dní (volitelné)
   - Early bird cena: 2000 Kč (sleva 500 Kč)
3. Vyber představení (multi-select z list)
4. Submit → status "on_sale"
```

### Co se stane na frontu kupce

URL `/cs/p/divadlo-hranice/subscriptions/pondelni-2026-27`:
- Hero s brand color + early bird countdown
- 4 představení v číslovaném programu (1, 2, 3, 4)
- "Koupit abonentku" → form (jméno, email)
- Po platbě → status `active` + auto-issue lístky pro všechna 4 představení

## 3.4 Scanner s kamerou (NEW)

**URL:** `/admin/scanner`

### Co umí

- ✅ Kamerové skenování QR/barcode (`html5-qrcode` lib)
- ✅ Manuální vstup UUID (USB scanner support)
- ✅ Multi-day events (re-entry per den)
- ✅ Zones/gates (VIP vs General entry)
- ✅ Offline queue — naskenuje bez netu, sync až bude online
- ✅ Real-time stats (kolik už přišlo)

### Workflow při akci

```
1. Pořadatel přihlásí scanner do `/admin/scanner`
2. Vybere event + zone (např. "Hlavní vstup")
3. Klikne 📷 ikonu → modal s kamerou
4. Browser povolí kameru → video stream
5. Namíř na QR na lístku → automaticky se naskenuje
6. ✅ Admitted (zeleně) / ❌ Already used (červeně)
7. Beep zvuk při scan, auto-close modal po úspěchu
```

## 3.5 Dárkové poukazy (NEW)

**URL:** `/admin/vouchers`

**Co to je:** Voucher s nominální hodnotou (např. 500 Kč), kupec ho zadá při checkoutu jako platební metodu (jako sleva = balance).

### Vystavení voucheru

```
1. /admin/vouchers → vyplň:
   - Hodnota: 500 Kč
   - Počet: 1 (nebo batch až 100)
   - Email příjemce: jan@example.cz (volitelné)
   - Expirace: +1 rok (volitelné)
2. Submit → kód generated (např. "ABCD-EFGH-JKLM")
3. Klikni "PDF" → branded voucher s:
   - Brand color hlavičkou
   - Logo promotéra (vlevo nahoře)
   - Velký 500 Kč display
   - Voucher kód v code box
   - QR pro pohodlné skenování
   - "Jak uplatnit" 4-step návod
```

## 3.6 Faktury + ISDOC export (NEW)

**URL:** `/admin/invoices`

**Co umí:**
- ✅ List všech vystavených faktur (B2B objednávky)
- ✅ Filter podle období, kupce
- ✅ CSV export pro účetní
- ✅ **ISDOC XML export** (NEW) — přímý import do Pohoda, Money S3, Helios

### ISDOC workflow

```
1. /admin/invoices → vidíš seznam faktur
2. Per row → tlačítko ".isdoc" (vpravo)
3. Klikni → stáhne se XML soubor "2026-0042.isdoc"
4. Tvůj účetní v Pohoda: Soubor → Import → ISDOC
5. Faktura automaticky importovaná s všemi položkami + DPH
```

**Co ISDOC obsahuje:**
- Dodavatel (IČO, DIČ, adresa, bank account)
- Odběratel (kupec)
- Položky (název, cena, DPH 10%)
- Celkové sumy (základ, DPH, k úhradě)
- Variabilní symbol pro platbu

## 3.7 Marketing nástroje

### Promo kódy (`/admin/promo-codes`)
- Sleva % nebo Kč
- Single-use / multi-use
- Limit počtu, limit per zákazník
- Datum platnosti
- Per-event nebo globální

### Access kódy (`/admin/access-codes`)
- Pre-sale pro VIP / členy klubu
- Odemyká skryté ticket types
- Limit počtu uplatnění

### Broadcasty (`/admin/broadcasts`)
- Email kampaň komukoliv kdo má lístek na akci X
- Smart send-time (každý uživatel dostane email v jeho optimal time)
- Templates (welcome, reminder, post-event)

### SMS kampaně (`/admin/sms-campaigns`)
- Přes BulkGate provider
- 160 znaků (1 segment)
- Audience filter (kupci posledních 90 dní)

### Audience segmentace (`/admin/customers` → Segments)
- 6 dimenzí: spend, frequency, recency, category, geo, source
- Predefined: "VIP", "Lapsed", "First-time"
- Custom segments s SQL-like filtrem

### Marketplace Ads (`/admin/ads`)
- CPC bidding na homepage / kategorie slot
- Min bid: 1 Kč
- Daily budget cap

---

# 4. Buyer — co vidí a dělá kupec

## 4.1 Discovery (homepage `/cs`)

```
┌──────────────────────────────────────────────┐
│  🎫 Vstupenky, které prostě fungují         │
│  [Procházet akce] [Hledat]                   │
├──────────────────────────────────────────────┤
│  Kategorie: 🎵 Koncerty (47) · 🎭 Divadlo... │
├──────────────────────────────────────────────┤
│  ✨ Doporučeno pro tebe                      │
│  [card] [card] [card]                        │
├──────────────────────────────────────────────┤
│  ⭐ Tipy redakce — Vybráno pro tebe          │
│  [card "Tip redakce"] [card] [card]          │
├──────────────────────────────────────────────┤
│  🔥 Tento týden                              │
│  [event] [event] [event]                     │
├──────────────────────────────────────────────┤
│  Promotéři: Divadlo Hranice (14) · ...       │
└──────────────────────────────────────────────┘
```

## 4.2 Event detail (`/cs/events/<slug>`)

**Co kupec vidí:**

1. **Hero**: cover image, title, datum, místo
2. **Popis akce** (markdown)
3. **RSVP buttons** (NEW): "❤️ Zajímá mě (3)" + "✓ Půjdu (7)" + "📅 Uložit do kalendáře (.ics)"
4. **Sdílení**: FB, Twitter, copy link
5. **Ticket picker** (vpravo):
   - List ticket types s cenou + dostupnost
   - Quantity selector
   - "Koupit" CTA → checkout

## 4.3 Checkout flow

```
1. Event detail → "Koupit" 2× VIP
2. /cs/checkout → vyplnit:
   - Jméno + příjmení (CZ pattern, ne single field)
   - Email
   - Telefon (volitelné)
   - Datum narození (pokud akce 18+)
   - ✓ Souhlas s podmínkami
   - ✓ Souhlas s GDPR
   - Volitelné: promo kód, voucher kód
3. "Pokračovat na platbu" → výběr metody:
   - Karta (GoPay)
   - Bankovní převod (Fio API)
   - Twisto (BNPL)
   - Pluxee / Sodexo / Edenred / Benefit+ (employee benefits)
4. Redirect na payment gateway (v dev: /mock-gopay)
5. Po platbě → /cs/order-confirmation/<id>
   - PDF lístků emailem
   - Apple/Google Wallet pass
   - Save to calendar link
```

## 4.4 Moje lístky (`/cs/my-tickets`)

- Aktivní lístky + minulé akce
- Per lístek:
  - "Stáhnout PDF" — branded s QR
  - "Apple Wallet" / "Google Wallet"
  - "Předat někomu" — transfer flow
  - "Prodat dál" — resale marketplace (P2P face-value)
  - "Vrátit lístek" — refund flow (14-day EU rule)

## 4.5 GDPR consent (`/cs/legal/cookie-settings`)

- 3 checkboxy: Essential (always on), Analytics, Marketing
- "Uložit změny" / "Odvolat veškerý souhlas"
- Server-side audit log s timestamp + IP hash

---

# 5. Seating editor — kompletní walkthrough

**KLÍČOVÁ SEKCE — TO JE TO CO JSI NEJVÍCE CHTĚL VĚDĚT.**

## 5.1 Koncept: master venue + per-event mapping

Tixly používá **2-úrovňový model**:

| Úroveň | Kdo dělá | Co ukládá | Příklad |
|---|---|---|---|
| **Master venue** | Master admin (TY) | Fyzická realita sálu — sektory, řady, sedadla, souřadnice | O2 Arena, Rudolfinum, Letná |
| **Event seat mapping** | Promotér | Per-akce: ceny per sektor, dostupnost, hold pravidla | "Sekce A = 1500 Kč, B = 800 Kč" |

**Proč 2-úrovňový?**
- Master venue je sdílený mezi promotéry (O2 Arena: koncert dnes, hokej zítra — stejný sál)
- Promotér nemusí znovu malovat sál pro každou akci
- Per-event jen ceny + zóny + dostupnost (rychlé)

## 5.2 Master admin — vytvoření nového sálu

**URL:** `/platform/venues/new` (zatím přes API + scripts)

### Workflow

```
1. Promotér nahlásí: "Otevřeli jsme nový stadion, 10 000 míst"
2. TY (master admin) máš 3 možnosti:
   A) Hotová mapa od architekta → import PDF/CAD
   B) Existující venue z konkurence → screenshot
   C) Ručně nakreslit
3. Postupuj podle bodu 5.3-5.5 níže
```

## 5.3 Cesta A: Z existujícího seating chart (Ticketportal, Eventim, ...)

```bash
# 1. Najdi existující venue na konkurenci
# Příklad: https://www.mapaplan.com/seating-plan/prague-o2-arena-praha-mapa-plan-sedadla-interactive-seat-row-numbers

# 2. Screenshot mapy + manuální převod do JSON
# Soubor: scripts/seating-imports/<venue-slug>.json

{
  "venue_id": "<uuid>",
  "name": "O2 Arena Praha",
  "total_capacity": 14000,
  "sectors": [
    {
      "id": "lower-a1",
      "label": "LOWER A1",
      "type": "seated",      // seated | standing | vip
      "rows": 15,
      "seats_per_row": [20, 22, 24, 24, 26, 28, 28, 28, 28, 28, 26, 24, 24, 22, 20],
      "x": 100, "y": 200,    // pozice na canvas
      "rotation": 0,         // úhel (pro zakřivené sály)
      "color": "#4f46e5"     // pro UI vizualizaci
    },
    ...
  ]
}

# 3. Import script
node scripts/import-venue-from-json.mjs scripts/seating-imports/o2-arena.json

# 4. Verify
docker exec tixly-postgres psql -U tixly -d tixly -c "
  SELECT name, total_capacity FROM catalog.venues WHERE slug = 'o2-arena';
"
```

## 5.4 Cesta B: Generátor podle parametrů (pro nové sály)

**URL:** `scripts/generate-rich-layouts.mjs`

### Příklad: Letná Stadium

```bash
node scripts/generate-rich-layouts.mjs --type=stadium \
  --name="Letná" \
  --rings=2 \
  --sectors-per-ring=20 \
  --rows=15 \
  --seats-per-row=22

# Vygeneruje:
# - 1 LOWER ring s 20 sektory (15×22 = 330 míst per sektor = 6 600 total)
# - 1 UPPER ring s 20 sektory (15×22 = 330) = 6 600
# - Celkem 13 200 míst
```

### Algorithm (radius / angle calculations)

```js
// Pseudo-code z scripts/generate-rich-layouts.mjs
const centerX = 500, centerY = 500;
const lowerRingRadius = 300;
const upperRingRadius = 400;

for (let sectorIdx = 0; sectorIdx < 20; sectorIdx++) {
  const angle = (sectorIdx / 20) * Math.PI * 2; // 0–360°
  for (let row = 0; row < 15; row++) {
    const rowRadius = lowerRingRadius + row * 12;
    for (let seat = 0; seat < 22; seat++) {
      const seatAngle = angle + (seat - 11) * 0.01;
      const x = centerX + Math.cos(seatAngle) * rowRadius;
      const y = centerY + Math.sin(seatAngle) * rowRadius;
      // Insert seat to DB
    }
  }
}
```

## 5.5 Validation — overlap detection

**KRITICKÉ:** Po vytvoření venue MUSÍŠ spustit overlap check:

```bash
node scripts/check-overlaps.mjs --venue=<venue-slug>

# Output:
# ✅ Letná: 0 hard collisions (touching: 12 — OK pro výšky)
# ❌ Olomouc: 47 hard collisions — Sector A4 overlaps A5 (10px gap)
```

**Pravidla (4 železná):**
1. **pitch ≥ 18px** mezi sedadly (jinak vypadají jak slepené)
2. **Sektor ≥ 3 řady × 6 sedadel** (jinak je to chuchel)
3. **Pouze axis-aligned** (nepatří otáčení sektorů, ledaže celý stadion)
4. **Explicitní stage box** (kde je pódium, žádné sedadlo tam)

## 5.6 Promotér — per-event seat mapping

Když promotér vytvoří akci pro existující venue:

```
1. /admin/events/new
2. Vybere venue: "O2 Arena Praha" (master venue)
3. /admin/events/<id>/seating → wizard:
   a) Zobrazí mapu O2 Areny (z master venue)
   b) Promotér klikne sektor LOWER A1 → "Cena: 1500 Kč, ticket type: VIP"
   c) Klikne LOWER A2-A5 → "Cena: 800 Kč, ticket type: Standard"
   d) Klikne UPPER → "Cena: 400 Kč, ticket type: Galerie"
4. Save → catalog.event_seats tabulka má per-sedadlo:
   - event_id, seat_id, ticket_type_id, status (available/sold/blocked)
```

### Test scenario

```
1. /admin/venues → vidíš seznam master venues (Rudolfinum, O2, Letná)
2. Klikni "O2 Arena Praha" → SVG mapa s 14 000 sedadly
3. /admin/events/new → vyber "Rolling Stones koncert"
   - Venue: O2 Arena Praha
   - Datum: 2026-10-15
4. /admin/events/<id>/seating → otevři seating editor
5. Drag-select sektor LOWER A1 → "Set price: 4500 Kč, type: VIP"
6. Drag-select LOWER B-D → "1500 Kč, Standard"
7. Save → all 14 000 sedadel mají cenu + ticket type assignment
8. Publish → buyer vidí mapu na /cs/events/<slug>/seats
```

## 5.7 Buyer seat selection

```
1. /cs/events/<slug> → klikni "Vybrat sedadla"
2. /cs/events/<slug>/seats → SVG mapa s legendou:
   - Žlutě: VIP (4500 Kč)
   - Modře: Standard (1500 Kč)
   - Zeleně: Galerie (400 Kč)
   - Šedě: vyprodáno
3. Klik sedadlo → highlight zelenou (selected)
4. Vybrané sedadlo se Redis-locks na 10 min (anti-double-booking)
5. "Pokračovat" → checkout s konkrétními sedadly
6. Po nákupu → seats trvale `sold`, na mapě šedé
```

---

# 6. Konkrétní use-cases — 4 scénáře krok-po-kroku

## 6.1 Use-case: Nový promotér se registruje

```
1. /cs/onboarding → wizard:
   - IČO, název firmy, kontakt
   - Brand color (pro PDF, embeds)
   - Logo upload
   - Bankovní účet pro payouty
   - DIČ (pokud plátce DPH)
2. Submit → status "pending"
3. Email TI (master admin): "Nová registrace — Divadlo XYZ"
4. /platform/promoters → schválit
5. Promotér dostane email "Účet aktivován, můžete přidávat akce"
```

## 6.2 Use-case: Divadlo zakládá sezónu 2026/27

```
1. Promotér: /admin/events/new
   - Vytvoří 16 představení (1 týdně, 4 měsíce)
   - Každé použije stejný master venue (Stará střelnice)
   - Stejné ceny (default ticket types)
2. /admin/subscriptions/new → "Pondělní abonentka 2026/27"
   - Vyber 4 představení (1.10., 5.11., 3.12., 7.1.)
   - Cena: 1200 Kč (sleva 400 Kč oproti 1×400 + 1×500 + 1×300 + 1×300 = 1500)
   - Early bird: -200 Kč do 31.8.
   - Kapacita: 50 míst
3. Publish → URL: /cs/p/divadlo/subscriptions/pondelni-2026-27
4. Marketing:
   - Newsletter k existujícím followerům
   - SMS kampaň
   - Marketplace ad na homepage
5. Kupci kupují → po platbě auto-issue 4 lístky
6. Den akce → scanner detekuje abonentku
```

## 6.3 Use-case: Festival s 10 000 lístky

```
1. Promotér: /admin/events/new
   - Multi-day event (3 dny)
   - Venue: festival ground (standing, no seats)
2. Ticket types:
   - 1-day pass: 1500 Kč
   - 3-day pass: 3500 Kč
   - VIP pass: 5000 Kč
3. /admin/access-codes/new — pre-sale pro fan club (10% off)
4. Marketing:
   - Email broadcast 50 000 přihlášeným
   - Meta Pixel + Google Ads (pixel ID v event nastavení)
5. Den akce:
   - 5 scannerů u vchodu (multi-device)
   - Real-time stats v /admin/scanner/stats
   - Anti-fraud: jeden lístek = max 1 scan
6. Po akci:
   - Refund cron (cancelled? full refund)
   - Payout výpočet (provize 5% z 35M Kč = 1.75M Kč na tixly side)
```

## 6.4 Use-case: Promotér napíše API integraci

```
1. Promotér: /admin/api/keys → "Vytvoř API key"
   - Scope: events:read, events:write
   - Env: test → live
2. Token: tick_test_a1b2c3d4...
3. Promotér používá v jejich CRM:
   curl -H "Authorization: Bearer tick_test_..." \
     https://app.tixly.cz/api/v1/events
4. Webhook: /admin/webhooks/new
   - URL: https://crm.divadlo.cz/tixly-webhook
   - Events: ticket.sold, order.refunded
   - Secret: HMAC signing
5. Tixly zpracuje order → POST na promotér URL s payload
6. Promotér's CRM aktualizuje jejich systém
```

---

# 7. API a integrace

## 7.1 B2B API (read-only pro promotéry)

**Base URL:** `https://app.tixly.cz/api/v1`
**Auth:** `Authorization: Bearer tick_(test|live)_<hex>`
**Rate limit:** 1000 req/min per API key

### Endpoints

```
GET  /api/v1/events                    — list events promotéra
GET  /api/v1/events/<id>               — event detail
GET  /api/v1/orders                    — list orders
GET  /api/v1/tickets                   — list issued tickets
GET  /api/v1/ticket-types              — pricing
```

## 7.2 Webhooks (outbound)

| Event | Payload |
|---|---|
| `event.published` | event ID, title, date |
| `ticket.sold` | order ID, ticket ID, buyer info, price |
| `order.refunded` | order ID, refund amount, reason |
| `event.cancelled` | event ID, refund eligibility |
| `payout.completed` | payout ID, amount, period |

## 7.3 Embed widget (pro promotérův web)

```html
<!-- Jeden event -->
<div data-tixly-event="EVENT_UUID" data-variant="card"></div>

<!-- Celá agenda promotéra -->
<div data-tixly-promoter="divadlo-hranice" data-limit="12"></div>

<script async src="https://app.tixly.cz/embed.js"></script>
```

---

# 8. Provoz a monitoring

## 8.1 Status pro provozovatele (TEBE)

| Co | Kde | Frekvence |
|---|---|---|
| **Health check** | `/api/health/ready` | každou minutu (Better Uptime) |
| **DB stav** | `/api/health/db` | každých 5 min |
| **Redis stav** | `/api/health/redis` | každých 5 min |
| **Payment providers** | `/api/health/providers` | každých 10 min |
| **Status page** | `/cs/status` (veřejná) | real-time z DB |

## 8.2 Cron jobs (16 aktivních)

```
expire-pending-orders          — každých 5 min  (10 min na zaplacení → cancel)
release-expired-seat-holds     — každých 5 min  (Redis lock TTL)
send-reminders                 — každých 15 min (1 den před akcí)
abandoned-cart                 — každých 6 hod  (started checkout, neplatil)
waitlist-notify                — každých 30 min (uvolnily se lístky)
bank-sync-fio                  — každé 2 hod    (Fio API import)
charge-installments            — denně 03:00    (BNPL splátky)
renew-subscriptions            — denně 04:00    (auto-renewal abonentek)
daily-stats                    — denně 06:00    (KPI email promotérům)
onboarding-reminder            — denně 09:00    (nový promotér, neaktivní 7d)
process-gdpr-deletions         — denně 02:00    (Art. 17 — anonymize PII)
anomaly-detect                 — každou hodinu  (fraud patterns)
release-rolling-reserves       — denně 05:00    (po 30d uvolnit reserved)
promoter-tier-evaluate         — měsíčně 1. den (auto-upgrade tier)
payouts-auto-settle            — pondělky 07:00 (týdenní vyplacení)
consent-log-purge              — pondělky 04:00 (GDPR 90d retention)
newsletter-digest              — pondělky 09:00 (NEW — weekly digest)
```

## 8.3 DR runbook (disaster recovery)

`docs/RUNBOOK-DISASTER-RECOVERY.md` — co dělat při:
- Postgres výpadek (P0, RTO 30 min)
- Redis výpadek (P1, RTO 5 min)
- Email queue zaseknutá (P1)
- Payment provider down (failover GoPay ↔ ComGate)

---

# 9. Test scénáře — co projít při manuálním testu

## 9.1 Smoke (5 min) — funguje vůbec něco?

| # | Co | URL | Expected |
|---|---|---|---|
| 1 | Homepage načte | `/cs` | 200 + 3 sekce viditelné |
| 2 | Event detail | `/cs/events` → klik první | RSVP buttons + Koupit |
| 3 | Admin login | `/cs/dev-login?as=admin` | Redirect na /admin |
| 4 | Platform login | `/cs/dev-login?as=platform` | Redirect na /platform |
| 5 | API health | `/api/health/ready` | `{ok: true}` |

## 9.2 Buyer journey (10 min)

| # | Co | URL/akce |
|---|---|---|
| 1 | Cookie consent | `/cs` → banner → "Přijmout vše" |
| 2 | Discover | Homepage → 3 sekce (Doporučeno, Tipy redakce, Tento týden) |
| 3 | Event detail | Klikni event → RSVP "Půjdu" → `.ics` download |
| 4 | Checkout | "Koupit 2× VIP" → fill form → mock GoPay → Pay |
| 5 | Confirmation | `/cs/order-confirmation/<id>` → email v MailHog |
| 6 | My tickets | `/cs/my-tickets` → PDF download |
| 7 | Wallet pass | "Add to Apple Wallet" → `.pkpass` |
| 8 | Transfer | "Předat" → email recipient → mock send |
| 9 | Abonentka | `/cs/p/divadlo-hranice/subscriptions/pondelni-2026-27` → Koupit |
| 10 | Refund | `/cs/my-tickets` → "Vrátit" → reason → confirm |

## 9.3 Promotér admin (15 min)

| # | Co | URL |
|---|---|---|
| 1 | Create event | `/admin/events/new` → wizard 4 kroky |
| 2 | Publish | Click Publish → AI moderation → published |
| 3 | Ticket types | `/admin/events/<id>/ticket-types` → add VIP/Standard |
| 4 | Voucher | `/admin/vouchers` → create 500 Kč → download PDF |
| 5 | Abonentka | `/admin/subscriptions/new` → 4 events → publish |
| 6 | Scanner | `/admin/scanner` → 📷 ikona → kamera otevře |
| 7 | Invoices | `/admin/invoices` → ISDOC download |
| 8 | Marketing | `/admin/ads/new` → CPC bid |
| 9 | Analytics | `/admin/analytics` → revenue chart |

## 9.4 Platform admin (5 min)

| # | Co | URL |
|---|---|---|
| 1 | Promoters | `/platform/promoters` → vidíš 6 promotérů |
| 2 | Moderation | `/platform/event-moderation` → schválit pending |
| 3 | Featured | API: `POST /api/platform/admin/events/<id>/feature` |
| 4 | DSA | `/platform/dsa-reports` → fronta |
| 5 | Audit log | `/platform/audit-log` → poslední 100 akcí |
| 6 | Incident | `/platform/incidents/new` → publish → `/cs/status` |
| 7 | Payouts | `/platform/payouts` → měsíční přehled |

## 9.5 Edge cases (10 min)

| Scenario | Test | Expected |
|---|---|---|
| Sold out | Event s 0 remaining | "Vyprodáno" badge + Koupit disabled |
| Promo kód | Aplikovat -10% | Cena -10% v summary |
| Wrong promo kód | "FAKE123" | "Neplatný kód" inline error |
| Race condition | 2 buyer kupují stejné sedadlo | First wins, second "Sedadlo právě obsazeno" |
| Refund | 14 dní od nákupu | Full refund OK; 15+ dní → "Refund window expired" |
| Anonymous + RSVP | `/cs/events/X` → "Zajímá mě" bez login | "Pro RSVP se přihlas" |
| Pohoda export | Stáhnout `.isdoc` | Otevřít v Pohoda → import OK |
| Embed widget | HTML soubor na desktopu | iframe se načte, klik otevře tixly.cz |

---

## Závěr

**Stav k 2026-05-20:**
- ✅ **152 commitů na GitHub**: https://github.com/omniascz/tixly
- ✅ **419 unit testů** zelené
- ✅ **28 E2E testů** zelené
- ✅ **286 DB migrací** aplikovaných
- ✅ **Demo end-to-end** funguje (buyer kupí, promotér prodává, master schvaluje)

**Co chybí pro produkci:**
1. **GoPay live API key** (smlouva + KYC) — ~14 dní
2. **Resend SMTP doména verified** — 1 hodina
3. **Vercel deploy** — 30 minut (hotové připravené)
4. **Neon Postgres** + apply migrations — 30 minut
5. **Cestou:** VAPID keys, Sentry DSN, Better Uptime probes — celkem ~1 hodina

**Doporučený pořadí akcí:**
1. **Tento týden:** Manuální walkthrough podle §9 (najít bugs)
2. **Příští týden:** Smlouvy s GoPay, Resend, Sentry
3. **Po podpisu:** Vercel deploy → preview URL
4. **Po test:** Custom domain `app.tixly.cz` + go live

**Nejlepší zdroj pravdy:**
- Code: `https://github.com/omniascz/tixly`
- DB schema: `migrations/*.sql` (286 souborů)
- Docs: `docs/` (DB-AUDIT, RUNBOOK-DR, COMPETITIVE-ANALYSIS, GOOUT-DEEP-DIVE, RLS-MIGRATION-GUIDE, atd.)
