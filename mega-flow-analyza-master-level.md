# MEGA FLOW ANALÝZA — Master Level
## Kompletní systémové flow na úrovni vývojáře, testera a architekta

---

# ČÁST A: TAXONOMIE — CO VŠECHNO SE DÁ PRODÁVAT

Než se pustíme do flow, musíme pochopit **šíři produktů**, které systém musí zvládnout. Každý typ má jiné flow, jiné edge cases, jiné UI.

## A1. JEDNORÁZOVÉ AKCE (Event-based)

| Kategorie | Podkategorie | Specifika pro flow |
|---|---|---|
| **Koncerty** | Klubový (100 osob), halový (5 000), stadionový (80 000), open-air | GA vs. reserved seating, backstage pass, meet&greet, VIP lounge |
| **Festivaly** | Jednodenní, vícedenní (2–7 dní), camping vs. non-camping | Multi-day pass, single-day, RFID náramek, cashless, zónový přístup, lineup per den |
| **Divadlo** | Činohra, muzikál, opera, balet, loutkové, improvizace | Abonmá/předplatné, přestávka (re-entry?), dětské představení (věkové omezení) |
| **Stand-up / comedy** | Klubový, halový, speciální (roast, open mic) | Věkové omezení (18+), 2-drink minimum, VIP stoly |
| **Sport** | Fotbal, hokej, basketbal, tenis, atletika, MMA, e-sport | Permanentky, sektorový prodej, away fans (separace), VIP skybox, hospitality, standing/seating mix |
| **Konference** | Business, tech, vědecká, networking | Multi-track agenda, early bird, speaker pass, sponsor pass, workshop add-on, online stream, hybrid |
| **Workshop / kurz** | Jednorázový, série (4–12 lekcí) | Omezená kapacita (10–30), materiály v ceně, skill level, opakované termíny |
| **Ples / galavečer** | Formální, maturitní, firemní | Stůl vs. jednotlivec, dress code info, menu výběr v objednávce, tombola vstupenka |
| **Filmové promítání** | Premiéra, festival, retrospektiva, open-air kino | Seat mapa kina, věkový rating, série (filmový festival = multi-pass) |
| **Vernisáž / výstava** | Zahájení (jednorázové), probíhající výstava | Vernisáž = event, výstava = timed entry denně po týdny/měsíce |

## A2. PRŮBĚŽNÝ/OPAKOVANÝ PRODEJ (Admission-based)

| Kategorie | Specifika |
|---|---|
| **Muzeum / galerie** | Timed entry, denní kapacita, stálá + dočasná expozice, skupinové vstupenky, school groups, audio guide add-on |
| **ZOO / botanická zahrada** | Celodenní vstup, sezónní ceny (léto/zima), rodinné vstupenky, krmení zvířat add-on, evening safari |
| **Hrad / zámek / památka** | Prohlídky s průvodcem (timed, fixní kapacita 20–40), self-guided, speciální okruhy, noční prohlídky |
| **Aquapark / zábavní park** | Celodenní, půldenní, sezónka, VIP (skip-the-line), kabiny/lehátka jako add-on |
| **Escape room** | Fixní slot (60–90 min), skupina 2–6 osob, min/max hráčů, tematické místnosti |
| **Laser game / bowling / go-kart** | Časový slot, skupinový nákup, party packages (narozeniny), F&B bundle |
| **Lázně / wellness** | Timed entry, capacity cap, services add-on (masáž, sauna), gender-specific sessions |
| **Rozhledna / vyhlídka** | Timed entry (malá kapacita), pěší výstup vs. výtah, kombi s muzeem |

## A3. PŘEDPLATNÉ / PERMANENTKY (Subscription-based)

| Typ | Flow specifika |
|---|---|
| **Divadelní abonmá** | Výběr z předdefinovaných balíčků (5–12 představení), seat lock across sezóny, obnova (renewal), výměna termínu |
| **Sportovní permanentka** | Celá sezóna / půlsezóna / flex (X zápasů dle výběru), seat lock, transfer jednotlivých zápasů, VIP upgrade |
| **Muzejní členství** | Roční / rodinné / student, neomezený vstup, slevy v shopu, member-only akce |
| **Sezónka (aquapark/ZOO)** | Roční / sezónní, foto na kartu, rodinná, firemní |

## A4. SPECIÁLNÍ TYPY

| Typ | Flow specifika |
|---|---|
| **Dárkový poukaz** | Nominální hodnota NEBO konkrétní akce, platnost, uplatnění v checkoutu |
| **Skupinová vstupenka** | 10+ osob, jmenný seznam (ano/ne), faktura, kontaktní osoba, skupinová sleva |
| **School group** | Učitel zdarma, žákovské ceny, faktura na školu, pedagogický doprovod poměr |
| **Firemní akce / teambuilding** | Faktura na IČO, logo firmy na vstupence, VIP catering, NDA |
| **Charity / benefice** | Donation ticket, transparentní účel, daňový doklad |
| **Combo ticket** | Muzeum + výstava + kavárna, ZOO + aquapark, festival + camping |
| **Skip-the-line / fast pass** | Prémiový doplněk k základní vstupence |
| **Virtuální / online akce** | Stream link, Zoom/YouTube integrace, timezone handling, replay přístup |
| **Hybrid akce** | Fyzická + online vstupenka, různé ceny, různý obsah |

---

# ČÁST B: KOMPLETNÍ FLOW — KAŽDÝ KROK, KAŽDÝ EDGE CASE

---

## B1. SUPER ADMIN FLOW

### B1.1 Inicializace platformy (jednorázově)

```
KROK 1: Konfigurace platformy
├── Nastavení globálních parametrů
│   ├── Provizní model (% z ceny / fixní / hybrid)
│   ├── Servisní poplatek pro kupujícího (fixní / % / za nákup / za vstupenku)
│   ├── Pravidla absorpce poplatků (kdo platí — pořadatel / kupující / split)
│   ├── Settlement frekvence (24h / 3 dny / týdně / měsíčně / po akci)
│   ├── Měna (CZK, EUR, multi-currency?)
│   ├── DPH režimy (21% / 15% / 10% / osvobozeno — dle typu akce)
│   ├── Minimální / maximální cena vstupenky
│   └── Maximální počet vstupenek na objednávku (anti-scalping)
├── Platební brány
│   ├── Primární (Stripe / GoPay / Pays / Comgate)
│   ├── Apple Pay, Google Pay
│   ├── QR platby (české banky)
│   ├── Benefitní systémy (Pluxee, Benefit Plus, Gallery Beta)
│   ├── Twisto / buy-now-pay-later
│   ├── Bankovní převod (automatický matching plateb)
│   └── Hotovost (POS / pokladna)
├── Bezpečnost
│   ├── CAPTCHA konfigurace (typy, threshold)
│   ├── Rate limiting (požadavky/s per IP)
│   ├── Waiting Room parametry (kapacita, timeout, randomizace)
│   ├── Fraud detection pravidla
│   ├── Digitální podpis vstupenek (certifikát, CA)
│   ├── GDPR nastavení (consent texty, data retention)
│   └── Anti-screenshot ochrana (dynamický barcode refresh interval)
└── Komunikační kanály
    ├── SMTP server (transakční emaily)
    ├── SMS brána (info SMS, reklamní SMS, SMS vstupenky)
    ├── Push notifikace (Firebase / APNs)
    └── Šablony emailů (potvrzení, připomínka, refundace, změna)
```

### B1.2 Správa Venue knihovny

```
KROK 2: Venue Management
├── Vytvoření venue profilu
│   ├── Základní info (název, adresa, GPS, kontakt, kapacita)
│   ├── Fotky, popis, pokyny pro návštěvníky
│   ├── Parkování, MHD, bezbariérovost
│   ├── Provozní doba (pokud trvalé venue)
│   └── Typ venue (indoor / outdoor / hybrid)
├── SEAT MAP EDITOR
│   ├── Canvas — drag-and-drop na podklad (PNG/SVG blueprintu)
│   ├── Nástroje:
│   │   ├── Kreslit sektor (polygon)
│   │   ├── Generovat řady a sedadla (grid / curved / custom)
│   │   ├── Číslování (automatické / manuální / sudá-lichá)
│   │   ├── GA zóna (stojící, bez sedadel — jen kapacita)
│   │   ├── VIP zóna (oddělený sektor)
│   │   ├── Skybox / lóže (pojmenované, fixní kapacita)
│   │   ├── Backstage zóna (staff only, akreditace)
│   │   ├── Přístupové body (vchody/východy — per sektor)
│   │   ├── Handicap místa (wheelchair, companion seat vedle)
│   │   ├── Sloup / překážka (sedadlo s omezeným výhledem → nižší cena)
│   │   ├── Technická oblast (zvuk, světla — neprodejné)
│   │   └── Pódium / stage / ring / hřiště (neprodejné, orientační)
│   ├── Uložení jako MASTER TEMPLATE
│   ├── Verzování (v1, v2... — venue se rekonstruuje)
│   ├── Klonování template → nový layout (festival = jiný floor než koncert)
│   └── Sdílení s pořadateli (výběr z katalogu)
├── Edge cases:
│   ├── Venue bez seat mapy (GA only — např. open-air louka)
│   ├── Venue s proměnlivým layoutem (kongresový sál — stoly vs. divadlo vs. bankét)
│   ├── Multi-stage venue (festival: Main Stage, Second Stage, Tent, DJ zone)
│   ├── Venue s omezeným výhledem (sloup, balkon, boční)
│   ├── Outdoor venue s počasím (contingency plan, rain date)
│   └── Venue bez adresy (pop-up, tajná lokace — reveal 24h před)
```

### B1.3 Správa pořadatelů

```
KROK 3: Pořadatel Management
├── Registrace nového pořadatele
│   ├── Formulář: jméno/firma, IČO, DIČ, kontakt, web, sociální sítě
│   ├── Ověření IČO přes ARES API → automatické doplnění údajů
│   ├── Bankovní účet pro settlement
│   ├── Nahrání dokladů (ŽL, výpis z OR — pokud vyžadováno)
│   └── Souhlas s OP, GDPR, provizním modelem
├── Schválení
│   ├── Super Admin recenzuje → schválí / zamítne / požádá o doplnění
│   ├── TIER systém:
│   │   ├── TIER 1 (nový) — manuální schválení každé akce, limit 500 tix/akce
│   │   ├── TIER 2 (ověřený) — auto-approve, limit 5 000 tix/akce
│   │   ├── TIER 3 (premium) — auto-approve, bez limitu, nižší provize
│   │   └── TIER 4 (enterprise) — custom SLA, dedikovaný account manager
│   └── Automatický upgrade na základě objemu a historie
├── Dashboard pořadatele (co vidí Super Admin)
│   ├── Všechny akce pořadatele
│   ├── Tržby, provize, settlement status
│   ├── Počet stížností / refundací
│   ├── Compliance score (včasnost dodání info, kvalita popisů)
│   └── Komunikační historie
├── Akce nad pořadatelem (Super Admin může)
│   ├── Pozastavit účet
│   ├── Změnit tier
│   ├── Vynutit refundaci (při zrušení akce a nečinnosti pořadatele)
│   ├── Upravit provizi (individuální dohoda)
│   └── Přiřadit account managera
```

### B1.4 Schvalování akcí

```
KROK 4: Schvalovací workflow
├── Nová akce od pořadatele → fronta ke schválení
├── Auto-approve pravidla:
│   ├── TIER 2+ → auto-approve (pokud splňuje automatické kontroly)
│   ├── Automatické kontroly:
│   │   ├── Název neobsahuje zakázaná slova
│   │   ├── Datum v budoucnosti (min. X dní předem)
│   │   ├── Venue existuje v databázi
│   │   ├── Cena v povoleném rozsahu
│   │   ├── Popis má min. délku
│   │   └── Obrázek nahrán (min. rozlišení)
│   └── Pokud jakákoli kontrola selže → manuální review
├── Manuální review:
│   ├── Super Admin vidí preview akce
│   ├── Schválí / zamítne s komentářem / požádá o úpravu
│   ├── Pořadatel dostane notifikaci (email + in-app)
│   └── Pořadatel upraví → resubmit → nový review
├── Edge cases:
│   ├── Duplicitní akce (stejný umělec, stejné datum, jiný pořadatel) → alert
│   ├── Kontroverzní obsah (politické akce, 18+ akce) → manuální vždy
│   ├── Podezření na podvod (nerealistické ceny, podezřelý pořadatel)
│   └── Akce na neověřeném venue (pop-up, soukromý prostor)
```

### B1.5 Finanční operace

```
KROK 5: Settlement a finance
├── Automatický settlement engine
│   ├── Pro každého pořadatele:
│   │   ├── Výpočet tržeb (gross sales)
│   │   ├── Odečtení provize platformy
│   │   ├── Odečtení servisních poplatků (pokud absorbuje pořadatel)
│   │   ├── Odečtení refundací
│   │   ├── Odečtení chargebacků
│   │   ├── = Net payout
│   │   └── Převod na bankovní účet pořadatele
│   ├── Frekvence: dle nastavení (24h / 3 dny / týdně / měsíčně / po akci)
│   ├── Automatický email s vyúčtováním (PDF)
│   └── Účetní podklady ke stažení (příjmový report + nákladová faktura za provizi)
├── Refundační pravidla
│   ├── Globální pravidla (výchozí)
│   │   ├── Plná refundace do X dní před akcí
│   │   ├── Částečná refundace do Y dní
│   │   ├── Žádná refundace po Z dnech
│   │   ├── Servisní poplatek nerefundovatelný (ano/ne — dle politiky)
│   │   └── Automatická refundace při zrušení akce pořadatelem
│   ├── Override pořadatelem (v rámci limitů)
│   └── Manuální refundace Super Adminem (spory, výjimky)
├── Edge cases:
│   ├── Pořadatel zmizí / nekomunikuje → Super Admin vynutí refundaci z holdovaných tržeb
│   ├── Chargeback od banky kupujícího → automatické storno + notifikace pořadateli
│   ├── Částečná refundace (pořadatel změní program — kupující chce zpět část)
│   ├── Refundace po akci (nekvalitní akce — claim)
│   ├── Multi-currency settlement (zahraniční pořadatel, CZK vs. EUR)
│   └── DPH reporting (různé sazby dle typu akce — kultura 15%, sport 21%, charita 0%)
```

### B1.6 Marketplace management

```
KROK 6: Portál a marketplace
├── Homepage
│   ├── Featured akce (ruční curation + algoritmické doporučení)
│   ├── Kategoriové sekce
│   ├── Regionální filtr (Praha / Brno / Ostrava / celá ČR)
│   ├── „Dnes večer" / „Tento víkend" / „Tento měsíc"
│   └── Sezónní kampaně (Vánoce, léto, festivaly)
├── Marketplace Ads (revenue stream)
│   ├── Sponzorované umístění (CPC model)
│   ├── Bannery na homepage
│   ├── Doporučení v kategorii
│   ├── Self-serve pro pořadatele (z dashboardu)
│   └── Reporting: impressions, clicks, konverze, ROAS
├── SEO
│   ├── Automatické event stránky (schema.org markup)
│   ├── Sitemap generátor
│   ├── Meta tagy per akce
│   └── Google Events structured data
├── Partnerská prodejní místa
│   ├── Onboarding partnera → přístupy, provize
│   ├── Partner vidí centrální databázi akcí
│   ├── Prodej z centrální DB → real-time synchronizace
│   ├── Provize partnerovi z provize platformy (nezatěžuje pořadatele)
│   ├── Vyzvednutí vstupenek na jakémkoli partnerském místě
│   └── POS systém pro partnera (webový / terminál)
```

---

## B2. POŘADATEL FLOW

### B2.1 Registrace a onboarding

```
KROK 1: Registrace
├── Email + heslo (nebo SSO: Google, Apple)
├── Formulář: typ (fyzická osoba / firma / spolek / příspěvková org.)
│   ├── Firma → IČO → ARES API → auto-fill (název, adresa, DIČ, OR)
│   ├── Fyzická osoba → jméno, adresa, datum narození
│   └── Příspěvková org. → IČO + zřizovatel
├── Bankovní účet (IBAN validace)
├── Profilová stránka (logo, popis, social links)
├── Souhlas s podmínkami + GDPR
├── → Super Admin schválí → účet aktivní
├── Testovací akce (sandbox) — pořadatel si vyzkouší flow nanečisto
└── 1:1 onboarding call (volitelné, pro TIER 3+)
```

### B2.2 Tvorba akce — MEGA DETAIL

```
KROK 2: Nová akce — krok za krokem
│
├── 2a) ZÁKLADNÍ INFO
│   ├── Název akce (povinné, min. 5 znaků, max. 120)
│   ├── Podtitul / claim (volitelné)
│   ├── Typ akce (dropdown: koncert / divadlo / festival / sport / konference / 
│   │   workshop / výstava / prohlídka / party / ples / filmové promítání / 
│   │   online / hybrid / rodinná akce / charita / firemní / jiné)
│   ├── Kategorie + tagy (pro vyhledatelnost)
│   ├── Popis (WYSIWYG editor, min. 100 znaků)
│   │   ├── AI asistence — generování popisu z klíčových slov
│   │   ├── Šablony popisů dle typu akce
│   │   └── Vícejazyčný popis (CZ / EN / DE — volitelné)
│   ├── Obrázky
│   │   ├── Hlavní obrázek (povinné, min. 1200×630px, max 5MB)
│   │   ├── Galerie (max 10 obrázků)
│   │   ├── Automatický crop pro social sharing (OG image)
│   │   └── Validace: rozlišení, formát (JPG/PNG/WebP), velikost
│   ├── Video (YouTube / Vimeo embed URL — volitelné)
│   ├── Lineup / účinkující
│   │   ├── Přidání umělců (jméno, foto, bio, Spotify link)
│   │   ├── Řazení (headliner → support)
│   │   ├── [Festival] Lineup per den / stage
│   │   └── Auto-propojení: Bandzone, Spotify, Songkick
│   ├── Věkové omezení (žádné / 12+ / 15+ / 18+ / 21+)
│   ├── Doplňkové info
│   │   ├── Dress code (formální, casual, kostým...)
│   │   ├── Co si vzít (deky, sluchátka, baterky...)
│   │   ├── Co je zakázáno (sklo, zvířata, drony...)
│   │   ├── Parkování (info, odkaz na mapu)
│   │   └── Bezbariérovost (ano/ne, detaily)
│   └── Viditelnost
│       ├── Veřejná (na marketplace)
│       ├── Neveřejná (pouze přes přímý odkaz)
│       └── Plánovaná publikace (datum + čas)
│
├── 2b) DATUM A ČAS
│   ├── Jednorázová akce
│   │   ├── Datum začátku + čas
│   │   ├── Datum konce + čas (volitelné — pro vícehodinové)
│   │   ├── Otevření dveří / gates open (čas)
│   │   └── Timezone (CET/CEST — auto-detect dle venue)
│   ├── Opakovaná akce (série)
│   │   ├── Opakování: denně / týdně / měsíčně / custom
│   │   ├── Výběr dnů v týdnu (Po–Ne)
│   │   ├── Rozsah dat (od–do)
│   │   ├── Výjimky (svátky, zavírací dny)
│   │   └── Generování X akcí v sérii (max 365)
│   ├── Vícedenní akce (festival)
│   │   ├── Začátek (den 1) → konec (den X)
│   │   ├── Denní program (lineup per den)
│   │   ├── Vstupenky: celý festival / single-day / combo
│   │   └── Camping: check-in / check-out data
│   ├── Timed entry
│   │   ├── Časové sloty (např. 09:00–10:00, 10:00–11:00...)
│   │   ├── Délka slotu (15 min / 30 min / 1h / custom)
│   │   ├── Kapacita per slot
│   │   ├── Buffer mezi sloty (úklid, příprava)
│   │   ├── Generování slotů pro celý den / týden / měsíc
│   │   └── Override kapacity per konkrétní slot (svátky, víkendy)
│   ├── Edge cases:
│   │   ├── Akce přes půlnoc (začátek 22:00, konec 04:00)
│   │   ├── Změna data po zahájení prodeje → notifikace všem kupujícím
│   │   ├── Zrušení jednoho dne z vícedenní akce
│   │   ├── Rain date / náhradní termín
│   │   └── Akce „TBA" (datum zatím neznámé — presale s pozdějším upřesněním)
│
├── 2c) VENUE A SEAT MAPA
│   ├── Výběr venue
│   │   ├── Z knihovny (databáze venue s hotovými seat mapami)
│   │   ├── Nové venue → zadání info → požadavek na seat mapu Super Adminovi
│   │   └── GA venue (bez seat mapy — jen celková kapacita)
│   ├── Custom floor edit
│   │   ├── Aktivace/deaktivace sektorů pro tuto akci
│   │   ├── Přesun focal pointu (stage vlevo/vpravo/uprostřed)
│   │   ├── Přidání GA zóny (stojící) k reserved venue
│   │   ├── Přidání VIP zóny
│   │   ├── Bloky: umělec, produkce, technika (neprodejné)
│   │   └── Uložení jako custom template pro budoucí akce
│   ├── Cenové úrovně (Price Levels)
│   │   ├── Vizuální přiřazení na seat mapě
│   │   │   ├── Klik na sekci/řadu/sedadlo → přiřazení price levelu
│   │   │   ├── Lasso tool (hromadný výběr)
│   │   │   ├── Smart commands: „řady A–E = VIP", „sektor 2 = kategorie B"
│   │   │   └── Barevné kódování dle ceny
│   │   ├── Real-time revenue kalkulace
│   │   │   ├── Při každé změně → okamžitý přepočet potenciálních tržeb
│   │   │   ├── Srovnání: „původní layout vs. upravený"
│   │   │   └── Breakdown: kolik sedadel × jaká cena = tržby
│   │   └── Holds & Kills
│   │       ├── Artist holds (X sedadel pro umělce/produkci)
│   │       ├── Promoter holds (alokace pro partnery, soutěže)
│   │       ├── Production kills (omezený výhled, technické pozice)
│   │       ├── Comp vstupenky (VIP hosté, média, soutěže)
│   │       └── Release timer — holds se uvolní X dní před akcí (automaticky)
│   ├── Edge cases:
│   │   ├── Venue bez existující seat mapy → pořadatel nakreslí sketch → Super Admin vytvoří
│   │   ├── Proměnlivé uspořádání (kongresový sál: divadlo vs. bankét vs. standing)
│   │   ├── Seat mapa s „mrtvými zónami" (sloup, zvuková stěna)
│   │   ├── Multi-stage (festival): přepínání mezi stages → různé kapacity
│   │   ├── Kombinace GA + reserved v jednom venue
│   │   └── Outdoor venue s počasím (kapacita se může měnit — přidání / odebrání sektorů)
│
├── 2d) TYPY VSTUPENEK
│   ├── Pro každý typ:
│   │   ├── Název (např. „Standard", „Early Bird", „VIP Gold", „Dětská")
│   │   ├── Popis (co zahrnuje)
│   │   ├── Cena (face value)
│   │   ├── Platnost price levelu (které sedadla/sektory)
│   │   ├── Počet k dispozici (nebo neomezený = kapacita venue)
│   │   ├── Min / max na objednávku (1–10 typicky)
│   │   ├── Prodejní období (od–do)
│   │   ├── Viditelnost (veřejná / skrytá = access code)
│   │   ├── Refundovatelnost (ano / ne / dle podmínek)
│   │   ├── Transferovatelnost (ano / ne / do X dní před akcí)
│   │   ├── Resale povolení (ano / ne / capped na face value)
│   │   └── Personalizace (na jméno ano/ne)
│   ├── Speciální typy:
│   │   ├── Early Bird → automatické přepnutí na Regular po datu / objemu
│   │   ├── Last Minute → aktivace X dní před akcí
│   │   ├── Skupinová → sleva od X kusů (5+, 10+, 20+)
│   │   ├── Rodinná → bundle (2 dospělí + 2 děti)
│   │   ├── Donation → kupující zvolí částku (min. 0 Kč)
│   │   ├── Zdarma → plnohodnotná vstupenka za 0 Kč (registrace pro kapacitu)
│   │   ├── Waitlist → registrace čekajících na vyprodanou akci
│   │   ├── Payment plan → splátky (2–6 plateb, automatický storno při nezaplacení)
│   │   ├── Na fakturu → IČO, ARES lookup, faktura, manuální potvrzení po zaplacení
│   │   └── Comp → darované vstupenky (s vlastním kódem, bez platby)
│   ├── Cenové strategie:
│   │   ├── Pevná cena
│   │   ├── Stupňované zdražování (v čase: od 1.1. = 200, od 1.3. = 250, od 1.5. = 300)
│   │   ├── Stupňované zdražování (dle objemu: prvních 100 = 200, dalších 200 = 250...)
│   │   ├── Dynamický pricing (algoritmický, opt-in, min/max limity)
│   │   ├── Slevové kódy (% / Kč / BOGO / X+1 zdarma)
│   │   ├── Access codes (odemkne skrytý typ vstupenky)
│   │   └── Bundle pricing (2+ akce v balíčku = sleva)
│
├── 2e) DOPLŇKOVÝ PRODEJ (Add-ony)
│   ├── Merch (tričko, plakát, CD/vinyl)
│   │   ├── Velikosti (S/M/L/XL/XXL), barvy
│   │   ├── Skladové množství
│   │   └── Vyzvednutí na místě / doručení poštou
│   ├── F&B (menu, VIP catering, festivalová večeře)
│   │   ├── Menu výběr v objednávce (ples, galavečer)
│   │   ├── Dietní omezení (vegetarián, vegan, bezlepkové)
│   │   └── Předobjednávka vs. nákup na místě
│   ├── Parkování (rezervace místa, číslo parcely)
│   ├── Camping (festival: standard / glamping / karavan)
│   ├── Audio guide (muzeum, hrad)
│   ├── Meet & Greet
│   ├── Photo pass
│   ├── Skip-the-line / Fast Pass
│   ├── Insurance (pojištění vstupenky)
│   ├── Custom add-ony (pořadatel definuje vlastní)
│   └── Upsell pravidla
│       ├── Automatická nabídka v checkoutu
│       ├── Post-purchase email s add-ony
│       └── Upgrade nabídka v den akce (in-venue)
│
├── 2f) PRODEJNÍ FÁZE (Onsale strategy)
│   ├── Pre-registration (registrace zájmu → Verified Fan model)
│   ├── Exclusive pre-sale (fan club, VIP, sponzorský kód)
│   ├── Early access (registrovaní uživatelé platformy)
│   ├── General onsale (veřejný prodej)
│   ├── Last minute (den akce)
│   ├── Door sales (na místě)
│   ├── Pro každou fázi:
│   │   ├── Datum + čas zahájení a ukončení
│   │   ├── Které typy vstupenek jsou dostupné
│   │   ├── Limit na osobu
│   │   ├── Promo kód povinný (ano/ne)
│   │   └── Waiting Room (ano/ne, parametry)
│
├── 2g) KOLABORACE (Sub-účty)
│   ├── Pozvání promotéra
│   │   ├── Email pozvánka → registrace → přístup k akci
│   │   ├── Oprávnění: view only / edit / approve
│   │   ├── Sdílená seat mapa — real-time kolaborace
│   │   ├── Chat v kontextu akce
│   │   ├── Notifikace o změnách
│   │   └── Audit log — kdo co kdy změnil
│   ├── Pozvání box office staffu
│   │   ├── Přístup k pokladnímu systému (POS)
│   │   ├── Omezení: nemůže měnit ceny / akci / seat mapu
│   │   └── Evidence prodejů per staff member
│   ├── Pozvání entry staffu
│   │   ├── Přístup ke skenování (app Brána)
│   │   ├── Omezení: nemůže prodávat / měnit
│   │   └── Přiřazení ke konkrétnímu vchodu
│   ├── Pozvání akreditačního managera
│   │   ├── Správa médií, VIP, staff vstupenek
│   │   ├── Schvalování žádostí o akreditaci
│   │   └── Generování akreditačních průkazů
│
├── 2h) KOMUNIKACE
│   ├── Automatické emaily (customizovatelné šablony)
│   │   ├── Potvrzení nákupu (+ vstupenka v příloze)
│   │   ├── Připomínka (X dní před akcí)
│   │   ├── Připomínka (den akce — ráno)
│   │   ├── Změna akce (datum/místo/lineup)
│   │   ├── Zrušení akce (+ refundační instrukce)
│   │   ├── Post-event děkujeme (+ feedback formulář)
│   │   └── Upsell email (add-ony, merch, další akce)
│   ├── SMS komunikace
│   │   ├── SMS vstupenka (QR kód přímo do SMS)
│   │   ├── Připomínací SMS v den akce
│   │   ├── Informační SMS (změna programu, počasí, doprava)
│   │   └── Reklamní SMS (remarketing na minulé návštěvníky)
│   ├── Push notifikace (pokud mobilní app)
│   │   ├── Onsale reminder
│   │   ├── Akce za X dní
│   │   └── Gate opening
│   └── Personalizace per typ vstupenky
│       ├── VIP vstupenka → jiný email s VIP info
│       ├── Backstage pass → bezpečnostní instrukce
│       └── Camping → check-in info, mapa areálu
│
└── 2i) PUBLIKACE
    ├── Preview mode — pořadatel vidí, jak akce vypadá na marketplace
    ├── Kontrolní checklist (systém automaticky ověří):
    │   ├── ✓ Název vyplněn
    │   ├── ✓ Popis min. délka
    │   ├── ✓ Obrázek nahrán
    │   ├── ✓ Alespoň 1 typ vstupenky
    │   ├── ✓ Datum v budoucnosti
    │   ├── ✓ Venue vybráno
    │   ├── ✓ Seat mapa (pokud reserved)
    │   ├── ✓ Cenové úrovně přiřazeny
    │   └── ✗ Chybějící položky → varování, nelze publikovat
    ├── Odeslání ke schválení (TIER 1)
    ├── Auto-approve (TIER 2+)
    └── Akce je v prodeji → distribuce do všech kanálů
```

---

## B3. KUPUJÍCÍ FLOW

### B3.1 Discovery → Nákup → Doručení → Vstup → Post-event

```
FÁZE 1: DISCOVERY (Jak kupující najde akci)
├── Organický
│   ├── Marketplace portál — procházení, vyhledávání, filtry
│   │   ├── Fulltextové hledání (název, umělec, venue, město)
│   │   ├── Filtry: datum, město, kategorie, cena (od–do), dostupnost
│   │   ├── Řazení: datum, popularita, cena, doporučené
│   │   ├── „Dnes" / „Tento víkend" / „Tento měsíc" shortcuts
│   │   ├── Personalizovaná doporučení (dle historie, oblíbených)
│   │   └── Geo-lokace (akce poblíž)
│   ├── Mobilní app
│   ├── Google Search (SEO event stránky)
│   ├── Social media (FB event, IG, TikTok)
│   └── Word-of-mouth / přímý odkaz
├── Placený
│   ├── Marketplace Ads (sponzorované výsledky)
│   ├── FB/IG/TikTok Ads (pořadatel)
│   ├── Google Ads (pořadatel)
│   └── SMS remarketing (pro minulé návštěvníky)
├── Partnerský
│   ├── Embedded widget na webu pořadatele
│   ├── Affiliate partneři (Bandzone, Songkick...)
│   ├── Fyzická prodejní místa
│   └── QR kód z plakátu/letáku

FÁZE 2: DETAIL AKCE
├── Stránka akce
│   ├── Název, popis, obrázky, video
│   ├── Datum, čas, venue (+ mapa)
│   ├── Lineup (s Spotify linky)
│   ├── Typy vstupenek a ceny
│   ├── Dostupnost (zbývá X / vyprodáno / waitlist)
│   ├── Věkové omezení
│   ├── Bezbariérovost
│   ├── Pravidla (co vzít, co ne)
│   ├── Refundační politika
│   ├── Sdílení (social buttons)
│   └── „Oblíbit pořadatele / venue" → notifikace o nových akcích

FÁZE 3: VÝBĚR VSTUPENEK
├── GA akce (bez seat mapy)
│   ├── Výběr typu vstupenky z dropdownu
│   ├── Počet (spinner / dropdown)
│   ├── Add-ony (checkbox / dropdown)
│   ├── Slevový kód (input field)
│   └── → Košík
├── Reserved seating (seat mapa)
│   ├── Interaktivní mapa venue
│   │   ├── Zoom in/out, pan
│   │   ├── Barevné kódování dle cenové úrovně
│   │   ├── Šedá = vyprodáno/blokováno
│   │   ├── Hover → tooltip (cena, řada, sedadlo, výhled)
│   │   ├── Klik → výběr sedadla → přidání do košíku
│   │   ├── Multi-select (shift+klik pro sousední)
│   │   ├── „Nejlepší dostupné" button (auto-select)
│   │   └── Filtry: cenová úroveň, sektor, dostupnost
│   ├── Handicap sedadla → speciální sekce + companion seat
│   ├── Skupinový nákup → systém nabídne sousední sedadla
│   └── → Košík
├── Timed entry (muzeum, ZOO, prohlídka)
│   ├── Kalendář → výběr dne
│   ├── Časové sloty → výběr slotu (zobrazena zbývající kapacita)
│   ├── Počet osob (dospělí, děti, senioři)
│   ├── Add-ony (audio guide, speciální okruh)
│   └── → Košík
├── Předplatné / permanentka
│   ├── Výběr typu (celá sezóna / flex / bundle)
│   ├── [Flex] Výběr konkrétních zápasů/představení
│   ├── [Reserved] Výběr sedadla (lock across sezóny)
│   ├── Payment plan (jednorázově / splátky)
│   └── → Košík
├── Edge cases:
│   ├── Poslední vstupenka → race condition handling
│   │   ├── Temporary hold (5–10 min timeout v košíku)
│   │   ├── Countdown timer viditelný kupujícímu
│   │   ├── Po expiraci → sedadlo/vstupenka se vrátí do prodeje
│   │   └── Paralelní pokus jiného kupujícího → „obsazeno, zkuste jiné"
│   ├── Změna ceny během browsingu (dynamický pricing)
│   │   └── Cena se fixuje až při přidání do košíku (ne dříve)
│   ├── Vyprodáno během nákupu
│   │   └── Graceful error → nabídka waitlistu / jiného termínu
│   ├── Přerušení platby (banka zamítne, výpadek sítě)
│   │   ├── Objednávka v „pending" stavu (max 30 min)
│   │   ├── Auto-cancel po 30 min → vstupenky zpět do prodeje
│   │   └── Duplikace kontrola (aby kupující nezaplatil 2×)
│   ├── Bot detection
│   │   ├── CAPTCHA při podezřelém chování
│   │   ├── Rate limiting per IP / session
│   │   ├── Waiting Room pro high-demand akce
│   │   └── Device fingerprinting
│   └── Výpadek internetu u kupujícího
│       └── Lokální uložení stavu košíku → obnovení po reconnectu

FÁZE 4: CHECKOUT
├── Přehled objednávky
│   ├── Seznam vstupenek (typ, sedadlo, cena)
│   ├── Add-ony
│   ├── Slevový kód (pole pro zadání → validace → přepočet)
│   ├── Servisní poplatek (transparentně zobrazen)
│   ├── Celková cena (vč. DPH breakdown)
│   └── Refundační politika (checkbox potvrzení)
├── Kontaktní údaje
│   ├── Email (povinné — pro doručení vstupenky)
│   ├── Telefon (povinné — pro SMS vstupenku / komunikaci)
│   ├── [Personalizovaná vstupenka] Jméno per vstupenka
│   ├── [Na fakturu] IČO → ARES → auto-fill firmy
│   ├── [Custom questions pořadatele] Dietní omezení, tričko velikost...
│   ├── GDPR souhlas (checkbox)
│   └── Marketing souhlas (opt-in, nesmí být default zaškrtnutý)
├── Platba
│   ├── Apple Pay / Google Pay (1-click, pokud uloženo)
│   ├── Platební karty (Visa, MC, Amex)
│   │   ├── 3D Secure autentizace
│   │   ├── Tokenizace (uložení karty pro příští nákup)
│   │   └── PCI DSS compliance
│   ├── QR platba (generování QR → sken v bankovní app)
│   │   ├── Čekání na potvrzení (webhook od banky)
│   │   └── Timeout → auto-cancel
│   ├── Bankovní převod
│   │   ├── Generování variabilního symbolu
│   │   ├── Zobrazení platebních údajů
│   │   ├── Automatický matching (webhook od banky / cron job)
│   │   ├── Timeout (3 dny typicky) → auto-cancel
│   │   └── Manuální matching Super Adminem (edge case)
│   ├── Benefitní systémy (Pluxee, Benefit Plus, Gallery Beta)
│   │   ├── Přesměrování na benefitní portál
│   │   └── Callback s potvrzením
│   ├── Twisto (buy now, pay later)
│   │   ├── Twisto ověření → okamžité doručení vstupenek
│   │   └── Faktura od Twisto → 14 dní na úhradu
│   ├── Hotovost (pouze na fyzickém prodejním místě / door sales)
│   └── Payment plan (splátky)
│       ├── Automatické strhávání (měsíčně)
│       ├── Notifikace o nadcházející splátce
│       ├── Grace period (X dní po splatnosti)
│       └── Auto-cancel + storno vstupenek při nezaplacení
├── Potvrzení
│   ├── Confirmation page (děkujeme, shrnutí objednávky)
│   ├── Email s vstupenkou (PDF + QR, digitálně podepsaná)
│   ├── SMS vstupenka (volitelné — QR do SMS)
│   ├── Apple Wallet / Google Wallet pass
│   └── Uložení do návštěvnického účtu

FÁZE 5: SPRÁVA VSTUPENEK (Post-purchase)
├── Návštěvnický účet
│   ├── Přehled všech vstupenek (nadcházející / minulé)
│   ├── Stažení vstupenky (PDF)
│   ├── Přidání do Wallet
│   ├── Přeposlání na email (nové doručení)
│   └── Faktura ke stažení
├── Transfer vstupenky
│   ├── Zadání emailu příjemce
│   ├── [Pravidla pořadatele] Transfer povolen / zakázán / do X dní před akcí
│   ├── Originální vstupenka → DEAKTIVOVÁNA (starý QR neplatí)
│   ├── Nová vstupenka → příjemci (nový QR, nový digitální podpis)
│   ├── Příjemce musí mít účet (registrace) NEBO přijme přes email/SMS
│   └── Edge cases:
│       ├── Transfer na neexistující email → pozvánka k registraci
│       ├── Příjemce nepřijme do X dní → vrátí se odesílateli
│       ├── Dvojitý transfer (A→B→C) → povoleno / zakázáno dle nastavení
│       └── Transfer personalizované vstupenky → změna jména
├── Resale (fan-to-fan)
│   ├── Nabídka vstupenky k prodeji
│   │   ├── Cena: max. face value (nebo % nad — dle nastavení pořadatele)
│   │   ├── Zobrazení na marketplace vedle primárních vstupenek
│   │   ├── Jasné označení „přeprodej"
│   │   └── Poplatek prodejce (% z prodejní ceny)
│   ├── Prodej
│   │   ├── Kupující vidí resale vstupenku na seat mapě
│   │   ├── Nákup → nový QR/barcode → originál deaktivován
│   │   └── Výplata prodejci: po akci (X pracovních dní)
│   ├── Stažení z prodeje (prodejce si to rozmyslí)
│   │   └── Vstupenka se vrátí prodejci
│   ├── [Pořadatel zakázal resale] → funkce nedostupná
│   └── Edge cases:
│       ├── Resale vstupenka se neprodá → vrátí se majiteli
│       ├── Zrušení akce → refundace i resale kupujícímu
│       └── Podezření na scalping → monitoring, ban účtu
├── Refundace
│   ├── Self-service (pokud povoleno pořadatelem)
│   │   ├── „Požádat o refundaci" button
│   │   ├── Validace dle refundačních pravidel
│   │   ├── Plná / částečná refundace → automaticky na platební metodu
│   │   └── Potvrzení emailem
│   ├── Přes zákaznickou podporu (pokud self-service zakázáno)
│   └── Automatická refundace při zrušení akce

FÁZE 6: DEN AKCE
├── Příchod na venue
│   ├── Ukázání vstupenky
│   │   ├── QR kód na telefonu (app / email / SMS / Wallet)
│   │   ├── Tištěná vstupenka (PDF)
│   │   ├── RFID náramek (festival)
│   │   └── Biometrie / selfie (budoucí fáze)
│   ├── Skenování
│   │   ├── App Brána / profesionální čtečka / turniket
│   │   ├── Validace:
│   │   │   ├── ✅ Platná → zelená + zvuk + haptická zpětná vazba → vpustit
│   │   │   ├── ❌ Neplatná → červená + zvuk → odmítnout
│   │   │   ├── ⚠️ Již použitá → oranžová → odmítnout (duplikát)
│   │   │   ├── ⚠️ Špatný den (multi-day) → info „tato vstupenka platí na pátek"
│   │   │   ├── ⚠️ Špatný slot (timed entry) → info „váš slot je 14:00–15:00"
│   │   │   └── ⚠️ Transferovaná → ověření nového majitele
│   │   ├── Zobrazení info po skenu:
│   │   │   ├── Typ vstupenky
│   │   │   ├── Sedadlo (sektor, řada, místo)
│   │   │   ├── Jméno (pokud personalizovaná)
│   │   │   ├── Add-ony (meet&greet → backstage přístup)
│   │   │   └── VIP status
│   │   └── Edge cases:
│   │       ├── Nečitelný QR → ruční zadání kódu
│   │       ├── Offline skenování (stažené barcody) → sync po reconnectu
│   │       ├── Fanoušek nemá telefon → vyhledání v systému dle jména/emailu
│   │       ├── Dva lidé se stejným QR (screenshot) → dynamický barcode řeší
│   │       └── Vstupenka z jiné sítě (cross-platform) → speciální validace
├── V průběhu akce
│   ├── Re-entry (opustit a vrátit se)
│   │   ├── Exit scan → re-entry povoleno / zakázáno (dle nastavení)
│   │   └── Časový limit na re-entry (max 30 min)
│   ├── In-venue upgrade
│   │   ├── Nabídka lepšího sedadla (push notifikace / kiosk)
│   │   ├── Doplatek → nová vstupenka → přesun
│   │   └── Dostupnost v reálném čase
│   ├── Cashless platby (festival)
│   │   ├── Dobití RFID náramku
│   │   ├── F&B, merch nákupy
│   │   └── Vrácení zůstatku po festivalu
│   └── Emergency
│       ├── Evakuace → scan data = kdo je uvnitř
│       ├── Zdravotní pomoc → lokalizace dle sektoru
│       └── Počasí (outdoor) → hromadná notifikace

FÁZE 7: POST-EVENT
├── Pro kupujícího
│   ├── „Děkujeme" email / SMS
│   ├── Feedback formulář (hodnocení 1–5 + komentář)
│   ├── Fotky z akce (odkaz na galerii)
│   ├── Nabídka dalších akcí (personalizovaná)
│   ├── Loyalty body (pokud program aktivní)
│   └── Cashless zůstatek → refundace / převod
├── Pro pořadatele
│   ├── Event report (prodeje, skeny, revenue, konverze)
│   ├── Attendance report (kolik přišlo vs. kolik koupilo)
│   ├── CRM update (noví kontakty, segmentace)
│   ├── Settlement (výplata tržeb)
│   └── Feedback summary (hodnocení od návštěvníků)
├── Pro Super Admina
│   ├── Platform report (celkové tržby, provize, aktivita)
│   ├── Settlement execution
│   ├── Fraud review (podezřelé transakce)
│   └── Compliance check
```

---

# ČÁST C: KRITICKÉ TECHNICKÉ FLOW

## C1. Concurrency & Race Conditions

```
PROBLÉM: Dva kupující kliknou na stejné sedadlo ve stejnou sekundu

ŘEŠENÍ:
1. Optimistic locking
   → Při přidání do košíku: version check na sedadle
   → Pokud version mismatch → „sedadlo bylo právě obsazeno"
   → Kupující vidí aktualizovanou mapu

2. Temporary hold (soft lock)
   → Sedadlo se „zamkne" na 5–10 minut po přidání do košíku
   → Countdown timer viditelný kupujícímu
   → Po expiraci → automatický unlock → zpět do prodeje
   → Redis-based distributed lock (ne databázový lock)

3. Waiting Room (high-demand)
   → Aktivace 30 min před onsalem
   → Randomizovaný přístup (ne FIFO)
   → Throttling: max X uživatelů na booking page současně
   → Fronta vizualizována kupujícímu (pozice, odhadovaný čas)

4. Idempotence
   → Každý nákup má idempotency key
   → Dvojitý klik / refresh → ne-duplikuje platbu
   → Webhook od platební brány → idempotentní zpracování
```

## C2. Seat Map Rendering

```
PROBLÉM: Venue s 80 000 sedadly → performance

ŘEŠENÍ:
1. Hierarchický rendering
   → Level 1: Celý venue (sektory jako polygony, barva = cenová úroveň)
   → Level 2: Sektor (řady jako linie, sedadla jako body)
   → Level 3: Detail (jednotlivá sedadla, čísla, stav)
   → Lazy loading per zoom level

2. SVG + Canvas hybrid
   → Sektory: SVG (vektorové, škálovatelné)
   → Sedadla: Canvas (tisíce elementů, performantní)
   → Interakce: event delegation (ne listener per sedadlo)

3. WebSocket pro real-time updates
   → Sedadlo se prodá → broadcast všem aktivním sessions
   → Okamžité vizuální update (šednutí sedadla)
   → Debounce updates (batch per 500ms)

4. Caching
   → Venue template: CDN cached (statický layout)
   → Availability: Redis (real-time stav sedadel)
   → Event metadata: cache s TTL (5 min)
```

## C3. Digitální podpis vstupenek

```
FLOW:
1. Generování vstupenky
   → PDF template + data (jméno, akce, sedadlo, QR)
   → QR kód = šifrovaný payload (event_id, ticket_id, owner_hash, timestamp)
   → PDF digitálně podepsán (X.509 certifikát)
   → Hash vstupenky uložen v DB

2. Dynamický barcode (anti-screenshot)
   → QR kód se mění každých 30–60 sekund
   → Algoritmus: TOTP-like (time-based one-time QR)
   → Skenování: validace current_window ± 1 (tolerance 30s)
   → Pouze v mobilní app (PDF verze má statický QR s dig. podpisem)

3. Validace při skenu
   → Sken QR → dekódování → lookup v DB
   → Kontrola: platnost, stav (active/used/cancelled/transferred), čas, den
   → Offline: stažená DB subset do skeneru (sync per 5 min)
```

## C4. Settlement Engine

```
FLOW:
1. Trigger (dle nastavení frekvence)
2. Per pořadatel:
   a. SELECT všechny objednávky v settlement window
   b. Gross sales = SUM(ticket_price × quantity)
   c. Platform commission = Gross × commission_rate
   d. Service fees = dle absorpce (kdo platí)
   e. Refunds = SUM(refunded_amounts)
   f. Chargebacks = SUM(chargeback_amounts)
   g. Net payout = Gross - Commission - Refunds - Chargebacks
   h. Pokud Net < 0 → holdback (pořadatel dluží platformě)
   i. Generování settlement reportu (PDF)
   j. Bankovní převod (API platební brány / manuální)
   k. Email notifikace pořadateli
   l. Status: settled

3. Edge cases:
   ├── Refundace po settlement → stržení z příštího payoutu
   ├── Chargeback po settlement → stržení z příštího payoutu
   ├── Pořadatel změnil bankovní účet → manuální ověření
   ├── Zahraniční pořadatel → FX konverze k datu settlement
   └── Insolvence pořadatele → holdback všech tržeb → právní řešení
```

---

# ČÁST D: SHRNUTÍ — CO ŽÁDNÝ KONKURENT NEMÁ KOMPLETNÍ

| Feature | Kdo to má nejlépe | Co chybí u všech |
|---|---|---|
| Kolaborativní seat mapa | Ticketmaster | Nikdo v ČR |
| Tier systém pořadatelů | Žádný plně | Všude manuální |
| Cross-platform odbavení | SMSticket | Nikdo jiný v ČR |
| SMS vstupenky + SMS kampaně | SMSticket | Nikdo jiný v ČR |
| Digitální podpis PDF | SMSticket | Nikdo jiný v ČR |
| Dynamický barcode | Ticketmaster (SafeTix) | Nikdo v ČR |
| Fan-to-fan resale s novým QR | See Tickets, Colosseum | Omezené v ČR |
| CRM Fans + CRM Business | ENIGOO | Nikdo jiný v ČR (v jednom systému) |
| Waitlist → auto-notifikace | Eventbrite | Chybí u většiny CZ platforem |
| Payment plan (splátky) | See Tickets, Eventbrite | Chybí u CZ platforem |
| ARES auto-fill (IČO→firma) | SMSticket | Měl by mít každý CZ systém |
| Benefitní platby (Pluxee...) | Colosseum | Chybí u většiny |
| Timed entry + kapacitní management | Eventbrite, ROLLER | Slabé u CZ platforem |
| White-label + marketplace v jednom | Colosseum | Unikátní model |
| Marketplace Ads (CPC) | Ticketmaster, Eventbrite | Žádná CZ platforma |
| Kompletní add-on engine | Eventbrite | Slabé u většiny |
| Multi-day festival management | See Tickets (Glastonbury) | Omezené v ČR |
| Akreditační systém | ENIGOO | Chybí u marketplace platforem |
| Loyalty program | ENIGOO, ROLLER | Chybí u CZ platforem |
| AI generování popisů | Eventbrite | Nikdo v ČR |

---

*Dokument zpracován jako master-level systémová analýza pro návrh ticketingového systému nové generace. Květen 2026.*
