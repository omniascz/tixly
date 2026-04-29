# Tixly — Platform Vision
> Verze 3.0 | Datum: 2026-04-06
> Aktualizace: rozšíření vize z čistého ticketingového systému na obecnou platformu
> pro řízení přístupu k omezeným zdrojům s platbou.

---

## Základní teze

Tixly v jádru řeší jeden problém:

> **Kdo smí přistupovat k čemu, kdy, v jakém množství, za jakou cenu — a jak to prokáže.**

Toto je universální problém. Vstupenka na koncert je jen jedna z tisíce instancí.
Platforma je tedy engine pro **"Right to Access"** — právo přístupu k omezenému zdroji.

```
┌──────────────────────────────────────────────────────────────────┐
│              TIXLY — RIGHT TO ACCESS ENGINE                │
│                                                                  │
│  ZDROJ          KDO         KDY          KOLIK     DŮKAZ        │
│  ────────────   ─────────   ──────────   ───────   ──────────   │
│  Koncertní sál  Kupující    20.6. 20:00  1 osoba   TOTP QR      │
│  Fitness lekce  Člen        Po 18:00     1 místo   TOTP QR      │
│  Restaurační    Host        Pá 19:30     4 osoby   TOTP QR      │
│    stůl                                                          │
│  Ski areál      Držitel     Celá sezona  1 os./den Skipas QR    │
│  Stream         Předplatitel Kdykoli     1 device  Token        │
│  Parkovací místo Řidič      8:00–18:00  1 auto    TOTP QR      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Primární produkt: Ticketing (beze změny)

Tixly **primárně zůstává ticketingovou platformou** pro živé události:
koncerty, festivaly, sport, divadlo, kino, konference.

Toto je core, kolem kterého vše ostatní rotuje. Ostatní vertikály jsou:
1. **Přirozená rozšíření** stejného technického základu
2. **Zdroj dat a LTV** — fitness člen, který koupil permanentku, je také zákazník pro ticketing
3. **Konkurenční příkop** — čím více vertikál, tím silnější síťový efekt a data

---

## Technologické primitiva (co máme a co je generické)

| Primitiv | Implementace | Použití |
|---|---|---|
| **Kapacitní slot** | `catalog.ticket_types.remaining_qty` | Sedadlo, místo v lekci, stůl, parkovací místo |
| **Seat locking** | Redis SETNX TTL 7 min | Dočasná rezervace při platbě — platí pro vše |
| **TOTP QR** | HMAC-SHA256, 30s rotace | Vstup na event, přístup do fitness, gate v coworkingu |
| **Season pass** | GoPay ON_DEMAND recurring | Permanentka, členství, předplatné, skipas |
| **Dynamic pricing** | Demand score × weights | Cena vstupenky, slotu, parkovacího místa |
| **Resale marketplace** | Escrow, price cap, QR swap | Vstupenky, sublicence, přeprodej slotů |
| **Anti-scalping** | Verified identity + limit | Limit na osobu (ne na účet) pro cokoliv |
| **RLS multi-tenant** | `withTenantContext()` | Každý promotér/provozovatel vidí jen svá data |
| **B2B API** | API keys, webhooks, rate limiting | POS integrace, partnerské sítě |
| **Recurring events** | iCal RRULE, parent_event_id | Lekce, time sloty, opakovaný pronájem |
| **Loyalty points** | Tier systém, cashback | Body za nákup vstupenek i členství |
| **Identity verification** | BankID, Onfido OCR | Anti-scalping, věková omezení, KYC |
| **Single customer view** | Fan profil, LTV, RFM | Cross-vertical analytics |

---

## Mapa vertikál

### TIER 1 — Okamžitě spustitelné (stávající kód, jen konfigurace)

Tyto vertikály fungují *dnes* pouze nastavením `event_type`, `venue_type` a
`slot_duration_min`. Nulový vývoj navíc.

#### 1. Escape rooms & laser game
```
event_type: space_rental
venue_type: coworking (místnost jako "prostor")
slot_duration_min: 60
Kapacita: 2–8 osob na místnost
Seat locking: ano (celá místnost = 1 "sedadlo")
Recurring: ano (každou hodinu od 10:00 do 22:00)
Group tickets: ano (1 objednávka = celá parta)
Loyalty: ano (10. návštěva zdarma)
```

#### 2. Golf & tenisové kurty
```
event_type: space_rental
venue_type: coworking (kurt = místnost)
slot_duration_min: 60 (tenis) / 270 (golf 18 jamek)
Seat locking: ano
Recurring: ano (denní provoz)
Season pass: ano (roční členství, X vstupů/měsíc)
Dynamic pricing: ano (víkend dražší, ráno levnější)
B2B API: ano (rezervační systémy pro golfové asociace)
```

#### 3. Ski areály
```
event_type: space_rental
venue_type: outdoor
ticket_type: daily_pass / weekly_pass / season_pass
TOTP QR: pro turnikety na vleku
Season pass: GoPay ON_DEMAND (měsíční/roční skipas)
Dynamic pricing: cena podle počasí a obsazenosti
Group tickets: rodinný skipas
B2B API: integrace s hotely (skipas v ceně ubytování)
```

#### 4. Muzea, galerie, ZOO, botanické zahrady
```
event_type: exhibition
venue_type: venue
Timed entry: recurring events (sloty po 30 min)
Season pass: roční permanentka
Group tickets: školní výpravy
B2B API: cestovní kanceláře
Věkové omezení: přes identity verification (dětské vstupné)
Dynamic pricing: high-season vs. low-season
```

#### 5. Stand-up comedy & improv
```
event_type: comedy
— identické s concert ticketing, nulová změna
```

---

### TIER 2 — Malá úprava (1–3 dny vývoje na vertikálu)

#### 6. Fitness studia & yoga studia
```
event_type: fitness_class
venue_type: fitness_studio
slot_duration_min: 60
Místo = "rohož" nebo "stanoviště" (ne sedadlo — jiný label v UI)
Season pass: měsíční členství (10 lekcí/měsíc nebo unlimited)
Recurring: ano (každé pondělí 18:00)
Waitlist: zákazník se přihlásí na pořadník když lekce plná
Check-in: instruktor skenuje QR na vstupu
Čeká na: UI label "Místo" místo "Sedadlo"
```

#### 7. Aquaparky & bazény
```
event_type: space_rental
venue_type: outdoor
Timed entry: sloty (dopoledne/odpoledne/celý den)
Atrakce = zóny (zone-access model — existuje)
Season pass: letní permanentka
Dynamic pricing: prázdniny, víkendy
Kapacita = max. počet osob v areálu (celkový pool, ne sedadla)
Čeká na: "pool capacity" model místo seat-based
```

#### 8. Restaurace & kavárny
```
event_type: restaurant_reservation
venue_type: restaurant
Stůl = "sedadlo" (kapacita = počet osob u stolu, ne osob)
slot_duration_min: 90–120
Floor plan: seat-map jako půdorys sálu (existující SVG model)
Recurring: denní provoz
No-show ochrana: hold platební karty (GoPay preauth = existující escrow)
Čeká na: "stůl pro N osob" místo "N sedadel", floor plan editor
```

#### 9. Nahrávací & foto studia, zkušebny
```
event_type: space_rental
venue_type: coworking
slot_duration_min: 60–240
Vybavení v ceně: "sedadlo" = studio s konkrétním vybavením
Recurring: denní provoz
Deposit: escrow hold (existující preauth model)
B2B: hudební agentury přes API
Čeká na: "vybavení tagu" pro filtrování (piano studio vs. bubenická zkušebna)
```

#### 10. Bowling, karaoke, trampolíny, paintball
```
Vzor identický s escape rooms (Tier 1)
Rozdíl: kombinované "sloty" (dráha + boty = bundle)
Bundle pricing: existující bundle logika
Čeká na: bundle konfigurační UI
```

---

### TIER 3 — Střední práce (1–2 týdny na vertikálu)

#### 11. Koworking prostory
```
event_type: space_rental
venue_type: coworking
Stůl/kancelář/zasedačka = "sedadlo" s různou kapacitou
slot_duration_min: 60 / 480 / 1440 (hodina, den, měsíc)
Season pass: měsíční hot-desk členství
Dynamic pricing: ranní hodiny levnější
B2B API: firemní zákazníci, fakturace
Access log: každý vstup přes TOTP QR logován (security)
Čeká na: "přístupové úrovně" (stůl × kancelář × zasedačka)
```

#### 12. Parkovací systémy
```
event_type: space_rental
venue_type: outdoor (parkoviště jako "venue")
Parkovací místo = "sedadlo" (číslo místa z SVG mapy)
slot_duration_min: proměnné (rezervace na X hodin)
Dynamic pricing: obsazenost v reálném čase, denní/noční tarif
Season pass: měsíční permanentka
TOTP QR: na závoru nebo parkovacím automatu
B2B API: integrace s navigacemi (Waze, Google Maps)
Čeká na: "proměnný slot" (zákazník si zvolí počet hodin)
```

#### 13. Sportovní ligy & turnaje (organizátor pohled)
```
event_type: sport
Sezóna = serie recurring events (parent_event_id)
Tým = "promotér" v B2B kontextu
Permanentka na sezónu = season pass
Fantasy liga = vedlejší produkt z match dat
Statistiky = SQL reports rozšíření
Čeká na: "tým vs. tým" šablona, ligová tabulka
```

#### 14. Virtuální eventy & streamy (rozšíření)
```
event_type: virtual_stream
venue_type: online
TOTP token = přístupový kód ke streamu (existující logika)
Geo-blocking: dle IP adresy diváka
Replay okno: token platný X hodin po skončení eventu
Concurrent limit: max. N zařízení na token
Chat & interakce: 3rd party (Discord, StreamYard)
B2B API: white-label embed pro promotéry
Čeká na: stream token middleware, geo-IP lookup
```

#### 15. Jazykové školy & tutoring
```
event_type: fitness_class (vzor identický)
venue_type: conference_room (nebo online)
Lekce = recurring event
Měsíční předplatné = season pass (X lekcí/měsíc)
Homework upload: mimo scope (3rd party LMS)
Certifikační zkouška = event s identity verification
Skupinová lekce: kapacita 6–15 studentů
Čeká na: "student limit" a "learning progress" modul
```

---

### TIER 4 — Větší práce, vysoký potenciál

#### 16. Firemní benefity SaaS (Multisport killer)
```
Firma = promotér (B2B tenant)
Zaměstnanec = kupující s firemním e-mailem
Benefit = season pass (X vstupů/měsíc do jakékoliv partnerské provozovny)
Partnerská provozovna = venue s B2B API napojením
HR integrace: SCIM/LDAP pro správu zaměstnanců
Fakturace: firemní faktura místo platební karty
Reporting: HR dashboard (čerpání benefitů per zaměstnanec)
Čeká na: B2B tenant model + HR integrace
```

#### 17. Camping & glamping rezervace
```
event_type: space_rental
venue_type: outdoor
Parcela/stan = "sedadlo" (číslo parcely z mapy tábořiště)
slot_duration_min: 1440 (1 den) × N nocí
Recurring: sezónní provoz
Dynamic pricing: prázdniny vs. mimo-sezona
Doplňkové služby: elektřina, sprchy = "bundle"
Online check-in: QR kód na závoře areálu
Čeká na: "multi-day slot" (výběr od-do místo počtu minut)
```

#### 18. Mariny & lodní stání
```
Lodní stání = "sedadlo" (číslo z mapy mariny = SVG)
slot_duration_min: 1440 × N dní
Season pass: roční stání
Rozměrové kategorie: ticket_type (do 6m, 6–10m, nad 10m)
Dynamic pricing: letní sezóna
B2B API: booking systémy pro jachting agentury
Čeká na: "multi-day slot" (stejně jako camping)
```

#### 19. Zdravotní & veterinární objednací systém
```
event_type: conference (lékař/vet jako "přednášející")
venue_type: conference_room (ordinace)
slot_duration_min: 15–30
Recurring: ordinační hodiny (denně)
Pojišťovna = B2B partner (automatická fakturace)
Anonymizace: GDPR na zdravotních datech (extra přísná)
Připomenutí: e-mail + SMS 24h před (existující email templates)
No-show: zrušení bez poplatku do X hodin
Čeká na: GDPR zdravotní data kategorie + pojišťovna B2B flow
```

#### 20. Letiště — VIP lounge přístup
```
event_type: space_rental
venue_type: venue (lounge jako venue)
TOTP QR: na vstupu do loungu
Kapacita: real-time occupancy (existující modul)
Season pass: roční členství (Priority Pass model)
B2B API: banky, kreditní karty (Visa, Mastercard benefit)
Dynamic pricing: peak hodiny (před ranními lety)
Čeká na: B2B billing pro kartové asociace
```

#### 21. Digitální tomboly & loterie
```
event_type: concert (draw event = speciální typ)
Losovací lístek = ticket (TOTP pro ověření výherce)
Omezený počet lístků = inventory
Anti-scalping: 1 lístek na verifikovanou osobu (identity verification)
Draw = live event s QR ověřením výherců
Transparentnost: blockchain audit trail (optional)
Regulace: loterie v CZ vyžaduje licenci MF
Čeká na: regulatorní posouzení + draw mechanismus
```

---

## Architekturální přidaná hodnota: Cross-vertical data

Klíčová výhoda platformy nad single-vertical SaaS je **cross-vertical Single Customer View**:

```
Zákazník X na Ticketariu:
  ├── Koupil 3 koncerty (ticketing)
  ├── Má fitness permanentku (fitness SaaS)
  ├── Rezervoval stůl k narozeninám (restaurace)
  └── Parkuje u arény každý víkend (parking)

LTV model:
  Ticketing: 3 × 800 Kč = 2 400 Kč/rok
  Fitness: 12 × 600 Kč = 7 200 Kč/rok
  Restaurace: 4 × 1 200 Kč = 4 800 Kč/rok
  Celkové LTV: ~14 400 Kč/rok ← vidí jen Tixly, ne jednotliví provozovatelé

Hodnota pro platformu:
  → Lepší doporučení (concertgoer → VIP lounge)
  → Lepší churn predikce (fitness drop → ticketing churn signal)
  → Lepší pricing (VIP zákazník = méně price-sensitive)
  → Lepší akvizice (lookalike audience pro Meta/TikTok)
```

---

## Co se nezmění (core invarianty)

Bez ohledu na vertikálu platí vždy:

1. **Všechny částky v INTEGER halířích** — nikdy float
2. **TOTP QR jako důkaz přístupu** — 30s rotace, anti-replay Redis
3. **Seat locking přes Redis SETNX** — atomická rezervace
4. **RLS multi-tenant** — každý provozovatel vidí jen svá data
5. **Resale s price cap** — přeprodej nikdy nad původní cenu
6. **Identity verification** — jeden člověk = jeden limit (anti-scalping)
7. **GDPR** — event-driven výmaz, data minimization
8. **B2B API** — každá vertikála má stejný API kontrakt

---

## Přehled vertikál dle effort

| # | Vertikála | Tier | Effort | Tržní potenciál CZ/SK |
|---|---|---|---|---|
| 1 | Escape rooms | 1 | 0 dní | Malý, rychlý |
| 2 | Golf & tenis | 1 | 0 dní | Střední (premium) |
| 3 | Ski areály | 1 | 0 dní | Střední |
| 4 | Muzea & ZOO | 1 | 0 dní | Střední |
| 5 | Stand-up comedy | 1 | 0 dní | Malý |
| 6 | Fitness studia | 2 | 2 dny | Velký (Mindbody) |
| 7 | Aquaparky | 2 | 2 dny | Střední |
| 8 | Restaurace | 2 | 3 dny | Velký |
| 9 | Studia & zkušebny | 2 | 2 dny | Malý |
| 10 | Bowling & zábava | 2 | 1 den | Malý |
| 11 | Coworking | 3 | 1 týden | Střední |
| 12 | Parkoviště | 3 | 1 týden | Velký |
| 13 | Sportovní ligy | 3 | 1 týden | Střední |
| 14 | Virtuální streamy | 3 | 1 týden | Velký (globální) |
| 15 | Jazykové školy | 3 | 1 týden | Střední |
| 16 | Firemní benefity | 4 | 3 týdny | Velký (B2B) |
| 17 | Camping & glamping | 4 | 2 týdny | Střední |
| 18 | Mariny | 4 | 2 týdny | Malý (niche) |
| 19 | Healthcare | 4 | 4 týdny | Obrovský (regulace) |
| 20 | Letiště VIP lounge | 4 | 3 týdny | Střední (B2B) |
| 21 | Digitální loterie | 4 | 3 týdny | Střední (regulace) |

---

## Závěr

Tixly není ticketingový systém. Je to **Right to Access engine** s ticketingem
jako primárním a nejlépe rozvinutým produktem.

Každá nová vertikála:
- Přidává data do Single Customer View → lepší LTV a personalizace
- Zvyšuje switching cost pro zákazníky → silnější retention
- Amortizuje náklady na infrastrukturu → lepší unit economics
- Vytváří cross-sell příležitosti → vyšší ARPU

Doporučené pořadí expanze (po stabilizaci ticketing core):
1. **Fitness studia** — největší trh, Mindbody je drahý a zastaralý
2. **Restaurace** — synergické s eventy (večeře před koncertem)
3. **Coworking** — B2B příjem, high LTV zákazníci
4. **Firemní benefity** — B2B SaaS model, nejvyšší ARPU


---

## Fáze 5 — Fyzická přístupová kontrola (Access Control as a Service)

TOTP QR rotující každých 30 sekund je moderní náhrada čipových karet (RFID/NFC).
Nevyžaduje speciální hardware — stačí telefon s kamerou nebo QR čtečka za 500 Kč.

### Kancelářské budovy a coworking sítě
- Visitor management: host dostane TOTP QR platný 1 den
- Contractor access: QR platný jen v povolené dny a patra
- Zaměstnanecké turnikety: QR místo přístupové karty (revoke v UI)
- Přímá konkurence: Salto, Kisi, Brivo

### Hotel digital key
- TOTP QR jako klíč od pokoje (online check-in, bez recepce)
- Platnost: automatický TTL od check-in do check-out
- Late checkout = zákazník si koupí prodloužení přes app
- Integrace: smart zámky (Nuki, dormakaba)

### Univerzity a školy
- Laboratoře: rezervace + QR vstup
- Zkušební místnosti: QR vydán po zaplacení poplatku za zkoušku
- Koleje: QR jako klíč od pokoje s denní rotací

---

## Fáze 5 — Sharing Economy Infrastructure

### Sdílená auta (car sharing)
- Auto = venue s jedním sedadlem
- Klíč = TOTP QR + integrace se smart zámkem
- Paušál = season pass + usage fee (dynamic pricing)
- White-label pro menší města a firmy

### Tool library & makerspace
- Vrtačka, sekačka, 3D tiskárna, laser cutter = sedadlo
- Rezervace + deposit = escrow preauth (existující GoPay model)
- Maker community membership = season pass

### Komunální zahrady a záhumenky
- Záhon = sedadlo (číslo z SVG mapy)
- Roční pronájem = season pass
- Sublicence záhonu sousedovi = resale model

### Sdílené sklepy a úložné prostory
- Box/sklep = sedadlo (SVG mapa budovy)
- Měsíční nájem = season pass
- Přístup = TOTP QR místo fyzického klíče

---

## Fáze 6 — Appointment Economy (no-show deposit killer)

Klíčová feature: GoPay preauth deposit při rezervaci.
Zákazník zarezervuje — preauth 50-200 Kč. Přijde = uvolní se. Nepřijde = strhne se.
No-show rate klesne z 15-20 % na ~2-3 %. Toto je samostatný SaaS produkt.

| Vertikála | Primitiv | Specifika |
|---|---|---|
| Kadeřník a kosmetika | fitness_class | No-show deposit, roční smlouva |
| Psí salon a veterinář | recurring events | Roční smlouva = season pass |
| Osobní trenér | 1 sedadlo, 60 min | Balíček 10 lekcí = season pass |
| Masáže a spa | space_rental | Dárková poukázka = gift voucher |
| Fyzioterapeut | conference_room | Pojišťovna = B2B partner |
| Tattoo a piercing | space_rental | Deposit povinný |
| Autoservis | space_rental | Slot = zvedák |

---

## Fáze 7 — Doprava a Mobilita

### Mezistátní autobusy a vlaky
- Sedadlo = seat (SVG mapa vagónu/autobusu)
- Spoj = recurring event (denní jízdní řád)
- Sezónní jízdné = season pass
- Dynamic pricing: čím dříve koupíš, tím levněji

### Parkovací domy (smart) + EV nabíjení
- Parkovací místo = sedadlo (SVG mapa patra)
- Dynamic pricing: obsazenost v reálném čase
- EV nabíjecí stání: slot_duration_min + usage metering
- Předplacené stání = season pass

### Trajekty a lodní linky
- Kabina/místo na palubě = seat
- Auto na trajektu = speciální sedadlo (větší, dražší)

### Lanovky a horské dráhy
- Virtual queue: notifikace místo fyzické fronty
- Single ride = ticket, skipas = season pass

---

## Fáze 8 — Digitální přístup a Licence

### API credits marketplace
- Balíček API calls = ticket s N použitími
- Každý request = 1 scan (scan log model)
- Předplatné = season pass

### AI/GPU compute time slots
- GPU slot na N minut = space_rental
- Dynamic pricing dle vytížení
- Fronta = virtual waiting room (existuje)

### Online kurzy a certifikace
- Přístup ke kurzu = ticket s replay oknem
- Zkouška = event + identity verification (BankID anti-cheating)
- Certifikát = digital wallet pass

### Software seat licensing
- Licence pro N uživatelů = N ticketů
- Roční předplatné = season pass

---

## Fáze 9 — Veřejný sektor a Samospráva

### Úřady a magistráty
- Termín u přepážky = time slot (recurring events)
- Virtual queue + QR emailem den předem
- Integrace s datovými schránkami přes B2B API
- Největší neobsloužený trh v CZ

### Komunální sportovní haly a bazény
- Město = promotér (multi-tenant RLS)
- Resident discount, školy = B2B API

### Národní parky a přírodní rezervace
- Timed entry pro přeplněné trasy (Pravčická brána, Macocha, Adršpach)
- Denní limit = inventory management

### Knihovny
- Studovní místnost = space_rental
- 3D tiskárna = tool library model
- Výpůjčka = ticket s TTL

---

## Fáze 9 — Enterprise a B2B SaaS

### Firemní benefity SaaS (Multisport/Edenred killer)
- Firma = promotér (B2B tenant)
- Benefit = season pass (X vstupů/měsíc do partnerských provozoven)
- HR integrace: SCIM/LDAP
- Fakturace: firemní faktura

### Meeting room booking (Robin/Condeco competitor)
- Zasedačka = sedadlo (floor plan = SVG)
- Calendar sync (Google/Outlook)
- Hot desk = space_rental

### Firemní fleet management
- Firemní auto = venue s 1 sedadlem
- Pool booking pro zaměstnance

---

## Fáze 9 — Niche a Inovativní

### Pop-up restaurace a supper clubs
- Chef's table = event (kapacita 6-12 osob)
- Recurring: každý pátek

### Camping a glamping
- Parcela/stan = sedadlo (SVG mapa)
- Multi-day slot: od-do výběr

### Mariny a lodní stání
- Lodní stání = sedadlo (SVG mapa mariny)
- Rozměrové kategorie = ticket_type

### Tmavá obloha a observatoře
- Teleskop = sedadlo
- Weather-dependent dynamic availability (API počasí)

### Digitální tomboly a loterie
- Losovací lístek = ticket s TOTP QR
- Anti-scalping: 1 lístek na verifikovanou osobu
- Regulace: licence MF CR

### Pohřební a obřadní služby
- Obřadní síň = venue, čas = slot
- Krematorium = time slot

---

## Kompletní přehled — 40 vertikál

| # | Vertikála | Tier | Fáze dev |
|---|---|---|---|
| 1 | Escape rooms, laser game, paintball | 1 | Fáze 5 |
| 2 | Golf, tenis, squash, padel | 1 | Fáze 5 |
| 3 | Ski areály a snowparky | 1 | Fáze 5 |
| 4 | Muzea, galerie, ZOO, botanické zahrady | 1 | Fáze 5 |
| 5 | Aquaparky, bazény, wellness | 1 | Fáze 5 |
| 6 | Stand-up comedy a improv | 1 | Fáze 5 |
| 7 | Fitness studia a yoga | 2 | Fáze 6 |
| 8 | Kadeřníci, kosmetika, tattoo, spa | 2 | Fáze 6 |
| 9 | Osobní trenéři a fyzioterapeuti | 2 | Fáze 6 |
| 10 | Bowling, karaoke, trampolíny | 2 | Fáze 6 |
| 11 | Nahrávací a foto studia, zkušebny | 2 | Fáze 6 |
| 12 | Coworking a meeting rooms | 3 | Fáze 7 |
| 13 | Parkoviště smart + EV nabíjení | 3 | Fáze 7 |
| 14 | Sportovní ligy a turnaje | 3 | Fáze 3d |
| 15 | Jazykové školy a tutoring | 3 | Fáze 7 |
| 16 | Tool library a makerspace | 3 | Fáze 7 |
| 17 | Komunální zahrady a záhumenky | 3 | Fáze 7 |
| 18 | Sdílená auta (car sharing white-label) | 4 | Fáze 8 |
| 19 | Smart building access control | 4 | Fáze 8 |
| 20 | Hotel digital key | 4 | Fáze 8 |
| 21 | Mezistátní autobusy a vlaky | 4 | Fáze 8 |
| 22 | Trajekty a lodní linky | 4 | Fáze 8 |
| 23 | Online kurzy a certifikace | 4 | Fáze 8 |
| 24 | API credits marketplace | 4 | Fáze 8 |
| 25 | Software seat licensing | 4 | Fáze 8 |
| 26 | GPU compute time slots | 4 | Fáze 8 |
| 27 | Firemní benefity SaaS | 4 | Fáze 9 |
| 28 | Meeting room booking | 4 | Fáze 9 |
| 29 | Firemní fleet management | 4 | Fáze 9 |
| 30 | Urady a magistráty | 4 | Fáze 9 |
| 31 | Komunální sportovní haly a parky | 4 | Fáze 9 |
| 32 | Národní parky a rezervace | 3 | Fáze 9 |
| 33 | Knihovny (studovny, výpůjčky) | 3 | Fáze 9 |
| 34 | Camping a glamping | 4 | Fáze 9 |
| 35 | Mariny a lodní stání | 4 | Fáze 9 |
| 36 | Pop-up restaurace a supper clubs | 2 | Fáze 9 |
| 37 | Pohrební a obradní služby | 4 | Fáze 9 |
| 38 | Digitální tomboly a loterie | 4 | Fáze 9 |
| 39 | Tmavá obloha a observatore | 3 | Fáze 9 |
| 40 | Virtuální streamy a webináre | 3 | Fáze 3c (#55) |
