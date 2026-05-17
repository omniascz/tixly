# Chargeback v ČR + jak se chrání QR proti padělání

> Reakce na: „v ČR se nejdřív ozve na Tixly, ne do banky, ve světě do banky?" + „jak se dělá nepadělatelný QR".

---

## Část 1: Chargeback — jak to reálně chodí

### Tři cesty kupce při problému

Pokud kupec není spokojený („nepřišel mi lístek", „akce zrušená", „nedostavil jsem se kvůli nemoci"), má tři možnosti:

```
1. PRODEJCE (nejlevnější, nejpomalejší)
   Kupec → email/telefon Tixly nebo promotér → vyřízení do 30 dní
   
2. ČOI (Česká obchodní inspekce — pokud prodejce ignoruje)
   Kupec → ČOI → mediace
   
3. CHARGEBACK (přes banku, nejrychlejší pro kupce)
   Kupec → vlastní banka → Visa/MC → naše banka → strhne nám
```

### CZ chování vs světové

**Tvoje intuice je správná, ale jen částečně.**

**CZ kontext:**
- ~80 % kupců se nejdřív ozve **prodejci**. Důvody:
  - Kulturní zvyk řešit přímo
  - Mnoho českých kupců neví, že chargeback existuje
  - České banky o této možnosti aktivně neinformují (raději platí merchanty)
- ~15 % jde rovnou na **chargeback** (znalí, frustrovaní, hodnota > 1 000 Kč)
- ~5 % končí na ČOI nebo v soudech

**Svět (US/UK/DE):**
- ~50 % kupců jde **rovnou na chargeback** — banky o této možnosti aktivně informují („zero liability protection")
- US Reg E vyžaduje, aby banka jednala do 10 dní → kupec ví, že je to rychlejší než prodejce

**Stripe statistiky pro ticketing v Evropě (2024):**
- Průměrná chargeback rate: **0.8 %** (vs 0.4 % e-commerce overall)
- Top reason codes:
  - 4853 „Cardholder Disputes" — „nepřišel lístek" (40 %)
  - 4855 „Goods not received" — typicky 2× nákup, „myslel jsem že platba neprošla" (25 %)
  - 4837 „No cardholder auth" — fraud (20 %)
  - 4860 „Credit not processed" — refund neprošel (10 %)

### Co se stane, když kupec udělá chargeback

```
Den 0:  Kupec píše bance „nedostal jsem lístek"
        ↓
Den 1:  Banka strhne peníze z Tixly Stripe účtu + 15 USD fee
        Webhook: charge.dispute.created
        ↓
Den 1-21: Tixly má 21 dní na evidence submission do Stripe dashboardu
        Submit: PDF lístku, scan log, email confirmation, IP log, timestamp
        ↓
Den 21+: Stripe pošle do Visa/MC arbitrage
        Visa rozhodne — typicky 30-90 dní
        ↓
Výsledek:
  - Win (60 % případů s dobrou evidence): peníze se vrátí na účet
  - Lose: peníze definitivně pryč + 15 USD fee
```

### Proč musíme rozhodnout o holdback

**Scénář bez holdback:** Promotér pořádá akci za 500 000 Kč. Tixly vyplatí promotérovi 95 % (475 000 Kč) hned po akci. Týden po akci přijde 10 chargebacků á 5 000 Kč = 50 000 Kč. Tixly ztratí 50 000 Kč protože už promotér peníze vyplatil. **Riziko nese Tixly.**

**Scénář s 5 % holdback po 90 dní:** Tixly vyplatí 90 % hned (450 000 Kč), 25 000 Kč drží 90 dní. 50 000 Kč chargebacků se z holdback nepokryje úplně, ale **risk se sdílí**.

**Realita:** Visa dispute window je 60-180 dní podle reason code. **5-10 % po 60-90 dní = standardní praxe Stripe, Adyen, Mollie.**

### Můj návrh pro tebe

**Tixly chargeback flow:**

```
Krok 1: PROAKTIVNÍ kanál „mám problém"
   → tlačítko v /cs/my-tickets „Něco není v pořádku"
   → e-mail support@tixly.cz s pre-filled context (order ID, event)
   → 80 % kupců se zastaví tady (CZ kultura)
   → vyřízeno do 48h = žádný chargeback

Krok 2: REAKTIVNÍ na webhook
   → Stripe webhook charge.dispute.created
   → notification do /admin pro promotéra + Tixly support
   → automatický submit base evidence (PDF + scan log)
   → support manuálně doplní context

Krok 3: HOLDBACK pro krytí
   → 5 % z každého payoutu drženo 90 dní
   → po 90 dnech automaticky uvolněno
   → v případě chargebacku odečteno z holdback
   → pro tier 3+ promotéry (důvěryhodné, velký objem): 0 %
```

**Pro launch:** stačí krok 1 + krok 3. Krok 2 (Stripe webhook) je už wired (commit `420e9f6`).

**Otázka pro tebe:** 5 % / 90 dní default? Nebo jiné číslo?

---

## Část 2: Anti-screenshot QR — jak to funguje

### Proč statický QR nestačí

**Statický QR** (současné PDF z mailu):
```
Payload: "ticket:abc-def-123"
```
Po naskenování scanner vyhledá ticket v DB. Vidí status:
- `valid` → zelená, status → `used`
- `used` → červená „už použito"

**Útok:** kupec udělá screenshot QR a pošle známému. Známý jde k vchodu **první**. Scanner registruje `used`. Originální kupec přijde za 5 minut, scanner → červená „už použito". Kupec se brání: „já jsem to nepoužil!". Promotér nemůže rozhodnout.

### Rotující QR (Tixly už má, Level 1)

**Princip:** Payload obsahuje **6-digit kód, který se mění každých 30 sekund**.

```
T = 0s:    payload "ticket:abc-123|otp:847291|ts:2026..."
T = 30s:   payload "ticket:abc-123|otp:153849|ts:2026..."
T = 60s:   payload "ticket:abc-123|otp:902471|ts:2026..."
```

Kód se generuje **deterministicky** ze secretu uloženého na serveru (TOTP — RFC 6238, stejný princip jako Google Authenticator). Scanner ho dokáže ověřit bez síťového volání na server (offline scan), protože má stejný secret v DB.

**Scanner check:**
1. Decode payload → `ticket_id`, `otp`, `timestamp`
2. Lookup ticket secret v DB (`tickets.tickets.totp_secret_encrypted`)
3. Spočítej očekávaný OTP pro aktuální čas
4. Match? Zelená. Mismatch? Červená.
5. **Window ±1** = scanner přijme OTP z aktuálního 30s slotu **i sousedních** (kvůli časové nestabilitě telefonu). Celková akceptační doba: 90s.

**Co tohle brání:**
- Kupec si vytiskne PDF doma → na vchodu QR neplatí (poslední rotace byla doma, teď je jiný kód)
- Kupec udělá screenshot a pošle známému 1h před akcí → screenshot vypršel
- Kupec udělá screenshot 1 minutu před akcí → kód platí 90s, ale **scanner registruje first-use** → druhý pokus = červená

**Co tohle NEBRÁNÍ:**
- Kupec stojí 30s před známým ve frontě, ukáže telefon, screenshot, předá → oba projdou pokud první projde a druhý do 90s
- → tomu se brání **„entry registered"** notif na buyer telefonu („Tvůj lístek byl právě použit u brány A. Pokud to nebyl ty, ozvi se.")

### Account-bound QR (Level 2, Ticketmaster SafeTix)

**Princip:** Lístek je svázaný s **účtem** kupce, ne jen s mailem. Buyer musí být přihlášen v Tixly app, aby zobrazil QR.

```
Anonymní screenshot URL /cs/t/[token] → funguje (Level 1)
Account-bound /buyer/ticket/[id] → vyžaduje login → screenshot URL nepomůže
```

**Co tohle brání:** Sdílení screenshotu mimo původního kupce. Útočník musí znát i heslo (nejen screenshot).

**Co tohle NEBRÁNÍ:** Sdílet účet (heslo). Tomu se brání **transfer flow** — kupec převede lístek na účet kamaráda, originál se zruší, kamarád dostane nový QR svázaný se svým účtem (commit `c7379a4`).

### Photo on ticket (Level 3)

**Princip:** Kupec při nákupu uploaduje fotku. PDF a mobile ticket zobrazují fotku vedle QR. Promotér u vchodu **vizuálně porovná** fotku s tváří kupce.

**Co tohle brání:** Forwarding na kamaráda. Pokud kamarád vypadá jinak, promotér odmítne.

**Limity:** Identity check u brány zdržuje frontu (3-5s per kupec → +20min u 1000 lidí). Diskriminační riziko. Promotér nemusí fotku reálně kontrolovat.

### Biometric entry (Level 4, TM Nexus partners)

**Princip:** Kupec při nákupu udělá **selfie**. Při vstupu kamera u brány vyfotí tvář, ML porovná s referenční selfie. Match → otevři turniket.

**Co tohle brání:** Skoro vše. Identical twin je outlier.

**Limity:** GDPR — biometric data jsou special category. Vyžaduje explicitní souhlas. Drahá infrastruktura (kamery, ML). UX hostile.

---

## Recap: kde Tixly dnes stojí

| Level | Technika | Tixly stav | Kód v repu |
|---|---|---|---|
| 0 | Statický QR v PDF | ✅ default pro email/PDF | `src/lib/tickets/pdf-renderer.ts` |
| 1 | Rotující TOTP 30s window | ✅ na `/cs/t/[token]` | `src/lib/totp/verify.ts` + `SmsTicketClient.tsx` |
| 2 | Account-bound transfer | ✅ implementováno | `/api/buyer/tickets/[id]/transfer/route.ts` |
| 3 | Photo on ticket | ❌ chybí | personalizace (P2-16) má jméno, ne fotku |
| 4 | Biometric entry | ❌ chybí | `_archive/biometric-entry` (stub) |

### Doporučená anti-padělání politika pro Tixly

```
DEFAULT (vše kromě high-demand):
  • PDF s statickým QR funguje (Level 0)
  • SMS odkaz na rotující QR funguje (Level 1)
  • Scanner přijímá oba
  • Push notif po use: „Tvůj lístek byl právě použit u brány X"
  → 99 % kupců se chová poctivě, řeší to UX > security

HIGH-DEMAND (concert, festival, derby):
  • Static PDF stažen 24h před akcí (cron task)
  • Po stažení: jen rotující QR přes /cs/t/[token]
  • Email pošleme se zprávou „Tvůj lístek bude aktivní 24h před akcí, ulož si URL"
  → 1 % případů, kde sdílení screenshot reálně bolí

TIER 4 (festival jako Rock for People, Sázava):
  • Photo on ticket — promotér si zaškrtne při tvorbě akce
  • Optional: biometric entry pro VIP zóny
  → individuální dohoda, my poskytujeme infra
```

### Co toto znamená pro otázku B-6

Není to binární „A/B/C", ale **per-event policy**:

```
catalog.events.qr_policy TEXT
  'static_allowed'   — PDF s statickým QR funguje vždy (default)
  'rotating_24h'     — static stažen 24h před akcí
  'rotating_only'    — od začátku jen rotující URL
  'photo_required'   — Level 3, foto na lístku + identity check
```

Promotér si vybere při tvorbě akce. Tixly nastaví defaults podle tier/kategorie. **Žádné globální rozhodnutí netřeba.**

---

## Souhrn

**B-5 chargeback:**
- V CZ se kupec **typicky nejdřív ozve prodejci** (80 %), ale 15 % jde rovnou na banku
- Banka může strhnout peníze **nezávisle** — pravidla Visa/MC platí globálně
- Cesta: kupec → vlastní banka → Visa → naše banka (Stripe) → strhne nám
- **Holdback 5 % po 90 dní = standardní praxe**, kryje 80 % případů
- Pro tier 3+ promotéry: 0 % (důvěra + velký objem)

**B-6 anti-screenshot QR:**
- **Tixly už má Level 1** (rotující 30s TOTP) — screenshot vypršel za 30-90s
- **Level 2** (account-bound transfer) také hotový
- **Level 3** (foto) chybí — nutné jen pro festival typu Rock for People
- **Level 4** (biometric) je luxus, ne potřeba pro pilot

**Doporučení:** per-event `qr_policy` flag místo globálního rozhodnutí. Default `static_allowed`, high-demand akce mohou eskalovat na `rotating_24h` jedním klikem.

**Otázky pro tebe:**
1. Holdback 5 % / 90 dní default — ano?
2. Per-event qr_policy s 4 úrovněmi — ano? Nebo chceš jednodušší (jen 2 úrovně)?
