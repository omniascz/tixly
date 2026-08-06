
---

## §96 🔴 Tabulky zcela mimo RLS: není jich 5, je jich 189 — z toho 24 nese tenant data

Předchozí kola tvrdila, že mimo model izolace stojí `marketing.editorial_articles`
a `platform.b2b_accounts`. To bylo podhodnocené o dva řády. Katalogový sken na
čerstvém klonu baseline + migrací 450–458 pod `tixly_app`:

```
tabulek celkem:                              600
s RLS zapnutou a >=1 policy:                 411
MIMO IZOLACI (RLS vypnuta nebo 0 policies):  189
  z toho s tenant sloupcem:                   24
```

189 souhlasí s dřívějším „411 z 599" ze §34 — to číslo tam bylo celou dobu,
jen se nikdy neodečetlo. Zbytek (165) jsou číselníky, logy a pomocné tabulky
bez vazby na tenanta; ty mimo izolaci stát můžou.

### a) Kterých 24 nese tenant sloupec

Kritérium: existuje sloupec `promoter_id`, `user_id`, `owner_id`,
`organizer_user_id`, `tenant_id`, `buyer_id` nebo `seller_id`.

| schéma | tabulky |
|---|---|
| `orders` | `guestlist_entries`, `press_accreditations`, `phone_orders`, `school_bookings`, `lottery_campaigns` |
| `platform` | `promoter_contacts`, `b2b_transactions`, `promoter_onboarding`, `promoter_contacts`, `agent_mandates`, `import_jobs` |
| `catalog` | `productions`, `films`, `sport_teams`, `season_pass_products`, `event_reschedules` |
| `identity` | `fan_profiles`, `eudi_verifications` |
| `communications` | `broadcasts`, `emergency_announcements` |
| `marketing` | `fan_bonus_issued` |
| ostatní | `analytics.yield_rules`, `pricing.dynamic_pricing_rules`, `brands.event_partnerships`, `notifications.push_sent_log` |

Není to okrajová sada. `orders.guestlist_entries` a `orders.press_accreditations`
drží jména a e-maily hostů; `platform.promoter_contacts` je CRM databáze
zákazníků promotéra; `platform.b2b_transactions` finanční pohyby;
`identity.fan_profiles` a `eudi_verifications` identitní data.

### b) Změřený únik, ne odvozený

Dva promotéři A a B, každý jeden řádek. Session pod `tixly_app`
(BYPASSRLS=false) s `app.current_promoter_id = A`:

```
 catalog.productions            vlastni=1  CIZI=1  🔴 UNIK
```

Cizí řádek je čitelný. Na tabulce bez RLS databáze nedělá **nic** — GUC je
nastavené a nemá co ovlivnit.

(`platform.promoter_contacts` se v tomhle běhu nenaseedovala — `name` je NOT NULL.
Mechanismus je ale týž: 0 policies = 0 filtrace. Netvrdím to jako změřené.)

### c) Sahá na ně aplikace? Na všech 24.

Grep přes `src/**/*.ts`: **každá z těch 24 tabulek má aspoň jednoho konzumenta**
(1–12 souborů). Nejsou to mrtvé tabulky, které by se daly odepsat.

Co drží izolaci dneska: **WHERE v aplikaci.** Kontrola šesti reprezentantů —
`promoter_contacts`, `productions`, `guestlist_entries`, `broadcasts`,
`press_accreditations` — všechny čtoucí routy `promoter_id` v dotazu mají.
Jediná skupina bez něj je B2B (`admin/b2b/*`, `b2b/account`), a ta je záměrně
platformová: `requirePlatformAdmin`, scope přes `account_id`.

### d) VERDIKT

**189 tabulek stojí mimo izolaci, 24 z nich nese tenant data, a ano — je to díra.**

Ale je potřeba být přesný v tom, jaká: na měřených cestách **nic neteče**,
protože každá routa si `WHERE promoter_id = …` napsala sama. Díra je v tom,
že u těch 24 tabulek je ten `WHERE` **jediná** vrstva. Zapomenutý filtr
v jedné budoucí routě = tichý cross-tenant únik, který databáze nezachytí.
U zbylých 411 tabulek by ho zachytila.

Je to tedy díra v obraně do hloubky, ne otevřený únik. Přesně ta třída, kterou
RLS existuje odstranit — dnes se na těchhle 24 tabulkách spoléhá na to, že si
programátor vzpomene.

⚠️ **NEOPRAVENO** podle zadání. Oprava není mechanická: 24 tabulek × správný
tvar policy (`app_is_platform_admin() OR app_is_service() OR promoter_id =
app_current_promoter_id()`) plus u každé rozhodnutí, jestli k ní mají mít
přístup i kupující (`fan_profiles`, `eudi_verifications` skoro jistě ano).

## §97 ⚪ `events/travel-packages` neověřuje, že akce je publikovaná

Doplněk k §94. Routa filtruje `p.active AND h.active AND r.active` + kapacitu,
takže neaktivní balíčky nepropouští — to bylo ověřeno. **Neověřuje ale stav
akce.** `event_id` bere z URL a na `catalog.events` se neptá.

Důsledek: kdo uhodne (nebo získá) UUID rozpracované akce, dostane její
cestovní balíčky — ceny, hotely, kapacity — dřív, než je akce zveřejněná.
Není to únik osobních dat, je to únik obchodního záměru před oznámením.

Zvlášť po opravě z §94 routa běží v **servisním kontextu**, takže RLS ji už
nepodrží — před opravou by ji filtr na `events` odstřihl náhodou, teď ne.
Servisní kontext přenáší odpovědnost za filtraci na routu, a tenhle filtr tam
chybí.

Oprava je jeden JOIN (`JOIN catalog.events e ON e.id = $1 AND e.status = 'published'`).
**NEOPRAVENO** — mimo zadání tohoto kola.

## §98 ⚪ Dvě reverted routy obalené (ne opravené)

`my/tickets/[ticketId]/transfer` (GET/POST/DELETE) a
`tickets/transfer/[token]` (GET/POST) šly minule zpět, protože mechanická
transformace u souborů s víc exportovanými handlery rozbila syntax (TS1005).
Ručně, každý handler zvlášť:

- `my/tickets/[ticketId]/transfer` — všechny tři handlery čtou `x-user-id`,
  proto `runWithUserContext(uid, …)`. `userId` se čte až uvnitř handleru, takže
  wrapper `withUser` čte hlavičku sám a 401 vrací před vstupem do kontextu.
- `tickets/transfer/[token]` — **GET je veřejný** (příjemce převodu ještě není
  přihlášený) → `runWithServiceContext`, ne `USING (true)`; routa se filtruje
  tokenem. POST → kontext přihlášeného uživatele.

`npx tsc --noEmit` → exit 0.

⚠️ Slovo je **obaleno, ne opraveno**: kontext je podle vlastnictví dat správný,
ale pozitivní cesta těchhle rout **není předvedena**. Přibývají k sedmi
z §95 — devět obalených bez důkazu funkčnosti.

---

## §99 ✅ R-13 opraveno: `events/travel-packages` vydávalo balíčky nezveřejněných akcí

Doplněn `JOIN catalog.events e ON e.id = p.event_id AND e.status = 'published'` —
týž tvar, jaký mají sousední routy `events/[id]/accreditation` a
`events/[id]/calendar`.

**RED→GREEN pod `tixly_app`, obě akce naseedované se stejným aktivním balíčkem**
(kapacita 10, `active` všude true — aby rozhodoval výhradně stav akce):

```
[R-13 RED]         draft, puvodni dotaz bez JOINu : 1 radek   ← unik
[R-13 GREEN draft] { status: 200, count: 0 }
[R-13 GREEN pub]   { status: 200, count: 1 }
Tests  7 passed (7)
```

RED není rekonstrukce z paměti — je to doslovná kopie původního `WHERE`
pouštěná proti témuž klonu. Ukazuje, že žádný z ostatních filtrů (`p.active`,
`h.active`, `r.active`, kapacita) únik nechytal.

🔧 **Oprava mého tvrzení z §97.** Napsal jsem tam, že routa „po §94 běží
v servisním kontextu". **Neběží** — §94 tyhle tři routy záměrně neobalil,
protože se filtrují samy. Routa jede na obyčejném `db().connect()` a projde
proto, že tabulky `catalog.travel_*` mají policy `USING (true)`.

Na závěru to nic nemění — spíš ho zpřísňuje. Kdyby routa v servisním kontextu
byla, RLS by ji nepodržela kvůli kontextu; takhle ji nepodrží kvůli tomu, že
policies jsou otevřené. V obou případech byl ten `JOIN` jediná možná obrana,
a chyběl.

---

## §100 R-12: rozpad 24 tabulek — 20 mechanických, 2 složité, 2 nejasné

Sloupce vytažené z katalogu baseline, ne z paměti.

### MECHANICKÉ — 20 tabulek, přímý sloupec, NOT NULL

**Promotérské (16), přímý `promoter_id NOT NULL`:**
`analytics.yield_rules`, `brands.event_partnerships`, `catalog.event_reschedules`,
`catalog.productions`, `catalog.season_pass_products`, `communications.broadcasts`,
`communications.emergency_announcements`, `orders.guestlist_entries`,
`orders.lottery_campaigns`, `orders.phone_orders`, `orders.press_accreditations`,
`orders.school_bookings`, `platform.import_jobs`, `platform.promoter_contacts`,
`platform.promoter_onboarding`, `pricing.dynamic_pricing_rules`

**Uživatelské (3), přímý `user_id NOT NULL`:**
`identity.fan_profiles`, `notifications.push_sent_log`, `platform.agent_mandates`

Několik z nich má i `event_id`, ale ten je **redundantní** — `promoter_id` je
na řádku přímo, takže se přes akci JOINovat nemusí. To je klíčové: **žádná
z těch 20 nepotřebuje korelovaný poddotaz**, takže se §53 (vnořené RLS, drahá
korelace na neunikátní sloupec) **netýká vůbec**.

Jeden příklad za všech 16 — zbytek je záměna jména tabulky:

```sql
ALTER TABLE catalog.productions ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_productions_scope ON catalog.productions
  FOR ALL
  USING      (public.app_is_platform_admin() OR public.app_is_service()
              OR promoter_id = public.app_current_promoter_id())
  WITH CHECK (public.app_is_platform_admin() OR public.app_is_service()
              OR promoter_id = public.app_current_promoter_id());
```

Tvar je doslova `p_orders_scope` ze §81. `app_is_service()` tam být **musí** —
servisní cesty (checkout, cron, webhooky) na část těch tabulek sahají.

### SLOŽITÉ — 2 tabulky, vazba přes JOIN

| tabulka | vazba | proč složité |
|---|---|---|
| `platform.b2b_transactions` | `account_id` → `platform.b2b_accounts` | tenant není na řádku; **a `b2b_accounts` sama nemá RLS** — policy by korelovala do tabulky bez ochrany, což nic nezaručí. Musí se řešit jako dvojice, nejdřív rodič. |
| `identity.eudi_verifications` | `user_id` **NULLABLE**, k tomu `event_id`, `order_id` | ověření identity běží i před přihlášením; `user_id IS NULL` řádky by žádná uživatelská větev nepustila. Potřebuje větev přes `order_id`, tj. korelaci do `orders.orders`. |

Tady §53 platí: obě korelují na neunikátní sloupec (`account_id`, `order_id`).
Ani jedna ale není v listingu s tisíci řádky — `b2b_transactions` se čte po
jednom účtu, `eudi_verifications` po jedné objednávce. Odhad dopadu: malý.
**Neměřeno.**

### NEJASNÉ — 2 tabulky, není zřejmé, čí data to jsou

| tabulka | proč nejasné |
|---|---|
| `catalog.films`, `catalog.sport_teams` | `promoter_id` je **NULLABLE**. To vypadá na sdílený číselník: film „Duna" nebo tým „Sparta" je jeden pro všechny promotéry, ale promotér si smí založit vlastní. Pak policy musí být `promoter_id IS NULL OR promoter_id = app_current_promoter_id()` — jenže tím se otevře zápis do sdílené části. **NEVÍM**, jestli je to záměr; z kódu se to nedá odvodit, řádky s NULL v seedu nejsou. Rozhodnutí je produktové. |
| `marketing.fan_bonus_issued` | `user_id` **NULLABLE** + `order_id`, `event_id`. Buď bonus pro hosta bez účtu, nebo nedodělek. |

### d) Dopad na výkon — kolik z 24 je v horkých cestách

Grep přes `app/api/{checkout,scan,webhooks,internal}` a `lib`:

```
HORKA  analytics.yield_rules            (1)
HORKA  catalog.productions              (3)
HORKA  identity.eudi_verifications      (1)
HORKA  marketing.fan_bonus_issued       (1)
HORKA  notifications.push_sent_log      (1)
HORKA  platform.b2b_transactions        (1)
HORKA  pricing.dynamic_pricing_rules    (2)
```

**7 z 24 leží v horké cestě. Pět z nich je mechanických**, tzn. predikát je
`promoter_id = app_current_promoter_id()` — rovnost na indexovaný sloupec,
`app_current_promoter_id()` je `STABLE`, takže se vyhodnotí jednou na dotaz.
Podle §53 rozhoduje kardinalita korelace; **tady žádná korelace není**, takže
cena je fakticky nula. To je jiná situace než u 453, kde predikát sahal do
čtyř dalších tabulek.

Zbylé dvě horké (`eudi_verifications`, `b2b_transactions`) jsou právě ty
složité — a obě se čtou po jednom klíči, ne v listingu.

### Souhrn nákladu

| kategorie | tabulek | práce | riziko výkonu |
|---|---|---|---|
| MECHANICKÉ | 20 | 1 migrace, 20× týž tvar + izolační test | žádné |
| SLOŽITÉ | 2 | vlastní návrh; b2b až po `b2b_accounts` | malé, neměřeno |
| NEJASNÉ | 2 | **produktové rozhodnutí, ne technické** | — |

⚠️ Migrace **nenapsána** dle zadání. Co je potřeba rozhodnout dřív: NULL větev
u `films`/`sport_teams` (sdílený číselník ano/ne) a jestli `b2b_accounts`
(taky bez RLS) jde do téhož balíku.

## §101 Doměření tří rout — dvě v pořádku, `alert` rozbitá

### `health/db` ✅ — mimo dosah RLS

Jediný dotaz je `SELECT 1`. Nesahá na tabulku, takže policies nemají co
vyhodnotit. Pod `tixly_app` funguje z definice; nic k měření.

### `platform/postal/[id]` ✅ — kontext sedí na policy

Routa je obalená v `runWithPlatformAdminContext` (nastaví `app.is_platform_admin
= 'true'`, `app.role = 'admin'`). Policy:

```
postal_deliveries_admin  FOR UPDATE  USING (current_setting('app.is_platform_admin', true) = 'true')
```

Větev existuje a kontext ji splňuje. `UPDATE` je bez `RETURNING`, takže se
SELECT vrstva neuplatní. Katalogově uzavřeno.

### `events/[id]/alert` 🔴 — 500 pro anonyma i pro přihlášeného

```
[alert anonym] { status: 500, body: '{"error":"INTERNAL"}' }
[alert user]   { status: 500, body: '{"error":"INTERNAL"}' }
```

Příčina **izolována experimentem, ne odvozena.** Tři běhy proti klonu:

```
ANONYM (zadny GUC)                42501 new row violates RLS policy ... ticket_alerts
USER bez kontextu (dnesni stav)   42501 new row violates RLS policy ... ticket_alerts
USER s app.current_user_id        rowCount=1  token=ANO
```

a rozhodující dvojice, která ukazuje, **která fáze** padá:

```
anonym BEZ RETURNING    OK rowCount=1
anonym S RETURNING      42501
```

**Vkládání projde. Padá `RETURNING token`** — SELECT policy nedovolí přečíst
právě vložený řádek. `ticket_alerts_insert` má `WITH CHECK (true)`, takže
zápisová vrstva nikdy problém nebyla.

Dvě nezávislé příčiny, obě reálné:

1. **Routa nikdy nenastaví kontext.** `x-user-id` se čte do proměnné v JS
   a předá jako sloupec, ale do session GUC se nedostane — routa jede na
   holém `db().connect()`. Proto padá i přihlášený uživatel.
2. **Anonymní hlídací pes nemá po 455 žádnou větev.** Třetí větev
   `ticket_alerts_select` zněla `current_setting('app.user_id','') = ''`
   (pro anonyma pravda). Migrace 455 ji přepsala na
   `(app_current_user_id())::text = ''` — a to je **uuid, které se prázdnému
   řetězci nerovná nikdy**. Větev je mrtvá. Anonym s `user_id IS NULL`
   neprojde ani druhou větví.

Bod 2 je vedlejší škoda 455: ta migrace opravovala name-drift a přitom
zavřela over-exposure, o které mluví `FINDINGS_RLS` §4C — jenže spolu s ní
i legitimní anonymní cestu. **Není to regrese jen kosmetická: featura
„dej mi vědět, až budou lístky" pro nepřihlášené návštěvníky je pod
`tixly_app` mrtvá.**

🔒 Oprava má dvě části a **jedna z nich je rozhodnutí, ne kód**: obalit routu
kontextem uživatele je mechanické, ale co má platit pro anonyma — servisní
kontext, nebo vlastní policy větev na `user_id IS NULL` — je táž otázka jako
u veřejných rout ze §94. **NEOPRAVENO**, mimo zadání tohoto kola.

Tím ze seznamu mizí všechny tři routy: 2 v pořádku, 1 rozbitá s doloženou
příčinou a lokalizovanou fází.

---

## §102 🔧 455 nezabila nic — moje atribuce v §101 byla ŠPATNĚ

### 1a/1c VERDIKT ČÍSLEM: **0 z 20**

Prošel jsem všech 20 policies z 455 a hledal v **původním** tvaru test na
prázdnotu kontextu (`= ''`, `IS NULL`, `COALESCE(…,'')`, `NULLIF`, default `''`
v `current_setting`). Výsledek:

```
ticket_alerts_select :: prazdnotny_test=1
zbylych 19           :: prazdnotny_test=0
```

**Jediná policy z 20 takovou větev vůbec má.** A 455 ji nezabila — byla mrtvá
už předtím.

### 1b: změřeno, tři tvary vedle sebe na jednom klonu

```
PUVODNI (baseline)   anonym=42501  prihlaseny=42501  cizi radky=0
PO 455               anonym=42501  prihlaseny=OK     cizi radky=0
NAVRH (IS NULL)      anonym=OK     prihlaseny=OK     cizi radky=0
```

Původní tvar byl `current_setting('app.user_id', true) = ''`. Aplikace ale
nastavuje `app.current_user_id`, **ne** `app.user_id` — to je přesně ten
name-drift, kvůli kterému 455 vznikla. `current_setting` na nenastavené GUC
s `missing_ok = true` vrací **NULL**, a `NULL = ''` je NULL, ne true.
Větev tedy neplatila nikdy.

**455 tu větev nezabila. Udělala z náhodné mrtvoty strukturální** — a přitom
**opravila přihlášeného uživatele** (42501 → OK). Byla to čistá výhra.

🔧 Moje formulace v §101 („vedlejší škoda 455", „featura je mrtvá vinou 455")
byla **nesprávná atribuce**. Funkce byla mrtvá od začátku, 455 se jí jen dotkla.
Nález sám (anonymní hlídací pes nefunguje) platí dál.

### 1d: co ta větev umožňovala

Anonymní přihlášení k odběru „dej vědět, až budou lístky" — bez účtu, jen e-mail.
Sloupec `user_id` je NULLABLE a routa posílá `userId ?? null`, takže **záměr
je jednoznačný**. Pod `tixly_app` to ale nikdy nefungovalo.

### 1e: mimo 455 — žádná další

Sken všech 596 policies v baseline i všech migrací 45x na tentýž vzorec vrací
**jediný zásah: `ticket_alerts_select`**. Jiná policy se na prázdný kontext
neptá.

## §103 ⛔ Navržený tvar `IS NULL` znovu otevírá únik — proto NE

Zadání navrhovalo nahradit srovnání s `''` za `app_current_user_id() IS NULL`.
Změřeno, než jsem to napsal:

```
v tabulce celkem (owner):        3 radku
ANONYM pod navrhem `IS NULL` vidi: 3 radku / 3 cizich e-mailu
```

Pro anonyma je `app_current_user_id()` NULL, takže větev je `USING (true)` —
tabulka se otevře **všem cestám bez kontextu**, ne jen tomu jednomu INSERTu.
Je to týž problém, kvůli kterému je zamčeno „veřejné routy → servisní kontext,
ne `USING (true)`".

**Migrace 460 proto použila jiný tvar: `app_is_service()`.** Servisní kontext
je dosažitelný výhradně z kódu aplikace, ne z HTTP.

## §104 ✅ 460 + kontext v routě: anonym i přihlášený, bez over-exposure

Oprava má dvě části a **ani jedna sama nestačí** — což se ukázalo měřením,
ne rozvahou:

1. **Routa** (`events/[id]/alert`) běžela na holém `db().connect()`; `x-user-id`
   se předalo jako sloupec, do session GUC nikdy. Obaleno: přihlášený →
   `runWithUserContext`, anonym → `runWithServiceContext`, DELETE (odhlášení
   z e-mailu) → servisní.
2. **Policy**: po obalení anonym **pořád padal**, protože `ticket_alerts_select`
   žádnou servisní větev neměla. Migrace 460 ji doplnila.

Mezikrok je poučný: po samotném obalení bylo `9 passed / 1 failed` — přihlášený
prošel, anonym ne. Kdybych se spolehl na to, že „servisní kontext to vyřeší",
nasadil bych polovinu opravy.

```
GREEN (10/10):
  [alert anonym]     status 200
  [alert user]       status 200
  [alert leak-check] v tabulce: 2 | anonym vidi: 0
```

Poslední řádek je podmínka, ne ozdoba: čerstvé spojení pod `tixly_app` **bez
jakéhokoli GUC** vidí nula řádků. Servisní kontext nepřežívá request a tabulka
zůstává zavřená — přesně to, co tvar `IS NULL` porušoval.

`rls-snapshot.json` přegenerován z klonu: 599 policies, 411 tabulek, gate prošel.

## §105 🕶️ Pátý zadrátovaný seznam — tentokrát v samotném gate

`rls-verify.mjs` psal do snapshotu:

```js
snap.generatedFrom = 'migrations: 000_baseline + 000_baseline_globals + 453 + 454 + 455';
```

Ten řetězec **lhal od migrace 456** — snapshot fakticky obsahoval i 456–460,
ale hlásil se jako stav po 455. Nikoho to nerozbilo (gate porovnává policies,
ne tenhle popisek), ale je to popáté táž třída ze §82: nástroj drží kopii
něčeho, co je na disku. Kdyby někdo řešil drift podle popisku, hledal by
příčinu o pět migrací vedle.

Opraveno na čtení z `migrations/`. Nová hodnota:

```
migrations: 000_baseline_20260730.sql + 000_baseline_globals.sql + 450_… + … + 460_…
```

---

## §106 ✅ Migrace 461: RLS na 19 mechanických tabulek (ne 20)

### Generátor našel chybu v mém vlastním čísle

§100 tvrdil **20 mechanických**. Generátor při ověřování proti katalogu jednu
odmítl:

```
NEGENERUJI — 1 tabulek neproslo overenim:
  • marketing.fan_bonus_issued.user_id: je NULLABLE — radky s NULL by neprosly zadnou vetvi
```

`marketing.fan_bonus_issued` patří mezi **NEJASNÉ**, ne mechanické — v §100
jsem ji vypsal správně v obou seznamech a pak špatně sečetl. Platí
**16 + 3 = 19**, nejasných je 5 (ne 4). Odhalil to nástroj ověřující proti
katalogu, ne čtení dokumentu — což je přesně důvod, proč se migrace generuje.

### Self-check generátoru (1b)

Podmínkou publikace, ne doplňkem. Do vstupu se vloží `identity.users`
deklarovaná se sloupcem `promoter_id`, který na ní není:

```
[selfcheck] vlozen spatny vstup: identity.users deklarovany se sloupcem promoter_id
  ODMITNUTO: identity.users: sloupec promoter_id NEEXISTUJE
[selfcheck] PROSEL — generator spatny vstup zachytil
```

Generátor ověřuje pět podmínek: tabulka existuje, sloupec existuje, je `uuid`,
je `NOT NULL`, tabulka dnes nemá policy. Selže-li kterákoli, **nenapíše nic**.

### FORCE ROW LEVEL SECURITY — záměrně NE

Zvažováno a zamítnuto. `FORCE` podrobuje RLS **vlastníka** tabulky. Aplikace se
připojuje jako `tixly_app`, který vlastníkem není, takže se ho RLS týká i bez
`FORCE`. Baseline nemá `FORCE` ani na jedné z 600 tabulek — zavést ho tady by
19 tabulek odlišilo od zbytku a podrobilo RLS i migrační skripty běžící pod
ownerem.

### 1c) Izolace RED→GREEN, 6 reprezentantů

RED je měření ze §96 stejnou metodou před migrací
(`catalog.productions vlastni=1 CIZI=1 🔴 UNIK`). Po 461:

```
 catalog.productions              vlastni=1 CIZI=0  ✅ IZOLOVANO
 platform.promoter_contacts       vlastni=1 CIZI=0  ✅ IZOLOVANO
 orders.guestlist_entries         vlastni=1 CIZI=0  ✅ IZOLOVANO
 communications.broadcasts        vlastni=1 CIZI=0  ✅ IZOLOVANO
 orders.school_bookings           vlastni=1 CIZI=0  ✅ IZOLOVANO
 identity.fan_profiles            vlastni=1 CIZI=0  ✅ IZOLOVANO
```

Zastoupeny obě skupiny (5× `promoter_id`, 1× `user_id`) i všechna dotčená
schémata kromě `analytics`/`pricing`/`brands`, kde seed narazil na povinné
sloupce a **nezměřil jsem je** — u těch platí jen katalogové ověření.

### 1d) Kolik testů 461 rozbila: **0**

```
po 461:  Tests  3 failed | 49 passed | 1 skipped  (53)
```

Všechny tři pády jsou **starší než 461** — ověřeno tím, že jsem migraci
dočasně odebral a pustil dotčenou sadu znovu:

```
bez 461: checkout-guest  1 failed | 3 passed   ← týž pád
```

| pád | povaha |
|---|---|
| `waitlist` — čeká `23514`, dostane `undefined` | zastaralá aserce (457 CHECK opravila) |
| `box-office` — čeká ≥500, dostane 404 | zastaralá aserce |
| `checkout-guest` dedup — 500 | **skutečná, předchází 461** |

Žádná routa tedy na těch 19 tabulkách neběžela bez kontextu — což dává smysl:
všechny čtoucí routy si `WHERE promoter_id` psaly samy (§96), takže kontext
měly nastavený.

`rls-snapshot.json`: **599 → 618 policies, 411 → 430 tabulek s RLS.** Gate prošel.

## §107 Podklad k rozhodnutí o zbylých 5

### a) `catalog.films`, `catalog.sport_teams` — sdílený číselník je ZÁMĚR, doložený kódem

Nemusí se hádat. `admin/films/route.ts:19`:

```sql
WHERE promoter_id = $1 OR promoter_id IS NULL
```

`promoter_id IS NULL` = **globální film viditelný všem promotérům**; promotér
si vedle toho smí založit vlastní. Totéž `admin/sport-teams`. Veřejné routy
(`cinema/films/[id]`, `sports/teams/[id]`) nefiltrují promotéra vůbec, jen
`status='active'`.

🔴 **Co se přitom našlo: zápis je širší než smazání.** `admin/films/[id]`:

```
řádek  87 (UPDATE): WHERE id = $… AND (promoter_id = $… OR promoter_id IS NULL)
řádek 107 (DELETE): WHERE id = $1  AND promoter_id = $2
```

**Kterýkoli promotér smí editovat globální film**, ale smazat ho smí jen
vlastník. Asymetrie, kterou dnes nedrží nic — a policy ji zviditelní.

Co by policy musela umět:

```sql
-- ČTENÍ: sdílené + vlastní
USING (app_is_platform_admin() OR app_is_service()
       OR promoter_id IS NULL OR promoter_id = app_current_promoter_id())
-- ZÁPIS: jen vlastní (NULL řádky patří platformě)
WITH CHECK (app_is_platform_admin() OR app_is_service()
            OR promoter_id = app_current_promoter_id())
```

⚠️ Takový `WITH CHECK` **rozbije dnešní chování** na řádku 87. Buď je editace
globálních filmů promotérem chyba (pak to policy opraví), nebo funkce (pak
musí `WITH CHECK` obsahovat i `IS NULL` a globální číselník je zapisovatelný
komukoli). **NEVÍM které** — z kódu se to nedá odvodit, je to produktové
rozhodnutí. Bez něj migraci psát nejde.

Kolik NULL řádků reálně existuje: **NEZMĚŘENO** — produkční větev je prázdná
a na klonu je jen to, co naseeduju.

### b) `platform.b2b_transactions` — tenant tam možná vůbec není promotér

`platform.b2b_accounts` **nemá `promoter_id`** ani žádný jiný promotérský
sloupec: `company_name`, `ico`, `dic`, `contact_email`, `credit_balance_halire`,
`account_code`. Je to **platformový** B2B účet, ne promotérův.

Tenantem je tedy firma, a vazba na člověka vede přes `platform.b2b_account_users`
(ta jediná z trojice **policy má** — 1).

Co by obnášelo řešit to jako dvojici:
1. Nejdřív `b2b_accounts`: policy `EXISTS (SELECT 1 FROM b2b_account_users bau
   WHERE bau.account_id = id AND bau.user_id = app_current_user_id())`.
   Tady §53 platí — korelace na neunikátní `account_id`.
2. Teprve pak `b2b_transactions` přes `account_id` → `b2b_accounts`.
   Vnořené RLS: policy nad `b2b_transactions` sáhne na `b2b_accounts`, která už
   RLS má. Vyplatí se `SECURITY DEFINER` helper `app_can_see_b2b_account(uuid)`
   stejně jako u 453.
3. `admin/b2b/*` běží pod `requirePlatformAdmin` — ten musí projít větví
   `app_is_platform_admin()`, jinak se rozbije správa účtů.

**Otevřená otázka:** je B2B účet vázaný i na promotéra (kdo vidí transakce
za nákupy na akcích promotéra X?), nebo je čistě platformový? Z katalogu vyplývá
druhé. **NEVÍM**, jestli to odpovídá záměru.

### c) `identity.eudi_verifications` — kontext je anonymní, jako u §94

`eudi/presentation-request/route.ts:59` zakládá řádek sloupci
`(request_id, event_id, order_id, status)` — **`user_id` se při založení
nevyplňuje vůbec.** `eudi/verify` pak řádek dohledává podle `request_id`, tedy
podle tokenu.

Je to týž tvar jako veřejné routy ze §94: **cesta začíná bez přihlášení
a filtruje se sama tokenem.** Odpovídající řešení je tedy servisní kontext
+ větev `app_is_service()`, ne uživatelská větev — uživatelská by nefungovala,
protože v okamžiku zápisu žádný uživatel neexistuje.

`checkout/route.ts:424` řádek čte (`SELECT 1 FROM identity.eudi_verifications`)
už v servisním kontextu, takže ta strana je připravená.

Zbývá rozhodnout, jestli má mít **uživatel** vlastní pohled na svá ověření
(dnes žádná routa taková není). Pokud ne, stačí servisní větev a je to
mechanické.

---

## §108 ✅ Migrace 462: sdílený číselník + eudi

### RED→GREEN pod `tixly_app`, obě fáze na témž klonu

```
RED (bez 462)
 catalog.films        vidi: global=1 vlastni=1 CIZI=1 | UPDATE globalni: ZMENIL 🔴
 catalog.sport_teams  vidi: global=1 vlastni=1 CIZI=1 | UPDATE globalni: ZMENIL 🔴
 identity.eudi_verifications  anonymni(servisni) zapis: OK | cizi user vidi: 1 🔴

GREEN (s 462)
 catalog.films        vidi: global=1 vlastni=1 CIZI=0 | UPDATE globalni: odmitnut ✅ (42501)
 catalog.sport_teams  vidi: global=1 vlastni=1 CIZI=0 | UPDATE globalni: odmitnut ✅ (42501)
 identity.eudi_verifications  anonymni(servisni) zapis: OK ✅ | cizi user vidi: 0 ✅
```

Všechny čtyři podmínky ze zadání splněny na všech třech tabulkách. `USING` je
záměrně širší než `WITH CHECK` — promotér globální položku vidí, ale nezmění.

### Kód opraven spolu s policy

`admin/films/[id]:87` a `admin/sport-teams/[id]:89` pouštěly UPDATE i na řádky
s `promoter_id IS NULL`, zatímco DELETE (ř. 107/109) jen na vlastní. Zúženo na
`promoter_id = $…`, aby aplikace a RLS říkaly totéž. `tsc` exit 0.

⚠️ **Počtvrté jsem si shodil běh neescapovaným backtickem** — komentář uvnitř
SQL v template literalu obsahoval `` `OR promoter_id IS NULL` `` a ukončil
řetězec (TS1005). Komentář patří **nad** volání `db().query`, ne do SQL.

### 🔎 Týž tvar jinde — NEOPRAVENO, mimo zadání

`admin/collections/[id]/events/route.ts:18` má funkci `ensureCollectionOwner`,
která se jmenuje „owner", ale přijímá i `promoter_id IS NULL` — a používá se
jako **zápisová** stráž pro POST. Táž třída jako films/sport_teams, jiná tabulka
(`catalog.event_collections`, mimo 462). Zbylé výskyty vzoru
(`channel-prices`, `support-faq`, `insurance-plans`, `support-chat`) jsou
**čtecí**, ty jsou v pořádku. `venues/[venueId]/seating-chart` má v hlavičce
napsané „Sdílené sály edituje pouze platform admin" — tedy správné pravidlo
už někde formulované bylo.

### ⚠️ Live sada: 3 padlé z 53, ale sada je FLAKY

```
s 462:  3 failed | 49 passed | 1 skipped (53)
```

Dva pády jsou známé zastaralé aserce (`waitlist`, `box-office`). Třetí se
**mezi běhy mění** — jednou `alert: prihlaseny uzivatel`, jindy
`discover NEpropusti cenu skryteho typu`, jindy žádný:

```
6 běhů public-routes s 462 → 2 pády, pokaždé JINÝ test
1 běh bez 462             → 10/10
opakování téhož testu     → [alert user] status 200, token vrácen
```

**NEVÍM, jestli 462 s tou flakinessou souvisí.** Proti souvislosti mluví, že
regrese z policy by padala deterministicky a na témž testu; tady padá pokaždé
jinde a při opakování projde. Pro souvislost nemluví nic měřeného — jeden čistý
běh bez 462 na rozhodnutí nestačí. **Flakinessa live sady je samostatný
nevyřešený problém**, který se tímhle kolem odhalil a měl by se řešit dřív,
než se sada použije jako brána.

`rls-snapshot.json`: **618 → 621 policies, 430 → 433 tabulek.** Gate prošel.

## §109 Podklad k b2b trojici — dvě opravy mých dřívějších tvrzení

### 🔧 Oprava 1: `b2b_account_users` policy NEMÁ

V §107 jsem napsal „ta jediná z trojice policy má — 1". **Špatně.** To číslo
pocházelo z `grep -c 'ON platform.b2b_account_users'`, který napočítal řádek
`CREATE INDEX idx_b2b_users_account ON platform.b2b_account_users …`.
Cílený grep na `CREATE POLICY` nevrací pro tuhle tabulku nic.

**Mimo RLS stojí celá trojice, ne dvě ze tří.**

### 🔧 Oprava 2: `b2b_transactions.user_id` NEUKAZUJE na `identity.users`

`b2b/account/route.ts:73`:

```sql
LEFT JOIN platform.b2b_account_users bau ON bau.id = bt.user_id
```

`b2b_transactions.user_id` je cizí klíč do **`b2b_account_users`**, ne do
`identity.users`. `b2b_account_users` navíc **žádný `user_id` nemá** — má
`email` a `name`. B2B uživatel tedy není platformový uživatel; je to záznam
u firmy, klíčovaný e-mailem.

Tím padá heuristika, kterou stála klasifikace v §100: sloupec jménem `user_id`
nemusí mířit na `identity.users`. Ostatních 19 tabulek z 461 to neohrožuje —
u těch byl helper ověřen měřením izolace — ale je to **třída chyby, kterou můj
katalogový sken najít neuměl**, protože se díval na jména sloupců, ne na cizí
klíče.

### a) Jak se dnes určuje, kdo smí vidět účet firmy

**Ne přes `b2b_account_users`.** `b2b/account/route.ts` používá vlastní token:

```
const session = await verifyB2BToken(req);   // Bearer token
… [session.b2bAccountId]
```

Autorizace tedy proběhne **v aplikaci** a do dotazu vstupuje `b2bAccountId`
z ověřeného tokenu. `admin/b2b/*` je jiná cesta — `requirePlatformAdmin`.

### b) Návrh pro trojici

Protože identita B2B uživatele **není** `app.current_user_id`, korelace přes
`b2b_account_users` by neměla z čeho vyjít. Nabízejí se dvě cesty:

| varianta | tvar | cena |
|---|---|---|
| **A — servisní** (doporučuji) | všechny tři tabulky dostanou `app_is_platform_admin() OR app_is_service()`; routy běží v servisním kontextu a scopují se `session.b2bAccountId` z ověřeného tokenu | žádná; §53 se netýká, protože není korelace |
| **B — nové GUC** | zavést `app.b2b_account_id`, helper `app_current_b2b_account_id()` a policy `account_id = app_current_b2b_account_id()` | nutná změna `rls-pool` + `verifyB2BToken`; teprve tohle by dalo RLS skutečnou vrstvu |

Varianta A **nepřidá vrstvu izolace** — jen tabulky zavře před kontexty, které
o nich nemají vědět. Varianta B je jediná, která by dala totéž, co má zbytek
schématu. Který z těch dvou cílů se sleduje, **je rozhodnutí, ne technikálie.**

Helper by v obou případech musel splňovat §51: `SECURITY DEFINER`,
`SET search_path = pg_catalog, public`, vrací `boolean`, scopuje se sám z GUC.

### c) `admin/b2b` pod `requirePlatformAdmin` — projde

Ověřeno čtením: routa volá `requirePlatformAdmin(req)`. Pokud běží
v `runWithPlatformAdminContext` (nastaví `app.is_platform_admin='true'`), projde
větví `app_is_platform_admin()` v obou variantách. **NEZMĚŘENO** — jestli je ta
routa tím kontextem obalená, jsem v tomhle kole neověřoval.

### d) Riziko

Nízké u varianty A (nic se neotevírá, jen zavírá), střední u B — zavedení
nového GUC se dotkne poolu i tokenové cesty a chyba by zavřela B2B portál
úplně. V obou případech platí, že se **nesmí zapnout RLS bez policy** —
to je tichý deny (§91).

---

## §110 FK místo jmen — VERDIKT: 3 nesoulady, 2 z nich v policies

Nový nástroj `scripts/fk-name-vs-target.mjs` čte `pg_constraint` a pro každý
sloupec s tenant-jménem porovná **očekávaný** cíl se **skutečným** `confrelid`.

```
sloupcu s tenant-jmenem: 553
  FK sedi s ocekavanim : 292
  FK MIRI JINAM        :   3
  BEZ FK (nelze overit): 258
```

### b) Tři nesoulady

```
b2b_orders.dunning_log.order_id        -> b2b_orders.invoice_orders  (cekano orders.orders)  V POLICY: p_rls_dunning_log
b2b_orders.order_reservations.order_id -> b2b_orders.invoice_orders  (cekano orders.orders)  V POLICY: p_rls_order_reservations
platform.b2b_transactions.user_id      -> platform.b2b_account_users (cekano identity.users) (v zadne policy)
```

**Dva z nich jsou v policy — a obě policy korelují proti špatné tabulce:**

```sql
p_rls_dunning_log: … OR EXISTS (SELECT 1 FROM orders.orders o_
                                 WHERE o_.id = dunning_log.order_id AND …)
```

`dunning_log.order_id` je ale klíč do `b2b_orders.invoice_orders`. Prostory ID
se nepotkávají, takže `EXISTS` neplatí nikdy a policy se smrskne na
`app_is_platform_admin() OR app_is_service()`.

**Změřeno, ne odvozeno** — naseedovaná faktura + řádek dunning logu:

```
 owner (bypassrls) vidi dunning_log: 1
 promoter (vlastnik faktury)  vidi: 0
 user (kupujici)              vidi: 0
 servisni                     vidi: 1
```

🟡 **Je to mrtvá větev, ne tichá díra.** Selhává **fail-closed**: promotér, který
fakturu vystavil, na svůj vlastní dunning log nevidí. Není to únik — je to
nedostupná funkce. Táž třída jako mrtvá anonymní větev v §102, jen jiná příčina
(špatná cílová tabulka místo špatného GUC jména).

### c) 19 tabulek z 461: **0 nesouladů**

```
17× FK OK   (z toho 6 s změřenou izolací)
 2× BEZ FK — analytics.yield_rules.promoter_id, orders.phone_orders.promoter_id
 0× FK MIRI JINAM
```

Policies z 461 tedy nestojí na špatném předpokladu. U dvou tabulek se cíl
ověřit nedá, protože FK chybí — tam platí jen to, že sloupec je `uuid NOT NULL`
a izolace se u nich **neměřila**.

### d) 258 sloupců BEZ FK — větší třída než nesoulady

```
celkem 258, z toho V POLICIES 191
```

**To je vlastní riziko a je řádově větší než tři nalezené nesoulady.** U 191
sloupců, na kterých stojí nějaká policy, se z katalogu nedá ověřit, že míří tam,
kam si policy myslí. Kdyby některý mířil jinam, projeví se to buď mrtvou větví
(jako výše), nebo — pokud by prostory ID kolidovaly — tichou dírou.

Neměřil jsem to; ověřit se to dá jen pozorováním dat nebo čtením zapisujícího
kódu, tabulku po tabulce. **NEVÍM**, kolik z těch 191 je v pořádku.

### e) VERDIKT ČÍSLEM

**3 nesoulady, 2 z nich v policies** (obě změřeny jako mrtvé větve, fail-closed).
K tomu **258 sloupců bez FK, z toho 191 v policies** — neověřitelných.

## §111 ✅ Migrace 463 (b2b, varianta A) + obalení 6 rout + R-16

### RED→GREEN

```
RED (bez 463)
 promoter (cizi kontext)    accounts=1  transactions=1  account_users=1
 user (cizi kontext)        accounts=1  transactions=1  account_users=1
 anonym (bez GUC)           accounts=1  transactions=1  account_users=1

GREEN (s 463)
 promoter (cizi kontext)    accounts=0  transactions=0  account_users=0
 user (cizi kontext)        accounts=0  transactions=0  account_users=0
 anonym (bez GUC)           accounts=0  transactions=0  account_users=0
 platform admin             accounts=2  transactions=2  account_users=2
 servisni                   accounts=2  transactions=2  account_users=2
```

### 🔴 c) `admin/b2b` kontextem obalená NEBYLA — 463 by ho zavřela

Změřeno čtením kódu: `admin/b2b/*` volá **holé** `requirePlatformAdmin(req)`,
které ověří token, ale **GUC nenastaví**. Kontext nastavuje až
`runAsPlatformAdmin` (`platform-auth.ts:55`), který tyhle routy nepoužívají.

Bez obalení by 463 správu B2B účtů zavřela: `app.is_platform_admin` by nebylo
nastavené a větev by neplatila. Obaleno proto **všech 6 b2b rout** ve stejném
commitu — 3 admin (`runWithPlatformAdminContext`), 3 portálové
(`runWithServiceContext`, scoping zůstává na `session.b2bAccountId`). `tsc` 0.

⚠️ 463 **nepřidává izolaci mezi firmami** — jen zavírá tabulky před kontexty,
které o nich nemají vědět. Skutečnou izolaci dá až varianta B (R-17).

### R-16: `ensureCollectionOwner` zúžena

```
RED  stary tvar  zapis do SDILENE: POVOLEN 🔴   do VLASTNI: povolen ✅
GREEN novy tvar  zapis do SDILENE: odmitnut ✅  do VLASTNI: povolen ✅
```

### Live sada: 5 z 53, ale flakinessa z R-15 trvá

```
5 failed | 47 passed | 1 skipped (53)
```

`public-routes` selhal **pokaždé na jiném testu** (tentokrát `discover min_price`
+ `artists/[slug]`, při opakování `alert: prihlaseny uzivatel`) — potvrzuje R-15.

`checkout-guest` naopak selhal **dvakrát na témž testu** (`velká písmena
v e-mailu nevytvoří druhého uživatele`), takže tenhle vypadá deterministicky.
Patří do téže rodiny jako pád `dedup: druhá objednávka`, který jsem změřil
**před** 461 i před 462 — tedy **předchází všem třem migracím tohoto i minulých
kol**. Příčinu jsem nehledal, došel kontext.

`rls-snapshot.json`: **621 → 624 policies, 433 → 436 tabulek.** Gate prošel.

---

## §112 R-15: flakinessa změřena, příčina NENALEZENA — a je širší, než jsem tvrdil

### a) Deset běhů

`public-routes` (10 testů), pětkrát po sobě, beze změny kódu:

```
beh1: 1 failed |  9 passed
beh2: 2 failed |  8 passed
beh3: 1 failed |  9 passed
beh4: 1 failed |  9 passed
beh5: 0 failed | 10 passed
```

Tři další běhy: 1 failed, 0 failed, 0 failed. Celkem tedy **5 z 8 běhů mělo
aspoň jeden pád**, počet 0–2. **Není to náhodné v tom smyslu, že by šlo o šum
měření — je to nedeterministický běh nad deterministickým vstupem.**

Doprovodná čísla jsou přitom pokaždé stejná:

```
[discover] 200 akci: 1     (ve všech zachycených bězích)
[artists]  200             (ve všech zachycených bězích)
```

Takže `discover` i `artists` vracejí data spolehlivě; padají jiné testy téhož
souboru a mezi běhy se střídají.

### 🔧 Oprava mého tvrzení z §111: flaky je i `checkout-guest`

Napsal jsem, že `velká písmena v e-mailu` selhalo „dvakrát na témž testu, takže
vypadá deterministicky". **Třetí běh dal `4 passed (4)`.** Dvě opakování nestačí
na závěr o determinismu — to byl můj chybný úsudek, ne vlastnost kódu.

Tím padá i premisa, ze které jsem měl vyjít v tomhle kole: *„padá stabilně,
předchází 461/462/463 — je to skutečný bug"*. **Není doloženo, že jde
o samostatný bug.** Může to být tentýž jev jako u `public-routes`.

Helper `createOrGetGuestUser` přitom e-mail **normalizuje správně**
(`guest-user.ts:118` → `input.email.trim().toLowerCase()`), takže hypotéza
z bodu 2c (guest se hledá podle nenormalizovaného e-mailu) **neplatí** —
ověřeno čtením, ne odhadem.

### b) Co jsem vyloučil měřením nebo čtením

| hypotéza | výsledek |
|---|---|
| souběh souborů | vyloučeno — `vitest.live.config.ts` má `fileParallelism: false` |
| souběh testů v souboru | vyloučeno — žádný `it.concurrent`, výchozí režim je sekvenční |
| rate limit na routách | vyloučeno — `discover`, `artists/[slug]`, `events/[id]/alert` žádný nemají (grep) |
| servisní kontext přežívá request | proti mluví `[alert leak-check]`, který **v každém běhu** hlásí `anonym vidi: 0` |
| závislost na pořadí | **NEOVĚŘENO** — `--sequence.shuffle` jsem nespustil, došel kontext |

### c) Nejsilnější zbývající podezřelý — NEOVĚŘENO

`rls-pool.ts:193–204` přepisuje `client.release()` tak, že RESET GUC běží
**fire-and-forget** a případné selhání se **tiše polkne**:

```js
void client.query('RESET app.current_promoter_id; RESET app.is_platform_admin; …')
  .catch(() => undefined)
  .finally(() => originalRelease(err));
```

Nad tím `statement_timeout: 15000`. Kdyby RESET selhal (timeout, přerušené
spojení), vrátí se spojení do poolu **špinavé** a nikdo se to nedozví — další
test by zdědil cizí `app.current_user_id` a RLS by mu odfiltrovala řádky.
Odpovídá to tvaru pádů („čekal jsem data, nedostal jsem nic") i jejich
nahodilosti (záleží, které spojení z poolu se trefí).

**Je to hypotéza, ne nález.** Neměřil jsem ji. Ověřila by se tak, že se při
akvizici spojení přečte `current_setting('app.current_user_id', true)` a hlásí
se každý nenulový výskyt.

### d) 5 běhů se stejným výsledkem: NEDOLOŽENO

Zadání chtělo doložit pět shodných běhů po opravě. **Opravu jsem nenašel**,
takže tenhle bod plním záporně: pět běhů shodných NENÍ a předstírat to nebudu.

### Co z toho plyne pro dřívější čísla

Všechna „X ze Y padlo" z posledních kol jsou **měřená s touhle nejistotou**.
Konkrétně: rozdíly o jeden až dva testy mezi běhy (7→5→3→5) **nemusely znamenat
nic**. Co tím naopak zpochybněno NENÍ, jsou přímá měření izolace
(`vlastni=1 CIZI=0`) a RED→GREEN dvojice — ty běžely proti klonu přímým SQL,
mimo vitest, a opakovaly se shodně.

---

## §113 R-15: hypotéza o špinavém spojení PADÁ — je to časovací závod

### 1a/1b) Instrumentace

Do `rls-pool.ts` přidána diagnostika za `RLS_POOL_DEBUG=1`:
při každé akvizici se přečtou všechny čtyři GUC a hlásí se nenulové;
selhání RESETu se místo `.catch(() => undefined)` **zaloguje**.

### 1c) VERDIKT: korelace NENÍ — hypotéza padá

Sedm běhů `public-routes` s diagnostikou:

```
beh1: 0 failed   DIRTY=0  RESETFAIL=0
beh2: 0 failed   DIRTY=0  RESETFAIL=0
beh3: 0 failed   DIRTY=1  RESETFAIL=0
beh4: 0 failed   DIRTY=1  RESETFAIL=0
beh5: 0 failed   DIRTY=0  RESETFAIL=0
beh6: 0 failed   DIRTY=1  RESETFAIL=0
beh7: 0 failed   DIRTY=0  RESETFAIL=0
```

**Špinavá spojení skutečně existují** — ve třech z sedmi běhů:

```
[RLS-DIRTY] spojeni z poolu nese GUC: {"r":"system"}
            | kontext teto akvizice: {"currentUserId":"d7052ed4-…","role":"user"}
```

**Ale RESET neselhal ani jednou** a — hlavně — **každý běh, ve kterém se špína
objevila, PROŠEL celý.** Korelace „padající test má zděděné GUC" tedy
**doložena není. Hypotéza padá** a říkám to.

(Ta konkrétní špína je navíc neškodná: zděděné `app.role='system'` akvizice
s kontextem hned přepíše na `'user'`. Nebezpečný by byl zděděný
`app.current_user_id` u kontextu, který ten GUC nenastavuje — `connect()`
totiž nastaví jen to, co má v kontextu, a ostatní **nečistí**.)

### 🔬 Co ale instrumentace odhalila: přidání jednoho round-tripu pády VYPNE

```
S diagnostikou     (7 běhů):  0 pádů
BEZ diagnostiky    (4 běhy):  2 běhy padly (2 a 1 pád)
                              discover NEpropusti cenu … | alert: prihlaseny uzivatel
```

Diagnostika dělá jedinou věc navíc: **jeden `await client.query(...)` mezi
`pool.connect()` a prvním `SET`**. To nemění logiku, jen posouvá časování —
a flakinessa zmizí.

**To je podpis časovacího závodu, ne špinavého stavu.** Kdyby šlo o zděděné
GUC, diagnostika by jev jen zviditelnila, ne odstranila.

Konkrétní závod jsem **nelokalizoval**. Nejsilnější kandidát zůstává tentýž
kód, ale z jiného důvodu než hypotéza: `release()` je přepsaný tak, že se tváří
synchronně, ale `originalRelease` se volá až v `.finally()` po dokončení RESETu.
Volající tím pádem pokračuje dřív, než je spojení opravdu vrácené. **Neověřeno.**

### 1d/1e) Oprava NEPROVEDENA, pět shodných běhů NEDOLOŽENO

Bod d) zadání byl podmíněný potvrzením hypotézy („teprve po potvrzení oprav").
Hypotéza potvrzená nebyla, takže jsem `release()` **neměnil** — změna semantiky
vracení spojení je zásah do produkční cesty a dělat ji na základě vyvrácené
hypotézy by bylo horší než flakinessa.

Sedm shodných běhů mám **jen se zapnutou diagnostikou**, což není oprava, ale
změna časování. Za doložení bodu e) to nevydávám.

### Co zůstává

Diagnostika je v repu **vypnutá** (`RLS_POOL_DEBUG` nenastavené) a stojí jeden
round-trip jen když se zapne. Zůstává i zviditelnění selhání RESETu — dřív bylo
neviditelné, což je vada bez ohledu na R-15.

**R-18 nezpracováno** — bylo v zadání podmíněné spolehlivou sadou, ta spolehlivá
není.

---

## §114 R-15 POTVRZENO ČÍSLY: závod o návrat spojení do poolu

### 1a) Velikost poolu

`rls-pool.ts:52` → `max: Number(process.env.PG_POOL_MAX ?? 10)`.
Testovací prostředí to nepřepisuje, takže platí **10**.

### 1b) Matice — 20 běhů `public-routes` (10 testů), bez diagnostiky

```
max=1  :  0 0 0 0 0   → 0 padu / 50 testu
max=2  :  0 2 1 1 1   → 5
max=5  :  1 0 1 1 1   → 4
max=20 :  0 1 0 0 2   → 3
```

**Není to gradient, je to práh.** Jedno spojení = nula pádů. Dvě a víc = pády
v podobné četnosti (3–5 z 50) bez ohledu na to, jestli jsou dvě, pět nebo dvacet.

To dává smysl přesně u tohohle závodu: **při `max=1` pool nemůže spojení vydat
dřív, než doběhne `originalRelease`** — tedy dokud se nedokončí RESET. Serializace
je vynucená. Od dvou spojení nahoru už může být další test obsloužen jiným
spojením, zatímco návrat prvního ještě neproběhl.

### 1c) 50 ms v `afterEach` — pády zmizí

```
max=10 (default) + afterEach 50ms:  0 0 0 0   → 0 padu / 40 testu
```

### 1d) VERDIKT: **ano, je to závod o spojení v poolu**

Čtyři nezávislé zásahy, každý jen posouvá časování a nemění logiku, a **každý
symptom odstraní**:

| zásah | běhů | pádů |
|---|---|---|
| `max=1` (vynucená serializace) | 5 | **0** |
| `afterEach` 50 ms | 4 | **0** |
| diagnostický round-trip při akvizici (§113) | 7 | **0** |
| — bez zásahu, `max=10` | 12 | 3–5 z 50 |

Závod je tedy **ve vracení spojení, ne uvnitř routy**. Kdyby šlo o timing uvnitř
handleru, `max=1` by nepomohl.

⚠️ Co tím **není** vysvětleno: proč se pád projeví jako „dotaz nevrátil data".
Zděděné GUC to podle §113 nejsou (diagnostika špínu viděla v bězích, které
prošly). **NEVÍM**, jakým mechanismem se nedokončený návrat spojení promítne do
prázdného výsledku.

## §115 Oprava přes `await release()` je mimo rozsah — 218 call sites

### 2a) Rozsah

```
celkem call sites .release() :  218
z toho ve finally blocích    :  215
souborů                      :  180
dnes awaitovaných            :    0
```

`finally { client.release(); }` je synchronní ve 215 z 218 případů. Udělat
`release()` awaitable znamená sáhnout na **180 souborů** produkční cesty.

### 2c) NEDĚLÁM TO — a navrhuju jiný tvar, který call sites nepotřebuje

Podle zadání se produkční cesta kvůli flaky testům bez rozvahy měnit nebude.
Návrh, který má **nula změn na call sites**:

**Přesunout čištění GUC z `release()` do `connect()`.**

Dnes: `connect()` nastaví jen ty GUC, které jsou v kontextu, a ostatní **nečistí**;
úklid se dělá až při `release()`, asynchronně a mimo dohled volajícího.

Navrhovaný tvar: `connect()` na začátku **vždy** nastaví všechny čtyři GUC —
z kontextu, nebo na prázdno — a `release()` se nechá být obyčejný. Volající
`connect()` už dnes awaituje, takže je úklid deterministicky hotový dřív, než
kdokoli vydá první dotaz. Asynchronní ocas zmizí.

| | dnes | návrh |
|---|---|---|
| kdy se čistí | při release, fire-and-forget | při acquire, v awaitované cestě |
| změny call sites | — | **0** |
| cena | — | 1 round-trip na akvizici s kontextem (dá se sloučit do jednoho `SET` příkazu) |

⚠️ **Neimplementováno a neověřeno.** Že tři jiné časovací zásahy symptom
odstraní, **není důkaz**, že tenhle ho odstraní taky — diagnostika ze §113 GUC
jen četla, nečistila, a přesto pomohla. Než se to nasadí, musí projít pět
shodných běhů BEZ diagnostiky a s `max=10`. Došel mi kontext, než jsem to mohl
udělat.

### Stav bodů zadání

| bod | stav |
|---|---|
| 1a–1d | ✅ splněno, verdikt doložen čísly |
| 2a | ✅ 218 call sites / 180 souborů |
| 2b | ❌ oprava neprovedena → 5 běhů nedoloženo |
| 2c | ✅ návrh + rozsah napsán |
| 3 | ⏭️ neprovedeno — závod V POOLU JE, takže podmínka „pokud závod není v poolu" neplatí |
| R-18 | ⏭️ pořád čeká na spolehlivou sadu |

---

## §116 ✅ MECHANISMUS R-15 VYSVĚTLEN: dotaz běží na session, kam SET nedorazil

### 1a) Instrumentace bez round-tripu

Předchozí sonda (§113) přidávala dotaz při akvizici — a tím jev **maskovala**
(0 pádů ze 7 běhů). Tentokrát se GUC čtou **jako sloupce téhož dotazu**, který
routa stejně posílá:

```sql
SELECT COUNT(*) AS total,
       current_setting('app.role', true)              AS _dbg_role,
       current_setting('app.current_user_id', true)   AS _dbg_uid,
       …
```

Nula round-tripů navíc → jev zůstal reprodukovatelný (3 pády ze 4 běhů).

### 1b) Korelace JE — a je jednoznačná

```
beh1: 1 failed
   [DISCOVER-GUC] radku=1 total=1 role="system" uid=null pid=null adm=null
   [DISCOVER-GUC] radku=1 total=1 role="system" uid=""   pid=""   adm=""
   [DISCOVER-GUC] radku=1 total=1 role="system" uid=""   pid=""   adm=""
beh3: 1 failed
   [DISCOVER-GUC] radku=1 total=1 role="system" uid=null pid=null adm=null
   [DISCOVER-GUC] radku=1 total=1 role="system" uid=""   pid=""   adm=""
   [DISCOVER-GUC] radku=0 total=0 role=null    uid=null pid=null adm=null   ← PÁD
beh4: 0 failed  (všechna tři volání role="system", radku=1)
```

**Ve chvíli pádu jsou všechny čtyři GUC `null` a dotaz vrátí 0 řádků.**
Ve všech ostatních voláních je `role="system"` a vrátí 1 řádek.

Rozlišení `null` vs `""` je tu nosné:

| hodnota | znamená |
|---|---|
| `null` | GUC v té session **nikdy nebyl nastaven** |
| `""` | GUC nastaven **byl** a pak přišel `RESET` |

Řádky 2 a 3 mají `uid/pid/adm = ""` → recyklované spojení po RESETu, na kterém
`SET app.role` proběhl. Řádek s pádem má **všechny čtyři `null`** → je to
session, do které **nedorazil žádný `SET`**.

### 1c) VERDIKT

Routa běží v `runWithServiceContext`, `connect()` tedy `SET app.role='system'`
vydal — ale **dotaz se vykonal na jiné backend session, než na které ten `SET`
proběhl.** Bez `app.role` je `app_is_service()` false, policy `p_events_promoter_scope`
nepustí nic → `radku=0` → test „událost nenalezena".

Tím je vysvětlené to, co §114 nechávalo otevřené: **proč se závod projeví jako
„dotaz nevrátil data".** Není to zděděný cizí GUC (§113 to vyloučila správně) —
je to **chybějící vlastní GUC**.

⚠️ **Co zůstává NEVÍM:** proč se session rozejde. Že `SET` a dotaz skončí na
různých sessionech, je změřené; jestli za to může znovupřipojení uvnitř `pg`,
záměna klienta v poolu, nebo něco třetího, jsem **nezjistil**.

### Vedlejší výsledek: dvojité `release()` to není

Hypotéza „release se volá dvakrát a druhý RESET dorazí do cizí session" byla
testována čítačem (bez round-tripu, tedy bez maskování):

```
beh1-5:  DOUBLE-RELEASE = 0, 0, 0, 0, 0   |   pády: 0,1,1,0,1
```

**Ani jednou** — a pády mezitím pokračovaly. Vyvráceno. Strážka idempotentního
release v kódu zůstává, ale proto, že dvojité release je chyba tak jako tak,
ne proto, že by cokoli řešila.

### Dopad na návrh opravy ze §115

Návrh (nastavit všechny GUC v `connect()` místo úklidu v `release()`) míří
správným směrem — deterministicky nastavit stav na akvizici. **Ale sám o sobě
nemusí stačit**: pokud se dotaz může vykonat na session, kam žádný `SET`
nedorazil, je problém v tom, že `SET` a dotaz nejsou garantovaně na témž
spojení. To by chtělo ověřit dřív, než se produkční cesta změní.

**Implementace bodu 2 NEPROVEDENA** — došel kontext. Body 2c (5 shodných běhů)
a 2d (celá sada 3×) proto **nedoloženy**. R-18 zůstává na řadě.

---

## §117 ✅ VERDIKT R-15: `SET` a dotaz běží na RŮZNÝCH backend PID

### 1a) `pool.query()` místo `client.query()` — VYLOUČENO

```
discover/route.ts        connect=1  db().query=0  client.query=3
artists/[slug]/route.ts  connect=1  db().query=0  client.query=2
events/[id]/alert        connect=3  db().query=0  client.query=2
```

Žádná z těch rout nejde přes pool-level `query()`. (Ta cesta v `RlsAwarePool`
existuje — `if (!ctx) return rawPool.query(…)` — ale uplatní se jen bez kontextu,
a tyhle routy kontext mají.)

### 1b) Chybějící `await` — VYLOUČENO

Všech **8** `SET` v `connect()` je awaitovaných, **0** bez `await`.

### 1d) DEFINITIVNÍ TEST: backend PID při SET vs. při dotazu

Aby se nezměnilo časování (a jev se nemaskoval, §116), zůstal **stejný počet
round-tripů**: `SET x = y` se nahradilo za
`SELECT set_config($1,$2,false), pg_backend_pid()` — jeden dotaz jako předtím,
navíc vrací PID. PID dotazu se přidal jako sloupec do dotazu, který routa
stejně posílá.

```
beh1: 1 failed  setPid=794 queryPid=794  shoda=true   role="system"  radku=1  (3×)
beh2: 1 failed  setPid=778 queryPid=778  shoda=true   role="system"  radku=1
                setPid=778 queryPid=778  shoda=true   role="system"  radku=1
                setPid=778 queryPid=781  shoda=FALSE  role=null      radku=0  ← PÁD
beh3: 0 failed  setPid=772 queryPid=772  shoda=true   (3×)
beh4: 0 failed  setPid=737 queryPid=737  shoda=true   (3×)
```

### 1e) VERDIKT

**`set_config` proběhl na backend session 778, dotaz se vykonal na 781** — na
tomtéž objektu klienta, uvnitř jednoho requestu. Spojení pod klientem se mezi
nastavením GUC a dotazem **vyměnilo**. To je kandidát **(c) — znovupřipojení /
záměna spojení**, ne pool-level query a ne chybějící `await`.

Tím je řetěz uzavřený:

```
spojení se vymění  →  na nové session žádný SET neproběhl  →  všechny 4 GUC null
                   →  app_is_service() false  →  policy nepustí nic  →  0 řádků
                   →  test „událost nenalezena"
```

To vysvětluje i práh u `max=1` ze §114: s jediným spojením se prostě nemá co
zaměnit.

⚠️ **Co NEVÍM:** *proč* se spojení vymění. `POOL-REMOVE` se objevil **2× v každém
běhu — i v těch, které prošly**, a `POOL-ERROR` ani jednou. Odstranění spojení
z poolu tedy samo o sobě pád nezpůsobuje; rozhoduje časování. Jestli za tím
stojí `idleTimeoutMillis: 30000`, Neonem zavřené nečinné spojení, nebo něco
v `pg`, jsem **nezjistil**.

### 2) Oprava NEPROVEDENA — a tvar z zadání pro tuhle příčinu nesedí

Zadání navrhovalo pro reconnect „nastavit GUC v `connect` handleru poolu".
**To by nefungovalo:** `pool.on('connect')` se volá při vzniku *nového* spojení,
kde ještě není znám request-scoped kontext (`app.current_user_id` konkrétního
uživatele). Statické GUC tam nastavit jde, tenant kontext ne.

Co by dávalo smysl (**nenavrženo k nasazení, jen zápis směru**): držet `SET` a
dotaz v jedné transakci (`SET LOCAL`), takže záměna spojení uprostřed skončí
**chybou místo tichého prázdného výsledku**. `RlsAwarePool.query()` to už tak
dělá; rozchází se to jen na cestě `connect()`, kterou si transakci řídí volající.

**Body 2a–2d nesplněny.** Pět shodných běhů ani trojí běh celé sady nedokládám —
oprava neexistuje. R-18 zůstává na řadě.

### Co zůstalo v kódu

`SET x = '<interpolovaná hodnota>'` → `set_config($1, $2, false)`. Počet
round-tripů **stejný**, ale hodnota jde parametrem místo vlepení do SQL.
`pg_backend_pid()` zůstává jako diagnostika. Události poolu (`error`, `remove`)
se logují jen pod `RLS_POOL_DEBUG`.

---

## §118 `idleTimeoutMillis` to není; obě cesty se liší transakcí

### 1a) Celá konfigurace poolu

```
max                     10   (PG_POOL_MAX)
statement_timeout    15000   (PG_STATEMENT_TIMEOUT_MS)
connectionTimeoutMillis 8000
idleTimeoutMillis      30000
maxUses            NENASTAVENO
allowExitOnIdle    NENASTAVENO
keepAlive          NENASTAVENO
```

`end()` navíc dělá `pool = null`, takže po něm vznikne **nový pool** s novými
spojeními — v testech se to ale volá až v `afterAll`.

### 1c) Experiment: `idleTimeoutMillis` 30 s → 600 s

```
2 0 0 1 0   ← idleTimeout=600s, max=10, bez diagnostiky   (3 pády z 50)
```

Baseline byl 3–5 z 50. **Beze změny. Vyhazování nečinných spojení tedy příčina
není** — kandidát vyloučen měřením, ne úvahou.

### 1d) Konfigurace, nebo Neon?

**NEVÍM.** Proti Neonu mluví, že `POOL-ERROR` se neobjevil ani jednou — kdyby
proxy spojení zavřela, `pg` by na tom klientovi chybu vyhodilo. Proti konfiguraci
mluví experiment výše. Zbývající možnost je něco uvnitř `pg` nebo v tom, jak
`Pool` recykluje objekty klientů; **nedohledal jsem to.**

## §119 Obě cesty vedle sebe — a proč sjednocení nejde

### 2a) Rozdíl přesně

| | `RlsAwarePool.query()` | `connect()` |
|---|---|---|
| transakce | `BEGIN` … `COMMIT` uvnitř metody | žádná — otevírá si ji volající |
| rozsah GUC | `SET LOCAL` (transakčně lokální) | `set_config(…, false)` = **session-level** |
| úklid | implicitní koncem transakce | `RESET` při `release()`, asynchronně |
| záměna spojení uprostřed | transakce zmizí → **CHYBA** | GUC zmizí → **tiché prázdno** |

**Jedna cesta selhává hlasitě, druhá tiše.** To je celé jádro R-15 — a je to
vlastnost návrhu, ne náhoda.

### 2b) Sjednocení rozbije volající — změřeno

```
souborů s db().connect():     176
z nich dělá vlastní BEGIN:    161
celkem výskytů BEGIN v src/:  192
```

Kdyby `connect()` vydával klienta s **už otevřenou** transakcí, 161 souborů by
poslalo vnořený `BEGIN`. Postgres na to odpoví `WARNING: there is already a
transaction in progress` — tedy **nespadne**, jen se rozejde sémantika `COMMIT`
(vnitřní commit ukončí celou transakci). To je horší než dnešní stav: tichá
chyba by se vyměnila za jinou tichou chybu, jen širší.

**Sjednocení tedy NEJDE.**

### 2c) Alternativa, která nepotřebuje změnu volajících — NÁVRH

Využít toho, že **161 ze 176 volajících `BEGIN` stejně dělá**: místo nastavování
GUC hned v `connect()` je nastavit **líně, hned po volajícího `BEGIN`** — obalit
`client.query` tak, že když projde `BEGIN`, injektne se
`set_config(…, true)` (tedy **LOCAL**).

| | dnes | návrh |
|---|---|---|
| rozsah GUC | session | transakční |
| round-tripů navíc | — | 0 (jen se přesunou za `BEGIN`) |
| změny call sites | — | 0 |
| záměna spojení | tiché prázdno | **chyba** — transakce na novém spojení neexistuje |
| volající bez `BEGIN` (15 ze 176) | funguje | musel by zůstat na dnešní cestě |

⚠️ **NEIMPLEMENTOVÁNO.** Je to zásah do cesty, kterou používá 176 souborů;
podmínkou nasazení je 5 shodných běhů `public-routes` a trojí běh celé sady.
**Došel mi kontext dřív, než jsem to mohl napsat a ověřit** — a nasadit takovou
změnu bez těch běhů by bylo přesně to, před čím tenhle celý blok varuje.

**2d a 2e tedy NEDOLOŽENY. R-18 zůstává na řadě.**

---

## §120 NAVRH ZE §119 PADA: padajici routy jsou prave ty BEZ BEGIN

Bod 1 zadani (over predpoklady, nez sahnes na 176 souboru) svuj ucel splnil —
navrh se vyvratil driv, nez se ho nekdo dotkl v kodu.

### 1a) Okno mezi connect() a BEGIN: 2 soubory

`my/tickets/[ticketId]/transfer/route.ts`, `tickets/transfer/[token]/route.ts`.
Obojí jsou routy, které jsem obaloval v §98. Malé.

### 1b) Volajici BEZ BEGIN — a mezi nimi VSECHNY tri padajici routy

```
discover/route.ts          BEGIN=0  connect=1
artists/[slug]/route.ts    BEGIN=0  connect=1
events/[id]/alert/route.ts BEGIN=0  connect=3
```

To je rozhodujici. Navrh „injektovat `set_config(…, true)` po volajiciho
`BEGIN`" by tyhle tri routy **nechal beze zmeny** — zadny `BEGIN` neposilaji,
takze by se injektaz nikdy nespustila a zustaly by na session-scoped ceste,
kde se ta flakinessa prave deje.

**Navrh tedy neresi ani jeden ze zmerenych padu.**

Seznam bez `BEGIN`: **14 souboru** metodou „nikde v souboru neni BEGIN";
metodou „po jednotlivem `connect()`" jich vyjde **17** — rozdil delaji soubory,
kde je `BEGIN` jen v nektere z vice vetvi.

| cte (0 zapisovych prikazu) — 8 | zapisuje — 7 |
|---|---|
| `artists/[slug]`, `buyer/fan-bonus`, `carbon-offset-settings`, `discover`, `events/[id]/travel-packages`, `health/db`, `my/orders/[id]/upgrade-options`, `postal-fees` | `admin/events/[id]/box-office` (2), `…/box-office/sessions/[sessionId]` (1), `admin/events/[id]/travel` (1), `…/travel/[packageId]` (2), `editorial/articles/[slug]` (1), `events/[id]/alert` (3), `lib/identity/guest-user.ts` (5) |

### 1c) Cim by se navrh musel doplnit — a proc to neni mechanicke

Pro volajici bez `BEGIN` by `connect()` musel transakci otevrit **sam** a
`release()` ji uzavrit `ROLLBACK`em.

- U **8 ctecich** bezpecne — nic se necommituje, protoze se nic nezapisuje.
- U **7 zapisujicich** nebezpecne: jejich zapisy by se implicitnim `ROLLBACK`
  **zahodily**. Mezi nimi `guest-user.ts`, ktery zaklada uzivatele napric osmi
  cestami, a `events/[id]/alert`, ktery zrovna ted opravujeme.

Rozlisit ctece a zapisovace za behu **nejde spolehlive** — helper nevidi, co
s klientem volajici udela. Slo by to explicitnim priznakem
`db().connect({ readOnly: true })`, ale to uz **je** zmena call sites, tedy
presne to, cemu se navrh chtel vyhnout.

### VERDIKT

Navrh stal na predpokladu, ze drtiva vetsina volajicich `BEGIN` posila
(161 ze 176). To cislo **plati**, ale je **irelevantni** — padaji ti, kdo do
tech 161 nepatri. **Statistika vetsiny nic nerika o tom, kde se chyba deje.**

**Bod 2 zadani jsem NEPROVEDL.** Sahnout na 176 souboru kvuli navrhu, o kterem
je zmereno, ze ani jeden pozorovany pad neopravi, by bylo za nic.
**2c, 2d, 2e NEDOLOZENY** — tentokrat ne proto, ze dosel kontext, ale proto,
ze by ta cisla stejne nic neukazala. **R-18 zustava na rade.**

### Smer dal (zadny nevybran)

1. Explicitni `readOnly` priznak u `connect()` → transakce jen tam, kde je to
   bezpecne. Zmena call sites, ale jen u 8 ctecich.
2. Kontrola PID pri prvnim dotazu — `set_config` uz dnes PID vraci (§117).
   Stoji round-trip navic na pozadavek.
3. Vynutit v dotazu `app.role IS NOT NULL`, aby zamena spojeni **spadla**
   misto vraceni prazdna.

Ktera z nich, **NEVIM** — rozhoduje se mezi cenou round-tripu a rozsahem zmeny
v call sites, a to je rozhodnuti, ne technikalie.

---

## §121 Varianta 3 implementovana — a MERENIM VYVRACENA

### Co je hotovo

`connect()` uz nenastavuje GUC po jednom. `applyGucs()` posle **jeden dotaz**,
ktery vsechny ctyri nastavi, **v temz dotazu je precte zpatky** a vrati
`pg_backend_pid()`. Kdyz se prectene hodnoty nesejdou s kontextem, spojeni se
zahodi (`client.release(true)`) a zkusi se jine; po treti neuspesne akvizici
se vyhodi **chyba**, ne prazdno.

- **1c** — nenastavene GUC se posilaji jako `''`, ne vynechavaji. Overeno
  ve schematu: `app_current_user_id()` je
  `SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid`,
  takze `''` da NULL a zadne 22P02.
- **1d** — `RlsAwarePool.query()` (transakcni cesta) **nezmenena**.
- **1e** — round-trip **nepribyl**: driv 1 dotaz na kazdy GUC v kontextu (1–4),
  ted vzdy 1. U servisniho kontextu je to 1 → 1, u uzivatelskeho 2 → 1.
  ⚠️ Je to tedy **snizeni**, ne shoda — a i snizeni meni casovani, takze zelena
  sada by sama o sobe nebyla dukazem.

### 2a) Pet behu — NESHODNYCH

```
9 passed | 9 passed | 9 passed | 10 passed | 10 passed
```

„9 passed" z deseti znamena **jeden pad**. Tri z peti behu tedy padly.
Kontrolni beh s diagnostikou:

```
beh1: 1 failed | MISMATCH=0 | pad: alert: prihlaseny uzivatel
beh2: 1 failed | MISMATCH=0 | pad: alert: prihlaseny uzivatel
beh3: 0 failed | MISMATCH=0
```

### VERDIKT: oprava neresi R-15, a je jasne proc

**`MISMATCH=0` — kontrola nezabrala ani jednou.** GUC jsou pri akvizici
nastavene spravne; **zamena spojeni nastava az POTOM**, mezi navratem
`connect()` a dotazem, ktery routa posle.

To odpovida mereni ze §117: `setPid=778`, `queryPid=781`. Servisni kontext
nastavuje jediny GUC, takze mezi jeho nastavenim a dotazem **neni zadny dalsi
krok, do ktereho by sla kontrola vlozit**. Overeni pri akvizici principialne
nemuze chytit neco, co se stane po ni.

**Varianta 3 na urovni poolu je tim vyvracena.** Kontrola musi byt v temz
round-tripu jako dotaz volajiciho, ne pred nim — jinak vzdy zbyde okno.

**2b a 2c NEDOLOZENY**: celou sadu 3x jsem nepoustel a vynucenou zamenu
nepredvadel, protoze by se dokladala oprava, o ktere je zmereno, ze nefunguje.

### Co ta zmena PRESTO zavira (jina dira, ne R-15)

Driv `connect()` nastavil **jen ty GUC, ktere byly v kontextu**, a ostatni
nechal byt. Spojeni s cizim zbytkem (§113 videla `app.role='system'`) tedy
mohlo do noveho kontextu propasovat cizi hodnotu, kterou ten kontext neprepisuje.
Ted se **vzdy nastavuji vsechny ctyri** — zbytek po predchozim drziteli uz
propadnout nemuze. To je realne zuzeni, jen neresi flakinessu.

**R-18 zustava na rade.**

---

## §122 VERDIKT proveditelnosti: kontrola v dotazu je KREHKA — R-15 se zaviraNA JAKO RIZIKO

### 1a) Jak by obalka vypadala — a proc zadny tvar nesedi

| tvar | proc nefunguje |
|---|---|
| **CTE guard** `WITH _guard AS (SELECT 1 WHERE current_setting('app.role',true) IS NOT NULL) <dotaz>` | CTE, na ktere se nikdo neodkazuje, se **nevykona** — planovac ho zahodi. Aby se vykonalo, musel by ho puvodni dotaz JOINovat, coz uz meni jeho semantiku. Navic dotaz muze `WITH` uz mit, a pak se musi slucovat. |
| **pripojeni podminky k `WHERE`** | Vyzaduje parsovat SQL. U `INSERT ... VALUES`, `COPY`, DDL a `BEGIN/COMMIT/SET` neni kam pripojit. |
| **dva prikazy v jednom round-tripu** (`SELECT guard; <dotaz>`) | Jde jen v **simple query** protokolu. Jakmile ma dotaz parametry — coz ma vetsina — pouzije se **extended** protokol, ktery vic prikazu v jedne zprave **neumi**. |

### 1b) Co to rozbije

Parametrizovane dotazy (vetsina), `COPY`, DDL, transakcni prikazy
(`BEGIN`/`COMMIT`/`ROLLBACK`/`SET`), pojmenovane prepared statements, kurzory,
`QueryConfig` objekty misto retezce. `RETURNING` by prezilo, ale to je jedina
polozka seznamu.

### 1c) VERDIKT: **prepis poolu, ne hodinova prace**

Aby to bylo bezpecne, musel by pool obsahovat **SQL-aware rewriter** s rozhodovaci
tabulkou pro kazdy typ prikazu a s fallbackem tam, kde se prepsat neda —
a prave ten fallback by okno nechal otevrene, takze by se cil stejne nesplnil.
Riziko rozbiti je vysoke, prinos nejisty.

**NEIMPLEMENTOVANO.** Treti navrh v rade, ktery neprojde — tentokrat uz ve fazi
posouzeni, ne az po zmereni.

## §123 R-15 uzavreno jako ZNAME RIZIKO (ne vyreseno)

### Diagnoza

**Pricina:** backend session se vymeni mezi `set_config` a dotazem. Doloženo
primo: `setPid=778`, `queryPid=781`, tyz objekt klienta, jeden request (§117).
Na nove session zadny `SET` neprobehl → vsechny ctyri GUC `null` (ne `''`) →
`app_is_service()` false → policy nepusti nic → **tiche prazdno**.

**Proc se session vymeni: NEVIM.** Vylouceno merenim: `idleTimeoutMillis`
(600 s nic nezmenilo), dvojite `release()` (citac 0 vyskytu), zdedene cizi GUC
(spina se objevila jen v bezich, ktere prosly), pool-level `query()`
(routy ho nepouzivaji), chybejici `await` (vsech 8 `SET` awaitovanych).
`POOL-ERROR` se neobjevil nikdy, `POOL-REMOVE` 2x v kazdem behu vcetne
prochazejicich.

### Reprodukce

```
max=10, public-routes (10 testu), 5 behu bez diagnostiky → 1-2 pady na beh
```

Tri zasahy, ktere jev MASKUJI (kazdy jen posouva casovani):

```
max=1                        5 behu → 0 padu
afterEach 50 ms              4 behy → 0 padu
diagnosticky round-trip      7 behu → 0 padu
```

### Tri vyvracene opravy

1. **Line `SET LOCAL` po volajiciho `BEGIN`** (§120) — padajici routy
   (`discover`, `artists/[slug]`, `alert`) `BEGIN` vubec neposilaji.
2. **Overeni GUC pri akvizici + retry** (§121) — implementovano, zmereno:
   `MISMATCH=0`, pady pokracuji. Zamena nastava AZ PO akvizici.
3. **Kontrola v dotazu** (§122) — posouzeno jako neproveditelne bez prepisu poolu.

### Dusledek pro produkci

- **Ctecí cesty bez `BEGIN`** (8 rout: `discover`, `artists/[slug]`,
  `travel-packages`, `postal-fees`, `carbon-offset-settings`, `health/db`,
  `buyer/fan-bonus`, `my/orders/[id]/upgrade-options`) mohou **vratit prazdno
  misto dat**. Tise. Uzivatel uvidi „nic nenalezeno".
- **Zapisove cesty** se projevi **hlasite** — bez GUC neprojde `WITH CHECK`
  a padne `42501`. Tam se to nepretece do dat, jen do chyby.
- Produkce zatim **nebezi**; jev je videt na trech routach v testech.

🟡 **Znama vada, ne vyresena.** Kdo na to narazi: symptom je „endpoint vraci
prazdny seznam, po refreshi uz ne".

## §124 Migrace 464: R-18 opraveno, RED→GREEN primym SQL

Sada je flaky (§123), takze dukaz je **primy SQL proti klonu**, ne pocet
zelenych testu.

```
RED (bez 464)
 promoter A (vlastnik faktury)  dunning_log=0  order_reservations=0
 promoter B (CIZI)              dunning_log=0  order_reservations=0
 kupujici                       dunning_log=0  order_reservations=0
 servisni                       dunning_log=2  order_reservations=2

GREEN (s 464), adresne na fakturu promotera A
 promoter A (vlastnik faktury)  dunning_log(A)=1  order_reservations(A)=1
 promoter B (CIZI)              dunning_log(A)=0  order_reservations(A)=0
 kupujici                       dunning_log(A)=0  order_reservations(A)=0
 servisni                       dunning_log(A)=1  order_reservations(A)=1
```

⚠️ Prvni GREEN meril **globalni count** a vypadal jako unik (B vidi 1) — jenze
B ma vlastni fakturu, takze videl **svuj** radek. Chyba byla v meritku, ne
v policy; opraveno na adresny dotaz na fakturu A. Nechavam to zapsane, protoze
globalni count je u izolacnich testu past.

Kupujici vidi 0 **zamerne**: `invoice_orders` nema `user_id`, je to fakturacni
objednavka firmy. Kdo za firmu vidi, resi R-17.

`rls-snapshot.json`: 624 policies, 436 tabulek. Gate prosel (pocet policies se
nemeni — 464 dve existujici prepisuje).

---

## §125 C2 kontrakt cronu — vzor na 3 routach z 9

Seznam z §41 **overen**, vsech 9 rout existuje:
`internal/cron/{seat-upgrade-notify, demand-forecast, verify-event-completion,
bank-sync-fio, onboarding-reminder, consent-log-purge}`,
`internal/resale/complete-transfer`, `internal/order-completed`,
`internal/web-vitals`.

### Tvar, ktery zavadim

```jsonc
{ "ok": failed === 0, "processed": n, "failed": m, "errors": [ "…" ] }
```

HTTP zustava **200** i pri `ok:false` — jedna polozka z tisice nesmi shodit cely
beh, ale signal musi byt v tele, ne ve statusu.

### 🔴 Nalez pri opravovani: `seat-upgrade-notify` hlasil zapis, ktery se nikdy nestal

```js
await client.query(
  `INSERT INTO orders.seat_upgrades (order_id, notified_at, status)
   VALUES ($1, NOW(), 'notified') ON CONFLICT …`,
).catch(() => { /* Table may not exist — best-effort */ });
notified++;
```

Dotaz ma `$1`, ale **pole parametru se nepredavalo vubec**. INSERT proto padal
**vzdy**, `.catch` chybu spolkl a `notified++` se presto provedl. Cron hlasil
`notified: N` pro zapis, ktery neprobehl ani jednou. To je presne trida, kvuli
ktere C2 vzniklo — doplneny parametry i pocitadlo.

### 🔴 A hlubsi vada: routa nikdy nemohla dobehnout

Primy beh proti klonu:

```
[seat-upgrade-notify] 500 {"error":"INTERNAL"}
  → relation "orders.seat_assignments" does not exist
```

`grep seat_assignments` v baseline: **0 vyskytu**. Routa se ptá na tabulku, ktera
ve schematu neni. Selhava **hlasite** (500), takze to neni tichy uspech — ale
znamena to, ze **novy tvar odpovedi se u ni nedal predvest**, protoze se k nemu
beh nedostane. Zapsano jako otevrena vada.

### Dolozeni primym behem (ne vitest sadou jako dukaz, jen jako spoustec)

```
[verify-event-completion] 200 {"ok":false,"processed":0,"failed":1,
                               "errors":["stats query: permission denied for table events"]}
[consent-log-purge]       200 {"ok":true,"processed":0,"failed":0,"errors":[],"purged":0}
[seat-upgrade-notify]     500 {"error":"INTERNAL"}
```

- **`verify-event-completion` ✅ kontrakt overen vynucenym selhanim.** Odebrano
  pravo na `catalog.events`; drive vracela `{ok:true, skipped:true}` — tedy
  „preskoceno", i kdyz se nezpracovalo nic. Ted `ok:false` s duvodem.
  Zaroven prestal byt tichy `catch {}` u zapisu do `audit.anomaly_alerts`.
- **`consent-log-purge` ⚠️ tvar srovnan, ale selhani jsem NEVYNUTIL.** `REVOKE`
  nezabral (prava chodi i pres default privileges) a ani statement-level trigger
  `BEFORE DELETE` beh neshodil — routa vratila `ok:true, purged:0`.
  **NEVIM, cim to je**; vetev `ok:false` u ni tedy tohle kolo **neni predvedena**
  (predvedena byla jinak v §102).
- **`seat-upgrade-notify`** — viz vyse, k tvaru se beh nedostane.

### Stav: **1 z 9 hotovych a overenych**, 2 rozpracovane

| routa | stav |
|---|---|
| `verify-event-completion` | ✅ tvar + vynucene selhani overeno |
| `consent-log-purge` | 🟡 tvar srovnan, `ok:false` neverifikovano |
| `seat-upgrade-notify` | 🟡 tvar + oprava chybejicich parametru; blokuje chybejici tabulka |
| zbylych 6 | ⏭️ neprovedeno — zadani chtelo nejdriv ukazat vzor |

---

## §126 F6/F7 vypnuty — a oprava premisy o foyer

🔧 **Foyer vypnuty NENI.** Zadani predpokladalo, ze existuje vzor „vypnuteho
subsystemu" u foyer; grep ukazuje, ze `admin/events/[id]/foyer-menu` i
`foyer-orders` normalne dotazuji `catalog.foyer_menu_items` a
`orders.foyer_orders`. Zadny vypinac tam neni. Vzorce `*_DISABLED`, ktere
v repu jsou, jsou **obchodni pravidla** (promoter zakazal vraceni), ne
prepinace subsystemu.

**Pouzil jsem mechanismus, ktery v repu opravdu je:** allowlist `ALLOWED_JOBS`
v `app/api/cron/dispatch/route.ts`. Odebranim jmena job zmizi — dispatcher vrati
`422 Unknown job`. Zaroven odebrany zaznamy z `vercel.json` (`crons` 30 → 28).

```
demand-forecast      pise proti jinemu designu tabulky (9 sloupcu nesedi)
seat-upgrade-notify  chybi tabulky, mj. orders.seat_assignments
                     (grep v baseline: 0 vyskytu)
```

Do kontraktu C2 se nezahrnuji — vypnuta routa kontrakt nepotrebuje.
Tikety „dostavet" zustavaji otevrene (R-20, R-21).

## §127 📚 Ucebnicovy priklad tridy: cron hlasil N zapisu, ktere se nestaly

```js
await client.query(
  `INSERT INTO orders.seat_upgrades (order_id, notified_at, status)
   VALUES ($1, NOW(), 'notified')
   ON CONFLICT (order_id) DO UPDATE SET …`,
).catch(() => {
  // Table may not exist — best-effort
});
notified++;
```

Tri vady v peti radcich, kazda sama o sobe stacila:

1. Dotaz ma `$1`, ale **pole parametru se nepredava**. Postgres to odmitne vzdy.
2. `.catch(() => {})` chybu **spolkne** — komentar navic tvrdi jiny duvod
   („tabulka nemusi existovat"), nez ktery ve skutecnosti nastane.
3. `notified++` se provede **bez ohledu na vysledek**.

Vysledek: cron hlasil `notified: N` pro zapis, ktery neprobehl **ani jednou**.
Zadny monitoring by to nechytil — odpoved byla `ok: true` a cislo rostlo.

**Poucení:** tvar odpovedi je jen pulka prace. Druha pulka je otazka, jestli ten
zapis vubec funguje — a ta se nezodpovi ctenim, jen behem.

## §128 🕶️ Skener na tuhle tridu SELHAL self-checkem — nula neplati

Napsal jsem skener hledajici `\.query(\`…$1…\`)` bez pole parametru a pustil ho
na peti routach: **0 nalezu**. Podle §54 nula z nastroje nic neznamena, dokud
se neukaze, ze nastroj tu tridu najit umi — tak jsem ho pustil na
**predfixovou verzi `seat-upgrade-notify`**, kde ta vada prokazatelne byla:

```
[selfcheck] v predfixove verzi nalezeno: 0 -> SKENER SLEPY
```

Druhy pokus (povolena carka pred zaviraci zavorkou) dal totez. Pricinou je moje
**escapovani `$` v shellu**, ne logika vzoru — regex se do `node -e` dostal
zkomoleny.

**Tim padem „0 dotazu bez parametru" u zbylych 5 rout NEPLATI.** Neni to nalez,
je to neuspesne mereni. Zapisuju to takhle a ne jinak, protoze presne tahle
zamena uz v teto praci nastala nekolikrat.

Skener patri do souboru, ne do `node -e` — az se k tomu vratim.

## Stav C2: **1 z 9 overenych, 2 vypnute, 6 nezpracovanych**

| routa | stav |
|---|---|
| `verify-event-completion` | ✅ tvar + vynucene selhani overeno |
| `consent-log-purge` | 🟡 tvar srovnan; vetev `ok:false` **NEOVERENA** (REVOKE ani trigger selhani nevynutily — NEVIM proc) |
| `seat-upgrade-notify` | ⛔ VYPNUTO (F6) |
| `demand-forecast` | ⛔ VYPNUTO (F7) |
| `resale/complete-transfer`, `bank-sync-fio`, `onboarding-reminder`, `order-completed` ×2, `web-vitals` | ⏭️ nezpracovano — dosel kontext |

`onboarding-reminder` uz dnes `sent` i `failed` pocita, chybi jen
`ok: failed === 0` a `errors[]` — je to nejlevnejsi dalsi krok.
`order-completed` ma 954 radku a 7 polykacu chyb; `:462` s `23514` na
`ticket_modular_access_level_check` jsem **neoveroval**.

---

## §129 ✅ R-22: skener prepsan do souboru, SELF-CHECK PROSEL

`scripts/scan-silent-writes.mjs`. Predchozi pokus v `node -e` byl slepy kvuli
escapovani `$` v shellu (§128) — tenhle ma povinny `--selfcheck` proti
predfixove verzi `seat-upgrade-notify`, kde vada prokazatelne byla:

```
[selfcheck] A dotaz bez parametru : 1  (radek 86)
[selfcheck] B catch polykac       : 1  (radek 90)
[selfcheck] C citac bez vazby     : 0
[selfcheck] PROSEL — skener zname vady NAJDE
```

Skener parsuje zavorky (preskakuje template literaly i `${}` interpolace), takze
nezavisi na tom, jestli je za backtickem carka — coz byla puvodni past.

### Vysledek na celem `src/`

```
A_DOTAZ_BEZ_PARAMETRU —  0
B_CATCH_POLYKAC       — 29
C_CITAC_BEZ_VAZBY     —  0
```

**A = 0 je tentokrat NALEZ, ne slepota** — trida „dotaz s `$n` bez pole
parametru" se v repu vyskytovala **jednou jedinkrat**, a ta uz je opravena.

⚠️ **C = 0 NEPLATI.** Heuristika hleda `x++` do 6 radku za polykacem a na znamem
pripade **nezabrala** (citac tam byl o 8 radku dal). Self-check to ukazal a
nechavam to tak — cislo je bezcenne a je oznacene.

### B: 29 polykacu chyb, `file:line`

`admin/commemorative/send:153`, `admin/events/[id]/artists:82`,
`admin/kyc/aml-check:134`, `admin/sales-stream:76,116,146`,
`admin/scanner/validate:469`, `auth/oauth/callback/apple:99`,
`auth/reset-password:117`, `buyer/refund-requests:116`, `dsa/report:75`,
`events/[id]/seats/stream:76`, `hardware/scan:105`, `health/redis:36`,
`internal/cron/charge-installments:170`, `internal/cron/consent-log-purge:43`,
`internal/cron/seat-upgrade-notify:89`, `internal/cron/send-commemorative:52`,
`internal/web-vitals:62`, `mock-qes/[requestId]:116`, `oauth/token:35`,
`resale/purchase/[listingId]:111`, `rfid/scan:103`,
`lib/ai/smart-send-time:97`, `lib/ai/social-post:93`,
`lib/pricing/rules-engine:102`, `lib/rate-limit/per-tenant:66`,
`lib/sdk/tixly-sdk:252`, `lib/vouchers/voucher-pdf:149`

**NEOPRAVENO** dle zadani — je to rozsah, ne verdikt. Ne kazdy polykac je vada:
u `health/redis` nebo `rate-limit` je degradace zamerna. Rozhodnout se to musi
kus po kuse: **polyka se tam chyba ZAPISU, ktery je soucasti ukolu?**
Nejpodezrelejsi jsou `scanner/validate:469`, `hardware/scan:105`, `rfid/scan:103`
a `resale/purchase:111` — tam jde o penize nebo o vstup.

## §130 🔧 Foyer: ZIVA cesta s ROZBITOU vetvi — premisa „vypnuty" byla chybna

### a) Dosazitelny z UI: ANO

```
src/app/admin/events/[id]/EventDetailNav.tsx:85  Foyer menu
src/app/admin/events/[id]/EventDetailNav.tsx:86  Foyer objednávky
src/app/admin/events/[id]/foyer-menu/page.tsx    fetch /api/admin/events/{id}/foyer-menu
```

Polozky v navigaci, vlastni stranky, vlastni fetch. **Neni to mrtvy kod.**

### b) Zmereno na klonu

```
catalog.foyer_menu_items  OK
orders.foyer_orders       OK
orders.foyer_order_items  42P01 relation "orders.foyer_order_items" does not exist
```

`grep foyer_order_items` v baseline: **0 vyskytu**. Pritom
`admin/events/[id]/foyer-orders/route.ts:54` z te tabulky ctе.

### c) VERDIKT: **ziva funkce, jedna vetev rozbita**

| routa | stav |
|---|---|
| `admin/events/[id]/foyer-menu` | tabulka existuje → cesta by mela fungovat |
| `admin/events/[id]/foyer-orders` | hlavni dotaz nad `orders.foyer_orders` projde, ale **poddotaz na polozky spadne na 42P01** |

Je to tataz trida jako `seat-upgrade-notify` (§126): routa se pta na tabulku,
ktera ve schematu neni. Rozdil je, ze foyer je **z UI dosazitelny**, takze to
uzivatel uvidi, zatimco cron by to jen tise zalogoval.

🔧 **Oprava tvrzeni z predchozich kol:** nikde v REMEDIATION jsem netvrdil,
ze foyer je vypnuty — ta premisa prisla v zadani a ja ji v §126 uz jednou
opravil. Tady ji doplnuju o mereni: **neni vypnuty, je castecne rozbity.**
Zapsano jako R-23.

---

## §131 ✅ R-23 foyer: tabulka nikdy neexistovala, skutecny navrh je `items jsonb`

### b) Rozhodnuto podle dukazu, ne uvahy

`git log -S foyer_order_items` nasel **precedens**: commit `aa62538`
„fix(checkout): DISABLE foyer pre-order — schema drift orphan (třída 3)":

> `orders.foyer_orders` má denormalizovaný jsonb `items` tvar (bez user_id/
> buyer_email) a `orders.foyer_order_items` NEEXISTUJE, takže post-commit foyer
> INSERT (:2200/:2211) padal 42703/42P01 AŽ PO COMMITu objednávky (:2128) →
> buyer platí, dostane 500, objednávka drží inventář = orphan pending.

Tedy:
- v `migrations/` (vcetne archivu) `foyer_order_items` **0 vyskytu**,
- katalog potvrzuje `orders.foyer_orders.items jsonb NOT NULL`,
- **zapisova** vetev uz byla ze stejneho duvodu odstranena v cervenci.

**Tohle byl tyz drift na CTECI strane, ktery tehdy nikdo nedohledal.**
Zadnou tabulku jsem si nevymyslel (bod d) — cetl jsem sloupec, ktery existuje.

### a) PEEL: `foyer_order_items` byla JEDINA chybejici vrstva

Po oprave, primy beh obou dotazu proti klonu:

```
PEEL foyer-menu  : OK rows=0
PEEL foyer-orders: OK rows=0
```

Zadne 42P01 ani 42703 pod tim — druha vrstva tam neni.

### c) Oprava: cist `fo.items`, ne neexistujici tabulku

Tvar polozek (`item_name`, `quantity`, `unit_halire`) zustava, meni se jen zdroj.
Mapovani je defenzivni (`item_name ?? name`, `unit_halire ?? unit_price_halire`),
protoze **zapisovatel byl odstranen**, takze kanonicky tvar jsonb neni z ceho
overit — a **hadat ho nebudu**. Migrace neni potreba.

⚠️ Zbyva otevrene: kdyz zapisovatel neexistuje, `foyer-orders` bude vzdy prazdny
seznam. Jestli se ma pre-order dostavet, nebo foyer z `EventDetailNav` odebrat,
je **produktove rozhodnuti** — R-25.

## §132 R-24: ctyri podezrele polykace posouzeny, opraven jeden

| misto | co polyka | verdikt |
|---|---|---|
| `admin/scanner/validate:469` | `fetch(/api/admin/commemorative/send).catch(() => {})` | ✅ **zamerna degradace** — pamětní e-mail je vedlejsi efekt, ne soucast vpustu. Selhani nikoho nepropusti. |
| `hardware/scan:105` | `UPDATE catalog.scanner_devices SET last_seen_at` | ✅ **zamerna degradace** — telemetrie, komentar to i rika („neblokuje odpověď"). Ztraci se jen udaj o zivosti zarizeni. |
| `rfid/scan:103` | `UPDATE catalog.rfid_devices SET last_seen_at` | ✅ **zamerna degradace** — tentyz tvar. |
| `resale/purchase/[listingId]:111` | `catch {}` kolem **inicializace platby** | 🔴 **ticha vada** — objednavka je zalozena a inventar drzi, ale duvod selhani se zahodil uplne. Zadny log, zadne pole v odpovedi. UI videlo jen chybejici `payment_url` a nevedelo proc. |

**Opraven jen ten ctvrty.** Neni to „uspech, ktery nenastal" — objednavka
opravdu vznikla — ale **ztracena pricina**. Doplneno `console.error` a dve pole
v odpovedi: `payment_ok`, `payment_error`. Padat se tam nesmi: objednavka uz
existuje, vyhozeni chyby by z ni udelalo presne ten orphan pending, kvuli
kteremu vznikl commit `aa62538`.

Prvni tri **NEOPRAVENY zamerne** — degradace je tam spravna volba a menit ji by
znamenalo shodit vpust kvuli telemetrii.

---

## §133 Kontrakt cronu: **4 z 9 overenych**, order-completed nezacata

### Dolozeni primym behem, vynucene selhani zapisu

```
[verify-event-completion] 200 {"ok":false,"processed":0,"failed":1,
                               "errors":["stats query: permission denied for table events"]}
[onboarding-reminder]     200 {"ok":false,"processed":0,"failed":1,
                               "errors":["candidates query: permission denied for table promoters"]}
[web-vitals]              200 {"ok":false,"processed":0,"failed":1,
                               "errors":["permission denied for schema marketing | retry: permission denied for schema marketing"]}
[bank-sync-fio]           200 {"ok":true,"processed":0,"failed":0,"errors":[],"results":[]}
[consent-log-purge]       200 {"ok":true,"processed":0,"failed":0,"errors":[],"purged":0}
```

### Nalezene vady typu „zapis, ktery se nikdy nestal"

Skener A nasel jen jeden vyskyt (§129), ale trida C je slepa — tak jsem citace
prosel ocima, jak zadani chtelo. Nasly se **tri dalsi**, kazda jina:

**1. `web-vitals` — INSERT se po zalozeni tabulky NEOPAKOVAL.**

```js
} catch {
  try { await db().query('CREATE TABLE IF NOT EXISTS marketing.web_vitals …'); }
  catch { /* ignore */ }
}
return NextResponse.json({ ok: true });
```

Tabulka se zalozila, ale metrika, kvuli ktere se zakladala, se **zahodila** —
a routa presto vratila `ok: true`. Ztraceny je i **prvni** datovy bod po kazdem
zalozeni. Doplneno `insertVital()` a jeho **zopakovani** po DDL.

**2. `resale/complete-transfer` — vyplata prodejci se nezaradila, `ok:true` presto.**

`INSERT INTO resale.seller_payouts … .catch(err => console.error(…))` —
chyba se zalogovala, ale odpoved tvrdila uspech. Prevod listku probehl,
**vyplata ne**. Padat se tam nesmi (prevod uz je hotovy), takze se stav
propisuje do `ok`/`failed`/`errors`.

**3. `onboarding-reminder` — selhani uvodniho dotazu koncilo 500.**
Ne tichy uspech, ale porusuje pravidlo „cron nesmi 500-ovat". Ted `ok:false`
s duvodem.

**4. `bank-sync-fio` — `results[]` uz per-promoter status nesl**, ale `ok: true`
se vracelo natvrdo. Kdyby selhaly vsechny banky, cron by hlasil uspech.
`ok` se ted z `results` odvozuje.

### Stav

| routa | stav |
|---|---|
| `verify-event-completion` | ✅ tvar + vynucene selhani |
| `onboarding-reminder` | ✅ tvar + vynucene selhani |
| `web-vitals` | ✅ tvar + vynucene selhani + opraveny ztraceny INSERT |
| `resale/complete-transfer` | 🟡 tvar + oprava; selhani **nevynuceno** (vyzaduje realny resale listing) |
| `bank-sync-fio` | 🟡 tvar overen behem; selhani **nevynuceno** (bez FIO credentials `results` prazdne) |
| `consent-log-purge` | 🟡 tvar; vetev `ok:false` **NEOVERENA** (§128) |
| `seat-upgrade-notify`, `demand-forecast` | ⛔ vypnute (F6/F7) |
| `order-completed` (:408, :462) | ⏭️ **NEZACATA** — 954 radku, dle zadani na samostatnou session |

**4 z 9 overenych vynucenym selhanim**, 3 s tvarem bez vynuceni, 2 vypnute.
Bod 2 zadani (`23514` na `ticket_modular_access_level_check`) **neresen** —
je uvnitr `order-completed`, kterou jsem nezacinal.

---

## §134 order-completed: mapa, dve opravene premisy, kontrakt

### 🔧 Premisa „7 polykacu" NEPLATI

Skener (self-checknuty, §129) hlasi v `order-completed` **0 polykacu s prazdnym
telem**. Cislo 7 pochazelo z meho drivejsiho hrubeho `grep -c`, ktery pocital
i `catch(() => undefined)` u `ROLLBACK` — a to polykac neni, to je spravne
osetreny rollback.

**Zadny catch v te route nebyl nemy.** Vsechny logovaly. Vada byla jinde:
**zadny z nich se nepromital do odpovedi.**

### a/c) Mapa — kriticke vs volitelne

| radek | krok | verdikt |
|---|---|---|
| 425 | loyalty award (ROLLBACK+log) | volitelne |
| 447 | fan-bonus (ROLLBACK+log) | volitelne |
| 490 | **modularni pristupy** (ROLLBACK+log) | 🔴 **kriticke** — buyer koupil pass, bez radku nefunguje |
| 520 | **group_invitations** (ROLLBACK+log) | 🔴 **kriticke** — soucast toho, co koupil |
| 559 | **party_split sloty** (ROLLBACK+log) | 🔴 **kriticke** |
| 571 | conversion tracking | volitelne |
| 585 | royalty accrue | volitelne |
| 598 | resale transfer | volitelne |
| 701 | wallet pass | volitelne |
| **706** | **vydani listku + PDF** | 🔴 **NEJKRITICTEJSI** |
| 722 | hlavni transakce — **rethrow** | spravne uz drive |
| 728 | loyalty | volitelne |
| 753 | e-mail | volitelne |
| 835 | forgemsg emit | volitelne |

### b) Citace: `ticketsIssued` byl reportovany, ale bez vazby na `success`

Odpoved znela `{ success: true, ticketsIssued, emailSent, … }` — `success: true`
**natvrdo**, bez ohledu na to, co se nepovedlo.

### 🔴 Dolozeno vynucenym selhanim kritickeho kroku

Odebrano pravo na `tickets.tickets`, pak realny retez objednavky:

```
[order-completed] ticket issue / PDF failed: error: permission denied for table tickets
[order-completed] 200 {"ok":false,"processed":0,"failed":1,
                       "errors":["ticket_issue: permission denied for table tickets"],
                       "degraded":[],"success":false,
                       "emailSent":true,"smsSent":false,…}
```

Vsimni si `emailSent: true` vedle `failed: 1`. **Kupujici dostal potvrzovaci
e-mail, ackoli se nevydal ani jeden listek** — a routa driv vratila
`success: true`. Presne ten „uspech, ktery nenastal", jen o rad drazsi nez
u cronu: tady uz probehla platba.

HTTP zustava **200 zamerne** — 500 by webhook nutil retryovat post-processing
nad uz zaplacenou objednavkou.

## §135 🔧 23514 na `ticket_modular_access_level_check` — premisa NEPLATI

Zadani tvrdilo, ze se vklada `access_level = 'full'`, ktere neni ve vyctu.
**Zmereno gepem, ne uvahou:**

```
CHECK (access_level = ANY (ARRAY['general','premium','vip','backstage','accessibility']))
kod (order-completed:476):  VALUES ($1, $2, $3, 'general')
grep 'full' jako access_level v celem src/:  0 vyskytu
```

Vklada se `'general'`, coz **ve vyctu je**. Hodnota `'full'` se v repu
nevyskytuje vubec — ani v kodu, ani v UI, ani ve schematu.

**Migrace 465 tedy NENI potreba** a hodnotu neni co opravovat. Bud uz byla ta
vada opravena drive, nebo byl puvodni report nepresny. **NEVIM ktere** — hledal
jsem v aktualnim stavu, ne v historii.

⚠️ Co ovsem plati: kdyby ten INSERT z jakehokoli duvodu selhal, **ted uz to
bude videt** — modularni pristupy jsou zarazene mezi kriticke kroky, takze
selhani da `ok:false`, ne tichy log.

---

## §136 ✅ F1: program-booklet smazan — nenarozena funkce, ne mrtva

### a) Co na tom viselo (overeno grepem, ne prevzato)

| misto | stav pri overeni |
|---|---|
| `api/programs/[eventId]/route.ts` | reader, cetl `is_published` + `program_price_halire` **SMAZANO** |
| `api/admin/events/[id]/program/route.ts` | writer, `INSERT … is_published` **SMAZANO** |
| `[locale]/program/[eventId]/page.tsx` | stranka, fetchovala reader **SMAZANO** |
| `backstage/[eventId]/page.tsx:184` | zivy odkaz na tu stranku **ODSTRANEN** (+ nepouzity import `Link`) |
| `checkout/route.ts:2222` | mrtva vetev za early-guardem **SMAZANA** |
| `checkout/route.ts:265` early-guard | **PONECHAN** — pojistka proti primemu API POST, komentar prepsan |
| `checkout/page.tsx` `PROGRAM_PURCHASE_ENABLED` | **PONECHAN** — viz nize |

### b) 🔴 Kritické rozliseni: tabulka ZUSTAVA

`catalog.event_programs` je **rozvrhova/timetable** tabulka:

```
id, event_id, event_day_id, zone_id, starts_at, ends_at,
title, artist_name, description, display_order, created_at
```

Zadny `is_published`, zadny `program_price_halire`. Bookletova funkce se na ni
**omylem napojila**. Tabulku ani `catalog.program_cast_entries` /
`orders.program_purchases` (obe existuji) jsem **nesmazal** — je to schema,
ne kod, a mazani tabulek nebylo v zadani.

⚠️ Overeno, ze **timetable nema zadneho ctenare**: `grep starts_at | grep program`
v `src/` vraci nic. Vsechny ctyri soubory, ktere se `event_programs` dotykaly,
byly bookletove. Timetable je tedy tabulka bez konzumenta — samostatna otazka
(R-27), nesmazal jsem ji ani nedostavel.

### c) Dolozeni

```
tsc --noEmit                     exit 0
odkaz na /program/ z UI          0 souboru
is_published v zivem kodu        0  (zbyle 4 vyskyty jsou KOMENTARE, ktere vysvetluji proc)
program_price_halire v zivem kodu 0  (dtto)
```

`PROGRAM_PURCHASE_ENABLED` zustava v `checkout/page.tsx` vedome: `programInfo`
se uz nikde nenacita, takze blok s checkboxem se **nevykresli**. Odstranit to
JSX by znamenalo prepsat okolni ternar a **jeden pokus o to mi rozbil stranku**
(TS17008, chybejici uzaviraci tag) — vratil jsem to a nechal jako mrtvy kod bez
cesty k vykresleni, s komentarem. Neni to hotove do posledniho radku a rikam to.

---

## §137 ✅ D10 / migrace 465: `lineups.artists.event_id` NULLABLE

### a) Nikdo na `NOT NULL` nespoleha — overeno ctenim vsech ctenaru

`lineups.artists` cte sedm mist: `admin/artists`, `admin/events/[id]/artists`,
`artists/[slug]`, `buyer/artists`, `buyer/following`, `buyer/discover/events`,
`discover`. **Zadny z nich `a.event_id` nepouziva.** Vyskyty `event_id` v tech
souborech patri jinym tabulkam (`catalog.events`, `lineups.event_artists`).
`admin/events/[id]/artists:18` spojuje pres `a.id` a `a.promoter_id`.

Vazba umelce na akci se dela `lineups.event_artists` — `admin/artists:39` uz
dnes pocita `event_count` prave z ni.

### b) RLS drzi i u zaznamu bez akce — ZMERENO

`lineups.artists` ma dve policy a **obe scopuji na `promoter_id`**:

```
artists_public_select  FOR SELECT  (public OR promoter_id = … OR admin)
p_artists_tenant       FOR ALL     (admin OR promoter_id = … OR promoter_id IS NULL)
```

Zadna se `event_id` nedotyka. Zmereno na klonu, ne odvozeno:

```
IZOLACE u zaznamu s event_id IS NULL: vlastni=1 CIZI=0 OK
```

### d) RED→GREEN primym behem (presne INSERT z `admin/artists:62`)

```
RED (bez 465)
 promoter A   INSERT bez event_id: 23502 null value in column "event_id" of relation "artists"
 promoter B   INSERT bez event_id: 23502 …

GREEN (s 465)
 promoter A   INSERT bez event_id: PROSLO
 promoter B   INSERT bez event_id: PROSLO
 IZOLACE u zaznamu s event_id IS NULL: vlastni=1 CIZI=0 OK
```

**PEEL:** pod tim uz zadna dalsi vrstva neni — INSERT pouziva presne ten sloupcovy
seznam, ktery ma routa, a projde cely.

### e) Gate

465 se policies nedotyka (jen nullability), snapshot je proto beze zmeny:
`436 tabulek s RLS`, **gate prosel**.

## §138 ✅ R-28 uzavreno: mrtvy kod bookletu v checkoutu opravdu pryc

Minule se odstraneni nepovedlo (TS17008). Pricina: soubor ma **`\r\n` konce
radku**, takze muj match na `"…) : null}\n"` nesedel a rez padl na spatne misto.

Tentokrat urcen rozsah **poctem zavorek**, ne textovym vzorem — blok
1136–1167. Odstraneno:

- JSX blok s checkboxem (32 radku)
- stavy `addProgram`, `programInfo`
- `if (addProgram && programInfo) body.addProgram = true;`
- **`useEffect` loader, ktery fetchoval `/api/programs/${eventId}`** — tedy
  routu, kterou jsem v §136 smazal. Bez tohohle by stranka po kazdem otevreni
  strilela 404 (tise, `.catch(() => {})`).
- `programTotal` prepocet, konstanta `PROGRAM_PURCHASE_ENABLED`, typ `ProgramInfo`

```
grep 'programInfo|addProgram|PROGRAM_PURCHASE|ProgramInfo' → 0 vyskytu
tsc --noEmit → exit 0
-60 radku
```

🔎 **Co se tim ukazalo:** §136 jsem uzavrel s tvrzenim „blok se nevykresli,
protoze `programInfo` se nenacita". **Nacital se** — loader tam porad byl.
Blok by se vykreslil, kdyby routa odpovedela. Ze nevykreslil, bylo dilem nahody
(routa uz neexistovala), ne navrhu. Tvrzeni bylo spravne ve vysledku a spatne
v oduvodneni.

---

## §139 🔴 R-27 verdikt: NENI to nedostavene — je to KOLIZE JMEN dvou tabulek

### a) Data: nula

Read-only count na **produkcni** vetvi (jedina vec, kterou jsem tam pustil):

```
catalog.event_programs        radku=0
catalog.program_cast_entries  radku=0
orders.program_purchases      radku=0
```

### b) Historie: tabulka BYLA bookletova

`git log -S event_programs` vede na `11c3051 feat(theater): 14 divadelnich
featur -- mig 357-371`, konkretne **`migrations/362_event_programs.sql`**.
Ta migrace vytvorila:

```sql
CREATE TABLE IF NOT EXISTS catalog.event_programs (
  id, event_id UNIQUE, title, about_text, director_note, dramaturg_note,
  running_time_minutes, intermissions, language, content_warnings,
  program_price_halire  INT NOT NULL DEFAULT 0,   -- ← booklet
  cover_image_url, gallery_urls,
  is_published          BOOLEAN NOT NULL DEFAULT false,  -- ← booklet
  created_at, updated_at
);
```

**Kod byl proti migraci 362 SPRAVNY.** `is_published` i `program_price_halire`
tam byly.

### c) VERDIKT: kolize jmen, ne nedostavena funkce

V `000_baseline_20260730.sql` ma `catalog.event_programs` **jiny tvar** —
rozvrhovy (`event_day_id`, `zone_id`, `starts_at`, `ends_at`, `artist_name`,
`display_order`), bez jedineho bookletoveho sloupce.

**Dve ruzne featury si narokovaly tyz nazev tabulky a v baseline vyhrala
rozvrhova.** `CREATE TABLE IF NOT EXISTS` v migraci 362 znamena, ze kdyz uz
tabulka existovala (z te druhe featury), migrace **tise neudelala nic** —
a bookletovy kod pak bezel proti cizimu schematu.

🔧 **Tim se opravuje muj vlastni zaver z §136**, kde jsem napsal „nenarozena
funkce: writer i reader existovaly, schema pod nimi nikdy nevzniklo".
Schema vzniknout **melo** — migrace ho psala. Nevzniklo kvuli `IF NOT EXISTS`
nad obsazenym jmenem. To je jina trida vady: **tichy no-op migrace**, ne
zapomenuty krok.

⚠️ Otazka k rozhodnuti (podklad, ne akce): rozvrhova `event_programs` nema
konzumenta ani po F1. Bud rozvrh dostavet, nebo obe tabulky odepsat. Data
nikde nejsou, takze obe cesty stoji stejne.

## §140 🔴 F1 melo mezeru: admin stranka prezila

Pri F1 jsem smazal API routu `admin/events/[id]/program`, ale **stranku**
`src/app/admin/events/[id]/program/page.tsx` **ne** — a ta byla ziva linkovana
z `EventDetailNav.tsx:56` jako „Digitální program". Fetchovala prave tu smazanou
routu, takze by po kliknuti hlasila chybu.

Odhalilo se to az pri R-27, kdy jsem hledal historii tabulky. **Muj grep v §136
hledal `program/` jen v `src/app/[locale]`**, admin cast jsem neproveril.

Odstraneno (549 radku) + polozka v navigaci. `tsc` 0, odkazu na `}/program`
v adminu **0**.

**Poucení:** kdyz mazu funkci, seznam mist musim brat z routovaci struktury
(`src/app/**`), ne z jednoho podstromu. V §136 jsem dolozil „odkaz na /program/
z UI: 0 souboru" — to cislo bylo spravne pro `[locale]`, ale grep mel byt
nad celym `src/app`.

---

## §141 🔴 `IF NOT EXISTS` jako trida: 362 NENI jedina, je jich 32

### a) Kolik jich v archivu je

366 migraci v `fc95cb2` (archiv):

```
CREATE TABLE IF NOT EXISTS      : 378
ADD COLUMN IF NOT EXISTS        : 256
CREATE INDEX IF NOT EXISTS      : 569
```

### b) Kolik z nich ma v baseline JINY TVAR, nez migrace zamyslela: **32**

Porovnano sloupec po sloupci — sloupce z `CREATE TABLE IF NOT EXISTS` proti
sloupcum teze tabulky v `000_baseline_20260730.sql`:

| migrace | tabulka | chybi sloupcu |
|---|---|---|
| `362_event_programs` | `catalog.event_programs` | **12** (`about_text`, `director_note`, `dramaturg_note`, `running_time_minutes`, …) |
| `437_demand_forecast` | `analytics.demand_forecasts` | **9** (`tickets_sold`, `tickets_total`, `pct_sold`, `forecast_sold`, `forecast_pct`, `demand_score`, …) |
| `367_event_reviews` | `marketing.event_reviews` | 4 (`reviewer_email`, `reviewer_name`, `comment`, `review_token`) |
| `069_event_seats_base` | `catalog.event_seats` | 3 (`row`, `dynamic_price_minor`, `dynamic_price_at`) |
| `090_referral_system` | `referral.credit_wallet` + 3 dalsi | 3+2+1+1 (vsechny `*_czk`) |
| `436_call_center` | `orders.phone_orders` | 2 (`order_id`, `updated_at`) |
| `365_waiting_list` | `orders.waiting_list` | 1 (`position`) |
| `035_cinema_program` | `cinema.*` ×4 | tabulky v baseline **NEJSOU VUBEC** |

### 🔎 Nezavisle potvrzeni F7

`437_demand_forecast` → `analytics.demand_forecasts`, **9 chybejicich sloupcu**.
To je presne symptom, kvuli kteremu jsem v §126 vypnul cron `demand-forecast`
s poznamkou „pise proti jinemu designu tabulky (9 sloupcu nesedi)". **Tehdy jsem
tu pricinu neznal** — bylo to jen pozorovani. Ted je dolozena: tataz trida jako
u 362.

### c) `ADD COLUMN IF NOT EXISTS`: 14 sloupcu v baseline chybi

Nejvyraznejsi je `018_recurring_events` — **6 sloupcu** na `catalog.events`
(`is_recurring`, `recurrence_rule`, `slot_duration_min`, `parent_event_id`,
`recurrence_index`, `recurrence_cancelled`). Cela featura opakovanych akci
tedy stoji na sloupcich, ktere v baseline nejsou.

### ⚠️ Co tenhle sken NEUMI rozlisit

Neshoda **nemusi** znamenat tichy no-op. Mohla vzniknout i tim, ze pozdejsi
migrace sloupec prejmenovala nebo zahodila — u `090_referral_system` to na to
vyslovene vypada (`balance_czk` → pravdepodobne `*_halire`, cely projekt jinde
pocita v halerich), u `069` je `row` rezervovane slovo.

**Je to tedy seznam KANDIDATU, ne potvrzenych vad.** Rozhodnout se da jen
u kazdeho zvlast: existuje pozdejsi migrace, ktera to prejmenovala? Kdyz ne,
je to tichy no-op.

Dva pripady uz **potvrzene jsou** meritelnym chovanim: `362` (§139) a `437`
(F7, cron vypnut). **NEOPRAVOVANO** dle zadani — R-29.

⚠️ False positives, ktere jsem nechal ve vypisu vedome: `450_tickets_dedup_unique`
a `440_prod_schema_reconcile` jsou **nenasazene** migrace z aktualni fronty,
takze jejich sloupce v baseline byt nemaji. Vypis je nefiltruje a rikam to,
misto abych cislo umele snizil.
