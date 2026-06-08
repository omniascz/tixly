# Švový audit — superadmin ↔ promotér ↔ buyer web ↔ widgety (2026-06-08)

Důkladná inspekce integračních švů celého řetězce, s reálnými E2E scénáři pod
**enforced RLS** (role `tixly_rls_test`, bypass=false). Cíl: ověřit propojení a
odhalit chyby/nepřesnosti — ne tvrdit „zelené" bez spuštění.

## Výsledek
- **Statická baseline:** `tsc --noEmit` = 0 chyb. Leftover artefakt uklizen + gitignored.
- **e2e-seams.mjs (NOVÝ):** 50/50 ✅ pod enforce, self-cleaning.
- **e2e-lifecycle.mjs:** 30/30 ✅ (regrese po opravách).
- **e2e-full-suite.mjs:** 42/42 ✅ (regrese po opravách).
- **Veřejný katalog:** vyčištěn na 8 reálných akcí (0 test).

## 🐞 Nalezené a OPRAVENÉ bugy

### 1. Master-admin fee override se ignoroval v payoutu  `[P1 — peníze]`
`PATCH /api/platform/promoters/[id]` uloží custom provizi do `platform.fee_schedules`
(UI to umožní a zobrazí), ale `/api/admin/payouts` počítal fee **natvrdo**
`PLATFORM_FEE_BPS=500`. Promotér s dohodnutými 8 % viděl pořád 5 %.
**Fix:** payout načte aktivní `percentage_fee` per měna z `fee_schedules` (fallback default).
**Důkaz:** 8 % override → fee=4000 z 50000 (dřív 2500). `feeBps` přidán do bucketu.

### 2. Seated event: zone↔sektor matching tiše selhal  `[P1 — prázdná mapa sedadel]`
Most chart→`event_seats` matchoval `ticket_types.zone === sektor.name` striktně.
Sektor `Přízemí` vs zóna `PŘÍZEMÍ` → 0 shod, `seatsCreated=0`, **žádná chyba** →
buyer dostal prázdnou mapu. (Oblast = bývalý P0 ze session 13.)
**Fix:** `copy-layout-to-event-seats.ts` → matching `trim + lowercase(cs) + NFC`.
**Důkaz:** zone `PŘÍZEMÍ` → sektor `Přízemí` → 282 sedadel, buyer vidí mapu (59 KB).

### 3. Public ticket-types leakly typy nepublikované akce  `[P2 — defense-in-depth]`
`/api/events/[id]/ticket-types` nefiltroval status akce. Pod enforced RLS to hlídá
public-read policy, ale pod dormantním BYPASSRLS (prod dnes) by to prozradilo typy
draft akce. Koupit nešlo (checkout má `e.status='published'` guard), ale konzistence.
**Fix:** explicitní `JOIN events e ON ... AND e.status='published'`.

## ✅ Švy ověřené jako FUNKČNÍ
- **Superadmin gate:** neschválený promotér se přihlásí, ale `POST /api/admin/events` → 403.
- **Schválení promotéra:** pending → active, pak login má membership.
- **Moderace akce:** akce → pending_review → master approve → published.
- **Buyer nákup E2E:** checkout → mock platba → lístek vystaven → inventář −1.
- **Veřejný katalog (RSC):** publikovaná akce se objeví (`date_start≥NOW AND p.status=active AND published`).
- **Embed widgety:** `/embed/event/[id]` i `/embed/promoter/[slug]` = 200, živá data.
- **Cross-tenant izolace:** promotér B nevidí (404) ani needituje (404) akci A; A není v seznamu B.
- **Branding → white-label:** promotér nastaví branding → verified doména → `/api/public/branding`
  servíruje jeho barvu/logo/hidePoweredBy.
- **Rate-limiting:** register-promoter 5/h, login 20/5min — globálně přes Redis (429 ověřeno živě).

## ⚠️ Známá nepřesnost — NEopraveno (záměrně, vyžaduje rozhodnutí)

### buyer_fee_halire (service fee kupujícímu) je no-op
Master admin může nastavit „service fee X Kč/obj." (`fee_schedules.buyer_fee_halire`,
UI to zobrazuje), ale **checkout ho nikdy nepřičte** k tomu, co buyer platí.
- **Proč neopraveno hned:** korektní aplikace mění outward-facing cenu pro kupujícího
  A musí jít do platform revenue (ne do promotérova gross v payoutu) → potřebuje
  finanční model + nejspíš sloupec na objednávce (migrace), ne slepé přičtení do
  `total_amount` (to by chybně nafouklo promotérův payout).
- **Doporučení:** rozhodnout, zda Tixly bere buyer-facing service fee. Pokud ano →
  přičíst v checkoutu + ukládat odděleně + odečíst z promoter gross v payoutu. Pokud
  ne → skrýt to pole z master UI, ať operátora nemate.

## Test-hygiena (opraveno)
E2E skripty po zapojení global rate-limitu padaly na 429 při opakovaných bězích.
Doplněn per-běh / per-volání `X-Forwarded-For` → suite je znovu spustitelná.
