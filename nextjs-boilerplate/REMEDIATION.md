
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
