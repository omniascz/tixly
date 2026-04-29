# NFC & NFT Rozšíření — Tixly
*Zapsáno: 8.4.2026 | Stav: návrh, neimplementováno*

---

## KONTEXT

Tento dokument zachycuje strategickou debatu o využití NFC a NFT v platformě Tixly,
plus sadu nových rozšíření která v `strategic-ideas.md` ani `platform-vision.md` chybí.

Vychází z předpokladu, že základní primitiva (TOTP QR, seat locking, Redis, Kafka, RLS)
jsou hotová a stabilní.

---

## NFC — Hlubší využití (nad rámec "NFC náramků + cashless")

### 1. NFC jako primární přístupový credential (offline fallback)
TOTP QR selže při vybitém telefonu nebo výpadku internetu na místě.
**Pasivní NFC tag** (NTAG215, ~1 Kč/kus) na fyzické vstupence nebo průkazu:
- Obsahuje HMAC-podepsané `{ticket_id, event_id, hmac}` zapsané při tisku/výdeji
- Scanner ověřuje offline (lokální cache veřejného klíče)
- Jednorázový zápis = NDEF Lock Bit zapnut při tisku → nedá se přepsat
- **Model nasazení:** QR jako primární, NFC jako fallback (scanner zkouší obojí)
- Effort: ~2 dny

### 2. NFC Smart Poster → přímý nákup bez apky
NDEF URL záznam na plakátu, výloze, sloupu MHD.
Zákazník přiloží telefon (iOS/Android nativně bez instalace apky) → otevře se platební flow
pro konkrétní event s přednastaveným UTM pro atribuci.
- Měřitelné: každý tap = konverze event v analytics
- Levné: jedna NFC samolepka = 5–15 Kč, funguje roky
- Effort: 2 dny (NDEF encoding + UTM tracking)

### 3. NFC Staff Badge autentizace
Pracovníci na akci mají NFC čip v ID kartě (vytisknuté organizátorem).
Přiložení ke scanneru = ověření identity + oprávnění ("Petr, bezpečnost, brána A–C, akce XY").
- Bez hesel, bez přihlašování
- Každé ověření = audit log záznam
- Revokace v reálném čase (scanner stáhne CRL list)
- Effort: 2 dny

### 4. NFC Bag Check / Šatna
Tag přilepený na tašku nebo bundě = provázaný s profilem zákazníka.
Obsluha přiloží čtečku → jméno, číslo stánku, telefonní kontakt.
Nahrazuje papírové lístky. Přirozené rozšíření festivalového modulu.
- Modul: `nfc-cloakroom`
- Effort: 1 den

### 5. NFC Seat Enhancement (order-at-seat)
Pasivní NFC tag přilepený pod sedadlo nebo na opěrku.
Divák přiloží telefon → objedná jídlo, drink, merch na dané místo.
Bez hledání apky, bez QR kódu.
- Revenue model: venue platí % z každé objednávky + setup fee
- Synerguje s: `merchandise`, `packages-v2`
- Effort: 3 dny

### 6. NFC Phygital Souvenir / Sběratelství
Fyzický předmět (plakát, pin, limitovaná edice, podepsaný CD) s vloženým NFC tagem.
Přiložením telefonu se odemkne:
- Zákulisní video, podpis umělce, certifikát pravosti
- POAP token (viz níže)
- Přístup do uzavřené fan komunity
- Organizer prodá předmět za 3× vyšší cenu. Revenue split s platformou.
- Effort: 3 dny (+ NFT vrstva níže)

---

## NFT — Kompletně chybí, velký white space

*Poznámka: Implementovat pragmaticky, ne "crypto-bro" způsobem.
Zákazník nemusí rozumět blockchainu — to je implementační detail.*

### 1. POAP — Proof of Attendance Protocol
Soulbound (nepřenositelný) NFT mintnutý **po** akci.
Důkaz mintu: TOTP log potvrzuje, že zákazník byl fyzicky přítomen.

- Chain: Polygon (gas ~$0.001 / mint)
- Standard: ERC-5484 (soulbound) nebo klasický ERC-721 s transfer lock
- UI: zákazník dostane email "Tvůj POAP je připraven" → otevře v apce
- **Co to dává:** digitální razítko "Byl jsem tam", ověřitelná třetí stranou, sbírka životních zážitků
- **Platform gain:** lock-in loajalita (sbírka → chce sbírat dál), virální sdílení

### 2. NFT jako kolekcionářský ticket (post-event unlock)
Po skončení akce se ticket "odemkne" jako NFT s unikátní grafikou:
pořadové číslo, datum, místo, stats (délka show, setlist, počet přítomných).
Generativní artwork dle parametrů eventu.

- Standard: ERC-721
- Royalty: EIP-2981 → každý sekundární prodej = % pro organizátora/umělce automaticky
- Hosting: IPFS (metadata) + Arweave (permanentní storage)

### 3. Programmable Royalties na ticket resale
Každý resale přes platformu nese smart-contract-enforced royalty:
- 5 % artist/organizer
- 2 % Tixly
- 93 % prodávající

Nedá se obejít protokolem. Nahrazuje "dobrovolný" podíl z resale.
Relevantní zejména pro dražší vstupenky (VIP, festival, sport).

### 4. NFT-gated presale
Majitelé specifického NFT collection (fan club token, předchozí POAP série)
mají přístup k presale 24h–72h před ostatními.

- Integrace: ověř `ownerOf(tokenId)` pro daný contract address → odemkni presale tier
- Organizer/artist si udělá vlastní NFT drop → distribuce přímým fanouškům
- Tixly poskytuje infrastrukturu pro gating, nemusí mít vlastní NFT

### 5. Event DAO — hlasování fanouškovou komunitou
Majitelé NFT vstupenek (nebo POAP) mohou hlasovat:
- Který support act hraje?
- Přídavky: ano/ne a jak dlouho?
- Příští ročník: Praha nebo Brno?

- Standard: Snapshot.org (off-chain voting, bez gas fees)
- Váha hlasu: počet POAP ze série (loajálnější fanoušci mají větší vliv)
- Organizer dostane přímý feedback, fanoušci se cítí součástí

### 6. Fractional NFT Ticket pro velmi drahé vstupenky
Grand prix paddock club (50 000 Kč), Super Bowl, finále Champions League.
Skupina lidí koupí 1 vstupenku společně jako NFT → sdílí ji (1 osoba jde fyzicky).

- Standard: ERC-1155 nebo ERC-20 fractional wrapper
- Escrow: smart contract drží ETH/stablecoin, uvolní prodávajícímu po vstupu
- Alternativa k skupinovému nákupu pro extrémně drahé vstupenky

---

## NOVÁ ROZŠÍŘENÍ — Co chybí v strategic-ideas.md i platform-vision.md

### Virtual Queue / Phantom Ticketing (anti-crash pro výprodeje)
Ticketmaster padá při výprodaných turné. Náš model:
Zákazník se zapíše do virtuální fronty **předem** (den/hodinu před otevřením prodeje).
Systém přidělí časové okno nákupu (ne všichni najednou).

- Technicky: Redis sorted set s timestampem přihlášení, worker odemyká okna po 200 zákaznících
- Bot protection: každé přihlášení do fronty = CAPTCHA + device fingerprint
- UX: "Jsi číslo 847 ve frontě, tvé okno je 14:23–14:33"
- **Máme Redis + Kafka → 3 dny práce**

### Biometrický přístup — Ticketless Entry
Face recognition jako vstupenka. Zákazník zaregistruje tvář v apce,
na turniketu projde bez telefonu/QR/NFC.

- GDPR: explicitní souhlas, biometrie uložena jako embedding hash (ne foto)
- Právo na výmaz: jeden klik v profilu
- Fallback: QR/NFC vždy jako záloha
- Relevantní pro: fotbal, velké festivaly, letiště lounges
- Vendors: FaceSDK (Regula), AWS Rekognition, Azure Face API

### Parametrické pojištění (weather-triggered refunds)
Integrace s weather API (Open-Meteo): pokud prší >X mm/h v čas+místo akce
→ automatický refund nebo voucher bez nutnosti kontaktovat CS.

- Implementace: po nákupu = registrace "pojistné podmínky" jako scheduled job
  Webhook od weather service → spustí refund saga
- Revenue: pojišťovna platí Tixly referral fee, nebo si nastavíme vlastní pool
- **Proč chybí na trhu:** všechny pojišťovny to dělají manuálně s 30denní lhůtou

### Accessibility Layer (přístupnost jako first-class feature)
Žádná platforma to nedělá správně. Konkrétně:
- Wheelchair seat booking s mapou přístupových tras (ne jen "bezbariérové místo")
- Carer/companion free ticket — zakoupení s ZTP průkazem → druhá vstupenka za 0 Kč (automatické pravidlo)
- Hearing loop zóna — tag na seat mapě, filtrovatelný
- Audio description session — speciální termíny pro nevidomé (divadlo, muzea)
- Neurodiversity-friendly tagging eventi (tichá hodina, sensory-friendly)
- Revenue: ZTP zákazníci jsou loajální + v mnoha zemích zákonná povinnost pro venues >500

### Live Commerce — nákup během akce
Zákazník na koncertě dostane notification: "Tato bunda je k dispozici — 2 ks zbývají."
Nakoupí merch bez opuštění místa, vyzvednutí u stolu nebo doručení domů.

- Technicky: organizer dashboard → "Live Push" tlačítko → Kafka event
  → notification všem aktivním appám na dané akci
- Integrace s: `merchandise`, `push-notification-copy`

### Demand Intelligence pro organizátory (pre-sale analytics)
Před zahájením prodeje organizer vidí:
- "847 lidí tento event watchlist-ovalo" (intent signal)
- "Jsi 23 % pod tržní cenou pro umělce této velikosti"
- "Doporučená cena na základě 47 srovnatelných eventů: 690–850 Kč"
- Benchmark: vlastní historická data + public zdroje (Songkick, Bandsintown API)

### Event Revenue Advance (tokenizované financování)
Organizer potřebuje cash před prodejem (záloha venue, produkce).
Platforma nabídne:
- Advance 70 % předpokládaného výnosu
- Splátky automaticky strhávány z ticketových výnosů
- Risk model: historická data prodeje podobných eventů
- Revenue model pro platformu: 3–8 % fee z advance
- Alternativa k bankovnímu faktoringu, rychlejší a bez zástavy

### eIDAS 2.0 / EU Digital Identity Wallet integrace
EU Digital Identity Wallet vstoupí v platnost 2026–2027.
Každý EU občan bude mít digitální průkaz v telefonu.

- Použití v Tixly: age verification (alkohol na akci), identity pro anti-scalping,
  přenos fan profilu mezi platformami, SSO pro celou EU
- Implementovat nyní (2026) = first-mover advantage
- Standard: OpenID4VP + OpenID4VCI

### Crowd Flow AI (operační inteligence pro venue)
Real-time heatmapa: kde se tvoří fronty, přetížená místa, nedostatečný počet barů.
Data ze zdrojů: NFC check-pointy, WiFi probe requesty, kamerový systém (optional).
Dashboard pro venue management s konkrétními doporučeními.

- Revenue: venue platí SaaS fee za real-time dashboard
- Synerguje s: `real-time-occupancy`, `branch-management`

### Federated Event Discovery (ActivityPub)
Organizer publishuje eventy na Mastodon/Fediverse přímo z dashboardu.
Sledovatelé mohou RSVP/koupit ticket přímo z jejich Mastodon klienta.

- Standard: ActivityPub (W3C)
- Proč: Facebook Events ztrácí uživatele, organizer nechce závislost na Meta

---

## PRIORITIZACE

| Priorita | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | DB schema migrace (bloker) | 2 dny | Unblocks payouty |
| P1 | Virtual Queue | 3 dny | High-demand sales |
| P1 | NFC Smart Poster | 2 dny | New acquisition channel |
| P2 | POAP NFT (post-event) | 1 týden | Retention + virality |
| P2 | Accessibility Layer | 1 týden | Legal + loyalty |
| P2 | Parametrické pojištění | 3 dny | Conversion booster |
| P3 | eIDAS 2.0 integrace | 3 týdny | EU first-mover |
| P3 | Demand Intelligence dashboard | 2 týdny | Organizer retention |
| P3 | Live Commerce | 1 týden | New revenue stream |
| P4 | NFT-gated presale | 2 týdny | Artist partnerships |
| P4 | Programmable Royalties | 2 týdny | Resale revenue |
| P4 | Biometrický vstup | 3 týdny | Premium venues |
| P5 | Event Revenue Advance | 4 týdny | Organizer financing |
| P5 | Crowd Flow AI | 4 týdny | Venue SaaS |
| P5 | Federated Discovery | 2 týdny | Distribution |
