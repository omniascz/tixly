# STAV — 2026-08-13 (cti nejdriv tohle)

Tenhle soubor je **hlavni zdroj kontinuity**. Da se z nej pokracovat bez
konverzace, ve ktere vznikl. Detaily nalezu jsou v `FINDINGS_RLS.md` (paragrafy
§1–§201); tady je jen to, co je hotove, co je otevrene a cim zacit.

⚠️ Tenhle soubor je ten v `nextjs-boilerplate/`. V korenu repa lezi starsi
`REMEDIATION.md` (STAV 2026-07-29), ktery je **neaktualni** — needituj ho.

## Jak se v tomhle projektu meri

* Vsechno se meri na **ephemeral Neon vetvi** (`tests/helpers/live-fixture.ts`,
  `scripts/baseline-clone.mjs`). Produkcni vetev je prazdna a **nesahá se na ni**.
* Handlery bezi jako **`tixly_app`** (`BYPASSRLS=false`). Pod `neondb_owner` je
  596 policies inertnich a mereni nic neznamena.
* Klon **musi** chtit `pooled=false`. Na `-pooler` endpointu se backend
  prideluje **per transakci**, takze GUC nastavene mimo transakci nezustanou
  u volajiciho a mezi mereními se michaji (§188, upresneno v §191).
  ⚠️ §188 psalo „vsechna spojeni sdili JEDEN backend" — to plati jen pri
  sekvencnim pouziti. Zmereno pri souběhu: 2 klienti -> 2 backendy,
  10 klientu -> 8 az 10 backendu (§191). Zaver §188 tim nepada, mechanismus
  je ale prirazovani per transakci, ne jediny sdileny backend.
* GUC se nastavuji **`SET LOCAL` v transakci**, nikdy holym `SET` (R-54).
* RED->GREEN se meri na klonu **bez** testovane migrace:
  `createLiveClone(label, { exclude: ['471'] })` (§190).
* Nastroj bez self-checku nic netvrdi (§54). Nula z nej neznamena nulu v repu.
* Seznam k auditu se bere ze **struktury** (routovaci strom, `pg_policies`,
  katalog), nikdy z dokumentu (§177).
* Kdyz mereni rekne „vlastni nevidi" nebo „vidi cizi", **prvni hypoteza je
  neuplny seed**, ne vada RLS (§183, §184c).

## Zamcena rozhodnuti (neprehodnocovat bez pokynu)

1. Produkcni `DATABASE_URL` bude pouzivat **`tixly_app`**, ne `neondb_owner`.
   Nastavuje se rucne ve Vercelu. **Deploy requirement.**
2. Verejne routy dostanou **servisni kontext**, ne `USING (true)` v policy.
3. Policies se opravuji na **`app_*()` helpery**, ne obchazenim v rls-poolu.
4. `communications` a `brands` dostanou granty (nejsou mrtve).
5. Kanaly se **rozlisuji**, nesjednocuji (reporting by se zpetne nerozdelil).
6. `base64url` prislo v PostgreSQL **19**, ne 18. Nikde neopravovat na 18.

## Hotovo a overene chovanim

| oblast | stav |
|---|---|
| RLS izolace promoter-dimenze | 64 vzorcu z 596 policies zmereno (§53) |
| RLS izolace buyer-dimenze | 19 tvaru pokryvajicich 93 policies, 0 uniku (§184) |
| migrace 455 | 9 z 20 policies overeno chovanim, 0 uniku (§180) |
| dynamicke SQL | 257 dotazu, 30 z uzivatelskeho vstupu, **0 zranitelnych** (§178) |
| souběh (harness A–E) | 5/5, vc. purchase-limit race po oprave (§174) |
| crony | 46 rout doauditovano ze struktury, 7 porusení opraveno (§175) |
| reporty | 198 definic, 152 aktivnich; 46 vyrazeno (15 tabulka + 31 sloupec) |
| T4 triage HIGH | 7 ze 7 skutecnych, 0 false positive (§181) |
| migrace 470, 471 | RED->GREEN spravnou metodou (§190) |

## Otevrene tikety — poradi, ve kterem bych pokracoval

0. **R-56** ✅ OPRAVENO dvema pooly (§192 kandidat b) — `connect()` jde na primy
   endpoint, `query()` na poolovany. Dolozeno 0/60 na obou cestach, self-check
   56/60 (pri navratu na pooler zase pada). Ziva sada 2x = ta znama ctverice,
   nic noveho. Env: `PG_DIRECT_POOL_MAX=4`, `PG_DIRECT_IDLE_TIMEOUT_MS=10000`.
   Deploy requirements v `db/ONSALE-PLAYBOOK.md` §1b a `GO-LIVE-CHECKLIST.md`.
   **ZBYVA POTVRDIT:** jestli prod `DATABASE_URL` opravdu miri na `-pooler`
   (sifrovane ve Vercelu, nikdo to od te doby necetl). Kdyz je prime, oprava
   nic nemeni a jen ubere sloty — pak snizit `PG_DIRECT_POOL_MAX` netreba.

### Puvodni zapis (vada)

0. **R-56** 🔴 `connect()` na poolovanem endpointu bezi pod CIZIM kontextem.
   Zmereno na realnem kodu (§191): POOLED 59/60 spatne (37 prazdno, 22 cizi
   uzivatel), DIRECT 0/60. Staci **2 soubezne requesty**. Tyka se 206 volani
   `db().connect()` ve 176 souborech; `db().query()` (666x) je bezpecne.
   **Blokuje to jedina neznama: jestli prod `DATABASE_URL` opravdu miri na
   `-pooler`.** `GO-LIVE-CHECKLIST.md:135` rika ze ano, ale hodnota je ve
   Vercelu sifrovana a NEOVERIL jsem ji. Cesty ven jsou **zmerene** (§192):
   proveditelne a) i b), **b) levneji**; c) nedoporucuji. Dopad ohranicen
   vzorkem 10 rout (§193): **0 z 10 by vydalo cizi data**, projev je
   fail-closed. R-57 (spici `SET LOCAL`) je **VYRESENY** (§195).
   **Pripraveno k implementaci (b)** — §194 ma zmerene rozpocty:
   direct pool `max=4`, `idleTimeoutMillis=10000` (855 slotu / 4 = 213 instanci);
   pooled pool nechat 10 / 30000. Strop je SPOLECNY (dolozeno: pooler drzel
   36 backendu a direct se dostal jen na 854 misto 890), ale pooled spojeni
   stoji ~1/9 backendu, takze direct je ten, ktery se musi skrbit.
   NEIMPLEMENTOVANO — dosla kapacita session, ne rozhodnuti.
1. **R-15** flakiness zive sady. Pooler byl *cast* pricin. **Domereno (§191):
   5 behu na `pooled=false` -> pada VZDY TYZ test** (`checkout-guest > velka
   pismena v e-mailu`, 2 z 5 behu, nikdy zadny jiny). §108 „pokazde jiny test"
   platilo jen na pooleru. Zbyla pricina je tim zuzena na jeden
   reprodukovatelny cil; proc pada, **NEVIM**.
2. **R-58** 🔴 NOVY (§197) — **39 z 596 policies cte GUC, ktery aplikace nikdy
   nenastavuje** (`app.bypass_rls` 13x, `app.promoter_id` 10x, `app.user_id` 10x,
   `app.is_service` 4x, `app.is_admin` 2x, `app.use_service_role` 2x,
   `app.platform_admin` 1x). Kod nastavuje presne ctyri jmena — overeno grepem
   ze struktury. Vsech 39 je **fail-closed**, ne unik (nenastaveny GUC = NULL =
   vetev neplati). Napojuje se na R-30 (`oauth_accounts`) a R-52
   (`ticket_transfers`). Cela servisni vrstva nad `rfid_*`, `royalty_*`,
   `parking/accommodation_offers`, `bundle_items`, `qes_signing_requests`,
   `scanner_devices` je mrtva. Opravovat po skupinach s izolacnim testem.
   ✅ **Dira zavrena (§199): vsechny 4 helpery `app_*()` vraci pri prazdnem
   kontextu null/false, POVOLUJE 0 ze 4** — zmereno volanim, ne ctenim.
   **Fail-closed se NEOTACI: 0 z 39** (§198) — vsech 39 je PERMISSIVE a zadna
   nepouziva NOT / IS NULL / IS DISTINCT FROM / <> / COALESCE s pravdivym
   defaultem. Proto tiket, ne hotfix.
   ⚠️ Cislo 39 plati pro **PRODUKCNI stav**; po nasazeni 470+471 bude 38.
3. **R-19** ✅ UZAVRENO (§197, §199) — vsech 134 sloupcu ma JEDINY tvar
   `col = app_current_*_id()` (85 promoter, 49 user), zadna jina trida.
   0 nesouladu, 0 uniku. ⚠️ Zbylych 116 uz nejde overit skenem: nemaji FK
   (definice R-19) ani zapisovatele v kodu — 6 z 10 zkousenych nema v `src/`
   ani jediny vyskyt. Policy tam hlida neco, co aplikace nepouziva (trida
   R-34/R-35). Dalsi krok by byl rucni: cist zakladajici migrace, 116x.
   Puvodni zapis (§197) — rozsah premeren ze struktury: 134 sloupcu
   (ne 191; jina definice, ne spor). **0** sloupcu se porovnava s GUC jineho
   druhu identity. Trida „unik zamenou identity" v tomhle vzorku neexistuje;
   vada je jinde, viz R-58. Detailne provereno 8 nejrizikovejsich.
4. **R-39** tri moduly s chybejicimi tabulkami (`catalog.seat_maps`,
   `forgemsg/dispatch`, `resolve-price`). `seat_maps` dnes shazuje
   `my/orders/[id]/upgrade-options` na 500 — je to jeden ze 4 trvale padajicich
   testu v zive sade.
5. **R-52** 11 z 20 policies migrace 455 neovereno (dlouhy FK retez;
   `ticket_transfers_insert` navic potrebuje merit INSERT, ne SELECT).
6. **R-45** 31 vyrazenych reportu ceka na rozhodnuti per sloupec.
7. **R-51** T4 medium (16) a low (29) neotriagovane. **Podezreni na artefakt
   parseru POTVRZENO a opraveno (§200):** `d.d -> conference.days.d` byl falesny
   — `days` je CTE (`WITH days AS (…) FROM days d`), ktere stinilo skutecnou
   `conference.days`. `aliasMap()` v `schema-reality-scan.mjs` ted CTE preskakuje,
   self-check na to bezi pri kazdem spusteni.
   **Premereno (§201): 6 high / 15 medium / 28 low = 49** (drive 52).
   `conference.days` ma 0 vyskytu. ⚠️ Ubytek -3 nejde pripsat oprave CTE —
   stara cisla vznikla na jinem stavu repa. Zbylych 15 medium vypada REALNE
   (penize: `platform.promoters.payout_*` na 2 mistech; `catalog.events.e.name`
   se kryje s §167; `m.membership_code` je znamy konzumovany sloupec).
   Triaz kus po kuse porad NENI hotova.
8. **R-47** demand-forecast — rozhodnuti o modelu, ne oprava.
9. **R-55** 74 z 93 buyer-only policies zmereno jen pres vzor. Nizka priorita:
   nejcastejsi tvar (56x) je trivialni a lisit se muze jen jmenem sloupce, coz
   jde overit staticky proti katalogu.
10. **R-25** foyer pre-order writer (ceka na rozhodnuti).
11. **R-29** 32 kandidatu na `IF NOT EXISTS`.
12. **R-32** duplicitni indexy — **odlozeno uzivatelem** („riziko prevysuje uzitek").

## Znamé trvale padajici testy (nejsou regrese)

```
T-WAITLIST-PROVIDER      admin-guest   23514 walkin
T-BOXOFFICE-EXPIRES      admin-guest   23502 expires_at
consent-log-purge (C2)   cron-contract vraci ok:true pri odepreni prava
upgrade-options          wrapped-routes catalog.seat_maps neexistuje  -> R-39
```

## Poznamky k historii (necist jako soucast nalezu)

* **Dva HTML artefakty se dostaly do cizich commitu.** `29c2bcd` obsahuje
  `plan-oprav-ux.html`, `798bbea` obsahuje `analyza-ia-vsech-funkci.html`.
  Nepatri k tem commitum — vzal je tam `git add -A`. **Historie se nepresipise**
  (rozhodnuti uzivatele), commity zustavaji jak jsou. Nic se neztratilo.
  Ponauceni: v tomhle repu se commituje **vyhradne vyslovnymi cestami**, protoze
  v tree byva soubezne rozpracovana prace na admin UI.
* **`npx tsc --noEmit` NENI zeleny a neni to vada RLS prace.**
  `.next/types/app/api/rfid/scan/route.ts` hlasi TS2344, protoze
  `src/app/api/rfid/scan/route.ts:253` exportuje `generateRfidDeviceKey` —
  Next.js v route souboru povoluje jen handlery a konfiguraci. Cizi kod,
  **nesahat**. Znamena to ale, ze tsc se v teto casti repa neda pouzit jako
  signal „cisto" — je potreba se divat, jestli je chyba tahle, nebo nova.

## Nasazeni

Migrace `470` a `471` jsou v repu, **na produkci NEJSOU**. Nic neni pushnute —
strom je vzdy 150+ commitu nad `origin/master` zamerne, push se nedela bez pokynu.

---

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

**🔧 KOREKCE 2026-08-13 (§191) — „proč se session vymění" UŽ VÍM, a dopad je
větší, než tenhle odstavec tvrdil.** Na poolovaném endpointu (transaction mode)
se backend přiděluje per transakci; `connect()` nastavuje GUC **session-level
mimo transakci**, takže dotaz volajícího může dorazit na jiný backend. Změřeno
na reálném kódu: POOLED 59/60 špatně, DIRECT 0/60, práh jsou **2 souběžné
requesty**. Dvě opravy původního textu:
* Není to jen „tiché prázdno" — většina případů je **cizí kontext** (jiný
  uživatel/promotér), ne prázdno.
* Netýká se to jen 8 rout bez `BEGIN`. Vlastní `BEGIN` volajícího nepomáhá
  (změřeno hůř než bez něj) → jde o **všech 206 volání `db().connect()`**.
Detail, sweep a směry opravy: §191. Tiket **R-56**.

### Původní zápis (dopad na produkci)

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

## R-40 VYRESENO migraci 470 (§163) — obe vetve 200

## R-41 `my/orders/[id]/upgrade` blokovana `orders.seat_assignments` (§164)

Sloupec `price_halire` -> `base_price` opraven, izolace dolozena (cizi 404),
ale routa pak pada na chybejici tabulce `orders.seat_assignments` — tataz,
kvuli ktere je vypnuty `cron/seat-upgrade-notify` (F6). Ceka na rozhodnuti
spolu s R-34/R-39.

## R-41 VYRESENO (§166) — `seat_assignments` nahrazena `tickets.tickets.seat_id`

## R-42 `cron/seat-upgrade-notify` uz nemusi byt vypnuty (§166)

F6 ho vypnul kvuli `orders.seat_assignments`. Ta se ukazala jako navrhova
odbocka — prirazeni sedadla je na `tickets.tickets.seat_id`. Staci tam tataz
zamena jako v `my/orders/[id]/upgrade` a job muze zpet do `ALLOWED_JOBS`.
POZOR: routa ma i druhou vadu (§127, chybejici parametry) — ta uz opravena je.

## R-43 report `udalosti_resell` NENI vyrazeny, ale spadne (§165)

`orders.resale_listings.price_halire` neexistuje (tabulka ma
`listing_price_halire`). Report proti nemu bezi a v `DISABLED_REPORTS` NENI,
protoze sken hleda chybejici TABULKY, ne sloupce. Bud opravit sloupec (R-37),
nebo report vyradit.

## R-42 AKTUALIZACE (§167): job zustava vypnuty, ale z JINEHO duvodu

Premisa „chybi orders.seat_assignments" neplatila (sedadlo je na
`orders.order_items.seat_id`), ale pod ni je retez: `o.buyer_email`, `e.name`,
`s.zone_name`, `s.row_label`, `s.label`. `catalog.seats` ma `zone`, `section`,
`seat_number`. Routa je psana proti JINEMU SCHEMATU sedadel — neni to zamena,
je to prepis. Tri opravy (oi.seat_id, buyer_email pres identity.users, e.title)
v kodu zustavaji.

## R-43 VYRESENO (§168) — `re.price_halire` -> `re.listing_price_halire`

## R-44 `DISABLED_REPORTS` vzniklo ze skenu TABULEK, ne sloupcu (§168)

Reporty se spatnym SLOUPCEM (jako `udalosti_resell`) vyrazovani proklouzly.
Kolik jich je, NEVIM — sken na sloupce v reportech neexistuje.

## R-44 VYRESENO (§169) — 31 reportu se spatnym sloupcem doplneno do DISABLED_REPORTS

Novy nastroj `scripts/scan-report-columns.mjs` (self-check prosel).
Aktivnich reportu: 198 -> 152 (46 vyrazenych: 15 chybejici tabulka,
31 spatny sloupec).
POZOR: „spustitelnych 152" NENI „overene funkcnich 152" — projdou jen dvema
skeny, nikdo je nespustil. 7 nekvalifikovanych sloupcu sken nepokryva.

## R-45 31 vyrazenych reportu ceka na rozhodnuti per sloupec (§169)

U `orders.orders.promo_code`, `platform_fee_halire`, `tickets.scan_logs.result`
a dalsich neni z dotazu poznat, jestli se sloupec prejmenoval, nebo featura
nevznikla. Rozhodnout kus po kuse.

## R-46 `demand-forecast` vraci `ok:true` s neprazdnym `errors` (§170)

Porusuje kontrakt C2. Vypnute joby do C2 auditu nespadaly, takze to proklouzlo.
NEOPRAVENO — job je vypnuty. Az se bude resit, opravit spolu s nim.

## R-47 demand-forecast: rozhodnuti misto opravy (§170)

`analytics.demand_forecasts` je per-ticket-type CENOVE doporuceni; kod pocita
per-event prognozu poptavky v absolutnich poctech. 5 z 11 hodnot nema kam,
4 klicova pole tabulky kod nepocita. Bud dostavet prognozu (nova tabulka),
nebo prepsat kod na cenovy model.

## R-46 VYRESENO (§172) — a odhalilo dva AKTIVNI crony mimo C2 audit

`payouts-execute` (penize!) a `daily-stats` vracely `ok:true` vedle neprazdneho
`errors`. C2 slo po jmennem seznamu devíti rout, ne po vsech cronech.

## R-48 🔴 PRUSTREL: purchase-limit race (§3.6, §173)

`max_per_buyer=2`, 5 soubeznych nakupu -> vsech 5 proslo (200×5), kupujici ma
5 kusu. Kontrola je read-then-write bez zamku.
Neztratilo se nic, PRETEKLO. Opacna vada nez oversell (§3.1), ktery drzi.
Oprava: `SELECT ... FOR UPDATE` na agregaci kupujiciho, nebo unikatni omezeni —
ktera cesta, je rozhodnuti. NEOPRAVENO dle zadani.

## R-48 VYRESENO (§174) — purchase-limit drzi (200×2, 422×3), harness 5/5

`pg_advisory_xact_lock` na dvojici (kupujici, akce) pred vsemi tremi kontrolami.
Podminka v INSERTu by to neopravila (READ COMMITTED), constraint „soucet <= N"
vyjadrit neumi.

## R-49 Doaudit cronu (§175): 46 rout, 7 mimo C2, vsech 7 opraveno

`broadcast-send`, `abandoned-cart`, `charge-installments`, `recompute-dynamic-pricing`,
`refresh-spotify`, `send-reminders`, `resale-payouts`. Dve se tykaly penez.
Poucení: audit podle routovaci struktury, ne podle seznamu v dokumentu.

## R-50 VYRESENO (§178) — vsech 30 provereno, 0 zranitelnych

### Puvodni zapis (§176)

Dohledano 8 nejrizikovejsich — vsechny bezpecne (allowlist, orezane cislo,
konstanty, vazane hodnoty, nazvy souboru). Zbylych 22 je NEZMERENYCH, ne cistych.
Nastroj: `node scripts/scan-dynamic-sql.mjs` (self-check rozlisi bezpecny
a rizikovy vzor).

## R-51 T4 medium (16) a low (29) neotriagovane (§179)

HIGH ma FP rate 0 % (7/7 skutecnych) — heuristiku UDRZOVAT.
Medium/low stoji na proxy konfidenci (pocet aliasu v dotazu), jejich FP rate
neni zmereny. Mezi medium je podezreni na artefakt parseru
(`d.d -> conference.days.d`), NEOVERENO.

## R-52 11 z 20 policies migrace 455 neovereno chovanim (§180)

Overeno 9 (bylo 3), unik zadny. Neovereno: 4x edp_*, event_travel_packages_write,
box_office_sales/sessions_promoter, seat_upgrades_buyer, travel_bookings_select,
wero_webhooks_tenant_isolation (FK retez), ticket_transfers_insert (test meri
jen SELECT).
Nastroj: `tests/mig455.live.test.ts` — seed z introspekce, NEVIM misto hadani.

## R-53 — `orders.transit_passes`: mrtva admin vetev (drift jmena GUC) — OPRAVENO

Policy `transit_passes_buyer_owns` cetla `current_setting('app.platform_admin')`
misto `app.is_platform_admin`. Aplikace ten GUC nenastavuje nikde, vetev byla
trvale false: platform admin transit_passes nevidel. Jediny vyskyt teto varianty
jmena v celych migracich.

Migrace `471_transit_passes_admin_guc_drift.sql`. Mereno na klonu:
`admin PRED=0 PO=1`, buyer izolace zachovana (`sve=1 cizi=0`). Detail §185.

Servisni vetev se NEPRIDAVALA — v puvodni policy nebyla a pridat ji by znamenalo
rozsirit pristup nad ramec toho, co autor napsal.

## R-54 — Mereni GUC musi pouzivat `SET LOCAL`, ne holy `SET`

Holy `SET` prezije transakci i klienta a pri recyklaci spojeni prosakne do dalsiho
mereni; zpusobil falesny unik. Stejna pricina jako R-15. Opraveno v
`tests/buyer-policies.live.test.ts` (BEGIN / SET LOCAL / COMMIT).

Zbyva projit ostatni zive testy a nahradit v nich holy `SET` — dokud se to
neudela, kazde cislo z testu, ktery nastavuje admin/service GUC a pak meri neco
jineho, je potencialne kontaminovane. Detail §186.

## R-55 — 74 z 93 buyer-only policies zmereno jen pres vzor

§184 zmerilo 19 reprezentantu, po jednom na tvar predikatu; pokryvaji vsech 93.
Netvrdi to ale, ze zbylych 74 je v poradku — dve policies stejneho tvaru se muzou
lisit tim, na ktery sloupec koreluji. Nizka priorita: nejcastejsi tvar (56x) je
trivialni `X = app_current_user_id()` a lisit se muze jen jmenem sloupce, ktere
jde overit staticky proti katalogu.

## R-56 🔴 `connect()` na poolovanem endpointu bezi pod CIZIM kontextem (§191)

Zmereno na realnem kodu (`tests/rls-pool-pooler.live.test.ts`), oba endpointy
tehoz klonu, self-check prosel na obou:

```
DIRECT  n=60  spatne= 0
POOLED  n=60  spatne=59   (37 prazdno, 22 CIZI uzivatel)
```

Prah je **2 soubezne requesty** (sweep 1/2/3/5/10 klientu v §191), ne onsale
napor. Tyka se **206 volani `db().connect()` ve 176 souborech**;
`db().query()` (666x/308 souboru) uz ma tvar `BEGIN/SET LOCAL/COMMIT` a je
zmerene tesne (0/120).

**Ceka na jednu FAKTU a pak na ROZHODNUTI:**
1. FAKT: miri prod `DATABASE_URL` na `-pooler`? `GO-LIVE-CHECKLIST.md:135`
   rika ano, ale hodnota je ve Vercelu sifrovana — **NEOVERENO**.
2. ROZHODNUTI mezi zmerenymi kandidaty (§192).

### Cesty ven — zmereno (§192), NEIMPLEMENTOVANO

| kandidat | spravnost n=60 | call sites | cena |
|---|---|---|---|
| **b) dva pooly**: direct pro `connect()`, pooled pro `query()` | 0/60 obe cesty | 0 | nejnizsi; direct sloty cerpa jen `connect()` |
| a) cely pool na direct URI | 0/60 obe cesty | 0 | strop **890 spojeni**, pak SQLSTATE 53300 — presne ta chyba, kvuli ktere pooler vznikl (`ONSALE-PLAYBOOK.md:24`) |
| c) transakce uvnitr `connect()` | — | 0 primo | **nejhorsi**: `SET LOCAL` zanikne prvnim `COMMIT`em volajiciho -> rozbije **12 volani v 11 souborech** (vc. `checkout`), a odjisti spici `SET LOCAL app.is_platform_admin` v `buyer/fan-bonus:18` |

Vnoreny `BEGIN` sam je jen WARNING (zmereno 3/3) — §120 melo pravdu, ale
zabijak je jinde: `SET LOCAL` konci s transakci volajiciho.

### Dopad: vzorek 10 z 206 (§193)

**0 z 10 by vydalo cizi data.** Vsech deset si identitu znovu vaze v aplikaci
(parametr dotazu nebo explicitni guard); RLS je u nich druha vrstva. Dominantni
projev zameny je **fail-closed** (prazdno / 42501), ne unik — coriguje to
durazny ton §191. Je to ale odhad ze **4,9 %** vzorku, ne dukaz o 206.
Trida, ktera by unikala (routa spolehajici na RLS VYHRADNE), ve vzorku nebyla;
kolik ji je mezi zbylymi 196, **NEVIM**.

⚠️ Nedelej z toho „206 der".

## R-57 ✅ VYRESENO (§195) — spici `SET LOCAL` odstranen

Radek smazan; `runWithPlatformAdminContext` se NEPOUZIL, protoze routa uz je
v servisnim kontextu a `gift_vouchers` ma vetev `app_is_service()`. Scoping
zajistuje `WHERE fbi.user_id = $1`.
RED->GREEN (`tests/fan-bonus-r57.live.test.ts`, 2/2): v transakci RED `"true"`
-> GREEN `""`. Neregrese: kupujici vidi svuj bonus a NEvidi cizi (a naopak).

### Puvodni zapis (§192)

`SET LOCAL app.is_platform_admin = 'true'` a v cele route neni `BEGIN`.
Zmereno 3/3: mimo transakci to hlasi `WARNING: SET LOCAL can only be used in
transaction blocks` a hodnota zustane `""`. Dnes tedy nedela nic.

Dve veci: (1) routa se spoleha na servisni kontext, ktery na pooleru ztraci —
proto muze vracet prazdno; (2) kdyby se R-56 resilo kandidatem (c), ten radek
by **zacal platit** a kupujici GET by bezel jako platform admin. Opravit
nezavisle na R-56 — bud radek odstranit, nebo ho dat do transakce vedome.

## Nastroje pridane 2026-08-13

* `scripts/guc-swap-probe.mjs` — meri ZTRATU vlastniho GUC (ne prosakovani
  ciziho, to je `guc-leak-probe.mjs`). Ma vestaveny self-check: scenar Z musi
  ztratu najit, jinak sonda konci exit 3 a jeji nuly NEPLATI. Pri `--clients=1`
  self-check korektne selze (1 backend, neni co zamenit).
* `tests/rls-pool-pooler.live.test.ts` — tyz zaver na produkcnim modulu misto
  na kopii tvaru. Direct vetev je self-check (musi byt 0).
