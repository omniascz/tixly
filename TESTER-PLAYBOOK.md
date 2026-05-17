# Tester playbook — Tixly hands-on QA

> Pořadí kroků = pořadí, v jakém testovat. Pokud na **kterémkoli** kroku něco selže, napiš mi heslo `fail Xn` (např. `fail B3`) a pokud možno screenshot — já si dotáhnu kontext sám.

**Demo URL:** `http://localhost:3000` (nebo `https://<staging>` pokud běží)
**Datum testu:** _doplň_
**Větev:** `master` (commit `fde40aa`)

---

## Demo přihlašovací údaje

| Role | Email | Heslo |
|---|---|---|
| Master admin | `superadmin@tixly.cz` | `Demo2026!` |
| Promotér (Stará střelnice) | `theatre@hranice.cz` | `Demo2026!` |
| Promotér (Velký sál Praha) | `koncerty@nationalgroup.cz` | `Demo2026!` |
| Promotér (Aréna + Stadion) | `arena@multiprod.cz` | `Demo2026!` |
| Promotér (Klub Underground) | `klub@underground.cz` | `Demo2026!` |
| Promotér (Divadlo v Celetné) | `verze@divadlovceletne.cz` | `Demo2026!` |
| VIP kupec | `anna.nova@example.cz` | `Demo2026!` |
| Kupec (vzor) | `{jmeno}.{prijmeni}@example.cz` | `Demo2026!` |

---

## A. Veřejná část (anonymní návštěvník)

Cíl: ověřit discovery, vyhledávání a vstup do public event detailu **bez přihlášení**.

### A1 — Homepage
- **URL:** `/cs`
- **Akce:** Otevři homepage v anonymním okně.
- **Očekávané:**
  - Vidíš grid akcí s obrázky, datem, městem, cenou „od"
  - Nahoře jazyk přepínač (CS/EN/SK)
  - Žádné rozbité obrázky, žádný 500
- **Fail signál:** `fail A1` — popiš co je rozbité (žádný grid / 500 / prázdné).

### A2 — Detail public eventu
- **URL:** klikni na první kartu, nebo přímo `/cs/p/romeo-a-julie` (musíš znát slug — vezmi z homepage)
- **Akce:** Otevři detail.
- **Očekávané:**
  - Velký cover, název, datum, místo, mapa Google/OSM
  - Tlačítko „Koupit vstupenky"
  - Sekce popisu, dostupných typů vstupenek s cenou
  - **Žádné** placeholder texty typu „Lorem ipsum"
- **Fail signál:** `fail A2`.

### A3 — Vyhledávání
- **URL:** `/cs/search?q=romeo`
- **Akce:** Hledej „romeo", pak „koncert", pak „neexistujícíkockodán".
- **Očekávané:**
  - Pro „romeo" min. 1 výsledek (R&J)
  - Pro „koncert" min. 1 výsledek (Symfonický)
  - Pro nesmysl prázdný stav s textem „nic nenalezeno", nikdy ne 500
- **Fail signál:** `fail A3`.

### A4 — Discovery filtry
- **URL:** `/cs/events`
- **Akce:** Vyzkoušej filtry města / kategorie / data.
- **Očekávané:** URL parametry se mění a grid se filtruje. Mapový pohled (pokud je) zoomuje na výběr.
- **Fail signál:** `fail A4`.

### A5 — Public promotér profil
- **URL:** `/cs/p/divadlo-v-celetne` _(nebo jaký je slug)_
- **Akce:** Otevři profil promotéra.
- **Očekávané:** Branding (logo, barvy), bio, seznam jejich akcí.
- **Fail signál:** `fail A5`.

---

## B. Registrace + login + nákup (golden path kupce)

Cíl: full happy path od signupu po PDF v mailu. **Tohle je #1 kritický flow.**

### B1 — Buyer signup
- **URL:** `/cs/register`
- **Akce:** Email `test+$(unix-timestamp)@example.cz`, heslo `Test2026!`, jméno „Test Kupec".
- **Očekávané:**
  - 201, mail s ověřovacím odkazem (MailHog: `http://localhost:8025` nebo zobrazí se notice na UI)
  - Redirect na buyer dashboard nebo on-boarding
- **Fail signál:** `fail B1`.

### B2 — Email verifikace
- **URL:** z mailu (`/cs/verify-email?token=...`)
- **Akce:** Klikni na odkaz v MailHogu.
- **Očekávané:** „Email ověřen" + redirect na `/cs/my-tickets` (zatím prázdné).
- **Fail signál:** `fail B2`.

### B3 — Výběr eventu a sedadel
- **URL:** vrať se na `/cs/p/romeo-a-julie` (nebo libovolný **published** event s mapou)
- **Akce:**
  1. Klikni „Koupit"
  2. Otevře se seat picker
  3. Vyber 2 sedadla v různých cenách (např. parter A12, balkon B5)
  4. Klikni „Pokračovat"
- **Očekávané:**
  - Mapa se vykreslí (žádné prázdné `<svg>`)
  - Sedadla se barví podle dostupnosti (zelená=volná, šedá=obsazená)
  - Po kliknutí se vybraná označí modře, cena se sčítá v košíku vpravo/dole
- **Fail signál:** `fail B3` — mapa prázdná = kritický bug (chybí `copy_layout_to_event_seats`).

### B4 — Checkout
- **URL:** `/cs/checkout`
- **Akce:**
  - Vyplň jméno, příjmení, telefon
  - Vyber **GoPay** (kartu) nebo **bank transfer** (Variabilní symbol)
  - Souhlas s VOP
  - „Zaplatit"
- **Očekávané:**
  - Validace formuláře (zkus prázdné pole — musí ho odmítnout)
  - **GoPay** → redirect na produkční GoPay nebo na `/mock-gopay/[id]` (pokud env chybí)
  - **Bank transfer** → redirect na `/cs/order-confirmation/[id]?awaiting=bank_transfer` se zobrazením VS (10-digit formát `EEEEEENNNN`)
- **Fail signál:** `fail B4`.

### B5 — Mock platba / reálný GoPay/ComGate redirect
- **URL:** `/mock-gopay/[id]` (v dev) nebo gate URL (v prod)
- **Akce:**
  - **Dev mock:** klikni „Úspěch" → redirect na `/cs/order-confirmation/[orderId]`
  - **Prod GoPay:** vyplň testovací kartu (sandbox: 4000 0000 0000 0008) → 3DS challenge → „Pay"
  - **Prod ComGate:** podobné, vlastní formulář
- **Očekávané:**
  - Po úspěšné platbě webhook (`/api/payments/gopay/webhook` nebo `/api/payments/comgate/webhook`) označí order `paid`
  - Trigger `/api/internal/order-completed` → email s PDF
  - Confirmation page „Děkujeme", číslo objednávky, sumár sedadel
- **Fail signál:** `fail B5`. Pokud webhook neproběhne, zkontroluj logs + audit_log.

### B5b — Bank transfer flow (jen pokud testuješ tuto metodu)
- **URL:** `/cs/order-confirmation/[id]?awaiting=bank_transfer`
- **Očekávané:**
  - Zobrazí se účet (`platform.promoters.bank_account`) + VS (10-digit) + částka
  - Status objednávky: `pending`, expire za 3 dny
  - Po reálném převodu: Fio cron stáhne výpis, automaticky páruje by VS → status `paid`
- **Fail signál:** `fail B5b` — pokud VS chybí nebo není 10-digit.

### B6 — Mail s PDF vstupenkou
- **URL:** MailHog `http://localhost:8025`
- **Akce:** Najdi mail s předmětem „Vaše vstupenky".
- **Očekávané:**
  - Mail dorazil do 5 vteřin po B5
  - PDF příloha (1 PDF s 2 vstupenkami, nebo 2 PDF)
  - V PDF: QR kód, jméno akce, sedadlo, datum, jméno kupce, branding promotéra
- **Fail signál:** `fail B6`.

### B7 — Moje vstupenky
- **URL:** `/cs/my-tickets`
- **Akce:** Najdi objednávku z B5.
- **Očekávané:**
  - Vidíš objednávku + 2 lístky, status `paid`
  - Tlačítko „Stáhnout PDF", „Přidat do Apple/Google Wallet" (může chybět — nahlas pokud chybí)
  - Tlačítka „Refundovat" / „Přeposlat" / „Prodat (resale)"
- **Fail signál:** `fail B7`.

---

## C. Scan na vchodu (entry)

### C1 — Skener přihlášení
- **URL:** `/t` _(nebo `/admin/scanner`)_
- **Akce:** Přihlas jako promotér (např. `theatre@hranice.cz`), vyber svůj event.
- **Očekávané:** Kamera (povolit přístup) nebo manuální zadání QR.
- **Fail signál:** `fail C1`.

### C2 — Validní sken
- **Akce:** Načti QR z PDF z B6.
- **Očekávané:**
  - **Zelená** notifikace „OK — Sedadlo A12, kupec Test Kupec"
  - Sken se uloží do `tickets.scan_logs`
- **Fail signál:** `fail C2` — pokud červená nebo error, zkontroluj `scan_logs`.

### C3 — Druhý sken stejné vstupenky
- **Akce:** Načti stejný QR podruhé.
- **Očekávané:** **Červená** „Již použito" + timestamp prvního skenu.
- **Fail signál:** `fail C3`.

### C4 — Sken cizí vstupenky
- **Akce:** Zkus naskenovat QR z jiného eventu / placeholder TOTP secret z demo seedu.
- **Očekávané:** Červená „Neplatná vstupenka pro tento event".
- **Fail signál:** `fail C4`.

---

## D. Refund (self-service)

### D1 — Refund tlačítko v `/my-tickets`
- **URL:** `/cs/my-tickets`
- **Akce:** U objednávky z B5 klikni „Refundovat".
- **Očekávané:**
  - Modal s pravidly (deadline, fee, kolik dostaneš zpět)
  - Potvrzovací tlačítko
- **Fail signál:** `fail D1` — pokud tlačítko chybí, je to známá P1 #5.

### D2 — Provedení refundu
- **Akce:** Potvrď refund.
- **Očekávané:**
  - Status objednávky → `refunded`
  - Mail „Vaše objednávka byla zrušena"
  - Sedadlo zpět dostupné v seat pickeru (ověř B3 znovu)
- **Fail signál:** `fail D2`.

---

## E. Promotér flow (vytvoření eventu)

### E1 — Promotér login
- **URL:** `/cs/login` jako `verze@divadlovceletne.cz`
- **Očekávané:** Redirect na `/admin` s brandingem Divadla v Celetné.
- **Fail signál:** `fail E1`.

### E2 — Vytvoření nové akce
- **URL:** `/admin/events/new`
- **Akce:** Vyplň název, datum, sál, popis, cover image, ticket types.
- **Očekávané:**
  - Wizard ve 4–5 krocích
  - Validace v každém kroku
  - Možnost uložit draft a pokračovat
- **Fail signál:** `fail E2`.

### E3 — Publikace
- **Akce:** „Odeslat ke schválení" (pokud tier 1) nebo „Publikovat" (tier 2+).
- **Očekávané:**
  - Pro tier 1: mail master adminovi, status `pending_review`
  - Pro tier 2+: status `published`, akce dostupná na `/cs/events`
- **Fail signál:** `fail E3`.

### E4 — Editace publikované akce
- **Akce:** Změň popis, přidej obrázek, zkus změnit datum.
- **Očekávané:**
  - Popis a obrázky lze měnit
  - Datum/místo zamčené po publikaci (SMSticket-style)
- **Fail signál:** `fail E4`.

### E5 — Promo kód
- **URL:** `/admin/promo-codes`
- **Akce:** Vytvoř kód `TEST20` na 20 % slevu, limit 5 použití.
- **Očekávané:** Kód se objeví v seznamu, lze ho uplatnit v B4.
- **Fail signál:** `fail E5`.

---

## F. Pokročilé scénáře (volitelné, dle času)

### F1 — Transfer vstupenky
- **URL:** `/cs/my-tickets` → „Přeposlat"
- **Očekávané:** Pravděpodobně **chybí** (P1 #7). Pokud chybí, napiš `chybí F1`.

### F2 — Resale (peer-to-peer prodej)
- **URL:** `/cs/my-tickets` → „Prodat"
- **Očekávané:** Modal s cenou, listing v `/cs/resale`.
- **Fail signál:** `fail F2`.

### F3 — Lottery (loterijní výběr)
- **URL:** `/cs/lottery`
- **Očekávané:** Stránka existuje, lze se přihlásit do losování o omezené vstupenky.
- **Fail signál:** `fail F3`.

### F4 — Gift / dárkové vouchery
- **URL:** `/cs/gift`
- **Akce:** Kup gift card.
- **Očekávané:** PDF voucher s kódem, uplatnitelný v checkoutu.
- **Fail signál:** `fail F4`.

### F5 — Embed widget
- **URL:** `/embed/event/<id>` (iframe widget pro promotér web)
- **Očekávané:** Mini-widget se seznamem akcí nebo seat pickerem, žádné error.
- **Fail signál:** `fail F5`.

### F6 — Public GraphQL API
- **URL:** `http://localhost:3000/api/graphql`
- **Akce:** Vyzkoušej `{ events { edges { node { title slug } } } }` v GraphiQL nebo Insomnii.
- **Očekávané:** Read-only odpověď s eventy.
- **Fail signál:** `fail F6`.

---

## F+ — CZ/SK launch features (po nové vlně)

### F7 — Promoter CZ/SK settings (master admin)
- **URL:** `/platform/promoters/[id]` jako `superadmin@tixly.cz`
- **Akce:** Najdi karta „CZ/SK launch — tržiště + sazby".
- **Očekávané:**
  - Country select: 🇨🇿 CZ / 🇸🇰 SR
  - Currency: CZK / EUR
  - Tier 1-4 selector s popisem
  - Holdback override (% + dní)
  - Fee override (% + buyer fee + důvod)
  - Klik „Uložit" → 200 + zobrazí „Uloženo."
- **Test path:** Změň `theatre@hranice.cz` na country=CZ, tier=2, fee=5 %, buyer_fee=10 Kč. Reload — hodnoty persist.
- **Fail signál:** `fail F7`.

### F8 — Event refund/QR/VAT settings (promotér)
- **URL:** `/admin/events/[id]/settings` jako promotér
- **Očekávané:** 3 nové sekce:
  - **Refund pravidla** — 3 inputy (deadline dní, fee %, min fee)
  - **QR kód policy** — 4 radio buttony (static/24h/only/photo)
  - **DPH kategorie** — 5 možností s CZ + SR sazbami
- **Test path:** Nastav refund deadline=7, fee=5 %, qr_policy=rotating_24h. Reload — hodnoty persist.
- **Fail signál:** `fail F8`.

### F9 — VS pro bank transfer (10-digit per-event)
- **Akce:** V B5b objednávka, podívej se na VS.
- **Očekávané:** Přesně **10 cifer** ve formátu `EEEEEENNNN` (6-digit event hash + 4-digit per-event sequence).
- Příklad: Romeo a Julie (event_id první 8 hex = 12345678 mod 1M = 654321) → první lístek = `6543210001`.
- **Fail signál:** `fail F9`.

### F10 — Refund po deadlinu (event policy)
- **Akce:** Nastav akci `refund_deadline_days=1`. Kup lístek. Den před akcí klikni refund v `/my-tickets`.
- **Očekávané:** Refund proběhne (jeden den před = OK).
- **Akce 2:** Stejné, ale v den akce — refund odmítnut s `REFUND_DEADLINE_PASSED`.
- **Fail signál:** `fail F10`.

### F11 — QR rotating_24h enforcement
- **Akce:** Nastav akci `qr_policy=rotating_24h`. Kup lístek 48h před akcí. Naskenuj statický QR z PDF.
- **Očekávané:** Sken OK (před 24h windowem). Stejný flow 12h před akcí → sken odmítnut s `totp_required`.
- **Fail signál:** `fail F11`.

### F12 — SK DPH 5 %
- **Akce:** Vytvoř promotéra s `country=SR`, `primary_currency=EUR`. Akce s `vat_category=cultural`. Kup lístek za 30 EUR.
- **Očekávané:** PDF účtenka zobrazuje DPH 5 % (ne 10 % jak CZ). Net = 28.57 EUR, VAT = 1.43 EUR.
- **Fail signál:** `fail F12`.

---

## G. Master admin (platforma)

### G1 — Platform admin login
- **URL:** `/cs/login` jako `superadmin@tixly.cz`
- **Očekávané:** Redirect na `/platform`.
- **Fail signál:** `fail G1`.

### G2 — Schválení čekajících akcí
- **URL:** `/platform/events/pending`
- **Očekávané:** Seznam pending eventů (Jazz Night by tu měla být ze seedu).
- **Fail signál:** `fail G2`.

### G3 — Schvalování promotérů (KYC)
- **URL:** `/platform/promoters`
- **Očekávané:** Seznam promotérů + status KYC.
- **Fail signál:** `fail G3`.

### G4 — Reporting (revenue, top eventy, ...)
- **URL:** `/platform/reports` _(může být `/platform/analytics`)_
- **Očekávané:** Grafy tržeb, fee, top promotérů.
- **Fail signál:** `fail G4`.

---

## H. Edge cases / chaos test

### H1 — Hold expirace
- **Akce:** Vyber sedadlo v B3, **nech ho 15 min stát**, pak otevři druhé okno a vyber stejné sedadlo.
- **Očekávané:** Druhé okno musí dostat sedadlo (hold expiroval). Pokud sedí přes 15 min na 1. okně blokované, je to bug.

### H2 — Konkurenční nákup
- **Akce:** Otevři dvě okna, oba kupte stejné sedadlo zároveň.
- **Očekávané:** Jen jeden uspěje, druhý dostane „už není dostupné".

### H3 — Refund po skenování
- **Akce:** B5 + C2 (sken) + D2 (refund).
- **Očekávané:** Refund **odmítnut** („Vstupenka už byla použita") nebo zpracován s flagem.

### H4 — Sold-out event
- **Akce:** Otevři Strindberg (minulý sold-out event).
- **Očekávané:** Banner „Vyprodáno", tlačítko „Sledovat resale" nebo „Notifikovat při uvolnění".

### H5 — Rejected event není ve veřejném výpisu
- **Akce:** Hledej v `/cs/events` ten zamítnutý event („investiční příležitost" — scam pattern).
- **Očekávané:** Není dostupný, 404 na public URL.

---

## Co reportovat zpět

Pro každý fail mi napiš:
```
fail B3
mapa se vykreslila, ale sedadla po kliknutí nereagují
DevTools console: TypeError: cannot read 'status' of undefined
screenshot: <přilož>
```

To stačí. Ostatní si dohledám.

---

## Co testovat NEMÁ smysl (známé prázdné mezery)

Neztrácej čas testováním těchto, jsou **vědomě nehotové** (z `mega-flow-action-plan.md`):

- Reálná platba (jen mock GoPay)
- Produkční SMTP (jen MailHog)
- Reálná SMS (jen BulkGate mock)
- CAPTCHA (mock scoring)
- Self-service částečný refund (jen full)
- Transfer vstupenky UI (jen admin support action)
- WebSocket real-time seats (jen polling)
- Push notifikace (jen flag v DB)
- Marketplace Ads CPC
- Loyalty body + redemption
- Apple Pay / Google Pay native
- WYSIWYG email editor
- Timed entry slots
- Personalizované vstupenky (jméno per ticket)
