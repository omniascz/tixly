
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

## R-15 ⚠️ Live sada je FLAKY — vyřešit dřív, než se použije jako brána (§108)

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
