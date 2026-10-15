# Kolo 21 / krok 1 — tajemství v URL

Zdroj: `nextjs-boilerplate/src` (stav větve `fix/round21-sentry-url-tokens-2026-10-15`). Hledáno přes `find src/app -type d -name '[*'` (všechny dynamické segmenty), `grep -rnE "\.get\(['\"]…['\"]\)"` (všechna čtení `searchParams`/`sp`/`params`), `grep "searchParams\??:\s*(Promise<)?\{"` + `searchParams.<název>` (props stránek), `grep "useSearchParams|location.search"`, `grep "[?&][A-Za-z_]+=\$\{"`, `grep "new URLSearchParams\(\{|searchParams.(set|append)"`, `grep '/\$\{[^}]*(token|code|hash|secret|key|serial)[^}]*\}'` a `grep '(appUrl|baseUrl|…)/(cs|en|sk)/…/\$\{…\}'` (stavění odkazů). Každý řádek níže byl ověřen přečtením souboru; cesty souborů jsou relativní k `nextjs-boilerplate/src/`.

## A) tajemství v parametru dotazu

### A1) naše URL (stránky a API)

| cesta | parametr | co token umožňuje | kde vzniká (soubor:řádek) | kde se čte (soubor:řádek) |
|---|---|---|---|---|
| `/{locale}/reset-password` | `token` | nastavit nové heslo k účtu (převzetí účtu), TTL 1 h | `app/api/auth/forgot-password/route.ts:29` | `app/[locale]/reset-password/page.tsx:61` (dál v těle POST `/api/auth/reset-password`, :82) |
| `/cs/verify-email` | `token` | ověřit e-mail účtu | `app/api/auth/send-verification-email/route.ts:37` (token), `:39` (odkaz) | `app/[locale]/verify-email/page.tsx:22` |
| `/api/auth/verify-email` | `token` | totéž (API) | `app/[locale]/verify-email/page.tsx:33` | `app/api/auth/verify-email/route.ts:17` |
| `/cs/unsubscribe` | `token` | odhlásit uživatele z notifikací bez přihlášení (HMAC userId + rozsah) | `app/api/internal/broadcast-send/route.ts:56` (token), `:58` (odkaz) | `app/[locale]/unsubscribe/page.tsx:18` |
| `/api/auth/unsubscribe` (GET i POST, hlavička List-Unsubscribe) | `token` | totéž (API) | `app/api/internal/broadcast-send/route.ts:61`, `:89`; `app/[locale]/unsubscribe/page.tsx:31` | `app/api/auth/unsubscribe/route.ts:52` (GET), `:66` (POST) |
| `/api/auth/magic-link/verify` | `token` | **přihlásit se** do účtu bez hesla (TTL 15 min) | `app/api/auth/magic-link/request/route.ts:35-37` | `app/api/auth/magic-link/verify/route.ts:41` |
| `/api/newsletter/confirm` | `token` | potvrdit odběr newsletteru (double opt-in) | `app/api/newsletter/subscribe/route.ts:49` (token), `:65` (odkaz) | `app/api/newsletter/confirm/route.ts:14` |
| `/team/accept` | `token` | přijmout pozvánku do týmu promotéra (= přístup do administrace) | `app/api/admin/staff/route.ts:142`, `:162`; `app/api/admin/team/route.ts:123`, `:142` | `app/team/accept/page.tsx:14-15` (dál v těle POST `/api/team/accept`, `TeamAcceptClient.tsx:21`) |
| `/{locale}/gift/redeem` | `token` | náhled a převzetí darované objednávky (převod lístků na příjemce) | `app/api/checkout/route.ts:1747` (`gift_redeem_token = randomUUID()`); odkaz se v kódu nesestavuje | `app/[locale]/gift/redeem/page.tsx:16-17` |
| `/api/gift/redeem` | `token` | GET náhled daru (e-mail kupujícího, zpráva) | `app/[locale]/gift/redeem/GiftRedeemClient.tsx:26` | `app/api/gift/redeem/route.ts:43` |
| `/cs/lottery/redeem` | `token` | uplatnit výhru v loterii → předvyplněný checkout | `app/api/admin/events/[id]/lotteries/[lotteryId]/draw/route.ts:115` (token), `:149` (odkaz) | `app/[locale]/lottery/redeem/page.tsx:16-17` |
| `/api/lottery/redeem` | `token` | GET detail výhry (e-mail, jméno) | `app/[locale]/lottery/redeem/LotteryRedeemClient.tsx:29` | `app/api/lottery/redeem/route.ts:49` |
| `/cs/my-tickets/{ticketId}/memory` | `token` | HMAC magic token vstupenky (stejný jako SMS `/t/{token}`) → pamětní vstupenka bez přihlášení | `app/api/admin/commemorative/send/route.ts:101` | `app/[locale]/my-tickets/[ticketId]/memory/page.tsx:54` |
| `/api/tickets/{id}/memory` | `token` | totéž (API) | `app/[locale]/my-tickets/[ticketId]/memory/page.tsx:65` | `app/api/tickets/[id]/memory/route.ts:34`, ověření `:41` |
| `/api/tickets/{id}/share-card` | `token` | „auth" share karty; **hodnota se neověřuje** — projde jakákoli neprázdná | v kódu se nesestavuje | `app/api/tickets/[id]/share-card/route.tsx:19-20` |
| `/cs/checkout/pay-by-link/{orderId}` | `token` | HMAC platební odkaz telefonické objednávky; **stránka v aplikaci neexistuje** (404), odkaz ale odchází zákazníkovi | `app/api/admin/call-center/order/route.ts:77` (token), `:104`, `:168` (odkaz) | — (žádná stránka) |
| `/api/checkout/pay-by-link/{orderId}` | `token` | detail telefonické objednávky (jméno, e-mail zákazníka) | v kódu ho žádný klient nevolá | `app/api/checkout/pay-by-link/[orderId]/route.ts:35` |
| `/api/events/{id}/alert` (DELETE) | `token` | zrušit upozornění „Upozorni mě" | `app/api/events/[id]/alert/route.ts:42` (token), `:51` (vrací se v JSON) | `app/api/events/[id]/alert/route.ts:64` |
| `/api/events/{id}/waitlist` (DELETE) | `token` | hodnota = ID záznamu čekací listiny; spolu s `email` záznam zruší | `app/[locale]/waitlist/[eventId]/page.tsx:93` | `app/api/events/[id]/waitlist/route.ts:107` |
| `/cs/events/{id}` | `waitlistId` | hodnota = tentýž rušicí token čekací listiny jako výše | `app/api/internal/cron/waitlist-notify/route.ts:97` | nikde se nečte |
| `/api/v3/secure-entry/barcode` | `token` | token SDK `se_…` → vrací aktuální TOTP kód vstupenky (= vstup na akci), TTL 5 min | `lib/secure-entry/sdk.ts:47` přes `app/api/v3/tickets/[id]/secure-entry-token/route.ts:41` | `app/api/v3/secure-entry/barcode/route.ts:21` |
| `/api/payments/paypal/capture` | `token` | ID objednávky PayPal (doplňuje PayPal); samo o sobě není tajné, capture vyžaduje shodu s `orderId` | PayPal; návratová URL `lib/payment/provider.ts:165` | `app/api/payments/paypal/capture/route.ts:24` |
| `/api/payments/paypal/capture` | `orderId` | Tixly orderId = oprávnění ke stránce `/cs/order-confirmation/{orderId}` (viz B) | `lib/payment/provider.ts:165` | `app/api/payments/paypal/capture/route.ts:23` |
| `/cs/checkout` | `orderId` | totéž (návrat po zrušení / chybě platby) | `lib/payment/provider.ts:166`, `:239`; `app/api/checkout/route.ts:2431`; `app/api/payments/paypal/capture/route.ts:41`, `:49`, `:83`, `:138` | stránka checkoutu `orderId` nečte |
| `/api/distribution/catalog` | `key` | API klíč distributora (náhrada hlavičky `X-Partner-Key`) → katalog akcí + provize | partner (`platform.reseller_partners.api_key`) | `app/api/distribution/catalog/route.ts:15` |
| `/{locale}/queue/{eventId}` | `token` | token fronty (UUID) — pořadí ve frontě, po vpuštění opravňuje k nákupu | `app/[locale]/queue/[eventId]/QueueWaiter.tsx:81` (hodnota z `app/api/queue/[eventId]/join/route.ts:155`) | `app/[locale]/queue/[eventId]/page.tsx:18` |
| `/{locale}/checkout` | `queueToken` | vpuštění z fronty → nákup | `app/[locale]/queue/[eventId]/QueueWaiter.tsx:108` | `app/[locale]/checkout/page.tsx:538` (ověření `app/api/checkout/route.ts:653-667`) |
| `/{locale}/events/{id}/seats/kategorie` | `token` | rezervace sedadel (hold token, UUID); bez něj checkout místa odmítne | `app/[locale]/events/[id]/seats/SeatPicker.tsx:262-263` (hodnota z `app/api/events/[id]/seats/hold/route.ts:145`) | `app/[locale]/events/[id]/seats/kategorie/page.tsx:19` |
| `/{locale}/checkout` | `seatHoldToken` | totéž | `app/[locale]/events/[id]/seats/SeatPicker.tsx:270` | `app/[locale]/checkout/page.tsx:539` |
| `/{locale}/checkout` | `lotteryToken` | `entry_token` loterie → detail výhry | `app/[locale]/lottery/result/[token]/page.tsx:101` | `app/[locale]/checkout/page.tsx:235`, `:239` |
| `/{locale}/checkout` | `lotteryEntryId` | UUID výherního záznamu; checkout ho přijme bez vazby na kupujícího (`app/api/checkout/route.ts:1881-1899`) → nákup vyhraného kontingentu | `app/[locale]/lottery/result/[token]/page.tsx:101`; `app/[locale]/lottery/redeem/LotteryRedeemClient.tsx:72` | `app/[locale]/checkout/page.tsx:56`, `:537` |
| `/{locale}/checkout` | `groupInvitation` | token skupinové pozvánky → nákup v rámci skupiny | `app/api/group-invitations/[token]/route.ts:118` | `app/[locale]/checkout/page.tsx:567` |
| `/cs/events/{id}` | `groupInvitation` | totéž | `app/api/group-invitations/[token]/route.ts:119` | nikde se nečte |
| `/cs/rezervace/zrusit` | `token` | zrušit rezervaci míst (v DB jen hash) | `lib/theatre/reservations.ts:83` (token), `:230` (odkaz v e-mailu) | `app/[locale]/rezervace/zrusit/page.tsx:15` (dál v těle POST) |
| `/cs/rezervace/zrusit` | `code` | kód rezervace (druhá polovina dvojice `code` + `token`) | `lib/theatre/reservations.ts:230` | `app/[locale]/rezervace/zrusit/page.tsx:10` |
| `/api/admin/sales-stream` | `token` | **přístupový JWT promotéra** (z localStorage) v URL EventSource | `app/admin/live/page.tsx:61` (token), `:63` (URL) | routa ho nečte (auth `runAsPromoter`, `app/api/admin/sales-stream/route.ts:40`) |
| `/api/auth/oauth/callback/google` | `code` | jednorázový autorizační kód Google → tokeny → přihlášení | Google; redirect_uri `app/api/auth/oauth/google/route.ts:27` | `app/api/auth/oauth/callback/google/route.ts:42` |
| `/api/auth/oauth/callback/google` | `state` | CSRF hodnota, porovnává se s cookie `oauth_state` | `app/api/auth/oauth/google/route.ts:26` | `app/api/auth/oauth/callback/google/route.ts:43` |
| `/api/auth/oauth/callback/facebook` | `code` | autorizační kód Facebooku → tokeny → přihlášení | Facebook; redirect_uri `app/api/auth/oauth/facebook/route.ts:21` | `app/api/auth/oauth/callback/facebook/route.ts:36` |
| `/api/auth/oauth/callback/facebook` | `state` | CSRF hodnota (cookie `oauth_state`) | `app/api/auth/oauth/facebook/route.ts:20` | `app/api/auth/oauth/callback/facebook/route.ts:37` |
| `/api/admin/facebook/oauth/callback` | `code` | kód FB → přístupové tokeny stránek promotéra | Facebook; redirect_uri `app/api/admin/facebook/oauth/start/route.ts:34` | `app/api/admin/facebook/oauth/callback/route.ts:41` |
| `/api/admin/facebook/oauth/callback` | `state` | HMAC `userId.nonce.sig`; s platným `code` naváže FB stránky na promotéra i bez session (fallback přes userId ze state) | `app/api/admin/facebook/oauth/start/route.ts:31` | `app/api/admin/facebook/oauth/callback/route.ts:42` |
| `/api/admin/bank-credentials/psd2/callback` | `code` | kód banky → PSD2 access/refresh token k účtu promotéra | banka; redirect_uri `app/api/admin/bank-credentials/psd2/authorize/route.ts:35-36` | `app/api/admin/bank-credentials/psd2/callback/route.ts:17` |
| `/api/admin/bank-credentials/psd2/callback` | `state` | 32 B; podle něj se dohledá promotér (`oauth_state`) | `app/api/admin/bank-credentials/psd2/authorize/route.ts:25` | `app/api/admin/bank-credentials/psd2/callback/route.ts:18` |
| `/api/buyer/spotify/callback` | `code` | kód Spotify (PKCE) → access/refresh token | Spotify; redirect_uri `lib/spotify/oauth.ts:57` | `app/api/buyer/spotify/callback/route.ts:39` |
| `/api/buyer/spotify/callback` | `state` | dohledá `user_id` + `code_verifier` (`marketing.spotify_oauth_pending`) | `lib/spotify/oauth.ts:34` | `app/api/buyer/spotify/callback/route.ts:40` |
| `/oauth/authorize` (náš OAuth server) | `state` | state klienta (třetí strany), vracíme ho na jeho redirect_uri | klient třetí strany | `app/oauth/authorize/page.tsx:34-46`, `:104` |
| `{redirect_uri klienta}` (externí) | `code` | **náš** autorizační kód → výměna na `/api/oauth/token` za přístup k účtu uživatele | `app/oauth/authorize/ConsentForm.tsx:61` | klient třetí strany |
| `{redirect_uri klienta}` (externí) | `state` | state klienta | `app/oauth/authorize/ConsentForm.tsx:41`, `:61` | klient třetí strany |
| `/cs/order-confirmation/{orderId}` | `session_id` | ID Stripe Checkout Session (`cs_…`), doplňuje Stripe | `lib/payment/stripe.ts:86` | nikde se nečte |
| `/{locale}/login` | `redirect` | obsahuje vnořenou cestu `/{locale}/group/{token}` (viz B) | `app/[locale]/group/[token]/page.tsx:50` | přihlašovací stránka ho nečte (čte jen `from`, `error`: `app/[locale]/login/page.tsx:22-23`) |
| `/cs/login` | `next` | obsahuje vnořenou cestu `/cs/tickets/transfer/{token}` | `app/[locale]/tickets/transfer/[token]/page.tsx:42` | nikde se nečte |
| `/cs/login` | `next` | obsahuje vnořené parametry `/oauth/authorize` vč. `state` a `code_challenge` | `app/oauth/authorize/page.tsx:69-70` | nikde se nečte |

### A2) odchozí URL na třetí strany (do breadcrumbů a spanů `fetch` se dostanou celé)

| cesta | parametr | co token umožňuje | kde vzniká (soubor:řádek) | kde se čte (soubor:řádek) |
|---|---|---|---|---|
| `https://graph.facebook.com/v19.0/oauth/access_token` | `client_secret`, `code` | tajemství aplikace FB + kód uživatele | `app/api/auth/oauth/callback/facebook/route.ts:61-68` | Facebook |
| `https://graph.facebook.com/v19.0/me` | `access_token` | přístupový token uživatele FB | `app/api/auth/oauth/callback/facebook/route.ts:83` | Facebook |
| `https://graph.facebook.com/{ver}/oauth/access_token` | `client_secret`, `code` | tajemství aplikace FB + kód promotéra | `lib/facebook/graph.ts:86-90` | Facebook |
| `https://graph.facebook.com/{ver}/me/accounts` | `access_token` | přístupový token promotéra (vrací page tokeny) | `lib/facebook/graph.ts:140-143` | Facebook |
| `https://graph.facebook.com/{ver}/{pixelId}/events` | `access_token` | CAPI token promotéra | `lib/tracking/meta-capi.ts:92` | Meta |
| `https://www.google-analytics.com/mp/collect` | `api_secret` | API secret GA4 Measurement Protocol | `lib/tracking/ga4.ts:38` | Google |
| Songkick `…/events.json` | `apikey` | API klíč Songkick | `lib/music/providers/songkick.ts:38` | Songkick |
| Bandsintown `…/artists/{a}/events` | `app_id` | API klíč (app_id) Bandsintown | `lib/music/providers/bandsintown.ts:48` | Bandsintown |
| `https://api.qrserver.com/v1/create-qr-code/` (img src) | `data` | URI `otpauth://` s **TOTP secretem 2FA administrátora** | `app/admin/settings/TwoFactorSettings.tsx:129` (secret z `app/api/admin/2fa/setup/route.ts:75`) | qrserver.com |
| `https://api.qrserver.com/v1/create-qr-code/` (img src) | `data` | URI `otpauth://` s **TOTP secretem darované vstupenky** | `app/[locale]/gift/[token]/page.tsx:38` (payload z `app/api/gift/[token]/route.ts:303`) | qrserver.com |

## B) tajemství v segmentu cesty

### B1) naše URL (stránky a API)

| cesta | segment | co token umožňuje | kde vzniká (soubor:řádek) | kde se čte (soubor:řádek) |
|---|---|---|---|---|
| `/{locale}/t/{token}` | `token` (HMAC magic token vstupenky) | stránka s rotujícím TOTP QR = vstup na akci bez přihlášení | `app/api/internal/order-completed/route.ts:833-834` (SMS) | `app/[locale]/t/[token]/page.tsx:14` → `SmsTicketClient.tsx:37` |
| `/api/public/tickets/{token}/totp` | `token` | aktuální TOTP kód vstupenky | `app/[locale]/t/[token]/SmsTicketClient.tsx:37` | `app/api/public/tickets/[token]/totp/route.ts:32` |
| `/{locale}/charity/claim/{token}` | `token` (`claim_token`) | beneficient si vyzvedne vstupenku zdarma | `app/api/admin/charity/allocations/route.ts:29`, `:131` (token); `app/api/admin/charity/allocations/[id]/slots/route.ts:50` (odkaz) | `app/[locale]/charity/claim/[token]/page.tsx:25` |
| `/api/charity/claim/{token}` | `token` | GET náhled, POST vydání vstupenky zdarma | `app/[locale]/charity/claim/[token]/page.tsx:34`, `:51` | `app/api/charity/claim/[token]/route.ts:21`, `:49` (GET); `:87`, `:119` (POST) |
| `/{locale}/foyer/pickup/{token}` | `token` (`pickup_qr_token`) | detail objednávky ve foyer vč. e-mailu kupujícího | `app/api/foyer-orders/route.ts:85`, `:114` (vrací se v JSON; odkaz se v kódu nesestavuje) | `app/[locale]/foyer/pickup/[token]/page.tsx:55` (SQL `:26-32`) |
| `/{locale}/gift/{token}` | `token` (`gift_claims.claim_token`) | výběr akce a místa a uplatnění dárku — vydá vstupenku příjemci a vrátí její TOTP secret | `app/api/checkout/route.ts:2209` (DB RETURNING), `:2352` (vrací se v JSON); odkaz se v kódu nesestavuje | `app/[locale]/gift/[token]/page.tsx:55` |
| `/api/gift/{token}` | `token` | GET náhled, POST uplatnění (bez přihlášení) | `app/[locale]/gift/[token]/page.tsx:68`, `:107` | `app/api/gift/[token]/route.ts:35`, `:53` (GET); `:121` (POST) |
| `/{locale}/group/{token}` | `token` (pozvánka) | náhled skupinové pozvánky, odkaz do checkoutu s tokenem | `app/api/buyer/group-invitations/route.ts:44`, `:94`; `app/api/buyer/group-invitations/reserve/route.ts:35`, `:114` | `app/[locale]/group/[token]/page.tsx:38` |
| `/api/group-invitations/{token}` | `token` | veřejný náhled + vrací checkoutUrl s tokenem | `app/[locale]/group/[token]/page.tsx:70` | `app/api/group-invitations/[token]/route.ts:17`, `:54` |
| `/api/buyer/group-invitations/{token}/claim` | `token` | zabrat držené místo (vyžaduje přihlášení) | `app/[locale]/group/[token]/page.tsx:53` | `app/api/buyer/group-invitations/[token]/claim/route.ts:26`, `:48` |
| `/{locale}/lottery/result/{token}` | `token` (`entry_token`) | výsledek loterie + odkaz k nákupu | `app/api/admin/lottery/[campaignId]/draw/route.ts:118`, `:130`; `app/api/admin/lottery/[campaignId]/advance/route.ts:92`, `:104` | `app/[locale]/lottery/result/[token]/page.tsx:51` |
| `/api/lottery/entry/{token}` | `token` | detail záznamu loterie (e-mail, jméno) | `app/[locale]/lottery/result/[token]/page.tsx:61`; `app/[locale]/checkout/page.tsx:239` | `app/api/lottery/entry/[token]/route.ts:28` |
| `/{locale}/reschedule/{token}` | `token` (`response_token`) | volba přijmout / vrátit peníze při přesunu akce | `app/api/admin/events/[id]/reschedule/route.ts:145`, `:171`; `lib/theatre/term-lifecycle.ts:258`, `:291` | `app/[locale]/reschedule/[token]/page.tsx:31` |
| `/api/reschedule/{token}` | `token` | GET detail, POST změní odpověď a případně objednávku | `app/[locale]/reschedule/[token]/page.tsx:45`, `:63` | `app/api/reschedule/[token]/route.ts:31` (GET), `:81` (POST) |
| `/{locale}/review/{token}` | `token` (`review_token`) | napsat recenzi akce | DB (`marketing.event_reviews.review_token`, mig 367); v kódu aplikace se odkaz nesestavuje | `app/[locale]/review/[token]/page.tsx:29` |
| `/api/reviews/{token}` | `token` | GET náhled, POST uložení recenze | `app/[locale]/review/[token]/page.tsx:45`, `:65` | `app/api/reviews/[token]/route.ts:17`, `:29` (GET); `:55`, `:73` (POST) |
| `/{locale}/season-pass/{passToken}` | `passToken` (`pass_token`) | detail permanentky a čerpání vstupů — POST založí objednávku + vstupenku držiteli, bez přihlášení | `app/api/season-passes/route.ts:169-174`, `:208` (vrací se v JSON) | `app/[locale]/season-pass/[passToken]/page.tsx:55` |
| `/api/season-passes/{passToken}` | `passToken` | totéž (API) | `app/[locale]/season-pass/[passToken]/page.tsx:73`, `:103` | `app/api/season-passes/[passToken]/route.ts:34` (GET); `:107`, `:133` (POST) |
| `/{locale}/tickets/transfer/{token}` | `token` (`transfer_token`) | převzít převáděnou vstupenku (POST vyžaduje přihlášení) | `app/api/my/tickets/[ticketId]/transfer/route.ts:109`, `:121` (vrací se v JSON; odkaz se nesestavuje) | `app/[locale]/tickets/transfer/[token]/page.tsx:19` |
| `/api/tickets/transfer/{token}` | `token` | GET detail (e-mail příjemce), POST přijetí | `app/[locale]/tickets/transfer/[token]/page.tsx:29`, `:46` | `app/api/tickets/transfer/[token]/route.ts:27` (GET), `:63` (POST) |
| `/transfer/accept/{token}` (sestavuje se bez locale) | `token` | P2P převod; náhled bez přihlášení, přijetí s přihlášením | `app/api/buyer/tickets/[ticketId]/transfer-invite/route.ts:62`, `:83` | `app/[locale]/transfer/accept/[token]/page.tsx:37` |
| `/api/transfer/accept/{token}` | `token` | totéž (API) | `app/[locale]/transfer/accept/[token]/page.tsx:51`, `:67` | `app/api/transfer/accept/[token]/route.ts:42` (GET), `:98` (POST) |
| `/nabidka/{token}` | `token` (v DB jen hash) | agent vidí nabídku a přijme ji / odmítne / pošle protinávrh → smlouva + rozpočet akce | `app/api/admin/events/[id]/offers/[offerId]/send/route.ts:63`, `:82` | `app/nabidka/[token]/page.tsx:64` |
| `/api/offers/{token}`, `/api/offers/{token}/respond` | `token` | totéž (API) | `app/nabidka/[token]/page.tsx:80`, `:108` | `app/api/offers/[token]/route.ts:75`; `app/api/offers/[token]/respond/route.ts:96` |
| `/party/{token}` (**stránka neexistuje**) | `token` (`share_token`) | sdílený odkaz na dělenou platbu | `app/api/checkout/party-split/route.ts:128`, `:144` | — (žádná stránka) |
| `/api/checkout/party-split/{token}` | `token` | GET stav dělené platby, POST zabrat a zaplatit slot | v kódu ho žádný klient nevolá | `app/api/checkout/party-split/[token]/route.ts:82` (GET), `:150` (POST) |
| `/api/queue/{eventId}/status/{token}` | `token` (UUID fronty) | stav ve frontě + vpuštění při dotazu | `app/[locale]/queue/[eventId]/QueueWaiter.tsx:94` (hodnota z `app/api/queue/[eventId]/join/route.ts:139`, `:155`) | `app/api/queue/[eventId]/status/[token]/route.ts:42`, `:52` |
| `/api/vouchers/{code}/pdf` | `code` | PDF dárkového poukazu (kód je sdílené tajemství, uplatní se v checkoutu) | `app/admin/vouchers/page.tsx:105`; `app/mock-voucher/[paymentId]/page.tsx:96`; generuje `app/api/admin/vouchers/route.ts:21`, `app/api/p/[slug]/vouchers/checkout/route.ts:27` | `app/api/vouchers/[code]/pdf/route.ts:23` |
| `/api/buyer/gift-cards/{code}` | `code` | zůstatek dárkové karty (kód je tajemství) | `app/[locale]/checkout/page.tsx:377` (kód zadává kupující); generuje `app/api/admin/gift-cards/route.ts:25` | `app/api/buyer/gift-cards/[code]/route.ts:11` |
| `/api/buyer/announcements/{token}/respond` | `token` (ve skutečnosti `announcement_id`) | odpověď na oznámení; `refund_requested` přepne objednávku — bez přihlášení a bez vazby na uživatele | v kódu se nesestavuje | `app/api/buyer/announcements/[token]/respond/route.ts:18` (SQL `:31-36`, `:45-49`) |
| `/cs/order-confirmation/{orderId}` | `orderId` | **oprávnění (capability)**: bez přihlášení ukáže objednávku (e-mail kupujícího, ID vstupenek; SQL načítá i `streaming_url`); stránka má Meta/Pixel skripty promotéra | `lib/payment/provider.ts:79`, `:100`, `:137`, `:187`; `app/api/checkout/route.ts:2430` | `app/[locale]/order-confirmation/[orderId]/page.tsx:136` (komentář `:53`) |

### B2) odchozí URL na třetí strany

| cesta | segment | co token umožňuje | kde vzniká (soubor:řádek) | kde se čte (soubor:řádek) |
|---|---|---|---|---|
| `{FIO_API_BASE}/rest/last/{token}/transactions.json`, `/rest/periods/{token}/…`, `/rest/set-last-id/{token}/…` | `token` | API token Fio banky promotéra (čtení pohybů na účtu) | `lib/bank/fio.ts:105`, `:130`, `:149` | Fio |
| `{P24 BASE}/trnRequest/{token}` | `token` | transakční token Przelewy24 (přesměrování kupujícího na platbu) | `lib/payment/przelewy24.ts:142` | Przelewy24 |

## C) výsledný seznam názvů parametrů k maskování

Povinný seznam: `token`, `code`, `key`, `secret`, `signature`, `sig`, `hash`, `otp`, `password`, `access_token`, `refresh_token`, `sessionId`, `session_id`.

Doplněno z tabulky A1 (naše URL):
- `state` — v callbacku admin FB (`app/api/admin/facebook/oauth/callback/route.ts:42`) je to HMAC s userId, který spolu s `code` naváže stránky i bez session; v PSD2 (`…/psd2/callback/route.ts:18`) a Spotify (`…/spotify/callback/route.ts:40`) podle něj server dohledá promotéra / uživatele + PKCE verifier.
- `queueToken` — vpuštění z virtuální fronty k nákupu (`app/[locale]/checkout/page.tsx:538`).
- `seatHoldToken` — rezervace konkrétních sedadel (`app/[locale]/checkout/page.tsx:539`).
- `lotteryToken` — `entry_token` loterie, otevírá detail výhry (`app/[locale]/checkout/page.tsx:235`).
- `lotteryEntryId` — UUID výhry, které checkout přijme bez vazby na kupujícího (`app/api/checkout/route.ts:1881-1899`).
- `groupInvitation` — token skupinové pozvánky (`app/[locale]/checkout/page.tsx:567`).
- `waitlistId` — hodnota = rušicí token čekací listiny (`app/api/events/[id]/waitlist/route.ts:107`, SQL `:113-118`).
- `orderId` — orderId je oprávnění ke stránce `/cs/order-confirmation/{orderId}` bez přihlášení (`page.tsx:53`, `:136`).
- `next`, `redirect` — mohou nést vnořenou cestu s tokenem (`/cs/tickets/transfer/{token}`, `/{locale}/group/{token}`) nebo parametry OAuth (`app/[locale]/tickets/transfer/[token]/page.tsx:42`, `app/[locale]/group/[token]/page.tsx:50`, `app/oauth/authorize/page.tsx:69-70`). Alternativa: hodnotu nemaskovat celou, ale prohnat ji stejnou maskou cest jako v B.

Doplněno z tabulky A2 (odchozí volání; týká se breadcrumbů a spanů `fetch`/`http`):
- `client_secret` — tajemství aplikace FB (`lib/facebook/graph.ts:87`, `app/api/auth/oauth/callback/facebook/route.ts:63`).
- `api_secret` — secret pro GA4 Measurement Protocol (`lib/tracking/ga4.ts:38`).
- `apikey` — API klíč Songkick (`lib/music/providers/songkick.ts:38`).
- `app_id` — API klíč Bandsintown (`lib/music/providers/bandsintown.ts:48`).
- `data` — jen u hostitele `api.qrserver.com`: nese `otpauth://…?secret=` (`app/admin/settings/TwoFactorSettings.tsx:129`, `app/[locale]/gift/[token]/page.tsx:38`). Jde o `img src`, takže to není `fetch` breadcrumb, ale samotný secret odchází třetí straně.

Segmenty cest k maskování (z B): `/t/*`, `/api/public/tickets/*/totp`, `/charity/claim/*`, `/api/charity/claim/*`, `/foyer/pickup/*`, `/gift/*` (kromě `/gift/redeem`), `/api/gift/*` (kromě `/api/gift/redeem`), `/group/*`, `/api/group-invitations/*`, `/api/buyer/group-invitations/*/claim`, `/lottery/result/*`, `/api/lottery/entry/*`, `/reschedule/*`, `/api/reschedule/*`, `/review/*`, `/api/reviews/*`, `/season-pass/*`, `/api/season-passes/*`, `/tickets/transfer/*`, `/api/tickets/transfer/*`, `/transfer/accept/*`, `/api/transfer/accept/*`, `/nabidka/*`, `/api/offers/*`, `/party/*`, `/api/checkout/party-split/*`, `/api/queue/*/status/*`, `/api/vouchers/*/pdf`, `/api/buyer/gift-cards/*`, `/api/buyer/announcements/*/respond`, `/order-confirmation/*`; odchozí `…/rest/(last|periods|set-last-id)/*` (Fio) a `…/trnRequest/*` (P24).

## D) zvažováno a vyřazeno

- `orderId` v administraci a v API kupujícího (`/admin/orders?eventId`, `/api/buyer/loyalty?orderId` `app/api/buyer/loyalty/route.ts:18`, `/api/foyer-orders?orderId` `app/api/foyer-orders/route.ts:135` + `runAsUser`, `/api/buyer/orders/{orderId}/…`) — vyžadují přihlášení. Do C se `orderId` přesto dostal kvůli stránce order-confirmation (B).
- `ticketId` (`/admin/scanner?ticketId`, `/api/buyer/resale/list?ticketId`) — admin / přihlášený kupující; ke vstupu je potřeba ještě TOTP nebo tiskový token.
- `eventId`, `ticketTypeId`, `eventDayId`, `entrySlotId`, `quantity`, `seatIds`/`seats` — veřejné identifikátory; sedadla bez hold tokenu checkout nepřijme.
- `buyerEmail`, `buyerName` (`app/[locale]/checkout/page.tsx:44`, `:47`), `email` (`/api/buyer/passkeys/authenticate`, `/api/events/{id}/waitlist`) — osobní údaje, ne tajemství (řeší se nastavením PII, ne maskou tokenů).
- `ref`, `/r/{code}` (`app/r/[code]/route.ts:25-34`), `qr_ref`, `utm_*` (`app/api/qr/[slug]/route.ts:81-84`) — veřejné marketingové a afiliátní kódy.
- `id` / `paymentId` u GoPay webhooku (`app/api/payments/gopay/webhook/route.ts:84`) — stav se autoritativně ověřuje dotazem na GoPay API (`:96-99`); bez konfigurace fail-closed.
- `external_id` u benefit callbacků (`app/api/payments/benefit/pluxee/callback/route.ts:57-60`) — rozhoduje podepsaná notifikace; routa `/api/payments/benefit/return` z `lib/payment/benefit-providers/*.ts` v aplikaci neexistuje.
- Mollie `id` — přichází v těle POST (`app/api/payments/mollie/webhook/route.ts:35-38`), ne v URL.
- Apple Sign In callback — `response_mode=form_post`, `id_token`/`state` jsou v těle POST (`app/api/auth/oauth/callback/apple/route.ts:42-55`).
- PayPal `PayerID` — nikde se nečte, je to jen identifikátor.
- `/oauth/authorize`: `client_id`, `redirect_uri`, `scope`, `response_type`, `code_challenge`, `code_challenge_method` — veřejné parametry (challenge je hash verifieru).
- `job` na `/api/cron/dispatch` — autorizace jde jen přes hlavičky (`lib/security/cron-auth.ts:15-29`).
- `id` na `/api/auth/sessions` (DELETE) — ID řádku session, ne token; vyžaduje přihlášení (`app/api/auth/sessions/route.ts:35-38`).
- `clientId` (`/api/buyer/connected-apps`), `shareId`, `overrideId`, `rule_id`, `expId`, `moduleId`, `reportId`, `actorId` — identifikátory za admin / uživatelskou autentizací.
- `as` na `/dev-login`, `from`, `error`, `connected`, `mock`, `status`, `awaiting`, `canceled`, `paypal_error` — UI/návratové parametry bez tajemství (kromě výjimek `next`/`redirect` v A).
- `host` (`/api/public/branding`), `vatNumber` (`/api/tax/vies-check`), `seed` (`/api/ai/cover-stub`), `urls` (`/api/health/external`) — veřejné hodnoty.
- Veřejné slugy a ID v cestě: `/kiosk/{slug}`, `/embed/promoter/{slug}`, `/p/{slug}`, `/signage/{venueId}`, `/api/qr/{slug}`, `/artists/{slug}` — veřejné stránky; nákup přes kiosek jde přes `/api/kiosk/` s přihlášením (`middleware.ts:66`).
- Admin cesty `/api/admin/customers/{email}` (PII v cestě), `/api/admin/dashboards/{key}`, `/api/admin/wristbands/{uid}`, `/api/admin/ares/{ico}` — za admin autentizací; nejde o přenositelné tajemství (u `{email}` jde o PII).
- Apple Wallet `/api/wallet/apple/v1/devices/{deviceLibraryId}/registrations/{passTypeId}/{serialNumber}` — tajemství je v hlavičce `ApplePass …`; segmenty jsou identifikátory. (Mimochodem: routa přijme jakýkoli neprázdný ApplePass token, `…/[serialNumber]/route.ts:27-29`.)
- Mock cesty `/api/vouchers/holders/{paymentId}/confirm` a `/api/subscriptions/holders/{paymentId}/confirm` (volá je i stránka `/mock-voucher/{paymentId}`) — v produkci vždy 404 (`lib/payment/demo-path-guard.ts:8-9`, `:20-29`; import v obou routách). U `/mock-bnpl/{provider}/{paymentId}`, `/mock-benefit/…` a `/mock-qes/{requestId}` jsem blokaci v produkci neověřoval; jde o simulátory.
- Tiskové tokeny `TXP1`/`TXP2` — jen v těle POST skeneru (`app/api/admin/scanner/validate/route.ts:29`, `…/passage/route.ts:46`, `…/offline-sync/route.ts:25`) a v QR na papíře, ne v URL.
- B2B `inviteToken` — zadává se do formuláře a posílá v těle POST (`app/b2b/login/page.tsx:22`).
- URI `otpauth://…?secret=` (`app/api/admin/2fa/setup/route.ts:75`, `app/api/gift/[token]/route.ts:303`, `lib/tickets/fan-ticket-renderer.ts:176`, `lib/tickets/pdf-renderer.ts:322`) — nejsou to HTTP URL (obsah QR); `secret` je beztak v povinném seznamu a únik přes qrserver je uveden v A2.
- Feedy `/api/v1/feed/*` (`promoterId`, `category`, `city`, `promoter_id`, `format`) — veřejné, bez tokenu.
- `/api/oauth/token` — kód a verifier jdou v těle POST.

## E) rozhodnutí kola 21 (maskování v scrub-pii.ts, `URL_SECRET_PARAMS`)
Ručně ověřeno čtením: `app/[locale]/checkout/page.tsx:234,538-539,567`, `app/api/events/[id]/waitlist/route.ts:107-118`,
`app/api/admin/facebook/oauth/callback/route.ts:42`, `lib/facebook/graph.ts:87`, `lib/tracking/ga4.ts:38`,
`lib/music/providers/songkick.ts:38`, `lib/music/providers/bandsintown.ts:48`, `app/api/auth/forgot-password/route.ts:27-29`,
`app/[locale]/events/[id]/seats/SeatPicker.tsx:262-263`.
- Maskuje se (27 názvů, přesná shoda bez ohledu na velikost písmen): povinných 13 + `state`, `queueToken`, `seatHoldToken`,
  `lotteryToken`, `lotteryEntryId`, `groupInvitation`, `waitlistId`, `orderId`, `next`, `redirect`, `client_secret`,
  `api_secret`, `apikey`, `app_id`. `next`/`redirect` se maskují celé (jednodušší a bezpečnější než maska cest).
- `data` (jen api.qrserver.com, otpauth secret v src obrázku): **nezařazeno** — obecný název (a v `deny` SDK páruje podřetězec),
  hodnota neodchází přes Sentry, ale přímo z prohlížeče třetí straně → kandidát na další kolo (jiné řešení: QR generovat lokálně).
- Tajemství v segmentu cesty (tabulka B) se v kole 21 **neopravují** — kandidáti na další kolo (viz ROUND21_REPORT.md).
