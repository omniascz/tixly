
---

## R-12 🔴 24 tabulek s tenant daty nemá žádnou RLS policy (§96)

**Priorita: vysoká, ale NE blokující nasazení.** Na měřených cestách neteče nic —
routy si filtrují samy. Blokující by to bylo, kdyby některá routa filtr neměla.

Rozsah: `orders.{guestlist_entries,press_accreditations,phone_orders,school_bookings,lottery_campaigns}`,
`platform.{promoter_contacts,b2b_transactions,promoter_onboarding,agent_mandates,import_jobs}`,
`catalog.{productions,films,sport_teams,season_pass_products,event_reschedules}`,
`identity.{fan_profiles,eudi_verifications}`,
`communications.{broadcasts,emergency_announcements}`,
`marketing.fan_bonus_issued`, `analytics.yield_rules`,
`pricing.dynamic_pricing_rules`, `brands.event_partnerships`,
`notifications.push_sent_log`.

Postup (jedna migrace na schéma, ne jedna na všechno):
1. Pro každou tabulku zjistit, kdo na ni legitimně sahá — u části je to i kupující
   (`identity.fan_profiles`, `eudi_verifications`), ne jen promotér.
2. Tvar podle vzorce ze §81: `app_is_platform_admin() OR app_is_service()
   OR promoter_id = app_current_promoter_id()`, explicitní `WITH CHECK`.
3. **Izolační test je podmínka nasazení**, ne doplněk — jinak migrace tabulku
   jen otevře jiným způsobem.
4. `rls-verify --snapshot` přegenerovat.

⚠️ Nedělat hromadně `ENABLE ROW LEVEL SECURITY` bez policies — tím se tabulka
pro `tixly_app` uzavře úplně a routy začnou vracet prázdno (přesně §91).

## R-13 ⚪ `events/travel-packages` — chybí filtr na publikovanou akci (§97)

Jednořádková oprava: přidat `JOIN catalog.events e ON e.id = <event_id>
AND e.status = 'published'`. Po §94 routa běží v servisním kontextu, takže
ji RLS nepodrží.

## R-14 ✅ VYŘEŠENO — `events/[id]/alert` (§102–104)

Migrace **460** (servisní větev v `ticket_alerts_select`) + obalení routy
kontextem. Anonym 200, přihlášený 200, anonymní spojení vidí 0 řádků.
⚠️ Návrh `app_current_user_id() IS NULL` byl **zamítnut měřením** — otevřel by
tabulku všem (3 ze 3 cizích e-mailů). Původní popis níže je historický.

## R-14 (původní popis) 🔴 `events/[id]/alert` — 500 pro všechny (§101)

Dvě příčiny, obě doložené:
1. Routa nenastaví kontext → obalit `runWithUserContext` (přihlášený).
2. Anonymní větev `ticket_alerts_select` je po 455 mrtvá
   (`(uuid)::text = ''` nikdy neplatí) → **potřebuje rozhodnutí**: servisní
   kontext (vzorec §94), nebo policy větev na `user_id IS NULL`.

Padá až na `RETURNING token`, ne na zápisu — `WITH CHECK (true)` prochází.

## R-12 upřesnění rozsahu (§100)

20 MECHANICKÝCH (přímý `promoter_id`/`user_id` NOT NULL, jedna migrace, žádná
korelace → §53 se netýká), 2 SLOŽITÉ (`b2b_transactions` až po `b2b_accounts`,
`eudi_verifications`), 2 NEJASNÉ (`films`/`sport_teams` NULL `promoter_id` =
sdílený číselník? — **produktové rozhodnutí**; `fan_bonus_issued`).
7 z 24 v horké cestě, z toho 5 mechanických → cena fakticky nula.

## R-12 ČÁSTEČNĚ VYŘEŠENO — migrace 461 (§106)

19 mechanických tabulek (ne 20 — `fan_bonus_issued` má NULLABLE `user_id`)
dostalo RLS + `p_*_scope`. Izolace ověřena, 0 rozbitých testů, gate prošel.

**Zbývá 5 a všech 5 čeká na ROZHODNUTÍ, ne na kód (§107):**

| tabulka | otevřená otázka |
|---|---|
| `catalog.films`, `catalog.sport_teams` | sdílený číselník je doložený záměr (`promoter_id IS NULL OR = $1`). Ale UPDATE dnes dovoluje **komukoli editovat globální film**, DELETE ne. Je ta editace chyba, nebo funkce? |
| `platform.b2b_transactions` | `b2b_accounts` nemá `promoter_id` — tenant je firma, ne promotér. Řešit jako trojici s `b2b_account_users` + `SECURITY DEFINER` helper (§53 platí). |
| `identity.eudi_verifications` | zápis je anonymní (`user_id` se nevyplňuje), filtrace tokenem → servisní větev jako §94. Má mít uživatel vlastní pohled? Dnes žádná routa taková není. |
| `marketing.fan_bonus_issued` | `user_id` NULLABLE — bonus pro hosta bez účtu, nebo nedodělek? |

## R-15 🟡 UZAVŘENO JAKO ZNÁMÉ RIZIKO — ne vyřešeno (§122–123)

Tři vyvrácené opravy: líné `SET LOCAL` po `BEGIN` (§120), ověření GUC při
akvizici (§121, `MISMATCH=0`), kontrola v dotazu (§122 — vyžadovala by
SQL-aware rewriter v poolu, jehož fallback by okno stejně nechal otevřené).

**Dopad na produkci:** 8 čtecích rout bez `BEGIN` může tiše vrátit prázdno
místo dat (`discover`, `artists/[slug]`, `travel-packages`, `postal-fees`,
`carbon-offset-settings`, `health/db`, `buyer/fan-bonus`,
`my/orders/[id]/upgrade-options`). Zápisové cesty selžou **hlasitě** (42501).
Symptom: „endpoint vrací prázdný seznam, po refreshi už ne."
**Proč se session vymění: NEVÍM.**

### Starší zápis (§120, §121)

**Varianta 3 (ověření GUC při akvizici) implementována a změřena: NEFUNGUJE.**
`MISMATCH=0` — kontrola nezabrala ani jednou, protože GUC jsou při akvizici
správně; záměna spojení nastává **až potom**, mezi návratem `connect()` a dotazem.
Ověření před dotazem principiálně nemůže chytit něco, co se stane po něm.
5 běhů: `9|9|9|10|10` passed z 10 → tři pády.

**Co z toho plyne:** kontrola musí být ve **stejném round-tripu jako dotaz
volajícího**, ne před ním — jinak vždy zbude okno. Jediné dva tvary, které to
splňují: transakce (`SET LOCAL` + dotaz), nebo přidání kontroly do dotazu samotného.
První nejde plošně (§120), druhý znamená sáhnout na dotazy.

### Starší zápis (§120)

Návrh injektovat SET LOCAL po volajícího BEGIN **neřeší ani jeden změřený pád**:
`discover`, `artists/[slug]` i `events/[id]/alert` mají BEGIN=0 — patří mezi 14
volajících, kteří transakci vůbec neotevírají. Statistika 161 ze 176 platí, ale je
irelevantní; padají ti zbylí.
Doplnit to transakcí v `connect()` nejde plošně: z volajících bez BEGIN je
8 čtecích (bezpečné) a **7 zapisujících** (implicitní ROLLBACK by jejich zápisy
zahodil — mezi nimi `guest-user.ts`).
Směry (žádný nevybrán): explicitní `readOnly` u `connect()` / kontrola PID při
prvním dotazu / vynucení `app.role IS NOT NULL` v dotazu.

### Starší zápis (§117–119)

`idleTimeoutMillis` vyloučen měřením (600 s → 3 pády z 50, beze změny).
**Jádro:** `RlsAwarePool.query()` drží `SET LOCAL` + dotaz v transakci → záměna
spojení = CHYBA. `connect()` nastavuje GUC session-level bez transakce → záměna
= TICHÉ PRÁZDNO. Sjednocení nejde: 161 ze 176 volajících si dělá vlastní `BEGIN`,
vnořený `BEGIN` dá jen WARNING a rozbije sémantiku `COMMIT`.

**NÁVRH (0 změn call sites, 0 round-tripů navíc):** nastavovat GUC líně —
obalit `client.query` tak, že po volajícího `BEGIN` se injektne
`set_config(…, true)` (LOCAL). Záměna spojení pak skončí chybou.
Volající bez `BEGIN` (15 ze 176) zůstanou na dnešní cestě.
NEIMPLEMENTOVÁNO — podmínka nasazení: 5 shodných běhů + celá sada 3×.

### Starší zápis (§117)

`setPid=778 queryPid=781 shoda=FALSE role=null radku=0` — přímý důkaz.
Vyloučeno měřením: pool-level `query()`, chybějící `await`, dvojité `release()`,
zděděné cizí GUC. **NEVÍM, proč se spojení vymění** (`POOL-REMOVE` 2× i v běhu,
který prošel; `POOL-ERROR` nikdy).

⚠️ Navrhovaný tvar „GUC v `pool.on('connect')`" **nesedí** — tam ještě není znám
request-scoped kontext. Směr, který dává smysl: držet `SET LOCAL` a dotaz
v jedné transakci, aby záměna spojení skončila **chybou místo tichého prázdna**.
`RlsAwarePool.query()` to už dělá; rozchází se cesta `connect()`.
NEIMPLEMENTOVÁNO.

### Starší zápis (§116)

Ve chvíli pádu jsou **všechny čtyři GUC `null`** (= v té session nikdy nebyly
nastavené) a dotaz vrátí 0 řádků; jinak `role="system"` a 1 řádek.
**Dotaz se vykonal na jiné backend session než `SET`.** Bez `app.role` je
`app_is_service()` false → policy nepustí nic.
Není to zděděný cizí GUC, je to **chybějící vlastní GUC**.
Dvojité `release()` vyvráceno čítačem (0 výskytů, pády pokračovaly).
⚠️ Návrh ze §115 (nastavit GUC v `connect()`) míří správně, ale **nemusí stačit** —
jádro je, že `SET` a dotaz nejsou garantovaně na témž spojení. Ověřit dřív,
než se produkční cesta změní. NEVÍM, proč se session rozejde.

### Starší zápis (§114–115)

Doloženo maticí: `max=1` → 0 pádů z 50; `max=2/5/20` → 3–5 z 50. Práh, ne
gradient. `afterEach` 50 ms → 0 z 40. Závod je ve vracení spojení, ne v routě.

**Oprava `await release()` je mimo rozsah: 218 call sites ve 180 souborech.**

**Navržený tvar bez změn call sites:** přesunout čištění GUC z `release()`
(fire-and-forget) do `connect()` (awaitovaná cesta) — `connect()` by vždy
nastavil všechny čtyři GUC, z kontextu nebo na prázdno.
NEIMPLEMENTOVÁNO. Podmínka nasazení: 5 shodných běhů bez diagnostiky, `max=10`.

### Starší zápis (§113)

**Hypotéza o špinavém spojení VYVRÁCENA:** špinavá spojení existují (3 ze 7 běhů),
ale RESET neselhal nikdy a **každý běh se špínou prošel** — korelace není.
**Nové zjištění:** přidání jediného round-tripu mezi `pool.connect()` a první
`SET` pády VYPNE (7 běhů 0 pádů vs 4 běhy bez něj → 2 padly). Podpis časovacího
závodu. Konkrétní závod nelokalizován. Kandidát: `release()` se tváří synchronně,
ale `originalRelease` běží až v `.finally()` po RESETu — volající pokračuje dřív,
než je spojení vrácené. NEOVĚŘENO.
Zásah do `release()` jsem neudělal: měnit semantiku vracení spojení v produkční
cestě na základě vyvrácené hypotézy je horší než flakinessa.

### Starší zápis (§108, §112)

**Aktualizace po 8 běžích:** 5 z 8 běhů `public-routes` mělo aspoň jeden pád
(0–2 z 10), pokaždé jinde. Flaky je i `checkout-guest`. Vyloučeno měřením:
souběh souborů/testů, rate limit, přežívající servisní kontext.
NEOVĚŘENO: závislost na pořadí (`--sequence.shuffle`).
**Nejsilnější podezřelý** (hypotéza, neměřeno): `rls-pool.ts:193` vrací
spojení do poolu s RESET GUC běžícím fire-and-forget a chybou spolknutou
`.catch(() => undefined)` — špinavé spojení by dalšímu testu podstrčilo cizí
`app.current_user_id`.
Ověření: číst `current_setting('app.current_user_id', true)` při akvizici
a hlásit každý nenulový výskyt.

### Původní zápis (§108)

6 běhů `public-routes` se stejným kódem: 2 pády, **pokaždé jiný test**
(`alert: prihlaseny uzivatel`, `discover … min_price`), při opakování projdou.
Regrese z policy by padala deterministicky a na témž testu. Dokud se to
nevyřeší, „X ze Y padlo" není spolehlivé referenční číslo.

## R-16 `admin/collections/[id]/events` — zápisová stráž přijímá sdílené (§108)

`ensureCollectionOwner` pouští POST i na kolekce s `promoter_id IS NULL`.
Táž třída jako films/sport_teams; tabulka `catalog.event_collections` je mimo
462. Rozhodnout stejně jako u číselníku a opravit kód + policy naráz.

## R-17 b2b trojice — čeká na rozhodnutí A vs B (§109)

Celá trojice (`b2b_accounts`, `b2b_transactions`, `b2b_account_users`) je mimo
RLS. Identita B2B uživatele NENÍ `app.current_user_id` — autorizace jde přes
`verifyB2BToken` → `session.b2bAccountId`.
**A** = jen servisní větev (nic se neizoluje navíc, jen zavře cizí kontexty).
**B** = nové GUC `app.b2b_account_id` + helper → skutečná izolace, ale dotkne se
`rls-pool` i tokenové cesty.

## R-17 ⏭️ TIKET: b2b varianta B — `app.b2b_account_id` + DEFINER helper

463 (varianta A) zavřela b2b trojici před cizími kontexty, ale **izolaci mezi
firmami nezavedla** — ta zůstává na aplikačním scopingu (`session.b2bAccountId`
z `verifyB2BToken`). Zapomenutý `WHERE account_id` v budoucí routě = firma A vidí
transakce firmy B, a databáze to nezachytí. Je to týž vzorec, kvůli kterému
vznikla 461: aplikační `WHERE` jako jediná vrstva.

Co by B obnášelo:
1. `rls-pool`: nový kontext `runWithB2BContext(accountId, …)` → `SET app.b2b_account_id`.
2. `verifyB2BToken` → routy obalit tímhle kontextem místo servisního.
3. Helper `app_current_b2b_account_id()` — `SECURITY DEFINER`,
   `SET search_path = pg_catalog, public`, vrací uuid (§51).
4. Policies: `account_id = public.app_current_b2b_account_id()` jako další větev.

Riziko střední: dotkne se poolu i tokenové cesty; chyba zavře B2B portál úplně.
Podmínka nasazení: izolační test firma A vs firma B, jinak migrace jen mění tvar.

## R-18 ✅ VYŘEŠENO migrací 464 (§124)

RED: promotér-vlastník viděl 0. GREEN: vidí 1, cizí promotér 0, kupující 0
(záměrně — `invoice_orders` nemá `user_id`). Doloženo přímým SQL, ne testy.

### Původní zápis (§110)

`p_rls_dunning_log` a `p_rls_order_reservations` dělají
`EXISTS (… FROM orders.orders o_ WHERE o_.id = <tbl>.order_id …)`, ale
`order_id` je FK do `b2b_orders.invoice_orders`. Změřeno: promotér, který
fakturu vystavil, na svůj dunning log **nevidí** (0 řádků); vidí jen
platform admin a servis. Fail-closed — nedostupná funkce, ne únik.
Oprava = přepsat korelaci na `b2b_orders.invoice_orders`.

## R-19 ⚠️ 191 sloupců v policies BEZ cizího klíče — neověřitelné (§110)

258 sloupců s tenant-jménem nemá FK; 191 z nich se objevuje v nějaké policy.
U těch se z katalogu **nedá** ověřit, že míří tam, kam si policy myslí.
Kdyby mířil jinam: mrtvá větev (jako R-18), nebo — při kolizi ID prostorů —
tichá díra. Ověřit jde jen čtením zapisujícího kódu, tabulku po tabulce.

## R-20 ⛔ `seat-upgrade-notify` vypnuto — dostavet subsystem (§126)

Chybi tabulky, mj. `orders.seat_assignments` (0 vyskytu v baseline). Odebrano
z `ALLOWED_JOBS` i z `vercel.json`. Tiket zustava otevreny.

## R-21 ⛔ `demand-forecast` vypnuto — sladit se schematem (§126)

Pise proti jinemu designu tabulky (9 sloupcu nesedi). Odebrano z `ALLOWED_JOBS`
i z `vercel.json`. Tiket zustava otevreny.

## R-22 🕶️ Skener „dotaz s $1 bez parametru" je slepy (§128)

Self-check na predfixove verzi vratil 0 tam, kde vada prokazatelne byla.
Vysledek „0 nalezu" u 5 rout tedy NEPLATI. Prepsat do souboru (ne `node -e`,
kde se rozbije escapovani `$`) a znovu self-checknout, nez se cislo pouzije.

## R-23 🔴 `foyer-orders` cte tabulku, ktera neexistuje (§130)

`orders.foyer_order_items` neni v baseline (0 vyskytu), ale
`admin/events/[id]/foyer-orders/route.ts:54` z ni cte → 42P01.
Foyer JE dosazitelny z UI (polozky v `EventDetailNav`, vlastni stranky),
takze to uvidi uzivatel, ne jen log. Bud tabulku doplnit, nebo poddotaz odstranit.

## R-24 🕶️ 29 polykacu chyb v `src/` (§129)

`node scripts/scan-silent-writes.mjs --root=src` (self-check prosel).
Ne kazdy je vada — u `health/redis` nebo `rate-limit` je degradace zamerna.
Rozhodnout kus po kuse: polyka se tam chyba ZAPISU, ktery je soucasti ukolu?
Nejpodezrelejsi: `scanner/validate:469`, `hardware/scan:105`, `rfid/scan:103`,
`resale/purchase/[listingId]:111` — penize a vstup.
⚠️ Trida C (citac bez vazby na vysledek) je v skeneru SLEPA — self-check ji na
znamem pripade nenasel. Cislo 0 u ni NEPLATI.

## R-25 ⏭️ Foyer pre-order nema zapisovatele — produktove rozhodnuti (§131)

Cteci strana opravena (cte `orders.foyer_orders.items jsonb`), ale zapisova
vetev byla odstranena uz v `aa62538`. `foyer-orders` proto bude vzdy vracet
prazdny seznam. Bud pre-order dostavet, nebo foyer odebrat z `EventDetailNav`.

## R-26 ⏭️ Program-booklet: znovuzavedeni = nova funkce od nuly (§136)

Smazano F1. Nebyl to drift k oprave, ale nenarozena funkce — writer i reader
existovaly, schema pod nimi nikdy nevzniklo. Kdyby se mel booklet delat,
zacina se navrhem schematu, ne obnovou kodu.

## R-27 🟡 `event_programs`: KOLIZE JMEN dvou featur (§139)

Migrace 362 vytvarela BOOKLETOVOU tabulku (`is_published`, `program_price_halire`),
ale `CREATE TABLE IF NOT EXISTS` nad uz obsazenym jmenem **tise neudelal nic** —
v baseline zustala ROZVRHOVA verze jine featury. Kod byl proti 362 spravny.
Data: 0 radku ve vsech trech tabulkach (overeno read-only na produkci).
Rozhodnout: rozvrh dostavet, nebo obe odepsat. Obe cesty stoji stejne.

### Puvodni zapis (§136)

Po smazani bookletu na tu tabulku nesaha zadny kod. Bud rozvrh dostavet
(je to smysluplna funkce), nebo tabulku odepsat. Nesmazal jsem ji — je to
schema a mazani tabulek nebylo v zadani.

## R-28 ✅ VYRESENO (§138) — blok, stavy, loader i typ odstraneny, tsc 0

### Puvodni zapis (§136)

Checkbox digitalniho programu se nevykresli (`programInfo` se nenacita), ale JSX
tam zustalo — pokus o odstraneni rozbil okolni ternar (TS17008) a byl vracen.
Odstranit pri pristim doteku toho souboru.

## R-29 🔴 32 migraci s `IF NOT EXISTS`, jejichz tvar v baseline nesedi (§141)

Trida „tichy no-op": `CREATE TABLE IF NOT EXISTS` nad uz obsazenym jmenem
neudela nic a kod pak bezi proti cizimu schematu.
**Potvrzene chovanim:** `362_event_programs` (§139), `437_demand_forecast`
(cron vypnut ve F7 pro „9 sloupcu nesedi" — ted zname pricinu).
**Kandidati:** `367_event_reviews` (4), `069_event_seats_base` (3),
`090_referral_system` (7 celkem, pravdepodobne prejmenovani `_czk`→`_halire`),
`436_call_center` (2), `365_waiting_list` (1), `035_cinema_program`
(4 tabulky v baseline vubec nejsou), `018_recurring_events` (6 sloupcu
na `catalog.events`).
Sken NEUMI odlisit tichy no-op od pozdejsiho prejmenovani — rozhodnout se musi
kus po kuse. Reprodukce: viz §141.

## R-30 🔴 ZMĚŘENO: 4 ze 4 zapisovaných tabulek jsou tiše rozbité (§145–146)

`platform.payouts`, `platform.payout_settings`, `compliance.e_signatures`,
`identity.oauth_accounts` — servisní `UPDATE` vrací `rowCount=0` **bez chyby**.
Doporučení per tabulka viz §146; `e_signatures` má být jen `FOR INSERT`
(podpis je důkaz, nesmí jít přepsat).
⚠️ `lib/payouts/executor.ts` navíc běží **bez kontextu** — i po opravě policy
by mu zápis neprošel.
**Čeká na rozhodnutí, migrace nenapsána.**

### Původní zápis (§144)

`compliance.e_signatures`, `identity.oauth_accounts`, `payments.wero_payments`,
`payments.wero_webhooks`, `platform.event_settlements`, `platform.payout_events`,
`platform.payout_settings`, `platform.payouts`.
**5 z nich má v kódu zapisovatele**, `platform.payouts` čtyři — peníze.
Mechanismus prokázán na `rolling_reserves` (D4: `rowCount 0` bez chyby),
u těchto 5 **NEZMĚŘENO**.
Rozhodnout per tabulka: kdo smí zapisovat — jen servisní cesta, nebo i platform
admin? U peněžních tabulek je to produktová otázka, ne technická.

## R-31 ✅ VYŘEŠENO migrací 468 (§148) — 6 z 6 přechodů projde

### Původní zápis (§147)

```
CHECK (status = ANY (ARRAY['pending','approved','paid','failed','cancelled']))
executor.ts: 'processing' na 3 mistech — prvni prechod pending → processing
```
Dřív to schovávala RLS (`rowCount=0` **před** kontrolou CHECKu). Oprava R-30
vadu **odkryla**. Doporučení dle vzorce D4 (enum nerozšiřovat): zmapovat na
`'approved'`. **Rozhodnutí, ne technikálie — čeká.**

## R-32 3 duplicitni CHECK constrainty + 15 duplicitnich indexu (§152)

Stopa po opakovanem spusteni migraci (tataz trida jako §141).
**Constrainty** — uklid bezpecny: zadne jmeno se v kodu nepouziva za behu
(jediny vyskyt `chk_resale_face_value_enforcement` je KOMENTAR
v `buyer/resale/list/route.ts:21`), `ON CONSTRAINT` nikde.
**Indexy — NE plosne.** Vetsina dvojic je `xxx_key` (index za UNIQUE constraintem)
+ `idx_xxx` (rucni). Zahodit `_key` = zahodit unikatnost tokenu
(`gift_claims`, `ticket_transfers`, `api_keys`). Bezpecna je jen rucni polovina,
a to per dvojici.
Cislo 15 je DOLNI ODHAD — sken neodhali indexy s jinym poradim sloupcu.

## R-33 `catalog.seat_maps` NEEXISTUJE, ale `my/orders/[id]/upgrade-options` z ni cte (§153)

`42P01`. V baseline zadna `catalog.seat_maps`; existuji `event_seats`, `seats`,
`venue_seating_charts`, `seat_view_photos`. Konzument je jediny — tahle routa.
Tataz trida jako `foyer_order_items` (§130) a `seat_assignments` (§126).
Rozhodnout: zalozit tabulku, nebo dotaz prepsat na `venue_seating_charts`?
Bez rozhodnuti by se hadalo schema. NEOPRAVENO.

## R-34 34 odkazu na neexistujici tabulky; 22 skutecne chybi (§154)

`node scripts/scan-missing-tables.mjs --root=src` (self-check prosel na
`seat_maps` i `foyer_order_items`).
**12x spatny prefix** — oprava jednoslovna, bez migrace (`identity.promoters` ->
`platform.promoters`, `platform.audit_log` -> `audit.audit_log`, `auth.users` ->
`identity.users` = zbytek po Supabase, ...).
**22x tabulka neexistuje nikde** — `seat_assignments`, `seat_maps`,
`seat_map_entries`, `foyer_order_items`, `price_tiers`, `ticket_scans`,
`payment_attempts`, `affiliate_*`, ...
Nejvetsi koncentrace v `src/lib/reports/*` (~18), a ten modul JE dosazitelny
(`admin/reports/run` + stranka `admin/reports/inhouse`).
Rozhodnout per tabulka: prefix / dostavet / odepsat report.

## R-35 24 ze 198 reportu dnes spadne na 42P01 (§156)

Modul `src/lib/reports/*` je dosazitelny (`admin/reports/run` + stranka
`admin/reports/inhouse`). 24 definic saha na tabulku, ktera neexistuje.
Scoping je v poradku — zadny report nebezi bez tenant filtru (21 je
`scope: 'platform'` a routa je hlida, 10 deleguje na `helpers.ts`).
Rozhodnout per report: dostavet tabulku, prepsat dotaz, nebo report odepsat.

## R-36 Sken neexistujicich tabulek mel slepe misto: schema `public` (§155)

`SCHEMAS` v `scan-missing-tables.mjs` neobsahoval `public`, takze
`public.scan_logs`, `public.resale_listings`, `public.foyer_orders` a dalsich
~12 jmen propadlo. Cislo 34 bylo PODHODNOCENE. Doplnit `public` a prescanovat.

## R-35 aktualizace: 15 (bylo 24) reportu spadne (§158)

Devet se opravilo srovnanim prefixu. Zbylych 15 stoji na tabulkach, ktere
neexistuji nikde.

## R-37 `udalosti_resell` ma spravny prefix, ale spatny sloupec (§157)

Po `public.resale_listings -> orders.resale_listings` dotaz porad pouziva
`re.price_halire`; tabulka ma `listing_price_halire` / `original_price_halire`.
Ktery z nich je "trzba z resale", je rozhodnuti. NEOPRAVENO.

## R-38 Roztrideni chybejicich tabulek nejde automatizovat (§159)

Dva klasifikatory (podobnost jmen, prekryv sloupcu) selhaly self-checkem —
1 ze 3 znamych pripadu. Duvod: spravna nahrada muze byt SLOUPEC na jine tabulce
(`foyer_orders.items jsonb`), ne jina tabulka.
Co plati: z 26 chybejicich je **17 vyhradne v `src/lib/reports/*`**. Odepsani
rozbitych reportu (R-35) by odstranilo dve tretiny problemu bez migrace.
Zbylych 9 je v routach a chce rozhodnuti per pripad.

## R-37 15 reportu ceka na tabulky (§160)

Vyrazeno z registru pres `DISABLED_REPORTS` v `src/lib/reports/registry.ts`
(mechanismus jako `ALLOWED_JOBS` u cronu). Definice v kodu ZUSTALY.
| report | chybi |
|---|---|
| `zakaznici_verified_fan` | `marketing.verified_fan_registrations` |
| `marketing_meta_pixel` | `analytics.pixel_events` |
| `marketing_broadcast_results` | `marketing.crm_broadcasts` |
| `marketing_access_codes_pouziti` | `marketing.access_code_groups` |
| `marketing_rsvp_dle_akce` | `marketing.rsvp_registrations` |
| `marketing_guestlist_bulk` | `public.guest_list_entries` |
| `marketing_affiliate_partner` | `marketing.affiliate_commissions/_events/_partners` |
| `ops_foyer_preorders` | `public.foyer_order_items` |
| `ops_commemmorative` | `public.commemorative_tickets` |
| `platform_onboarding_wizard` | `platform.onboarding_wizards` |
| `platform_mrr` | `platform.subscription_payments` |
| `udalosti_lottery` | `marketing.lottery_winners` |
| `platform_error_rate` | `orders.payment_attempts` |
| `marketing_access_codes` | `marketing.access_code_usages` |
| `ops_scan_duplicit` | `tickets.ticket_scans` |

## R-39 Tri moduly s chybejicimi tabulkami — NEVIM (§161)

`lib/forgemsg/dispatch.ts` (`public.forgemsg_credentials`),
`lib/pricing/resolve-price.ts` (`pricing.price_tiers`),
`my/orders/[id]/upgrade-options` (`catalog.seat_maps`, `seat_map_entries`).
`lib/ai/smart-send-time.ts` (`marketing.email_opens`,
`campaign_recipient_events`) je podle vseho nedostaveny subsystem.

## R-40 `tickets/transfer/[token]` vraci 404 i po oprave sloupce (§162)

`tr.token` -> `tr.transfer_token` opraveno (42703 pryc), ale GET dal vraci
`404 NOT_FOUND` a POST `500`, ackoli radek v `orders.ticket_transfers` existuje.
Dotaz ma pet JOINu (tickets, orders, events, venues, ticket_types) — nektery
radek zahazuje. Nedohledano.
