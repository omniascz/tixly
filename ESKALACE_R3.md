# Krok 3 (kolo 3) — admin eskalace `SET LOCAL app.is_platform_admin = 'true'`

Zdroj: `logs/r2/3_inline_escalations.txt` (54 řádků = 52 v kódu + 2 komentáře) + 1 výskyt, který grep kola 2 (jen `.ts`) nezachytil: `app/[locale]/p/[slug]/vouchers/page.tsx`.
Řádky = čísla z kola 2 (před úpravou). Test: `tests/fix-r3-escalations.live.test.ts` (inventura + kupec proti cizímu uživateli + pořadatel proti cizímu pořadateli + anonym/servis).

| soubor | typ volajícího | před | po |
|---|---|---|---|
| `app/api/admin/charity/allocations/route.ts:83` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele; čtení schváleného partnera (charity.partners jen service/admin) a INSERT claim slotů přes asSystemInTx |
| `app/api/admin/events/[id]/view-photos/route.ts:50` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele (runAsPromoter*) bez admin práv; RLS scopuje na jeho akce |
| `app/api/admin/events/[id]/view-photos/route.ts:124` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele (runAsPromoter*) bez admin práv; RLS scopuje na jeho akce |
| `app/api/admin/reports/nipos/route.ts:55` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele (runAsPromoter*) bez admin práv; RLS scopuje na jeho akce |
| `app/api/admin/subscriptions/packages/[id]/route.ts:36` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele (runAsPromoter*) bez admin práv; RLS scopuje na jeho akce |
| `app/api/admin/subscriptions/packages/[id]/route.ts:129` | pořadatel | SET LOCAL app.is_platform_admin = 'true' | kontext pořadatele (runAsPromoter*) bez admin práv; RLS scopuje na jeho akce |
| `app/api/buyer/discover/events/route.ts:30` | kupec | SET LOCAL app.is_platform_admin = 'true' | spojení čteno pod kontextem kupce; skóre přes lineups.event_artists přes asSystemInTx (user_top_artists dál scopované na kupce) |
| `app/api/buyer/fan-bonus/route.ts:18` | kupec | jen komentář | jen komentář — eskalace odstraněna už dříve (R-57); beze změny |
| `app/api/buyer/group-invitations/reserve/route.ts:40` | kupec | SET LOCAL app.is_platform_admin = 'true' | akce + typ ověřeny pod kontextem kupce; zámek/držení sedadel a INSERT pozvánky přes asSystemInTx |
| `app/api/buyer/group-invitations/route.ts:48` | kupec | SET LOCAL app.is_platform_admin = 'true' | akce + typ vstupenky ověřeny pod kontextem kupce (nově: typ musí patřit k akci); INSERT pozvánky přes asSystemInTx |
| `app/api/buyer/group-invitations/[token]/claim/route.ts:40` | kupec (oprávnění = token pozvánky) | SET LOCAL app.is_platform_admin = 'true' | e-mail kupce pod jeho kontextem; čtení pozvánky, zámek sedadla, objednávka, položka, sedadlo, počítadlo + zápis platebního id přes asSystemInTx |
| `app/api/buyer/modular-pass/checkout/route.ts:54` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/buyer/modular-pass/checkout/route.ts:226` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/buyer/otp/request/route.ts:60` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/buyer/otp/verify/route.ts:43` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/buyer/restwert-balance/route.ts:24` | kupec | SET LOCAL app.is_platform_admin = 'true' | vlastní abonentky (holders) zjištěny pod kontextem kupce; souhrn přes balíčky přes asSystemInTx omezený na h.id = ANY(vlastní) |
| `app/api/buyer/spotify/callback/route.ts:52` | kupec (identita = OAuth state, bez session) | SET LOCAL app.is_platform_admin = 'true' | state čte servisní kontext routy; zápisy spojení + top interpretů přes asUserInTx(user ze state) = RLS vlastních řádků |
| `app/api/buyer/spotify/connect/route.ts:66` | kupec | SET LOCAL app.is_platform_admin = 'true' | kontext kupce — RLS pokrývá jeho vlastní řádky; eskalace odstraněna |
| `app/api/buyer/spotify/connect/route.ts:88` | kupec | SET LOCAL app.is_platform_admin = 'true' | kontext kupce — RLS pokrývá jeho vlastní řádky; eskalace odstraněna |
| `app/api/buyer/spotify/connect/route.ts:151` | kupec | SET LOCAL app.is_platform_admin = 'true' | kontext kupce — RLS pokrývá jeho vlastní řádky; eskalace odstraněna |
| `app/api/buyer/spotify/connect/route.ts:204` | kupec | SET LOCAL app.is_platform_admin = 'true' | kontext kupce — RLS pokrývá jeho vlastní řádky; eskalace odstraněna |
| `app/api/buyer/subscriptions/[id]/pick/route.ts:145` | kupec | SET LOCAL app.is_platform_admin = 'true' | vlastnictví abonentky ověřeno pod kontextem kupce (FOR UPDATE); balíček, pool akcí, výdej vstupenky a redemption přes asSystemInTx |
| `app/api/buyer/subscriptions/[id]/pick/[eventId]/route.ts:32` | kupec | SET LOCAL app.is_platform_admin = 'true' | vlastnictví abonentky ověřeno pod kontextem kupce (FOR UPDATE); načtení, revoke vstupenky, smazání výběru a kredit přes asSystemInTx |
| `app/api/charity/claim/[token]/route.ts:29` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/charity/claim/[token]/route.ts:108` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/events/[id]/seat-view-photos/route.ts:24` | anonym | SET LOCAL app.is_platform_admin = 'true' | anonymní kontext — čte jen veřejná data (published akce / tabulky čitelné všem) |
| `app/api/group-invitations/[token]/route.ts:26` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/cron/release-group-invite-holds/route.ts:24` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/cron/seat-upgrade-notify/route.ts:23` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/order-completed/route.ts:435` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/order-completed/route.ts:455` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/order-completed/route.ts:481` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/order-completed/route.ts:522` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/internal/order-completed/route.ts:550` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/mock-bnpl/[provider]/[paymentId]/confirm/route.ts:47` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/p/[slug]/vouchers/checkout/route.ts:70` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/platform/artists/route.ts:18` | platform admin (requirePlatformAdmin + runWithPlatformAdminContext) | SET LOCAL app.is_platform_admin = 'true' | inline SET odstraněn (duplicitní) — admin kontext dává runWithPlatformAdminContext po ověření |
| `app/api/platform/postal/route.ts:19` | platform admin (requirePlatformAdmin + runWithPlatformAdminContext) | SET LOCAL app.is_platform_admin = 'true' | inline SET odstraněn (duplicitní) — admin kontext dává runWithPlatformAdminContext po ověření |
| `app/api/platform/postal/[id]/route.ts:31` | platform admin (requirePlatformAdmin + runWithPlatformAdminContext) | SET LOCAL app.is_platform_admin = 'true' | inline SET odstraněn (duplicitní) — admin kontext dává runWithPlatformAdminContext po ověření |
| `app/api/platform/travel/hotels/route.ts:16` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/route.ts:65` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/[hotelId]/rooms/route.ts:19` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/[hotelId]/rooms/route.ts:63` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/[hotelId]/route.ts:20` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/[hotelId]/route.ts:61` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/travel/hotels/[hotelId]/route.ts:112` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/venues/[id]/seat-view-photos/route.ts:33` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/venues/[id]/seat-view-photos/route.ts:89` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/platform/venues/[id]/seat-view-photos/[photoId]/route.ts:20` | platform admin (requirePlatformAdmin = podepsaný JWT, roles.isPlatformAdmin) | SET LOCAL app.is_platform_admin = 'true' | PONECHÁNO — volající prokazatelně platform admin z ověřené session |
| `app/api/subscriptions/holders/[paymentId]/confirm/route.ts:49` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `app/api/vouchers/holders/[paymentId]/confirm/route.ts:43` | systém / veřejný endpoint (route v runWithServiceContext) | SET LOCAL app.is_platform_admin = 'true' | servisní kontext routy (app_is_service) bez admin práv |
| `lib/checkout-deps.ts:6` | — | jen komentář | jen komentář (nejde o eskalaci); beze změny |
| `lib/db/with-context.ts:75` | helper bez volajícího | SET LOCAL app.is_platform_admin = 'true' | withPlatformAdminDb + queryAsPlatformAdmin ODSTRANĚNY (mrtvé API, eskalovalo bez ověření volajícího) |
| `lib/white-label/domain.ts:59` | anonym (host header před autentizací) | SET LOCAL app.is_platform_admin = 'true' | čtení domény/brandingu přes asSystemInTx (politiky jen service/admin/pořadatel), ne admin |
| `app/[locale]/p/[slug]/vouchers/page.tsx:25` (navíc, .tsx) | anonym (veřejná landing page) | SET LOCAL app.is_platform_admin = 'true' | anonymní kontext — čte jen veřejná data (published akce / tabulky čitelné všem) (platform.promoters SELECT = true) |

## Souhrn

- eskalace odstraněna — stačí kontext (kupec/pořadatel/anonym/servis): **29**
- ponecháno (ověřený platform admin): **10**
- zúženo: ověření pod kontextem + asSystemInTx pro konkrétní příkazy: **9**
- odstraněn duplicitní inline SET (admin kontext z ověřené session): **3**
- komentář (beze změny): **2**
- zúženo na kontext uživatele (asUserInTx): **1**
- helper odstraněn: **1**
- celkem řádků: **55** (54 ze seznamu kola 2 + 1 page.tsx)

Po kroku 3 zbývá v kódu 10 výskytů — všechny v `app/api/platform/**` za `await requirePlatformAdmin(req)` (test to hlídá).
