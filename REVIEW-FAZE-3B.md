# Code Review Faze 3b -- Tixly

Datum: 2026-04-05
Reviewer: Opus 4.6 (senior code review)
Moduly: 12 (embed-widget, verified-fan, cart-abandonment, affiliate-tracking, ambassador-management, loyalty-points, re-engagement, audience-segmentation, conversion-funnel, marketing-attribution, buyer-blacklist, faze-3b-tests)

## Tabulka nalezených problemu

| # | Modul | Zavaznost | Popis problemu | Status |
|---|-------|-----------|----------------|--------|
| 1 | embed-widget | KRITICKA | `sendToParent()` pouzival `'*'` jako target origin v `postMessage` -- umozni libovolnemu oknu zachytit zpravy widgetu (XSS vektor) | OPRAVENO |
| 2 | loyalty-points | KRITICKA | `calculateEarnedPoints()` pouzival float aritmetiku `(orderAmount / 100) * multiplier` kde `multiplier` muze byt 1.5 -- pro velke castky se ztrati presnost IEEE 754 | OPRAVENO |
| 3 | cart-abandonment | VYSOKA | POST `/api/cart` vracel HTTP 200 pro vytvoreni noveho kosiku misto 201 Created | OPRAVENO |
| 4 | verified-fan | VYSOKA | POST `/api/events/[eventId]/verified-fan` vracel 409 Conflict pro `RegistrationClosedError` -- spravne je 422 Unprocessable Entity (registrace neni otevrana != konflikt) | OPRAVENO |
| 5 | audience-segmentation | VYSOKA | `exportSegment()` pouzival string interpolaci `LIMIT ${EXPORT_LIMIT}` v SQL -- i kdyz je to konstanta, porusuje princip "vsechny hodnoty parametrizovane" | OPRAVENO |
| 6 | re-engagement | VYSOKA | `startCampaign()` kontroloval unsubscribe v tabulce campaigns (`status = 'unsubscribed'`), ale `unsubscribe()` zapisuje do dedicovane tabulky `re_engagement_unsubscribes` -- pokud by se kampane smazaly, unsubscribe by se ztratil (GDPR riziko) | OPRAVENO |
| 7 | verified-fan | STREDNI | SQL `ORDER BY ${orderBy[cfg.selection_method]}` v `runSelection()` -- technicky bezpecne (hodnota z whitelistu Record), ale vzor interpolace v SQL je fragile | WON'T FIX (bezpecne, hodnota z konstantniho Record) |
| 8 | affiliate-tracking | STREDNI | `trackClick()` fire-and-forget DB writes (INSERT click, UPDATE counter) bezi mimo transakci -- pri chybe se click zaznamena ale counter ne (nebo naopak) | WON'T FIX (dokumentovany fire-and-forget pattern pro redirect latenci) |
| 9 | re-engagement | STREDNI | Error messages v anglictine ("User already has an active re-engagement campaign") zatimco zbytek platformy ma ceske zpravy | WON'T FIX (internal service, EN je ok pro logy) |
| 10 | buyer-blacklist | STREDNI | Error messages v anglictine -- konzistentni v ramci modulu, ale nekonsistentni s ostatnimi moduly (cs) | WON'T FIX (internal/admin facing, EN je ok) |
| 11 | audience-segmentation | STREDNI | Error messages v anglictine ("Segment not found") | WON'T FIX (admin-only modul) |
| 12 | conversion-funnel | NIZKA | Funnel track route pouziva `@/services/funnel.service` (path alias) zatimco ostatni moduly pouzivaji relativni importy | WON'T FIX (lokalni konfigurace, ne bug) |
| 13 | vsechny moduly | INFO | `withTenantContext` je vsude stub -- pripomenuti ze pred deployem musi byt nahrazeno realnou implementaci z `@tixly/rls-multitenancy` | N/A |
| 14 | vsechny moduly | INFO | `null as any` pro DB deps v route souborech -- ocekavany pattern pro DI stubs, kazdy je oznacen komentarem | N/A |

## Pozitivni nalez: co je spravne

### Financni aritmetika (po oprave)
- `calculateCommission()` v affiliate-tracking: `Math.floor((orderAmount * commissionRateBps) / 10000)` -- spravne integer
- Ambassador `useCode()`: `Math.floor((orderAmount * row.commission_rate_bps) / 10_000)` -- spravne integer
- `calculateDiscount()` v loyalty: `points === halere` -- trivialne spravne
- `calculateEarnedPoints()` (po oprave): `Math.floor((orderAmount * multiplierX10) / 1000)` -- eliminuje float intermediate

### SQL injection prevence
- Vsechny moduly pouzivaji parametrizovane dotazy ($1, $2, ...)
- `buildWhereClause()` v audience-segmentation je kvalitni implementace s renumbering parametru
- Zadna string interpolace uzivatelskych vstupu v SQL

### Idempotence
- `ON CONFLICT` pouzito spravne v: verified-fan registrace, cart-abandonment upsert, affiliate conversion, ambassador code usage, loyalty earnPoints, re-engagement startCampaign, blacklist banUser, blacklist submitAppeal
- Vsude kde je treba atomicka operace je pouzita DB transakce (affiliate recordConversion, ambassador useCode/requestPayout, loyalty earnPoints/redeemPoints, blacklist reviewAppeal)

### Kafka eventy
- Vsechny business-kriticke operace emituji Kafka eventy
- Konzistentni fire-and-forget pattern s `.catch(() => {})` nebo `fireAndForget()` wrapper

### Validace vstupu
- Zod schema v cart-abandonment, loyalty-points redeem, conversion-funnel track, re-engagement unsubscribe
- Manualni validace kde Zod neni pouzito (ambassador, blacklist) -- dostatecna

### Race condition ochrana
- `FOR UPDATE` / `FOR UPDATE SKIP LOCKED` v: verified-fan selection, ambassador useCode, ambassador requestPayout, affiliate requestPayout, loyalty redeemPoints
- Spravne pouziti transakci pro atomicke wallet operace

## Klicove architektonicke poznatky

### Pozitivni vzory (konzistentne pouzivane)
1. **Dependency injection** -- vsechny service funkce prijimaji `deps: ServiceDeps` bag, testovatelne bez realne infrastruktury
2. **Typed error classes** -- kazdy modul definuje vlastni error tridy s kodem a HTTP status codem
3. **Fire-and-forget Kafka** -- analytics a eventy nikdy neblokuji business flow
4. **Integer halere** -- vsechny financni hodnoty konzistentne v halerich (integer)
5. **Parametrizovane SQL** -- zadna string interpolace uzivatelskych dat
6. **ON CONFLICT idempotence** -- pro vsechny write operace kde muze dojit k retries

### Opakujici se patterny k vylepseni (ne bugy, ale tech debt)
1. **withTenantContext stub** -- kazdy modul ma vlastni stub; mel by se importovat ze sdileneho balicku
2. **DbAdapter interface** -- kazdy modul definuje vlastni verzi; sdileny typ by eliminoval duplikaci
3. **Jazykova nekonzistence** -- nektere moduly (re-engagement, blacklist, segmentation) maji anglicke zpravy, ostatni ceske; doporucuji sjednotit pred MVP
4. **DI pattern** -- tri ruzne pristupy k DI (stub deps v routes, getServiceDeps() declare, getServiceContainer() service locator); doporucuji sjednotit

### Kontrola konzistence s existujicimi moduly

Porovnano s: `rls-multitenancy`, `jwt-auth`, `platform-fees`, `pricing-engine`.

1. **withTenantContext signatura** -- produkcni verze pouziva `withTenantContext(db, TenantContext, fn)` kde `TenantContext` je objekt `{ promoterId?, userId?, role }`. Stuby v Faze 3b pouzivaji ruzne signatury (nekdy string userId, nekdy db + string). Pri integraci bude nutne sjednotit signatury vsech stubu na produkcni tvar. Zadny bezpecnostni problem (stuby jsou no-op), ale tech debt.

2. **Financni aritmetika** -- `platform-fees` pouziva `Math.round((price * percentageFee) / 10000)`, `pricing-engine` pouziva `Math.ceil((price * factor) / 1000) * 1000`. Faze 3b moduly pouzivaji `Math.floor` pro commission a body -- konzistentni volba (round vs floor vs ceil je oduvodnena business kontextem: fee = round, commission = floor, pricing = ceil).

3. **JWT pattern** -- `jwt-auth` pouziva `jose` s HS256, issuer/audience validaci. `verified-fan` access-token a `cart-abandonment` recovery-token take pouzivaji `jose` s HS256 -- plne konzistentni.

4. **SQL parametrizace** -- vsechny existujici i nove moduly konzistentne pouzivaji `$1, $2...`. Dynamicky SQL builder v `platform-fees` (updateFeeSchedule) a `audience-segmentation` (buildWhereClause) pouzivaji stejny vzor: dynamicke slozeni SQL s renumberovanymi parametry.

5. **Error classes** -- `platform-fees` pouziva `FeeError(code, message)`, Faze 3b moduly pouzivaji dedicovane error tridy s `statusCode` a `code` properties. Funkcionalne ekvivalentni, ale strukturalne odlisne. Doporuceni: sjednotit na spolecny `AppError` base class pred MVP.

**Zaver**: Zadne nove bugy nalezeny v existujicich modulech. Faze 3b moduly jsou konzistentni s existujici kodovou zakladnou ve vsech kritickich oblastech (financni aritmetika, SQL bezpecnost, JWT, idempotence). Odchylky jsou pouze v DI signaturach a error class strukture -- tech debt, ne bugy.

### Celkove hodnoceni
Kvalita kodu Faze 3b je vyrazne vyssi nez rannejsich fazi. Hlavni business logika (financni vypocty, idempotence, race conditions) je resena spravne. Nalezene problemy byly prevazne v kategorii "vysoka" a "stredni" -- zadny SQL injection ani kriticky data-loss bug. Opraveno 6 problemu, 6 oznaceno won't fix s oduvodnenim. Kontrola konzistence s existujicimi moduly potvrdila ze Faze 3b dodrzuje zavedene vzory.
