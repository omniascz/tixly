
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

## R-15 🔴 NEVYŘEŠENO — vyvráceny UŽ DVA návrhy (§120, §121)

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

## R-18 🟡 Dvě policy korelují proti špatné tabulce — mrtvé, ne děravé (§110)

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
