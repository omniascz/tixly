# Návod: Založení sálu Městské divadlo Bílina v Tixly

**Sál:** Městské divadlo Bílina  
**Kapacita:** 372 míst (228 přízemí + 144 balkón)  
**Typ:** Klasické divadlo s balkónem  
**Pódium:** Dole

---

## TL;DR — Nejrychlejší cesta (5 minut)

1. **Platform admin** → `/platform/venues/new` → vytvoř venue „Městské divadlo Bílina"
2. **Otevři detail** → `/platform/venues/[id]/edit`
3. **Klik „Import seating chart"** → vyber soubor `docs/bilina-seating.csv` (372 řádků, hotový)
4. **Dry-run preview** → ověř že vidíš 2 sektory (Balkón 144 + Přízemí 228)
5. **„Potvrdit import"** → chart se uloží jako verze 1
6. **Hotovo** — promotér v `/admin/venues` uvidí Bílina, může na ní zakládat akce

Pokud chceš celé vidět nebo upravit, čti dál.

---

## ČÁST 1 — Co jsem ve sále našel (z PDF)

Bílina divadlo má dva sektory:

### Balkón — 144 míst, 8 řad
- **Řady 8-5 (zadní 4 řady):** 16 sedadel, rozdělené prostředním vchodem  
  - Vlevo: 16, 15, 14, 13, 12, 11, 10, 9 (8 čísel)
  - Vpravo: 8, 7, 6, 5, 4, 3, 2, 1 (8 čísel)
- **Řady 4-1 (přední 4 řady):** 20 sedadel, bez mezery
  - Vlevo: 20, 19, 18, 17, 16, 15, 14, 13, 12, 11 (10 čísel)
  - Vpravo: 10, 9, 8, 7, 6, 5, 4, 3, 2, 1 (10 čísel)

### Přízemí — 228 míst, 13 řad (horseshoe shape)
| Řada | Počet sedadel |
|---:|---:|
| 13 (vzadu) | 15 |
| 12 | 16 |
| 11 | 15 |
| 10 | 16 |
| 9 | 19 |
| 8 | 19 |
| 7 | 19 |
| 6 | 19 |
| 5 | 19 |
| 4 | 19 |
| 3 | 19 |
| 2 | 17 |
| 1 (vpředu, u pódia) | 16 |

Číslování v každé řadě je 1 (vpravo) → n (vlevo) — standardní divadelní logika kde se počítá od pravé strany hlediště pohledem ze sedadla.

**Poznámka z PDF:** „Při projekci Digitálního kina je balkón z technických důvodů uzavřen." → V Tixly to vyřešíš jednoduše: pro filmové promítání vytvoříš akci s ticket type co má v access matrix přístup jen na „Přízemí" sektor. Balkón sedadla zůstanou v chart, ale nebudou prodejná.

---

## ČÁST 2 — Tři způsoby jak založit chart

### Způsob A — CSV Import (DOPORUČENO, 5 minut)

**Pro koho:** Když máš pravidelný layout (řady, sedadla). Ideální pro divadla, kina, koncertní sály.

**Postup:**

1. **Přihlas se jako platform admin** (master admin Tixly, ne promotér)
   - `https://tixly.cz/cs/login` → účet s `isPlatformAdmin = true`

2. **Vytvoř venue**
   - Jdi na `/platform/venues` → klikni „Nový sál"
   - Vyplň:
     - Název: `Městské divadlo Bílina`
     - Slug: `mestske-divadlo-bilina` (auto-generuje se z názvu)
     - Město: `Bílina`
     - Adresa: `Mírové náměstí 87, 418 01 Bílina`
     - Kapacita: `372`
     - Typ: `theatre`
   - Klikni „Uložit"

3. **Otevři chart import**
   - V detailu sálu → záložka „Seating chart"
   - Klikni „Import z CSV/JSON/SVG"
   - Cesta: `/platform/venues/[id]/seating-chart/import`

4. **Nahraj CSV**
   - Format: `csv` (vyber z dropdownu, nebo nech `auto`)
   - Klikni „Vybrat soubor" → vyber `docs/bilina-seating.csv` z repa
   - Nebo si stáhni z `https://github.com/tixly/tixly/blob/master/docs/bilina-seating.csv`
   - Klikni „Dry-run preview"

5. **Zkontroluj dry-run**
   - Měl bys vidět:
     - **2 sektory:** Balkón (144 sedadel, 8 řad), Přízemí (228 sedadel, 13 řad)
     - **Žádné warnings** (jinak je něco špatně v CSV)
     - **Layout preview** — schematický náhled rozložení

6. **Potvrdit import**
   - Klikni „Save chart"
   - Chart se uloží jako verze 1 v `catalog.seating_charts`
   - Promotér to teď uvidí v `/admin/venues` a může na sále zakládat akce

7. **Doladění — pódium**
   - V detailu sálu → záložka „Edit chart" (Visual editor)
   - Klikni „Add Stage" → vyber pozici „bottom" → label „Pódium"
   - Save

**Hotovo.** Sál je v systému.

---

### Způsob B — Visual Editor (drag-and-draw, 30-60 minut)

**Pro koho:** Když je layout nepravidelný (stadion s elipsou, opera s lóžemi) a nemůžeš dát pravidelný CSV. Pro Bílinu to ale není potřeba — CSV stačí.

**Postup pro Bílinu (pokud chceš editor vyzkoušet):**

1. **Vytvoř venue** (stejně jako v způsobu A, kroky 1-2)

2. **Otevři Visual Editor**
   - `/platform/venues/[id]/seating-chart/editor`

3. **Nástroje (klávesové zkratky):**
   - `1` — Select (klik na sedadlo = označení, Delete = smaž)
   - `2` — Straight row (přímá řada — 2 kliky = začátek + konec, prompt na počet sedadel)
   - `3` — Arc row (obloukovitá řada — 3 kliky = začátek + vrchol + konec, prompt na počet)
   - `4` — Pan (posun canvasu)
   - `Ctrl+Z` undo, `Ctrl+Y` redo

4. **Postup pro Bílina balkón:**

   a) Vytvoř nový sektor:
      - Klikni „Add sector" → název `Balkón`, barva např. modrá `#3b82f6`

   b) Pro každou řadu 5-8 (16 sedadel s mezerou) udělej **dvě straight rows**:
      - Levou půlku: klik na (320, 80) → klik na (550, 80) → prompt „kolik sedadel?" → zadej `8`
      - Pravou půlku: klik na (650, 80) → klik na (880, 80) → prompt → `8`
      - Číslování: editor automaticky čísluje 1-8. **Musíš ručně přečíslovat** klikem na sedadlo a zadáním nového čísla. Pro levou stranu řady 8 zadej 16, 15, 14, 13, 12, 11, 10, 9.

   c) Pro řady 1-4 (20 sedadel bez mezery): jedna straight row klik (300, 200) → (940, 200) → `20` → přečísluj.

   ⚠ Tohle je 8 řad × 2-3 minuty = **~25 minut jen pro balkón**. Pro Bíliny CSV je rychlejší.

5. **Postup pro Bílina přízemí (horseshoe):**

   Pro horseshoe shape (přední řady kratší) máš dvě možnosti:

   - **A. Straight rows s různým počtem sedadel** — 13 straight rows, každá s počtem podle tabulky výše. Manuálně přečíslovat.
   - **B. Arc rows** — pokud chceš zaobliny. Klik na začátek řady, klik na vrchol oblouku, klik na konec → editor rovnoměrně rozloží sedadla po křivce.

   Pro Bílinu (rovné řady s přední užší) doporučuji A.

6. **Stage**
   - Klik „Add Stage" → pozice „bottom" → label „Pódium Městské divadlo"

7. **Save**
   - Klikni „Save" → název chartu např. `Bílina default 2026`

---

### Způsob C — JSON Import (programaticky, 1 minuta)

**Pro koho:** Když máš data v jiném systému a chceš API integraci.

**Postup:**

1. Vytvoř JSON podle template:
   ```json
   {
     "viewBox": "0 0 1200 900",
     "sectors": [
       {
         "name": "Balkón",
         "color": "#3b82f6",
         "rows": [
           { "label": "8", "seats": [
             { "num": "16", "x": 319, "y": 80 },
             { "num": "15", "x": 351, "y": 80 }
           ]}
         ]
       }
     ]
   }
   ```

2. Upload v `/platform/venues/[id]/seating-chart/import` → format `json`

3. Dry-run → Save

---

## ČÁST 3 — Po vytvoření sálu

### Promotér si chart aplikuje na svou akci

1. Promotér jde do `/admin/events/new` → wizard
2. **Krok 2 (Místo a čas):** vybere ze seznamu venues → najde „Městské divadlo Bílina"
3. **Krok 3 (Vstupenky):** pro každý ticket type vybere sektor (Balkón nebo Přízemí) nebo „Všude"
4. Po publish: Tixly automaticky **zkopíruje chart do `event_seats` tabulky** pro tuto akci (přes `copyLayoutToEventSeats` helper)
5. Buyer v `/cs/events/[id]/seats` vidí interactive seat picker s reálným layoutem

### Cenové sektory

V detailu akce → `/admin/events/[id]/edit` → ticket types:
- **Ticket type „Balkón"** — `kind: standing`, `base_price: 25000` (250 Kč), sector restrict: Balkón
- **Ticket type „Přízemí standard"** — `base_price: 35000` (350 Kč), sector restrict: Přízemí
- **Ticket type „Přízemí VIP první 3 řady"** — `base_price: 50000` (500 Kč), sector restrict: Přízemí + manuálně vybrat sedadla v `/admin/events/[id]/holds`

### Bezbariérová sedadla

V CSV jsou některá sedadla označená sloupcem `accessibility: true` (nyní 0 pro Bílinu — divadlo nemá specifikováno z PDF). Pokud má Bílina vyhrazené bezbariérové sedadlo (typicky řada 1 sedadlo 1 nebo specifická pozice), edituj CSV před importem nebo přes Visual editor:
- Klik na sedadlo v editoru → checkbox „Bezbariérové"

V buyer flow se ta sedadla zobrazí se symbolem ♿ a nelze je koupit přes obecný ticket — jen přes speciální „Bezbariérová vstupenka" ticket type.

### Blocked seats (technické rezervace)

Pro každou akci může promotér v `/admin/events/[id]/holds` ručně zablokovat sedadla pro:
- **Technika / mixing pult** — typicky řada 9-10 prostředek
- **VIP / press accreditation** — řada 1 a 2
- **Comp tickets** pro pořadatele

Tyto sedadla jsou v chart vidět, ale buyer je nemůže koupit (status `held`).

### Verze chartu

Tixly drží **historii všech změn chartu**:
- `/platform/venues/[id]/seating-chart/versions` — seznam verzí
- Diff mezi verzemi (přidaná/odebraná sedadla)
- Restore staré verze (např. pokud někdo omylem smazal řadu)
- ⚠ Pozor: změna chartu **neovlivní již vytvořené akce** (mají vlastní snapshot v `event_seats`). Změna se projeví jen u nově vytvořených akcí.

---

## ČÁST 4 — Časté problémy

### „CSV import vyhodí Warning: Sector X has overlapping seats"
- Dva sedadla mají stejné `(x, y)` souřadnice
- Editor automaticky doporučí spacing — nech 30 unit horizontálně a 25-30 vertikálně mezi sedadly

### „Sedadla se na buyer side nezobrazují"
- Pravděpodobně chybí volání `copyLayoutToEventSeats` při create akce. Tixly to dělá automaticky, ale pokud bylo akce vytvořené před přidáním chartu, je třeba akci znovu uložit (PATCH na `/api/admin/events/[id]`).

### „Můžu změnit číslování sedadel po importu?"
- Ano, ale **jen v editoru per-seat**. CSV import respektuje to co je v souboru.

### „Layout vypadá vzhůru nohama"
- Ve Visual editoru je horní okraj y=0, dolní okraj větší y (standard SVG). Pódium typicky dole (y=850).
- V PDF Bíliny je pódium taky dole, takže layout v CSV odpovídá real life pohledu „shora dolů na sál".

### „Chci v balkónu rozdělit levou a pravou stranu jako separate sektory pro různé ceny"
- Místo 1 sektoru `Balkón` (jak je v CSV) udělej 2 sektory: `Balkón levý` a `Balkón pravý`. Edituj CSV: změň sloupec `sector` pro sedadla 16-9 (vlevo) na `Balkón levý` a 8-1 (vpravo) na `Balkón pravý`. Re-import.

### „Promotér chce sám zakládat sály bez platform admin"
- Aktuálně sály jsou **platform-admin only** (master katalog). Promotér nemůže sám přidat nový sál — musí požádat platform admina (email, ticket).
- Důvod: kvalita master katalogu (žádné duplicit „Sál v Bílině" vs „Bílina divadlo"). Plus chart authoring vyžaduje pečlivost.
- **Workaround:** promotér si v `/admin/venues` může přiřadit existing master venue, ale pokud chybí, musí ho admin přidat.

---

## ČÁST 5 — Pro vývojáře

### Struktura dat v DB

```sql
catalog.venues (id, name, slug, city, address, capacity, type)
catalog.seating_charts (id, venue_id, name, version, layout jsonb, active, created_at)
catalog.event_seats (event_id, seat_id, sector, row, num, status, x, y, held_by, ...)
```

`seating_charts.layout` = JSON struktura:
```json
{
  "viewBox": "0 0 1200 900",
  "sectors": [
    {
      "name": "Přízemí",
      "color": "#3b82f6",
      "rows": [
        { "label": "1", "seats": [{ "num": "16", "x": 360, "y": 860 }, ...] }
      ]
    }
  ],
  "stage": { "position": "bottom", "label": "Pódium" }
}
```

### copyLayoutToEventSeats

Po vytvoření akce (v `POST /api/admin/events`) volá `lib/seats/copy-layout-to-event-seats.ts`:
1. Načte active chart pro venue
2. Pro každé sedadlo v layout vytvoří row v `event_seats` s `status='available'`
3. Promotér pak může ručně označit sedadla jako `held`

### CSV template (raw text)

```
sector,row,num,x,y,accessibility
"Balkón","8","16",319,80,
"Balkón","8","15",351,80,
...
```

Sloupce:
- `sector` (text, max 80) — název sektoru
- `row` (text, max 20) — label řady (typicky číslo 1-99 nebo písmeno A-Z)
- `num` (text, max 20) — číslo sedadla
- `x` (integer) — X souřadnice v viewBox (0-1200 default)
- `y` (integer) — Y souřadnice
- `accessibility` (boolean, prázdné nebo „true") — bezbariérové sedadlo

### Generování CSV pro nový sál

Pokud chceš automatizovaně generovat CSV pro jiný sál (jako jsme udělali pro Bílinu), použij `scripts/generate-bilina-csv.mjs` jako šablonu. Jen uprav počet řad a sedadel.

---

## Hotový soubor pro Bílinu

`docs/bilina-seating.csv` — připraven k importu, 372 řádků, validovaný.

Pokud chceš sál jen na vyzkoušení, postup je: vytvoř venue → import → publikuj testovací akci → otevři buyer seat picker → zkontroluj layout. Celé to zabere asi **10 minut**.
