# Seating chart — praktický manuál pro master admina

Tenhle dokument popisuje **jak nastavit nový sál v Tixly tak, aby seating fungoval správně** —
bez překrývajících se sedadel, s realistickou geometrií a bez nutnosti opravovat to později.

## Než začneš: 4 železná pravidla

Tixly seating má 3 historické pasti — všechny vyřešené, ale dobré je znát co se nesmí dělat:

| Past | Proč | Pravidlo |
|---|---|---|
| **1-řadové „proužky"** jako sektory | Při scanu / hold po sektorech vznikne 200 namísto 40 logických zón, UI je nečitelný | **Sektor = blok aspoň 3 řady × 6 sedadel** |
| `cos(angle) / sin(angle)` per sedadlo | Vytvoří kruhový shluk, který se vizuálně překrývá | **Vycházej z reálného půdorysu sálu, ne z parametru** |
| Pódium / hřiště implicitně z `position: 'top'` | Renderer pak neví, jak velké je → sedadla se kreslí přes ně | **Stage / field má explicitní `{x, y, width, height}`** |
| Lóže jako řady jednoho sektoru | Hold flow nepustí 2 lidi do stejné lóže odděleně | **Každá lóže = samostatný sektor (LL01, LL02, …)** |

Vše čerpá z auditu `scripts/generate-rich-layouts.mjs` po fix Stadionu FC Praha.

---

## Co máš teď k dispozici — 5 nástrojů v Tixly UI

V master admin (`/platform/venues/{id}`) najdeš:

| # | Nástroj | Cesta | K čemu je |
|---|---|---|---|
| 1 | **Grid builder** | `/seating-chart` | Pravidelný sál (kino, divadlo s amfiteátrem) — vyplníš X sektorů × Y řad × Z sedadel |
| 2 | **Visual editor** | `/seating-chart/editor` | Drag-and-draw pro nepravidelné sály — opera, kabaret, stadion s elipsou |
| 3 | **Import CSV/SVG/JSON** | `/seating-chart/import` | Masivní import z externího formátu — třeba Inkscape SVG nebo CSV z konkurence |
| 4 | **Tools** | `/seating-chart/tools` | Po-import analýza: detekuje špatně číslované řady, sektory které jsou ve skutečnosti 3 oddělené, doporučí split/flatten |
| 5 | **Versions** | `/seating-chart/versions` | Historie verzí + restore — nikdy nemažeš, vždy verzuješ |

---

## Scénář A — „mám obrázek nebo odkaz z konkurence"

Toto je nejčastější případ. Postupuj:

### 1. Identifikuj zdroj

Ptej se: **kde má konkurence nakreslený seating ve své prodejní stránce?**

- **GoOut, ticketmaster, Eventim** — interaktivní SVG, můžeš si stáhnout DOM. Right-click → Inspect → vyber `<svg>` → Copy → Copy element. Ulož jako `foo.svg`.
- **PDF od pořadatele** — otevři v Inkscape → ulož jako SVG → otevři v textovém editoru → ověř, že tam jsou `<circle>` per sedadlo, ne jen rastr.
- **JPG screenshot bez vektorů** — toto je nejhorší případ, viz Scénář B (musíš to rekonstruovat ručně).

### 2. Pošli SVG do importu

`/platform/venues/{venueId}/seating-chart/import` → vyber `SVG` → paste obsah.

**Co Tixly potřebuje v SVG, aby to fungovalo dobře:**

```svg
<!-- Best: explicitní data-* atributy -->
<circle cx="100" cy="200" r="6" fill="#3b82f6"
        data-sector="Tribuna A"
        data-row="A"
        data-num="1" />

<!-- Acceptable: stejná barva = stejný sektor (Tixly odhadne) -->
<circle cx="100" cy="200" r="6" fill="#3b82f6" />
<circle cx="113" cy="200" r="6" fill="#3b82f6" />
<!-- Tixly nazve sektor "Sector-3b82f6" a řady auto-detekuje podle Y -->
```

### 3. Klikni „Dry-run"

Tixly NIC neuloží — jen ukáže preview:
- Počet sektorů, řad, sedadel
- Layout preview (viewBox + sektory s prvním/posledním číslem)
- **Warnings** — toto je klíčové! Tixly upozorní na overlaps, podivná čísla, anomálie

### 4. Pokud warnings, oprav

V dry-run vidíš jména sektorů odhadnutá z barvy. **Přejmenuj je smysluplně** (Tribuna sever A → SEVER-A). Klikni „Importovat".

### 5. Po importu spusť „Tools"

`/seating-chart/tools` automaticky detekuje:
- **alpha-rows** — řady číslované "1", "2", "3" místo "A", "B", "C" → renumber
- **splittable-sector** — to co vypadá jako 1 sektor je 3 oddělené kvůli mezerám → split spatial
- **column-sector** — sektor má 1 sedadlo na řadu (špatný proužek!) → flatten

Klikni „Apply" u každého doporučení a podívej se na preview.

### 6. Vizuální kontrola

**NIKDY nepublikuj bez vizuálního screenshotu.** Otevři `/seating-chart/editor`, podívej se na celkový SVG render:

- Překrývají se sedadla? → buď spatial split špatně, nebo origináli SVG měl bug
- Sedí pódium na správném místě?
- Působí proporce realisticky? (tribuny by měly být VĚTŠÍ než hřiště, ne stejně velké)

Pokud OK, klikni „Publish" → chart se uloží do `catalog.venue_seating_charts`. Promotér ho teď vidí v dropdownu při tvorbě eventu.

---

## Scénář B — „mám náčrt tužkou / JPG screenshot"

Pencil nebo rastrová bitmapa = **musíš to ručně rekonstruovat**. Nejde jen importovat.

### Postup pro pravidelný sál (kino, divadlo s amfiteátrem)

Použij **Grid builder** (`/seating-chart`):

1. Klikni „Nový sektor"
2. Vyplň `name` (Parter), `rows` (15), `seatsPerRow` (24)
3. `startX`, `startY` — kde má sektor začínat. Tip: nech 50, 50 a sleduj preview.
4. `spacingX` (22) — vzdálenost mezi sedadly horizontálně. **Nedělat menší než 18** (vizuálně srazí).
5. `spacingY` (22) — řady. Stejně, ne pod 18.
6. Klikni „Přidat sektor" pro každý další.
7. Vpravo vidíš preview, **dříve než publish prozkoumej**:
   - Žádné sektory se nepřekrývají
   - Sedadla v sektoru jsou pravidelná
   - Pódium (pokud máš) je na správném místě

### Postup pro nepravidelný sál (opera s lóžemi, kabaret se stoly)

Použij **Visual editor** (`/seating-chart/editor`):

1. Klikni „+ Sektor" → namaluj obdélník pro každou sekci (parter, balkon, lóže I-VI atd.)
2. V každém sektoru klikni „+ Sedadlo" a klikni do prostoru kam patří. Nebo „+ Řada" → tahej myší → vznikne řada N sedadel.
3. Lóže = samostatný sektor s 4-8 sedadly (LL01, LL02, …).
4. **Před publish** přepni do náhledu → ASCII vykreslení proporcí. Sedí to s tvým náčrtem?

---

## Scénář C — „nový stadion, žádný materiál" 🏟️

Klient ti řekne „postavili jsme arenu na 12 tisíc, udělejte nám seating". Co potřebuješ od něj:

### Vstupní brief (povinně, vyžádej e-mailem)

```
1. Půdorys haly / stadionu — PDF, CAD, alespoň rukou nakreslené proporce
2. Kolik tribun a jak se jmenují (Sever / Jih / V / Z)?
3. Kolik bloků na tribunu (typicky 4-10)?
4. Kolik řad v bloku? Kolik sedadel v řadě?
5. Jsou nějaké lóže / VIP boxy?
6. Je to fotbal/hokej/koncert/multi-use? (mění to layout pódium vs hřiště)
```

### Workflow

1. **Vytvoř test layout v `scripts/layouts/`**, ne hned v UI. Dej mu pevné rozměry sektorů (např. blok = 25 řad × 50 sedadel = 1 250 sedadel).
2. Spusť `node scripts/generate-rich-layouts.mjs` upravený pro tvůj stadion. Tento skript je referencí — má dobré helpery (`rowAlongAxis`, `buildRectSector`).
3. Otevři vygenerovaný JSON v textovém editoru → ověř `viewBox`, počet sektorů, total seats.
4. Naimportuj přes `/seating-chart/import` typ JSON.
5. **Spusť Tools** — detekuje issues.
6. Vizuálně zkontroluj v editoru.
7. Publikuj jako „Draft" verzi → ukaž klientovi screenshot → po jeho OK publish jako Active.

### Kdy NEPOUŽÍVAT formuli `cos(angle) × radius`

Pokud máš stadion s zaoblenými rohy nebo elipsovitým ovalem, **NEPOČÍTEJ sedadla z polárních souřadnic**. Místo toho:

- Nakresli 4 obdélníkové tribuny (Sever, Jih, V, Z)
- Pro rohy přidej 4 zvlášť pojmenované sektory (SV-roh, SZ-roh, JV-roh, JZ-roh) — každý s 5-10 řadami v obdélníkové formaci, jen s `startX`, `startY` posunutými do rohů
- **Nezkoušej generovat kruhový oval z trigonometrie** — vždy vyjde špatně, sedadla se překrývají

To je přesně chyba, kterou má Olomouc, viz Scénář D.

---

## Scénář D — „fix existujícího sálu (Olomouc) s překrývajícími se sedadly"

Olomoucký sál byl seedován starým generátorem se 200 proužkovými sektory. Postup k opravě:

### 1. Najdi venue ID

V Tixly URL: `/platform/venues/{venueId}/edit` — to UUID je zlatý klíč.

### 2. Stáhni aktuální layout

```bash
docker exec tixly-postgres psql -U tixly -d tixly -t \
  -c "SELECT layout FROM catalog.venue_seating_charts \
       WHERE venue_id = '{venueId}' AND active = TRUE" \
  > current-layout.json
```

### 3. Diagnostika — kolik sektorů má?

Otevři JSON v editoru. Vyhledej `"sectors":` → spočti pole. **Pokud má víc než 20 sektorů pro sál pod 5 000 sedadel, je to špatně.** Reálný stadion typu Letná má ~40 sektorů, ne 200. Reálné divadlo má ~5-8 sektorů.

### 4. Tools analýza v UI

`/platform/venues/{venueId}/seating-chart/tools` → spustí `analyzeForSuggestions(layout)`. Vrátí:

- **kind: 'column-sector'** — sektor má 1 sedadlo na řadu → tlačítko **„Flatten"** ho sloučí
- **kind: 'splittable-sector'** — sektor obsahuje 2+ oddělené clustery → tlačítko **„Split spatial"** ho rozdělí
- **kind: 'alpha-rows'** — řady jsou "1,2,3" místo "A,B,C" → **„Renumber"**

Klikej u každého — preview se rovnou aktualizuje.

### 5. Pokud analýza nepomůže, jdi do `generate-rich-layouts.mjs`

Otevři `scripts/generate-rich-layouts.mjs` — máš tam helpery `buildRectSector(name, originX, originY, rows, seatsPerRow, seatPitch, rowPitch, orientation)`. Napiš si vlastní funkci `buildOlomoucArena()` která:

1. Vychází z **reálného půdorysu** (najdi si foto Plečnikova / Andrův stadion v Google Maps Earth → ulož screenshot)
2. Definuje 4 tribuny jako rectangular sectors
3. Pro rohy přidá 4 menší samostatné sektory
4. **Žádné cos/sin per sedadlo**

Vygeneruj JSON, importuj do UI, znovu projdi Tools, vizuálně zkontroluj, publikuj.

### 6. Před publish: jak detekuješ překryv?

Tixly nemá auto-detekci kolizí (zatím). Manuální kontrola:

```sql
-- Zjisti, kolik sedadel sdílí stejné (x, y) ± 5px
SELECT s.layout
FROM catalog.venue_seating_charts s
WHERE venue_id = '{venueId}' AND active = TRUE;
```

Vezmi výsledný JSON, projeď ho skriptem (přidej do `scripts/check-overlaps.mjs`):

```javascript
const fs = require('fs');
const layout = JSON.parse(fs.readFileSync('layout.json', 'utf8'));
const positions = new Map();
let overlaps = 0;
for (const sector of layout.sectors) {
  for (const row of sector.rows) {
    for (const seat of row.seats) {
      const key = `${Math.round(seat.x/5)*5},${Math.round(seat.y/5)*5}`;
      if (positions.has(key)) {
        overlaps++;
        console.log(`OVERLAP: ${sector.name} ${row.label}${seat.num} ↔ ${positions.get(key)}`);
      }
      positions.set(key, `${sector.name} ${row.label}${seat.num}`);
    }
  }
}
console.log(`Total overlaps: ${overlaps}`);
```

`overlaps > 0` = nepublikovat, vrátit do editoru.

---

## Checklist před publish ✅

```
[ ] Sektor není proužek — minimum 3 řady × 6 sedadel
[ ] Žádný cos/sin per-sedadlo trick, vše obdélníkové
[ ] Stage / field má explicitní {x, y, w, h}, ne jen position
[ ] Lóže = samostatné sektory s krátkými jmény (LL01..LL12)
[ ] Tools nevrací žádné suggestions
[ ] check-overlaps.mjs reportuje 0 overlaps
[ ] Vizuální screenshot v editoru sedí s referencí
[ ] Tribuny jsou znatelně větší než pole / pódium
[ ] Žádný sektor nemá > 2000 sedadel (pokud ano, rozdělit na A/B)
[ ] Žádné UUID v názvech sektorů — jen lidská jména
```

---

## Časové odhady (z mé zkušenosti)

| Scénář | Čas |
|---|--:|
| Import SVG ze konkurence (s data-* atributy) | 15 min |
| Import SVG bez metadat → manuální přejmenování | 45 min |
| Grid builder pravidelný sál (1500 sedadel) | 20 min |
| Visual editor nepravidelný divadlo (300 sedadel) | 1-2 h |
| Nový stadion od nuly s briefem | 4-6 h |
| Fix existujícího chaotického layoutu | 1-3 h |

Pokud nemáš čas, **nepublikuj a požádej klienta o víc materiálů**. Špatný seating se v prodejní fázi projeví okamžitě a buyer si bude stěžovat.

---

## Eskalace

Pokud narazíš na něco, co manuál nepokrývá:

1. Zkus to v dev-loginu (`/cs/dev-login?as=platform`) na test venue
2. Pokud bug v UI/parseru → otevři ticket s screenshot + JSON sample
3. Pro velké stadiony zvaž najmutí designéra na seating chart (4-8h práce, externí cena ~5 000–15 000 Kč)
