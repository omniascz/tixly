
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
