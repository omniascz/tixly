# UX remediace admina — co je hotové a co zbývá

> Založeno **2026-08-13**. Zdroj: rešerše UI/UX ticketingových adminů + analýza
> informační architektury Tixly (171 stránek).
>
> **Pravidlo této série:** neodevzdávat nic, co nejde ověřit. Build a `tsc`
> nestačí — dotazy do databáze se spouštějí proti skutečnému Postgresu.
> Důvod je konkrétní: sloučený dotaz na historii objednávky prošel typovou
> kontrolou i buildem a proti DB spadl na dvou nekompatibilních typech.
> Bez spuštění by shodil každý detail objednávky.

Podkladové dokumenty (HTML, mimo repozitář, v `C:\Users\omnia\Documents\tixly\`):

| Dokument | Co obsahuje |
|---|---|
| `vyzkum-admin-ux.html` | Rešerše cizích adminů — co dělají dobře, kde selhávají, doporučená architektura |
| `plan-oprav-ux.html` | Plán oprav v šesti vlnách, 30 položek |
| `analyza-ia-vsech-funkci.html` | Soupis všech 171 obrazovek a zařazení všech 76 funkcí akce |

---

## ✅ Hotovo (2026-08-13)

### Vlna 0 — hotfixy
- **Stavy vstupenek česky** — `TicketStatusBadge` (šest stavů). Dřív se do
  `StatusBadge` posílaly stavy vstupenek, který zná jen stavy objednávek, takže
  se zobrazovalo anglické `valid` / `used`.
- **Číslo objednávky sjednocené a stabilní** — `formatOrderNumber()` v
  `lib/format.ts`. Dřív se generovalo jako `ORD-2026-<pořadí na stránce>`,
  měnilo se podle filtru i stránkování a detail ukazoval úplně jiný řetězec.
  Vyhledávání rozšířeno o `o.id`, aby kód z výpisu šlo dohledat.
- **Tabulky se neořezávají** — `DataTable` má `overflow-x-auto`.
- **Mrtvé položky z menu akce** — duplicitní „Náramky", „Lotterie (old)",
  a odkaz „Lístky", který vedl na 404 (adresář `tickets` obsahuje jen detail
  historie jednoho lístku, žádný výpis).
- **Refund sjednocený** — `components/admin/RefundForm.tsx`, jedny fieldy pro
  seznam i detail. Seznam dřív posílal důvod natvrdo, takže **v audit logu byl
  důvod, který nikdo nevybral**. `window.confirm` odstraněn.
- **Filtry objednávek v URL** — návrat z detailu zachová filtr i stránku,
  odfiltrovaný seznam se dá poslat odkazem.

### Vlna 1 — přehled akce
- **`events/[id]/page.tsx`** — obrazovka, která dosud neexistovala. Sell-through,
  tržba, průměr na vstupenku, dny do akce, kapacitní pruh, tabulka typů vstupenek.
  Data z `live-ops`, žádná nová logika.
- Sály doplněné do menu (`admin/venues/page.tsx`) — editor plánku byl hotový,
  ale bez znalosti URL nedosažitelný.

### Vlna 2 — dashboard
- **`/api/admin/stats/overview`** — agregace na serveru. Dřív se dnešní tržba,
  týdenní trend, 14denní graf, průměrná objednávka, počet zákazníků i podíl
  refundací počítaly v prohlížeči **ze 100 posledních objednávek**, takže při
  vyšším objemu byla všechna ta čísla nepravdivá.
- 11 KPI karet → 4. Emoji z nadpisů pryč.
- **Čistá tržba** místo hrubé, vzorec převzatý z modulu Výplaty.
- Role `staff` peněžní pole nedostane (server je neposílá).
- Měny se nesčítají — agreguje se jen ta nejpoužívanější, ostatní se hlásí.

### Vlna 3 — navigace
- **`lib/admin/nav.ts`** — jediný zdroj pravdy pro obě menu, rozcestník
  i budoucí hledání. Navigace byla rozsypaná ve dvou komponentách; **to byl
  důvod, proč 26 hotových stránek nebylo dosažitelných odnikud.**
- Menu akce: 74 odkazů v 9 dropdownech → **10 záložek**, jeden klik.
- Levé menu: 49 položek → **12 + rozcestník „Vše"** s vyhledáváním.
- Devět rozcestníkových stránek záložek + `components/admin/SectionHub.tsx`.

### Z vln 4 a 6 to, co šlo ověřit bez dat
- **Rozpad peněz v detailu objednávky** (4.3) — vstupenky, sleva, servisní
  poplatek, zaplaceno, provize partnera, hrubý výnos pořadatele.
- **Historie objednávky čitelně** (4.5 + část 4.4) — sloučená z
  `audit.audit_log` a `audit.support_actions`. **Druhý zdroj detail vůbec
  nečetl**, takže odeslané e-maily, převody, změny jména a storna vstupenek
  byly v historii neviditelné.
- **Autosave průvodce tvorbou akce** (6.5) — osm kroků přežije zavření okna,
  kroky jsou průchozí oběma směry.
- **Typová chyba** — `generateRfidDeviceKey` exportovaná z route souboru
  přesunuta do `lib/rfid/device-key.ts`. `tsc` je teď poprvé úplně čistý;
  build ji neodhalil, protože má vypnutou validaci typů.

---

## ⛔ Blokátor pro zbytek vlny 4

**Neexistuje databáze s daty.**

| Zdroj | `DATABASE_URL` | Stav |
|---|---|---|
| `.env.local` | `localhost:5433` | kontejner běží, ale schéma je **starší než kód** (chybí migrace 374 a 431) a je **prázdné** |
| `.env.prod` | prázdný | — |
| Vercel produkce | prázdný | z 36 proměnných je 14 vyplněných, žádná není databáze |

Důsledek: nasazená aplikace nemá připojenou databázi. Nejsou tedy ani data
o používání, podle kterých by šlo rozhodnout, které z duplicitních funkcí
jsou živé, ani prostředí, kde ověřit zápisové operace.

### Jak blokátor odstranit

1. Doběhnout migrace na lokální DB (`migrations/`, 24 souborů, runner
   `scripts/run-migrations.sh`) — tím se doplní `orders.lottery_campaigns`
   a `platform.gift_cards`.
2. Naplnit `seed.sql` (40 kB) nebo `scripts/seed-divadlo-celetna.mjs`.
3. Ověřovat proti tomu e2e skripty, které už v repozitáři jsou —
   `scripts/e2e-lifecycle.mjs`, `e2e-destructive.mjs`, `e2e-full-suite.mjs`.

Dokud tohle není, **nepouštět se do 4.1 a 4.2**.

---

## 📋 Zbývá

### Vlna 4 — objednávka a peníze

| # | Co | Předpoklad | Jak ověřit | Odhad |
|---|---|---|---|---|
| 4.1 | **Výměna vstupenky adminem** — jiný typ nebo termín, doúčtování rozdílu, vše v jedné objednávce | DB s daty | e2e: výměna nesmí projít jako storno + nový nákup; historie zůstane pohromadě; `remaining_qty` sedí u obou typů | 2–3 dny |
| 4.2 | **Částečný refund** — vybrané vstupenky nebo vlastní částka | DB s daty | e2e: kapacita se vrátí **jen** za skutečně zneplatněné lístky; součet částečných refundů nepřekročí objednávku | 1–2 dny |
| 4.4 | **Log odeslaných e-mailů** — dokončit | **nová tabulka** (dnes není `email_log` ani ekvivalent; `notifications.*` je něco jiného) | zobrazit stav doručení, pokud ho brána vrací | 1 den + migrace |

> 4.1 stojí na hotovém motoru: `api/admin/ticket-changes/[changeId]` už při
> schválení mění `ticket_type_id` i sedadlo, upravuje `remaining_qty` a řeší
> cenový rozdíl. Chybí varianta, kterou zakládá admin, ne zákazník.

### Vlna 5 — provoz a mobil

| # | Co | Předpoklad | Jak ověřit | Odhad |
|---|---|---|---|---|
| 5.1 | **Offline režim do nativní appky** — logiku převzít z `lib/scanner/offline-queue`, ne psát znovu | zařízení / emulátor | režim letadlo: odbaví vstupenku, označí duplicitu, po připojení srovná frontu | 2–3 dny |
| 5.2 | **Odezva skeneru přes celou obrazovku** — dnes karta s 16px textem | — | čitelné ve tmě na délku paže | 1 den |
| 5.3 | **Mobilní navigace admina** — `admin/layout.tsx` má pevný `w-60 h-screen` bez jediného responzivního pravidla | — | pod 1024 px: přehled, objednávky, skener a pokladna použitelné | 1–2 dny |
| 5.4 | **Pokladna: údaje kupujícího na hlavní ploše** | — | prodej na tři kliky, pole nejsou za rozbalením | 1 den |

### Vlna 6 — systémová hygiena (průběžně, nikdy jako blok)

| # | Co | Poznámka |
|---|---|---|
| 6.1 | **Rozhodnout o tmavém režimu** | `ThemeProvider` má `defaultTheme="light"`, `enableSystem={false}`, `setTheme` nikdo nevolá → režim je fakticky vypnutý. V adminu je **2 373 natvrdo zapsaných barevných tříd**, které by ho rozbily. Buď zrušit a odstranit mrtvý kód, nebo naplánovat převod na tokeny. **Nedělat půlku.** |
| 6.2 | **Jedna tabulka místo 68** | `DataTable` je v 6 stránkách, **68 stránek má vlastní `<table>`**. Doplnit řazení, volbu sloupců, sticky hlavičku a migrovat vždy tu stránku, které se stejně dotýkáš. |
| 6.3 | **Uložené pohledy** | Staví na hotových filtrech v URL. |
| 6.4 | **Pryč s nativními dialogy** | Zbývá ~20 `alert()` / `window.confirm` mimo objednávky. |
| 6.6 | **Prázdné stavy** | `EmptyState` používají 2 stránky ze 171. |
| 6.7 | **Role jemněji** | Dnes fakticky dvě úrovně. Doplnit Pokladní, Marketing, Účetní s vlastní výchozí obrazovkou. Mění autorizační sémantiku — samostatně a s testy. |
| 6.8 | **Přístupnost admina** | `A11Y_AUDIT.md` pokrývá jen nákupní stranu a sám přiznává odebraný `outline` a kontrast pod 4,5 : 1. Admin nebyl auditovaný vůbec. |

---

## ❓ Čeká na rozhodnutí (ne na kód)

| Věc | Zjištěno | Co je potřeba |
|---|---|---|
| `staff` vs. `team` | **Stejné tabulky**, `staff` je nadmnožina (umí odebrat člena, novější). V nové navigaci je `staff` jako „Tým". | Zrušit `/admin/team`, nebo přesměrovat. |
| `lottery` vs. `lotteries` | Různé tabulky. Nová je napojená na checkout a má zákaznické stránky; **stará nemá v aplikaci žádný vstupní bod** kromě admin odkazu „(old)". | Rozhodnout o smazání staré route. Tabulky zatím nemazat — `api/buyer/gdpr/export` na `catalog.event_lotteries` sahá. |
| `vouchers` vs. `gift-cards` | **Nejsou duplicita.** Poukaz je pořadatelský a lze ho vázat na akci; gift karta je platformová předplacená. Obojí visí na checkoutu. | Ponechat obojí, názvy už rozlišené („Dárkové poukazy" vs. „Tixly gift karty"). |
| `live` vs. `dashboard/live` | Stejný SSE endpoint. `/admin/live` je novější a navíc posílá token v query (EventSource neumí hlavičku) — vypadá jako oprava starší verze. Menu teď míří na tu novější. | Zrušit starší. |
| Modulární zapínání funkcí | V `nav.ts` připravené (`tier`, `templates`, `isFeatureEnabled`), ale **neběží** — API akce nevrací šablonu a není kam ukládat ručně zapnuté moduly. | Doplnit šablonu do odpovědi API + sloupec pro zapnuté moduly. Je to jedno místo v kódu. |
| Slučování 76 podstránek akce | Navigace je zatím jen **přeskládala**. Skutečné sloučení (deset cenových stránek na jednu) stojí víc. | Nejdřív měřit návštěvnost stránek admina, rozhodnout za dva měsíce. |

---

## Doporučené pořadí

1. **Odstranit blokátor** — migrace + seed na lokální DB. Odemkne 4.1 a 4.2 a zároveň umožní projít nové obrazovky naživo (zatím ověřené jen buildem, `tsc`, lintem a spuštěním SQL — **ne proklikáním v prohlížeči**).
2. **4.1 + 4.2** — nejčastější operace telefonické podpory.
3. **5.3 + 5.2** — před sezónou, ať večer akce projde bez notebooku.
4. **5.1** — offline do appky.
5. **6.x** průběžně, vždy u stránky, které se stejně dotýkáš.
6. **6.1** kdykoli — ale je to rozhodnutí, ne úkol.
