
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
