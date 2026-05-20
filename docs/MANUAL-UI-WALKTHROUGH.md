# Manual UI Walkthrough — Session features test

**Cíl:** Otestovat 13 featur z této session co Playwright nepokrývá.
**Trvání:** ~30 minut + screenshots.
**Před začátkem:** `npm run dev` (port 3000), MailHog running (port 8025).

---

## Setup (3 min)

```bash
# Terminal 1
cd nextjs-boilerplate
npm run dev

# Wait for "Ready in Xs"
# Open http://localhost:3000 → měl by se zobrazit homepage
```

✅ Pokud homepage načte za < 10s, pokračuj.

---

## Část 1: Buyer journey (10 min)

### 1.1 Homepage discovery features

**Open:** `http://localhost:3000/cs`

- [ ] Hero "Vstupenky, které prostě fungují"
- [ ] **NOVÉ: ✨ Doporučeno pro tebe** sekce (3-col grid)
  - Bez login: trending fallback
  - 6 cards s reason badges (např. "aktuální trend", "podobné akce")
- [ ] **NOVÉ: ⭐ Vybráno pro tebe** sekce (jen pokud admin něco označil — pravděpodobně 0 v dev)
- [ ] "Tento týden" sekce
- [ ] Kategorie quick-links (Koncerty, Divadlo, ...)
- [ ] **Cookie banner** vlevo dole při first visit
  - [ ] "Vlastní volba" toggle → 3 checkboxy
  - [ ] "Přijmout vše" → banner zmizí, POST /api/consent log

### 1.2 Cookie withdrawal (NEW)

**Open:** `http://localhost:3000/cs/legal/cookie-settings`

- [ ] Hlavička "Nastavení cookies"
- [ ] 3 checkboxy: Essential (disabled, checked), Analytics, Marketing
- [ ] Toggle analytics → "Uložit změny" → flash "Volba uložena."
- [ ] "Odvolat veškerý souhlas" → all unchecked + save
- [ ] "Naposledy upraveno: <date>" zobrazí

### 1.3 Event detail + RSVP (NEW)

**Open:** `http://localhost:3000/cs/events` → klik na první published event

- [ ] **NOVÉ: RSVP tlačítka** (Heart + Check + Calendar)
  - [ ] Heart icon "Zajímá mě" → bez login → "Pro RSVP se prosím přihlas"
  - [ ] Counts (např. `(3)`) pokud někdo už označil
  - [ ] Calendar download → `.ics` soubor stažen
  - [ ] Otevři `.ics` v Apple Calendar / Outlook → event s reminder -1 den

### 1.4 Wallet pass (existoval, ověř že funguje)

**Login:** `http://localhost:3000/cs/dev-login?as=buyer`
**Open:** `http://localhost:3000/cs/my-tickets`

- [ ] Vidím alespoň 1 lístek
- [ ] "Add to Apple Wallet" → `.pkpass` download (~50kb, header `X-Wallet-Signed: false` v dev)
- [ ] "Add to Google Wallet" → response s `saveUrl` (mock)

### 1.5 Subscriptions buyer flow (NEW)

**Pre-req:** Admin musí mít vytvořenou alespoň 1 abonentku v `on_sale` (viz §2.3).

**Open:** `http://localhost:3000/cs/p/divadlo-v-celetne/subscriptions/<package-slug>`

- [ ] Brand color gradient hero
- [ ] Title "Pondělní abonentka 2026/27" + sezóna badge
- [ ] Cena display (early-bird crossed-out pokud aktivní)
- [ ] Stats: počet představení, předplatitelů, místo
- [ ] Číslovaný program (1-N) s linky na event detail
- [ ] "Koupit abonentku" → form (Jméno, Email, Telefon)
- [ ] Submit → redirect `/mock-subscription/<paymentId>`
- [ ] "Zaplatit a aktivovat" → ✅ Abonentka aktivní + "X/Y lístků vystaveno"

---

## Část 2: Promoter admin (10 min)

**Login:** `http://localhost:3000/cs/dev-login?as=admin`

### 2.1 Sidebar — nové linky

- [ ] **Abonentky** (mezi Akce a Sezónní přehled) — NEW
- [ ] **Dárkové poukazy** (v Marketing) — NEW

### 2.2 Camera scanner (NEW)

**Open:** `http://localhost:3000/admin/scanner`

- [ ] Manual UUID input pořád existuje
- [ ] **NOVÉ: kamera ikona** vedle inputu
- [ ] Klik kamera → modal "Sken QR kódu" otevře
  - [ ] Browser žádá o camera permission
  - [ ] Allow → video stream se zobrazí
  - [ ] Deny → "Přístup ke kameře odmítnut" + návod
- [ ] ESC zavře modal
- [ ] Klik mimo modal zavře

### 2.3 Subscriptions admin (NEW)

**Open:** `http://localhost:3000/admin/subscriptions`

- [ ] List packageů (zatím prázdný)
- [ ] "Nová abonentka" toggle form
- [ ] Vyplnit:
  - Název: "Pondělní abonentka 2026/27"
  - Slug: `pondelni-2026-27`
  - Sezóna: `2026/27`
  - Kategorie: Divadlo
  - Cena: 2500
  - Early bird do: vyber datum +14 dní
  - Early bird cena: 2000
  - Vyber 2-3 představení z list
- [ ] Submit → "Abonentka vytvořena" message
- [ ] List refresh, package viditelný s `on_sale` status

### 2.4 Vouchers admin (NEW)

**Open:** `http://localhost:3000/admin/vouchers`

- [ ] Form: hodnota 500 Kč, batch 1, expirace +1 rok
- [ ] Submit → kód generated (např. "ABCD-EFGH-JKLM")
- [ ] List zobrazí voucher
- [ ] Copy code button → ✓ flash
- [ ] **PDF download** → otevři v PDF reader
  - [ ] Brand color hlavička
  - [ ] Title "Dárkový poukaz"
  - [ ] Velký 500 Kč display
  - [ ] Kód box + QR
  - [ ] "Jak uplatnit" 4-step
  - [ ] Footer "Vystaveno přes Tixly"

### 2.5 ISDOC export (NEW)

**Open:** `http://localhost:3000/admin/invoices`

- Pokud žádné faktury, sklip dál.

- [ ] List faktur
- [ ] Nový sloupec **ISDOC** s download buttonem
- [ ] Klik `.isdoc` → XML soubor stažen
- [ ] Otevři v text editor → ISDOC 6.0.2 XML + UTF-8 BOM v začátku

### 2.6 Migrované endpointy (typed-fetch)

Tyto endpointy by měly fungovat stejně jako dřív (žádná visible změna):

- [ ] **Access codes** `/admin/access-codes` — list + create
- [ ] **Ads** `/admin/ads` — list + create campaign
- [ ] **Affiliates** `/admin/affiliates` — list + create

---

## Část 3: Platform admin (5 min)

**Login:** `http://localhost:3000/cs/dev-login?as=platform`

### 3.1 Featured events (NEW)

```bash
# Najdi event_id co je status=published
curl -s "http://localhost:3000/api/events/featured" | jq

# Označit nějaký event jako featured (potřebuje platform admin token)
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"order": 100, "blurb": "Vybráno redakcí pro vás"}' \
  http://localhost:3000/api/platform/admin/events/<event-id>/feature
```

- [ ] Response 200
- [ ] Open `/cs` → sekce "⭐ Vybráno pro tebe" teď zobrazuje event
- [ ] Card má italic blurb "Vybráno redakcí pro vás"

### 3.2 DSA reports / Audit log (existoval)

- [ ] `/platform/dsa-reports` — funguje
- [ ] `/platform/audit-log` — funguje

---

## Část 4: Embed widget (NEW, 3 min)

Vytvoř lokální HTML:

```bash
cat > /tmp/embed-test.html <<'EOF'
<!DOCTYPE html>
<html>
<head><title>Tixly Embed Test</title></head>
<body style="padding: 20px;">
  <h1>Promotér Divadlo v Celetné — agenda</h1>
  <div data-tixly-promoter="divadlo-v-celetne" data-limit="6"></div>
  <script async src="http://localhost:3000/embed.js"></script>
</body>
</html>
EOF
open /tmp/embed-test.html  # nebo dvojklik v Exploreru
```

- [ ] iframe se načte s grid akcí
- [ ] Brand color promotéra v hlavičce
- [ ] 6 event cards s cover image
- [ ] Klik na event → otevře tixly.cz v parent okně (target=_top)
- [ ] Footer "Powered by Tixly"

---

## Část 5: Newsletter digest cron (NEW, 2 min)

**MailHog UI:** `http://localhost:8025`

Manual trigger:
```bash
curl -X POST \
  -H "x-internal-token: $INTERNAL_SERVICE_TOKEN" \
  http://localhost:3000/api/internal/cron/newsletter-digest
```

- [ ] Response: `{"ok": true, "promoters": N, "sent": X, "failed": 0}`
- [ ] MailHog vidí emaily s subject "<Promotér>: X akcí v 14 dnech"
- [ ] Email obsahuje brand color cards + "Koupit lístek" buttons

---

## Část 6: GDPR consent (NEW, 2 min)

Po §1.1 (Accept All v banner) ověř:

```bash
docker exec tixly-postgres psql -U tixly -d tixly -c "
SELECT decided_at, analytics, marketing, source, user_agent
  FROM compliance.cookie_consent_log
 ORDER BY decided_at DESC
 LIMIT 5;
"
```

- [ ] Vidím záznam (analytics=true, marketing=true, source='banner')
- [ ] Po §1.2 (cookie-settings) → další záznam (source='settings-page')
- [ ] Po "Odvolat" → záznam (analytics=false, marketing=false, source='reset')

---

## Část 7: Acceptance summary

Po projití všech sekcí:

- [ ] 0 console errors v DevTools
- [ ] 0 network 5xx v Network tab
- [ ] Všechny new UI prvky vizuálně OK
- [ ] Žádný layout broken (overlapping, missing icons)
- [ ] CS lokalizace všude (žádné English fallback)

**Pokud vše OK → ready for production push** ✅

---

## Issues template

Po každém failed checkbox:

```
**Co:** [název checkboxu]
**URL:** http://localhost:3000/...
**Expected:** [co mělo nastat]
**Actual:** [co se stalo]
**Screenshot:** [drag drop]
**Console errors:** [paste]
**Network 5xx:** [paste]
```

Commit do repa jako `/docs/TEST-RESULTS-<date>.md` nebo GitHub Issue.
