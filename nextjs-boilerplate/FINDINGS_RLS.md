
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
