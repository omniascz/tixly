# Tixly — inventura pro produkční spuštění (go-live)

> **Zdroj:** výhradně kód a konfigurace v lokálním repu (`C:\Users\omnia\Documents\tixly`, větev `fix/round9-golive-2026-10-04`, stav k 2026-10-04).
> Nebylo se připojováno k žádné databázi, k Vercelu ani k poskytovatelům. Vše níže je **odvozeno z kódu, ne ověřeno proti běžící produkci**.
> Cesty `src/…`, `scripts/…`, `next.config.mjs`, `vercel.json` jsou relativní k `nextjs-boilerplate/`; `.github/…` a `migrations/…` k rootu repa.
> Kde něco z kódu zjistit nejde, je uvedeno **„nezjištěno z kódu"**.

---

## Obsah

1. [Env proměnné](#1-env-proměnné)
2. [E-mail](#2-e-mail)
3. [GitHub secrets](#3-github-secrets)
4. [Cron úlohy](#4-cron-úlohy)
5. [DB role a práva](#5-db-role-a-práva)
6. [Doména, HTTPS, CSRF, webhooky](#6-doména-https-csrf-webhooky)
7. [Shrnutí pro vlastníka](#7-shrnutí-pro-vlastníka)

---

## 1. Env proměnné

Seznam vychází z `logs/r9/3_env_usage.txt` (206 jmen `process.env.X` v `nextjs-boilerplate/`). Klasifikace:

- **povinná** — bez ní produkce nefunguje, nebo funguje nebezpečně (fail-closed pád, tichý fallback na localhost/mock, demo vodoznak),
- **volitelná** — zapíná doplňkovou funkci / integraci, nebo má rozumný default,
- **jen dev/test** — test, simulátor, override URL na fake server, dev přepínač; **v produkci nenastavovat** (u některých by nastavení bylo bezpečnostní díra — označeno ⛔),
- **nepoužívá se v prod** — nastavuje platforma sama, je to mrtvý kód, nebo se nesmí nastavovat.

**Počty:** povinná **21** · volitelná **144** · jen dev/test **34** · nepoužívá se v prod **7** · celkem **206**. Spočteno skriptem nad tabulkami níže.

Do povinných se počítají tři proměnné GoPay a dvě ComGate jako alternativy. Reálně je povinných 16 společných + buď 3 (GoPay), nebo 2 (ComGate).

> Pozn.: `NEXT_PUBLIC_*` se do klientského JS **vkládají při buildu** — po změně je nutný nový build/deploy.
> Pozn.: kód čte i jména, která v `3_env_usage.txt` nejsou, protože se k nim přistupuje dynamicky: `KB_PSD2_CLIENT_ID/SECRET`, `CS_PSD2_CLIENT_ID/SECRET`, `CSOB_PSD2_CLIENT_ID/SECRET` (`src/lib/bank/psd2.ts:42-61,75`) — volitelné (PSD2 napojení bank).
> Pozn.: `.env.example` obsahuje proměnné, které kód **nečte** (0 výskytů `process.env.X`): `GOPAY_MOCK`, `GOPAY_REDIRECT_URL`, `NEXTAUTH_SECRET`, `KAFKA_*`, `CLOUDFLARE_*`, `POSTGRES_*`, `REDIS_HOST/PORT/PASSWORD`, `DEBUG` — není třeba je nastavovat.

### 1.1 Databáze, pool, Redis, health

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `DATABASE_URL` | Connection string runtime poolu aplikace; musí být role `tixly_app` (NOBYPASSRLS) | **povinná** | Neon konzole → projekt → Connection details (pooled host); role `tixly_app`, heslo nastavit `ALTER ROLE tixly_app WITH PASSWORD …` (`migrations/000_baseline_globals.sql:15`) | `src/lib/db/rls-pool.ts:86` |
| `DATABASE_URL_DIRECT` | Samostatný pool pro `connect()` (transakce); bez ní se použije `DATABASE_URL` | volitelná | Neon konzole → Connection details, **ne-pooled** host, role `tixly_app` | `src/lib/db/rls-pool.ts:73` |
| `DATABASE_URL_OPS` | Owner/superuser URL pro ops skripty (migrace, opravy); runtime ji nečte | jen dev/test | (ops) Neon konzole → role `neondb_owner` | `scripts/prod-migrate-runner.mjs:15` |
| `DATABASE_URL_SUPER` | Test izolace tenantů | jen dev/test | — | `src/lib/db/rls-tenant-isolation.test.ts:31` |
| `DATABASE_URL_APP` | Test izolace tenantů | jen dev/test | — | `src/lib/db/rls-tenant-isolation.test.ts:25` |
| `RLS_TENANT_DB` | Zapíná DB test izolace tenantů | jen dev/test | — | `src/lib/db/rls-tenant-isolation.test.ts:72` |
| `RLS_POOL_DEBUG` | `=1` loguje chyby/odebrání spojení z poolu | volitelná | — (diagnostika) | `src/lib/db/rls-pool.ts:98` |
| `PG_POOL_MAX` | Max spojení hlavního poolu (default 10) | volitelná | — | `src/lib/db/rls-pool.ts:89` |
| `PG_IDLE_TIMEOUT_MS` | Idle timeout hlavního poolu (default 30000) | volitelná | — | `src/lib/db/rls-pool.ts:96` |
| `PG_DIRECT_POOL_MAX` | Max spojení connect-poolu (default 4) | volitelná | — | `src/lib/db/rls-pool.ts:74` |
| `PG_DIRECT_IDLE_TIMEOUT_MS` | Idle timeout connect-poolu (default 10000) | volitelná | — | `src/lib/db/rls-pool.ts:77` |
| `PG_STATEMENT_TIMEOUT_MS` | statement_timeout obou poolů (default 15000) | volitelná | — | `src/lib/db/rls-pool.ts:75` |
| `REDIS_URL` | Fronta (virtual queue) + rate-limit; bez ní rate-limit jen in-memory per instance | volitelná (silně doporučená) | Vercel Marketplace → Upstash Redis (dle `.env.example:27`) | `src/lib/queue/redis-queue.ts:27` |
| `HEALTH_CHECK_DB_TIMEOUT` | Timeout DB v health checku (default 1000 ms) | volitelná | — | `src/lib/health-check/health.integration.ts:102` |
| `HEALTH_CHECK_REDIS_TIMEOUT` | Timeout Redis v health checku (default 100 ms) | volitelná | — | `src/lib/health-check/health.integration.ts:103` |
| `HEALTH_CHECK_EXTERNAL_TIMEOUT` | Timeout externích API v health checku (default 5000 ms) | volitelná | — | `src/lib/health-check/health.integration.ts:104` |
| `EXTERNAL_HEALTH_CHECK_APIS` | Seznam externích URL pro health check | volitelná | — | `src/lib/health-check/health.integration.ts:64` |

### 1.2 Auth, kryptografie, interní tokeny, bezpečnost

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `JWT_SECRET` | Podpis JWT (přihlášení); v produkci min. 32 znaků, jinak throw (fail-closed) | **povinná** | vygenerovat: `openssl rand -hex 64` | `src/lib/auth.ts:17-21`, `src/middleware.ts:15-17` |
| `JWT_ACCESS_TOKEN_TTL` | Platnost access tokenu (default 900 s) | volitelná | — | `src/lib/auth.ts:7` |
| `JWT_REFRESH_TOKEN_TTL` | Platnost refresh tokenu (default 604800 s) | volitelná | — | `src/lib/auth.ts:8` |
| `ENCRYPTION_KEY` | AES-256-GCM pro data v klidu (bankovní/PSD2 tokeny, Fio tokeny…); bez ní throw. **Po nasazení neměnit** — znehodnotí zašifrovaná data | **povinná** | vygenerovat: `openssl rand -hex 32` (64 hex znaků) | `src/lib/crypto/index.ts:9-10` |
| `EMAIL_VERIFY_SECRET` | HMAC tokenů ověření e-mailu a odhlášení; fallback `JWT_SECRET` | volitelná (doporučeno dedikovat) | `openssl rand -hex 32` | `src/lib/email-verification/token.ts:21` |
| `TICKET_MAGIC_SECRET` | HMAC magic-linku SMS vstupenky; fallback `JWT_SECRET` | volitelná (doporučeno) | `openssl rand -hex 32` | `src/lib/tickets/magic-token.ts:19` |
| `NFC_SIGNING_KEY` | Podpis NFC/skupinových/tiskových tokenů; fallback `JWT_SECRET` | volitelná (doporučeno) | `openssl rand -hex 32` | `src/lib/safetix/nfc.ts:27` |
| `RESELLER_JWT_SECRET` | Podpis JWT prodejců (resellerů); fallback `JWT_SECRET` | volitelná (doporučeno) | `openssl rand -hex 32` | `src/lib/reseller-auth.ts:8` |
| `IP_HASH_SALT` | Salt pseudonymizace IP v consent logu; v produkci bez ní throw → POST `/api/consent` 500 | **povinná** | `openssl rand -hex 32` | `src/app/api/consent/route.ts:28-30` |
| `HMAC_SECRET` | Salt hashe IP v DSA hlášeních; fallback **prázdný řetězec** (tichý) | **povinná** | `openssl rand -hex 32` | `src/lib/compliance/dsa.ts:68` |
| `FACEBOOK_STATE_SECRET` | Podpis OAuth `state` (FB); fallback `INTERNAL_SERVICE_TOKEN` | volitelná | `openssl rand -hex 32` | `src/app/api/admin/facebook/oauth/state-secret.ts:11` |
| `CRON_SECRET` | Autorizace cron rout (`Authorization: Bearer`); bez ní všechny crony 403 (fail-closed) | **povinná** | vygenerovat `openssl rand -hex 32` a uložit do Vercel env (`.env.example:135` tvrdí „Vercel automaticky vygeneruje" — ověřit, kód to nezaručuje) | `src/lib/security/cron-auth.ts:13` |
| `INTERNAL_SERVICE_TOKEN` | Token `x-internal-token` mezi vlastními endpointy (dispatcher → interní crony, webhooky → order-completed) | **povinná** | `openssl rand -hex 32` | `src/lib/security/cron-auth.ts:27`, `src/app/api/cron/dispatch/route.ts:98` |
| `INTERNAL_API_TOKEN` | Alternativní jméno interního tokenu — **má přednost** před `INTERNAL_SERVICE_TOKEN` v `verifyInternalToken`; dispatcher ale posílá `INTERNAL_SERVICE_TOKEN` | nepoužívá se v prod (**nenastavovat**, jinak 3 crony 401) | — | `src/lib/internal-auth.ts:22` |
| `INTERNAL_API_SECRET` | Alternativní token pro ruční `/api/internal/pricing/recalculate` | volitelná | `openssl rand -hex 32` | `src/app/api/internal/pricing/recalculate/route.ts:25` |
| `NEXT_PUBLIC_INTERNAL_API_SECRET` | Tlačítko „přepočet" v adminu posílá tuto hodnotu z **prohlížeče** — veřejná | jen dev/test ⛔ (nastavení = únik interního tokenu) | — | `src/app/admin/events/[id]/dynamic-pricing/page.tsx:241` |
| `HCAPTCHA_SECRET` | Server-side ověření hCaptcha; bez ní mock-pass. Fakticky mrtvé: widget `HCaptchaWidget` není nikde v UI použit a `captchaToken` se nikde nepředává | nepoužívá se v prod (mrtvý kód) | hCaptcha dashboard → Settings → Secret | `src/lib/bot-detection/detect.ts:63-65` |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | Site key pro widget (widget se nikde nerenderuje; CSP navíc `js.hcaptcha.com` nepovoluje) | nepoužívá se v prod (mrtvý kód) | hCaptcha dashboard → Sites | `src/components/security/HCaptchaWidget.tsx:52` |
| `TIXLY_OTP_DEV_LEAK` | `=1` vrací OTP kód v odpovědi API — **bez NODE_ENV pojistky** | jen dev/test ⛔ | — | `src/app/api/buyer/otp/request/route.ts:95` |

### 1.3 Veřejná URL, web, provoz, feature flagy

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `APP_URL` | Veřejná URL serveru — notification/return URL plateb, CSRF allowlist, odkazy; fallback `http://localhost:3000` | **povinná** | vlastní doména, např. `https://app.tixly.cz` (bez lomítka na konci) | `src/app/api/checkout/route.ts:2395`, `src/lib/security/csrf.ts:53` |
| `NEXT_PUBLIC_APP_URL` | Totéž pro klienta + cron dispatcher (self-fetch), odkazy v e-mailech; fallback localhost nebo `''` | **povinná** (stejná hodnota jako `APP_URL`) | vlastní doména | `src/app/api/cron/dispatch/route.ts:97` |
| `NEXT_PUBLIC_FEATURE_INSTALLMENTS` | **Kolo 10:** splátky (plány splátek, BNPL Twisto / Skip Pay, cron charge-installments). Vypnuto → checkout 422 `FEATURE_DISABLED`, API 404, UI skryté | **nenastavovat** (výchozí vypnuto; zapíná jen `1`; vkládá se při buildu) | — | `src/lib/features/launch-flags.ts` |
| `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS` | **Kolo 10:** předplatné / permanentky / abonentky (aktivace, checkout, uplatnění v checkoutu, cron renew-subscriptions). Vypnuto → 422 / 404, stránky 404 | **nenastavovat** | — | `src/lib/features/launch-flags.ts` |
| `NEXT_PUBLIC_FEATURE_BENEFIT_CARDS` | **Kolo 10:** benefitní karty (Pluxee, Edenred, …; chybí návratová URL). Vypnuto → checkout 422, callbacky 404, UI skryté | **nenastavovat** | — | `src/lib/features/launch-flags.ts` |
| `NEXT_PUBLIC_API_URL` | Prefix API pro klienta; prázdné = stejný origin | volitelná | — | `src/lib/api.ts:11` |
| `EMBED_ALLOWED_ORIGINS` | CORS pro embed endpointy (ticket-types, checkout, seats); default `*` | volitelná (doporučeno omezit) | seznam domén promotérů | `next.config.mjs:135` |
| `EMBED_FRAME_ANCESTORS` | CSP `frame-ancestors` pro `/embed/*`; default `*` | volitelná (doporučeno omezit) | seznam domén promotérů (mezerou oddělené) | `next.config.mjs:78` |
| `NODE_ENV` | Režim běhu; na **všech** fail-closed pojistkách závisí `=== 'production'` | nepoužívá se v prod (nastavuje Vercel/Next automaticky — **nepřepisovat**) | — | `src/lib/payment/mock-guard.ts:12` |
| `NEXT_RUNTIME` | Rozlišení nodejs/edge v instrumentaci | nepoužívá se v prod (nastavuje Next) | — | `src/instrumentation.ts:9` |
| `APP_VERSION` | Release tag pro Sentry (server) | volitelná | např. git SHA | `sentry.server.config.ts:20` |
| `NEXT_PUBLIC_APP_VERSION` | Release tag pro Sentry (klient) | volitelná | např. git SHA | `sentry.client.config.ts:23` |
| `NEXT_PUBLIC_ENV` | Jméno prostředí v Sentry (klient) | volitelná | — | `sentry.client.config.ts:22` |
| `TRACE_LOG` | `=1` zapne trace logy v produkci | volitelná | — | `src/lib/tracing/span.ts:44` |
| `NEXT_PUBLIC_FEATURE_ACTOR_PROFILES` | Feature flag stránek profilů herců (`'true'`) | volitelná | — | `src/app/[locale]/actors/[id]/page.tsx:64` |
| `MODERATION_AUTO_PUBLISH_DISABLED` | `=1` → žádná akce se nepublikuje automaticky, vždy schvaluje master admin | volitelná (doporučeno `1` na start, `.env.example:155`) | — | `src/lib/moderation/ai-gate.ts:340` |
| `MODERATION_PROVIDER` | `mock` vynutí mock moderaci i s klíčem | volitelná (v prod **nenastavovat `mock`**) | — | `src/lib/moderation/ai-gate.ts:292` |
| `TICKET_PDF_PRODUCTION_MODE` | `=1` skryje vodoznak „Demo vstupenka" v PDF | **povinná** (`1`) | — | `src/lib/tickets/label-pdf.ts:73`, `src/lib/tickets/pdf-renderer.ts:87` |
| `PLATFORM_ADMIN_EMAIL` | Adresa pro urgentní alerty (DSA high-severity, AML) a **kolo 14: upozornění provozu** (cron neproběhl > 2× interval, selhání webhooku brány, zaplaceno bez vstupenek po 10 min, selhání e-mailu se vstupenkami, refund_failed, selhání zálohy; nejvýš 1 e-mail / 30 min na problém) a **denní souhrn v 7:00** Europe/Prague; bez ní se upozornění jen zapíše do `monitoring.ops_events` | **povinná pro hlídání provozu** | e-mail provozovatele (schránka, kterou někdo čte) | `src/lib/notifications/platform-notify.ts:15`, `src/lib/ops/alerts.ts`, `src/app/api/internal/cron/ops-daily-summary/route.ts` |

### 1.4 Platby — výběr brány a mock pojistky

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `PAYMENT_PROVIDER` | Globální karetní brána `gopay`/`comgate`/`stripe`; default `mock` → v produkci checkout **throw** (fail-closed) | **povinná** | rozhodnutí: `gopay` nebo `comgate` | `src/lib/payment/provider.ts:67` |
| `PAYMENT_PROVIDER_EUR` | Override brány pro EUR (SK) | volitelná | — | `src/lib/payment/provider.ts:60` |
| `ALLOW_MOCK_PAYMENTS` | `=1` povolí mock brány i v produkci (lístky bez platby) | jen dev/test ⛔ | — | `src/lib/payment/mock-guard.ts:12` |
| `ENABLE_DEMO_PAYMENT_PATHS` | Demo cesty bez platby; v produkci vždy vypnuto bez ohledu na flag | jen dev/test | — | `src/lib/payment/demo-path-guard.ts:22` |

### 1.5 Platby — GoPay

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `GOPAY_GOID` | GoID obchodníka (číslo) | **povinná** (při `PAYMENT_PROVIDER=gopay`) | administrace GoPay (sekce integrace / API přístupy) po aktivaci obchodního účtu | `src/lib/payment/gopay-real.ts:31` |
| `GOPAY_CLIENT_ID` | OAuth2 ClientID | **povinná** (při GoPay) | administrace GoPay (sekce API přístupy) | `src/lib/payment/gopay-real.ts:32` |
| `GOPAY_CLIENT_SECRET` | OAuth2 ClientSecret | **povinná** (při GoPay) | administrace GoPay (sekce API přístupy) | `src/lib/payment/gopay-real.ts:33` |
| `GOPAY_SANDBOX` | `true` → sandbox `gw.sandbox.gopay.com` | volitelná (v prod **nenastavovat / false**) | — | `src/lib/payment/gopay-real.ts:34` |
| `GOPAY_API_BASE_URL` | Override base URL (simulátor `tests/helpers/fake-gopay`) | jen dev/test | — | `src/lib/payment/gopay-real.ts:36` |
| `GOPAY_REFUND_TIMEOUT_MS` | Timeout refundu (default 20000) | volitelná | — | `src/lib/payment/gopay-real.ts:241` |

### 1.6 Platby — ComGate

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `COMGATE_MERCHANT` | Identifikátor obchodu | **povinná** (při `PAYMENT_PROVIDER=comgate`) | klientský portál ComGate (nastavení obchodu / integrace) | `src/lib/payment/comgate.ts:38` |
| `COMGATE_SECRET` | API secret (Basic auth + ověření notifikace) | **povinná** (při ComGate) | klientský portál ComGate (nastavení obchodu / integrace) | `src/lib/payment/comgate.ts:39` |
| `COMGATE_TEST` | `true` = testovací platby | volitelná (v prod **nenastavovat**; `.env.example:67` má `true`!) | — | `src/lib/payment/comgate.ts:40` |
| `COMGATE_API_BASE_URL` | Override base URL (simulátor) | jen dev/test | — | `src/lib/payment/comgate.ts:42` |
| `COMGATE_REFUND_TIMEOUT_MS` | Timeout refundu (default 20000) | volitelná | — | `src/lib/payment/comgate.ts:198` |

### 1.7 Platby — ostatní brány, výplaty, benefity

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe Checkout, mobilní PaymentIntent, splátky. **Pozor:** je-li nastaven a `PAYMENT_PROVIDER_EUR` ne, všechny EUR platby jdou přes Stripe | volitelná | Stripe Dashboard → Developers → API keys | `src/lib/payment/provider.ts:64` |
| `STRIPE_PUBLISHABLE_KEY` | Publishable key pro mobilní app | volitelná | Stripe Dashboard → API keys | `src/app/api/mobile/payment-intent/route.ts:156` |
| `STRIPE_WEBHOOK_SECRET` | Ověření podpisu Stripe webhooku (bez něj webhook odmítne) | volitelná (povinná se Stripe) | Stripe Dashboard → Webhooks → endpoint → Signing secret | `src/lib/payment/stripe.ts:223` |
| `STRIPE_API_BASE_URL` | Override API (simulátor) | jen dev/test | — | `src/lib/payment/stripe.ts:18` |
| `P24_MERCHANT_ID` | Przelewy24 merchant | volitelná | administrace Przelewy24 (sekce API) | `src/lib/payment/przelewy24.ts:33` |
| `P24_POS_ID` | Przelewy24 POS (default = merchant) | volitelná | administrace Przelewy24 | `src/lib/payment/przelewy24.ts:34` |
| `P24_CRC_KEY` | CRC klíč pro podpisy | volitelná | administrace Przelewy24 | `src/lib/payment/przelewy24.ts:35` |
| `P24_API_KEY` | API klíč | volitelná | administrace Przelewy24 | `src/lib/payment/przelewy24.ts:36` |
| `P24_SANDBOX` | `1` = sandbox | volitelná (v prod nenastavovat) | — | `src/lib/payment/przelewy24.ts:20` |
| `MOLLIE_API_KEY` | Mollie platby | volitelná | Mollie Dashboard (sekce Developers → API keys) | `src/lib/payment/mollie.ts:37` |
| `MOLLIE_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/mollie.ts:14` |
| `PAYPAL_CLIENT_ID` | PayPal platby i PayPal Payouts | volitelná | PayPal Developer Dashboard → Apps & Credentials | `src/lib/payment/paypal.ts:34` |
| `PAYPAL_CLIENT_SECRET` | dtto | volitelná | PayPal Developer Dashboard → Apps & Credentials | `src/lib/payment/paypal.ts:35` |
| `PAYPAL_WEBHOOK_ID` | Ověření podpisu webhooku (bez něj webhook odmítne) | volitelná (povinná s PayPal) | PayPal Developer Dashboard → app → Webhooks | `src/lib/payment/paypal.ts:36` |
| `PAYPAL_SANDBOX` | `1` = sandbox | volitelná (v prod nenastavovat) | — | `src/lib/payment/paypal.ts:24` |
| `PAYPAL_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/paypal.ts:23` |
| `TRIPLEA_CLIENT_ID` | Triple-A (krypto) OAuth | volitelná | Triple-A merchant dashboard (sekce API) | `src/lib/payment/triplea.ts:41` |
| `TRIPLEA_CLIENT_SECRET` | dtto | volitelná | Triple-A merchant dashboard | `src/lib/payment/triplea.ts:42` |
| `TRIPLEA_API_ID` | API ID (live) | volitelná | Triple-A merchant dashboard | `src/lib/payment/triplea.ts:44` |
| `TRIPLEA_NOTIFY_SECRET` | Ověření webhooku | volitelná (povinná s Triple-A) | Triple-A merchant dashboard | `src/lib/payment/triplea.ts:45` |
| `TRIPLEA_SANDBOX` | `true` = sandbox | volitelná (v prod nenastavovat) | — | `src/lib/payment/triplea.ts:43` |
| `TRIPLEA_SANDBOX_API_ID` | API ID pro sandbox | jen dev/test | — | `src/lib/payment/triplea.ts:44` |
| `TRIPLEA_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/triplea.ts:46` |
| `WISE_API_KEY` | Wise výplaty promotérům (cron `payouts-execute` — **není registrován**, viz §4) | volitelná | Wise Business → Settings → API tokens | `src/lib/payouts/wise.ts:37` |
| `WISE_PROFILE_ID` | Wise profil | volitelná | Wise Business (profil) | `src/lib/payouts/wise.ts:38` |
| `WISE_WEBHOOK_PUBLIC_KEY` | Ověření Wise webhooku | volitelná | dokumentace Wise (veřejný klíč webhooků) | `src/lib/payouts/wise.ts:227` |
| `WISE_SOURCE_CURRENCY` | Zdrojová měna výplat (default EUR) | volitelná | — | `src/lib/payouts/executor.ts:139` |
| `WISE_SANDBOX` | `1` = sandbox | volitelná (v prod nenastavovat) | — | `src/lib/payouts/wise.ts:28` |
| `WISE_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payouts/wise.ts:27` |
| `PAYOUT_PROVIDER` | Výplaty z resale; default `mock` → výplata se označí `paid` s falešným ID; `fio`/`stripe_connect` jsou neimplementované (throw) | volitelná (route neregistrována v `vercel.json`) | — | `src/app/api/cron/resale-payouts/route.ts:49,105-117` |
| `PLUXEE_MERCHANT_ID` | Pluxee benefit platby (jediný benefit s vlastní ověřenou callback routou) | volitelná | smlouva s Pluxee (merchant portál) | `src/lib/payment/benefit-providers/pluxee.ts:52` |
| `PLUXEE_API_KEY` | dtto | volitelná | Pluxee | `src/lib/payment/benefit-providers/pluxee.ts:53` |
| `PLUXEE_CALLBACK_SECRET` | Ověření callbacku | volitelná (povinná s Pluxee) | Pluxee | `src/lib/payment/benefit-providers/pluxee.ts:108` |
| `PLUXEE_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/benefit-providers/pluxee.ts:57` |
| `EDENRED_MERCHANT_ID` | Edenred — callback jde na generickou routu, která je **v produkci 403** → v prod nefunkční | volitelná (fakticky nefunkční v prod) | Edenred | `src/lib/payment/benefit-providers/edenred.ts:33` |
| `EDENRED_API_KEY` | dtto | volitelná (nefunkční v prod) | Edenred | `src/lib/payment/benefit-providers/edenred.ts:34` |
| `EDENRED_CALLBACK_SECRET` | dtto | volitelná (nefunkční v prod) | Edenred | `src/lib/payment/benefit-providers/edenred.ts:80` |
| `EDENRED_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/benefit-providers/edenred.ts:38` |
| `MULTISPORT_MERCHANT_ID` | MultiSport — generický callback, v prod 403 | volitelná (nefunkční v prod) | MultiSport | `src/lib/payment/benefit-providers/multisport.ts:52` |
| `MULTISPORT_API_KEY` | dtto | volitelná (nefunkční v prod) | MultiSport | `src/lib/payment/benefit-providers/multisport.ts:53` |
| `MULTISPORT_CALLBACK_SECRET` | dtto | volitelná (nefunkční v prod) | MultiSport | `src/lib/payment/benefit-providers/multisport.ts:105` |
| `MULTISPORT_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/benefit-providers/multisport.ts:57` |
| `GALLERY_BETA_API_KEY` | Gallery Beta — generický callback, v prod 403 | volitelná (nefunkční v prod) | Gallery Beta | `src/lib/payment/benefit-providers/gallery-beta.ts:31` |
| `GALLERY_BETA_CALLBACK_SECRET` | dtto | volitelná (nefunkční v prod) | Gallery Beta | `src/lib/payment/benefit-providers/gallery-beta.ts:73` |
| `GALLERY_BETA_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/benefit-providers/gallery-beta.ts:33` |
| `BENEFIT_PLUS_PARTNER_ID` | Benefit Plus — vlastní callback routa nezjištěna z kódu | volitelná (nefunkční v prod) | Benefit Plus | `src/lib/payment/benefit-providers/benefit-plus.ts:45` |
| `BENEFIT_PLUS_SECRET` | dtto | volitelná (nefunkční v prod) | Benefit Plus | `src/lib/payment/benefit-providers/benefit-plus.ts:46` |
| `BENEFIT_PLUS_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/payment/benefit-providers/benefit-plus.ts:50` |
| `BENEFIT_MOCK` | Povolí generický benefit callback (jen mimo produkci) | jen dev/test | — | `src/app/api/payments/benefit/callback/route.ts:32` |
| `BENEFIT_DEV_MOCK_FALLBACK` | `=1` vynutí mock benefitů **i v produkci** (bez NODE_ENV pojistky) | jen dev/test ⛔ | — | `src/lib/payment/benefits.ts:112` |
| `BENEFIT_DEV_SKIP_CALLBACK_VERIFY` | Přeskočí ověření Pluxee callbacku (jen mimo produkci) | jen dev/test | — | `src/app/api/payments/benefit/pluxee/callback/route.ts:35` |
| `FIO_API_TOKEN` | Jen indikátor v `/api/health/providers`; samotný `bank-sync-fio` bere šifrované tokeny promotérů z DB | volitelná (jen health) | Fio internetbanking → API tokeny | `src/app/api/health/providers/route.ts:52` |
| `PSD2_CLIENT_ID` | Jen indikátor v health; reálný flow čte `KB_/CS_/CSOB_PSD2_*` | volitelná (jen health) | — | `src/app/api/health/providers/route.ts:56` |
| `PSD2_CLIENT_SECRET` | dtto | volitelná (jen health) | — | `src/app/api/health/providers/route.ts:56` |

### 1.8 E-mail, SMS, push

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `SMTP_HOST` | SMTP server (nodemailer); fallback `localhost` | **povinná** | SMTP poskytovatel (např. Resend: `smtp.resend.com`, `.env.example:90`) | `src/lib/email/mailer.ts:43` |
| `SMTP_PORT` | Port (default 587, na localhost 1025) | volitelná | poskytovatel | `src/lib/email/mailer.ts:44` |
| `SMTP_USER` | SMTP uživatel (u Resend `resend`) | **povinná** | poskytovatel | `src/lib/email/mailer.ts:45` |
| `SMTP_PASS` | SMTP heslo / API klíč | **povinná** | poskytovatel (Resend → API Keys) | `src/lib/email/mailer.ts:46` |
| `SMTP_SECURE` | `true` = implicitní TLS (465); jinak STARTTLS | volitelná | — | `src/lib/email/mailer.ts:48` |
| `EMAIL_FROM` | Odesílatel transakčních e-mailů (vstupenky); fallback `vstupenky@tixly.local` | **povinná** | adresa na ověřené doméně | `src/lib/email/mailer.ts:49` |
| `MAIL_FROM` | Odesílatel jiných e-mailů (broadcast, abandoned-cart, reminders, lottery, team invite, waitlist); fallback `noreply@tixly.cz` | **povinná** | adresa na ověřené doméně | `src/app/api/internal/broadcast-send/route.ts:93` |
| `RESEND_API_KEY` | Jen admin alerty přes Resend HTTP API (odesílatel natvrdo `noreply@tixly.cz`) | volitelná (silně doporučená) | Resend → API Keys | `src/lib/notifications/platform-notify.ts:16,32` |
| `RESEND_API_BASE_URL` | **Kolo 10:** základ Resend HTTP API (výchozí `https://api.resend.com`); jen pro testy se simulátorem | ne (nenastavovat) | — | `src/lib/notifications/platform-notify.ts` |
| `STAGING_EMAIL_ALLOWLIST` | **Kolo 10, jen staging:** e-mail odejde jen na tyto adresy / `@domény` (čárkou); mimo → neodešle se a zaloguje. S `TIXLY_ENV=staging` a prázdným allowlistem server nenastartuje | v produkci **ne**; na stagingu **povinná** | adresy testerů | `src/lib/email/staging-allowlist.ts`, `src/lib/env/staging-guard.ts` |
| `BULKGATE_APPLICATION_ID` | BulkGate SMS; bez něj mock (jen audit log) | volitelná | portal.bulkgate.com → aplikace API | `src/lib/sms/bulkgate-mock.ts:121` |
| `BULKGATE_APPLICATION_TOKEN` | dtto | volitelná | portal.bulkgate.com | `src/lib/sms/bulkgate-mock.ts:122` |
| `BULKGATE_SENDER_ID` | Jméno odesílatele SMS (default `Tixly`) | volitelná | BulkGate (registrace sender ID) | `src/lib/sms/bulkgate-mock.ts:123` |
| `BULKGATE_MOCK` | `=1` vynutí mock i s tokeny | jen dev/test | — | `src/lib/sms/bulkgate-mock.ts:125` |
| `BULKGATE_TOKEN` | Čte se jen v testu | nepoužívá se v prod | — | `src/lib/sms/bulkgate-mock.test.ts:86` |
| `SMS_PROVIDER` | SMS pro TAN kódy (`smsmanager`); bez něj se kód jen zaloguje | volitelná | — | `src/lib/sms/tan.ts:51` |
| `SMSMANAGER_API_KEY` | SMSManager.cz API klíč | volitelná | smsmanager.cz → API | `src/lib/sms/tan.ts:130` |
| `TWILIO_AUTH_TOKEN` | OTP SMS kupce: s tokenem se **nepošle nic** (stub), bez něj se kód jen zaloguje — reálné odeslání neexistuje | nepoužívá se v prod (stub) | — | `src/app/api/buyer/otp/request/route.ts:36-42` |
| `VAPID_PUBLIC_KEY` | Web push (server) | volitelná | `npx web-push generate-vapid-keys` | `src/lib/push/web-push.ts:66` |
| `VAPID_PRIVATE_KEY` | Web push (server) | volitelná | dtto | `src/lib/push/web-push.ts:67` |
| `VAPID_SUBJECT` | `mailto:` kontakt pro push | volitelná | např. `mailto:admin@tixly.cz` | `src/lib/push/web-push.ts:65` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Veřejný VAPID klíč pro klienta (stejná hodnota jako `VAPID_PUBLIC_KEY`) | volitelná | dtto | `src/components/PushSubscribeButton.tsx:45` |

### 1.9 Monitoring

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `SENTRY_DSN` | Sentry server/edge; zároveň zapíná `withSentryConfig` při buildu. **Kolo 14: musí být nastavená i pro BUILD** (Vercel env pro Production včetně buildu) — jinak se route handlery neobalí a jejich neošetřené chyby do Sentry nedojdou. Ověřeno lokálně proti simulátoru Sentry: chyba z route handleru i selhání cronu dorazí, e-maily / jména / telefony maskované (`src/lib/observability/scrub-pii.ts`). Po nasazení ověřit `POST /api/ops/sentry-check` (Bearer `CRON_SECRET`) → v Sentry chyba „Sentry kontrola: kupec [email], tel. [telefon]" | volitelná (doporučená) | Sentry → projekt → Project Settings → Client Keys (DSN) | `sentry.server.config.ts:15`, `next.config.mjs:211` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry klient | volitelná | dtto | `sentry.client.config.ts:18` |
| `SENTRY_ORG` | Upload source map | volitelná | Sentry (slug organizace) | `next.config.mjs:214` |
| `SENTRY_PROJECT` | Upload source map | volitelná | Sentry (slug projektu) | `next.config.mjs:215` |
| `SENTRY_AUTH_TOKEN` | Upload source map při buildu | volitelná | Sentry → Settings → Auth Tokens | `next.config.mjs:216` |

**Hlídání provozu (kolo 14 / krok 3)** — nové crony ve `vercel.json`: `ops-watchdog` (každých 15 min: heartbeat cronů,
zaplaceno bez vstupenek, refund_failed) a `ops-daily-summary` (5:00 a 6:00 UTC, odešle se jen v 7:00 Europe/Prague).
Heartbeat zapisuje dispatcher (`/api/cron/dispatch`) po úspěšném běhu jobu; selhání jobu vrací 502 a jde do Sentry.
Záloha DB hlásí výsledek na `POST /api/ops/backup-status` (GitHub secrets `TIXLY_APP_URL`, `CRON_SECRET` — viz §3).
Tabulky `monitoring.cron_heartbeats`, `monitoring.ops_alerts`, `monitoring.ops_events` (migrace 508). Nové env proměnné
v aplikaci nejsou — stačí `PLATFORM_ADMIN_EMAIL` (§1.3) a funkční e-mail (§1.8).

### 1.10 AI a compliance

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | AI moderace akcí (text + vision plakátu), AI popisy, seating z obrázku/textu; bez ní mock regex moderace, vision se přeskočí | volitelná (silně doporučená; `.env.example:147` „V produkci NUTNÉ") | console.anthropic.com → API Keys | `src/lib/moderation/ai-gate.ts:291` |
| `OPENAI_API_KEY` | AI tagy, cover image (DALL-E), support chat, popisy, social posty, moderace (OpenAI větev) | volitelná | platform.openai.com → API keys | `src/lib/ai/auto-tag.ts:55` |
| `AI_CHAT_MODE` | `stub` vypne OpenAI pro support chat | volitelná | — | `src/lib/ai/support-chat.ts:67` |
| `AI_DESC_MODE` | `stub` vypne OpenAI pro popisy | volitelná | — | `src/lib/ai/description-gen.ts:46` |
| `AI_IMAGE_MODE` | Režim cover image (default `stub`!) — pro DALL-E nutno nastavit jinak než `stub` | volitelná | — | `src/lib/ai/cover-image.ts:46` |
| `AI_MODERATION_MODE` | `stub` vypne OpenAI moderaci | volitelná | — | `src/lib/ai/moderation.ts:55` |
| `AI_SOCIAL_MODE` | `stub` vypne OpenAI social posty | volitelná | — | `src/lib/ai/social-post.ts:31` |
| `AI_TAG_MODE` | `stub` vypne OpenAI auto-tag | volitelná | — | `src/lib/ai/auto-tag.ts:55` |
| `OPENSANCTIONS_API_KEY` | AML screening; bez klíče → ruční review (fail-closed, ne tiché „OK") | volitelná | opensanctions.org (API key) | `src/lib/compliance/sanctions.ts:125` |
| `ARES_BASE_URL` | Override ARES API (default veřejné `ares.gov.cz`); testy míří na simulátor | jen dev/test | — | `src/lib/compliance/ares.ts:28` |
| `ARES_TIMEOUT_MS` | Timeout ARES (výpadek → ruční ověření) | volitelná | — | `src/lib/compliance/ares.ts:31` |
| `ARES_MODE` | `mock` (jen mimo produkci) | jen dev/test | — | `src/lib/ares/verify.ts:52` |

### 1.11 Integrace (OAuth, wallet, QES, doprava, hudba, marketing, úložiště)

| Název | K čemu slouží | Povinná v produkci? | Kde ji vlastník získá | Soubor:řádek |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | Přihlášení přes Google | volitelná | Google Cloud Console → APIs & Services → Credentials (OAuth client); redirect URI viz §6 | `src/app/api/auth/oauth/google/route.ts:19` |
| `GOOGLE_CLIENT_SECRET` | dtto | volitelná | dtto | `src/app/api/auth/oauth/callback/google/route.ts:63` |
| `FACEBOOK_APP_ID` | Přihlášení přes FB + Graph API (promotér) | volitelná | developers.facebook.com → aplikace → Settings → Basic | `src/app/api/auth/oauth/facebook/route.ts:13` |
| `FACEBOOK_APP_SECRET` | dtto | volitelná | dtto | `src/app/api/auth/oauth/callback/facebook/route.ts:42` |
| `APPLE_SERVICE_ID` | Sign in with Apple (Service ID) | volitelná | Apple Developer → Certificates, Identifiers & Profiles → Identifiers | `src/app/api/auth/oauth/apple/route.ts:18` |
| `APPLE_PASS_TYPE_IDENTIFIER` | Apple Wallet .pkpass (default `pass.cz.tixly.event-ticket`) | volitelná | Apple Developer → Identifiers → Pass Type IDs | `src/lib/wallet/apple-pass.ts:51` |
| `APPLE_TEAM_IDENTIFIER` | Team ID (default `TIXLYTEAMID` — neplatné) | volitelná | Apple Developer → Membership | `src/lib/wallet/apple-pass.ts:52` |
| `APPLE_PASS_CERT_PEM` | Certifikát Pass Type ID (PEM); bez něj nepodepsaný bundle | volitelná | Apple Developer → Certificates | `src/lib/wallet/apple-pass.ts:214` |
| `APPLE_PASS_KEY_PEM` | Privátní klíč k certifikátu | volitelná | dtto | `src/lib/wallet/apple-pass.ts:215` |
| `APPLE_WWDR_CERT_PEM` | Apple WWDR intermediate | volitelná | Apple PKI (WWDR certifikát) | `src/lib/wallet/apple-pass.ts:216` |
| `GOOGLE_WALLET_ISSUER_ID` | Google Wallet issuer (default demo `3388000000000000000`) | volitelná | Google Pay & Wallet Console → Issuer ID | `src/lib/wallet/google-wallet.ts:46` |
| `GOOGLE_WALLET_CLASS_SUFFIX` | Suffix třídy pasu (default `tixly_event_ticket`) | volitelná | — | `src/lib/wallet/google-wallet.ts:47` |
| `GOOGLE_WALLET_SERVICE_ACCOUNT` | E-mail service accountu (default `tixly-demo@noreply.local`) | volitelná | Google Cloud → IAM → Service Accounts | `src/lib/wallet/google-wallet.ts:69` |
| `GOOGLE_WALLET_PRIVATE_KEY_PEM` | Privátní klíč SA (bez něj throw) | volitelná | Google Cloud → SA → Keys (JSON → `private_key`) | `src/lib/wallet/google-wallet.ts:122` |
| `QES_PROVIDER` | Elektronický podpis smluv promotérů; default `mock` (podpis „projde" mockem) | volitelná (pro reálný podpis `docusign`) | — | `src/lib/qes/index.ts:16` |
| `NEXT_PUBLIC_QES_PROVIDER` | Jen zobrazení jména providera v adminu | volitelná | — | `src/app/admin/documents/page.tsx:245` |
| `DOCUSIGN_INTEGRATION_KEY` | DocuSign | volitelná | DocuSign Admin → Apps and Keys | `src/lib/qes/docusign-provider.ts:56` |
| `DOCUSIGN_SECRET_KEY` | DocuSign | volitelná | DocuSign Admin → Apps and Keys | `src/lib/qes/docusign-provider.ts:57` |
| `DOCUSIGN_ACCOUNT_ID` | DocuSign account | volitelná | DocuSign Admin → Apps and Keys | `src/lib/qes/docusign-provider.ts:49` |
| `DOCUSIGN_HMAC_KEY` | Ověření DocuSign Connect webhooku | volitelná | DocuSign Admin → Connect → HMAC | `src/lib/qes/docusign-provider.ts:52` |
| `DOCUSIGN_BASE_URL` | API base (default **demo** `demo.docusign.net`) | volitelná (pro prod nutno nastavit produkční) | DocuSign (produkční base URI účtu) | `src/lib/qes/docusign-provider.ts:46` |
| `PDF_SIGNING_P12_BASE64` | PAdES podpis PDF vstupenek (kvalifikovaný cert) | volitelná | PostSignum / I.CA / eIdentity (`.env.example:180`) | `src/lib/tickets/pdf-sign.ts:44` |
| `PDF_SIGNING_P12_PASSWORD` | Heslo k P12 | volitelná | dtto | `src/lib/tickets/pdf-sign.ts:45` |
| `EUDI_VERIFIER_URL` | EUDI wallet verifier; bez něj endpoint 503 (fail-closed) | volitelná | poskytovatel EUDI verifieru — nezjištěno z kódu | `src/lib/eudi/verifier.ts:20` |
| `EUDI_CLIENT_ID` | dtto | volitelná | dtto | `src/lib/eudi/verifier.ts:21` |
| `BLOB_READ_WRITE_TOKEN` | Upload cover obrázků a fotek výhledů (Vercel Blob); bez něj 503 | volitelná (doporučená) | Vercel → Storage → Blob store (token se propíše do env) | `src/app/api/admin/uploads/cover-image/route.ts:52` |
| `SPOTIFY_CLIENT_ID` | Propojení Spotify kupce | volitelná | developer.spotify.com → Dashboard → app | `src/lib/spotify/oauth.ts:53` |
| `SPOTIFY_CLIENT_SECRET` | dtto | volitelná | dtto | `src/lib/spotify/oauth.ts:54` |
| `SPOTIFY_REDIRECT_URI` | Override redirect URI (default `${NEXT_PUBLIC_APP_URL}/api/buyer/spotify/callback`) | volitelná | — | `src/lib/spotify/oauth.ts:56` |
| `SPOTIFY_ACCOUNTS_BASE_URL` | Override API | jen dev/test | — | `src/lib/spotify/oauth.ts:28` |
| `SPOTIFY_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/spotify/oauth.ts:29` |
| `BANDSINTOWN_APP_ID` | Distribuce koncertů na Bandsintown (cron `music-distribute`; bez klíče joby přeskočí) | volitelná | Bandsintown partner program | `src/lib/music/providers/bandsintown.ts:21` |
| `BANDSINTOWN_PARTNER_TOKEN` | dtto | volitelná | dtto | `src/lib/music/providers/bandsintown.ts:22` |
| `BANDSINTOWN_API_BASE` | Override API | jen dev/test | — | `src/lib/music/providers/bandsintown.ts:26` |
| `SONGKICK_API_KEY` | Distribuce na Songkick | volitelná | Songkick API | `src/lib/music/providers/songkick.ts:15` |
| `SONGKICK_API_BASE` | Override API | jen dev/test | — | `src/lib/music/providers/songkick.ts:17` |
| `FORGEMSG_API_URL` | ForgeMsg (marketing) — platformní default; crony `forgemsg-*` běží každých 5 min / hodinu | volitelná | ForgeMsg (partner) | `src/lib/forgemsg/dispatch.ts:27` |
| `FORGEMSG_API_KEY` | dtto | volitelná | ForgeMsg | `src/lib/forgemsg/dispatch.ts:28` |
| `FORGEMSG_PARTNER_SECRET` | Provisioning org + klíčů pro promotéry | volitelná | ForgeMsg | `src/lib/forgemsg/provision.ts:25` |
| `DPP_API_KEY` | Jízdenky MHD Praha (DPP); bez něj mock | volitelná | DPP (partnerská smlouva) | `src/lib/transit/partners/dpp.ts:35` |
| `DPP_PARTNER_CODE` | Kód partnera (default `tixly`) | volitelná | DPP | `src/lib/transit/partners/dpp.ts:38` |
| `DPP_VALIDATION_SECRET` | HMAC QR jízdenky; fallback `INTERNAL_SERVICE_TOKEN`, pak literál z repa | volitelná | `openssl rand -hex 32` | `src/lib/transit/dpp.ts:35` |
| `DPP_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/transit/partners/dpp.ts:37` |
| `IDOS_BRNO_API_KEY` | Jízdenky Brno | volitelná | IDOS/KORDIS Brno — nezjištěno z kódu | `src/lib/transit/partners/idos-brno.ts:27` |
| `IDOS_BRNO_API_BASE_URL` | Override API | jen dev/test | — | `src/lib/transit/partners/idos-brno.ts:29` |
| `TRANSIT_DEV_MOCK_FALLBACK` | `=1` vynutí mock jízdenek **i v produkci** | jen dev/test ⛔ | — | `src/lib/transit/dpp.ts:144` |
| `RAIL_API_URL` | Vlakové spoje (travel) | volitelná | nezjištěno z kódu | `src/lib/travel/rail.ts:14` |
| `RAIL_API_KEY` | dtto | volitelná | nezjištěno z kódu | `src/lib/travel/rail.ts:15` |

### 1.12 Pozor: tichý fallback (bezpečnostně / provozně relevantní)

Proměnné, jejichž **chybějící nebo špatná hodnota v produkci nevyhodí chybu**, ale tiše přepne na localhost / mock / demo / slabý klíč:

| # | Proměnná | Co se stane | Soubor:řádek |
|---|---|---|---|
| 1 | `APP_URL` chybí | Notification/return URL plateb = `http://localhost:3000/...` → brána nikdy nedoručí notifikaci, objednávky zůstanou `pending` a expirují | `src/app/api/checkout/route.ts:2395`, `src/app/api/checkout/seats/route.ts:177`, `src/app/api/buyer/group-invitations/[token]/claim/route.ts:140`, `src/app/api/internal/cron/bank-sync-fio/route.ts:173` |
| 2 | `NEXT_PUBLIC_APP_URL` chybí | Cron dispatcher volá `http://localhost:3000/api/internal/cron/*` → **všechny crony** selžou; party-split a white-label objednávky mají notification URL bez hostu (`''`); season passes localhost | `src/app/api/cron/dispatch/route.ts:97`, `src/app/api/checkout/party-split/[token]/route.ts:201`, `src/app/api/v1/wl/orders/route.ts:164`, `src/app/api/season-passes/route.ts:143` |
| 3 | `SMTP_HOST` chybí | Mailer míří na `localhost:1025` (MailHog) → e-maily (vstupenky!) se neodešlou; volající je většinou „fire-and-forget" | `src/lib/email/mailer.ts:43-44` |
| 4 | `EMAIL_FROM` / `MAIL_FROM` chybí | Odesílatel `vstupenky@tixly.local` (nedoručitelné) resp. `noreply@tixly.cz` (musí být ověřená doména) | `src/lib/email/mailer.ts:49`, `src/app/api/internal/broadcast-send/route.ts:93` |
| 5 | `TICKET_PDF_PRODUCTION_MODE` ≠ `1` | Vstupenky mají vodoznak „Demo vstupenka" | `src/lib/tickets/label-pdf.ts:73` |
| 6 | `COMGATE_TEST=true`, `GOPAY_SANDBOX=true`, `PAYPAL_SANDBOX=1`, `P24_SANDBOX=1`, `TRIPLEA_SANDBOX=true`, `WISE_SANDBOX=1` | Testovací brána v produkci → testovací „zaplaceno" vystaví reálné vstupenky bez peněz. `.env.example:67` má `COMGATE_TEST=true` | `src/lib/payment/comgate.ts:40`, `src/lib/payment/gopay-real.ts:34` |
| 7 | `ALLOW_MOCK_PAYMENTS=1` | Mock brány povoleny v produkci (lístky zdarma) | `src/lib/payment/mock-guard.ts:12` |
| 8 | `TIXLY_OTP_DEV_LEAK=1` | OTP kód v JSON odpovědi — bez NODE_ENV pojistky | `src/app/api/buyer/otp/request/route.ts:95` |
| 9 | `BENEFIT_DEV_MOCK_FALLBACK=1`, `TRANSIT_DEV_MOCK_FALLBACK=1` | Mock benefitů / jízdenek i v produkci | `src/lib/payment/benefits.ts:112`, `src/lib/transit/dpp.ts:144` |
| 10 | `NEXT_PUBLIC_INTERNAL_API_SECRET` nastaven | Hodnota je ve veřejném JS; je-li rovna `INTERNAL_API_SECRET`, kdokoli spustí `/api/internal/pricing/recalculate` | `src/app/admin/events/[id]/dynamic-pricing/page.tsx:241`, `src/app/api/internal/pricing/recalculate/route.ts:25` |
| 11 | `INTERNAL_API_TOKEN` nastaven jinak než `INTERNAL_SERVICE_TOKEN` | `verifyInternalToken` ho preferuje, dispatcher posílá `INTERNAL_SERVICE_TOKEN` → crony `corporate-orders-overdue`, `expire-date-holds`, `seat-reservations` dostanou 401; dispatcher přesto vrátí Vercelu HTTP 200 | `src/lib/internal-auth.ts:22`, `src/app/api/cron/dispatch/route.ts:98,113-117` |
| 12 | `HMAC_SECRET` chybí | Hash IP v DSA hlášeních bez saltu (triviálně reverzibilní) | `src/lib/compliance/dsa.ts:68` |
| 13 | `INTERNAL_SERVICE_TOKEN` chybí | Mimo jiné HMAC platebního odkazu call-centra s literálem `dev-secret`; `DPP_VALIDATION_SECRET` spadne na literál `tixly-dpp-default-secret` | `src/app/api/admin/call-center/order/route.ts:28`, `src/lib/transit/dpp.ts:33-37` |
| 14 | `STRIPE_SECRET_KEY` chybí (nebo kupec nemá uloženou kartu) | Cron `charge-installments` (denně 03:00) označí splátku jako **zaplacenou bez stržení** (`mock-cron-…`). **Kolo 10:** cron vyřazen z `vercel.json`, routa 404 bez `NEXT_PUBLIC_FEATURE_INSTALLMENTS=1` | `src/app/api/internal/cron/charge-installments/route.ts:68-130` |
| 15 | (nezávisle na env) | Cron `renew-subscriptions` obnovuje předplatná **bez platby** (mock instant-renew). **Kolo 10:** cron vyřazen z `vercel.json`, routa 404 bez `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS=1` | `src/app/api/internal/cron/renew-subscriptions/route.ts:60-75` |
| 16 | `PAYOUT_PROVIDER` chybí | Výplaty prodejcům z resale se označí `paid` s falešným ID (route zatím v `vercel.json` není) | `src/app/api/cron/resale-payouts/route.ts:49,72-74` |
| 17 | `STRIPE_SECRET_KEY` nastaven, `PAYMENT_PROVIDER_EUR` ne | EUR karty automaticky přes Stripe (ne přes GoPay/ComGate) | `src/lib/payment/provider.ts:64` |
| 18 | `REDIS_URL` chybí | Rate-limity jen in-memory per serverless instance (slabé) | `src/lib/rate-limit/per-tenant.ts:40` |
| 19 | `ANTHROPIC_API_KEY` chybí / `MODERATION_PROVIDER=mock` | Moderace akcí jen mock regex, vision plakátu se přeskočí | `src/lib/moderation/ai-gate.ts:290-296` |
| 20 | `PLATFORM_ADMIN_EMAIL` nebo `RESEND_API_KEY` chybí | DSA/AML alerty adminovi se jen zalogují | `src/lib/notifications/platform-notify.ts:18-21` |
| 21 | `SMS_PROVIDER`, `BULKGATE_*` chybí; `TWILIO_AUTH_TOKEN` | TAN kódy jen do logu; BulkGate mock; OTP SMS kupce se reálně neposílá nikdy | `src/lib/sms/tan.ts:51-60`, `src/lib/sms/bulkgate-mock.ts:124-125`, `src/app/api/buyer/otp/request/route.ts:36-42` |
| 22 | `QES_PROVIDER` chybí | Podpis smluv promotérů přes mock provider | `src/lib/qes/index.ts:16` |
| 23 | `EMBED_ALLOWED_ORIGINS`, `EMBED_FRAME_ANCESTORS` chybí | CORS `*` a framování embedu odkudkoli | `next.config.mjs:78,135` |
| 24 | `GOOGLE_WALLET_ISSUER_ID`/`SERVICE_ACCOUNT`, `APPLE_TEAM_IDENTIFIER` chybí | Demo hodnoty → neplatné pasy | `src/lib/wallet/google-wallet.ts:46,69`, `src/lib/wallet/apple-pass.ts:52` |
| 25 | `DOCUSIGN_BASE_URL` chybí (s `QES_PROVIDER=docusign`) | Volá se DocuSign **demo** | `src/lib/qes/docusign-provider.ts:46` |
| 26 | `HCAPTCHA_SECRET` chybí | `verifyHCaptcha` vrací mock-pass (fakticky nepoužito, widget není v UI) | `src/lib/bot-detection/detect.ts:64-65` |

**Fail-closed (bez proměnné to spadne, ne tiše):** `JWT_SECRET` (`src/lib/auth.ts:18-21`), `ENCRYPTION_KEY` (`src/lib/crypto/index.ts:10`), `IP_HASH_SALT` a řetězené secrety přes `resolveSecret` (`src/lib/security/secrets.ts:22-26`), `CRON_SECRET` (`src/lib/security/cron-auth.ts:14`), `INTERNAL_SERVICE_TOKEN` u cron rout (`src/lib/security/cron-auth.ts:28`), `PAYMENT_PROVIDER` bez konfigurace (`src/lib/payment/mock-guard.ts:25-30`), GoPay/ComGate webhook bez konfigurace (`src/app/api/payments/gopay/webhook/route.ts:90`, `src/app/api/payments/comgate/webhook/route.ts:66-70`).

---

## 2. E-mail

**Transport:** jediný mailer `src/lib/email/mailer.ts` používá **SMTP přes `nodemailer`** (`mailer.ts:69-76`); žádný jiný `createTransport` v kódu není. Poskytovatel se nevolí proměnnou, ale **hostem** `SMTP_HOST` — label se jen odvozuje (`resend`/`postmark`/`sendgrid`/`aws-ses`, `mailer.ts:51-58`).

**Výjimka:** admin alerty (`src/lib/notifications/platform-notify.ts:25-37`) jdou přes **Resend HTTP API** (`RESEND_API_KEY`) s odesílatelem natvrdo `Tixly Platform <noreply@tixly.cz>`.

Projektová dokumentace počítá s Resend (`.env.example:90`, `DEPLOYMENT.md:210-212`, `GO-LIVE-CHECKLIST.md:82`). Z kódu plyne, že při použití Resend se obě cesty sjednotí na jednoho poskytovatele.

**Potřebné env (Resend přes SMTP):**

| Env | Hodnota |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `587` (STARTTLS) nebo `465` + `SMTP_SECURE=true` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | API klíč Resend (`re_…`) |
| `EMAIL_FROM` | např. `vstupenky@tixly.cz` (na ověřené doméně) |
| `MAIL_FROM` | např. `noreply@tixly.cz` (na ověřené doméně) |
| `RESEND_API_KEY` | týž nebo jiný klíč Resend (admin alerty) |
| `PLATFORM_ADMIN_EMAIL` | adresa provozovatele pro alerty |

**Požadavky na doménu odesílatele:**

- Všechny tři odesílací adresy — `EMAIL_FROM`, `MAIL_FROM` a natvrdo zadaná `noreply@tixly.cz` (`platform-notify.ts:32`) — musí ležet na doméně **ověřené u poskytovatele**. Z kódu plyne doména `tixly.cz`. Pokud se použije jiná doména, alerty z `platform-notify.ts` budou odcházet z neověřené adresy.
- Některé routy skládají odesílatele jako `"<jméno promotéra>" <EMAIL_FROM>` (`src/lib/email/send-order-tickets.ts:261`, `src/app/api/admin/orders/[orderId]/support-action/route.ts:236`). Doména tedy zůstává naše, mění se jen zobrazované jméno.
- **DNS záznamy:** přesné hodnoty vypíše Resend po přidání domény (Resend → Domains → Add domain). Je potřeba:
  - **SPF** (TXT) dle Resend. `DEPLOYMENT.md:210` uvádí `v=spf1 include:_spf.resend.com ~all`. Před zadáním **ověřit proti tomu, co ukáže Resend**, hodnota v repu může být zastaralá.
  - **DKIM** (TXT, `DEPLOYMENT.md:211`: „resend ti přesně vypíše hodnoty").
  - Případný MX/return-path záznam, pokud ho Resend vyžaduje. Z kódu nezjištěno.
  - **DMARC** (TXT `_dmarc`), doporučeno např. `v=DMARC1; p=quarantine; rua=mailto:<admin>` (`DEPLOYMENT.md:212`).
- Při jiném SMTP poskytovateli (Postmark/SendGrid/SES, `.env.example:91-93`) platí totéž: SPF + DKIM dle daného poskytovatele a DMARC.

**Staging (kolo 10):** staging nemá Mailpit — posílá přes Resend (`SMTP_HOST=smtp.resend.com`) skutečným lidem, proto
povinný `STAGING_EMAIL_ALLOWLIST` (adresy nebo `@domény`, plus-adresy pasují). Filtr je v `sendMail` (všechny e-maily
přes SMTP) i v `platform-notify` (Resend HTTP API); příjemce mimo allowlist se vyřadí a zaloguje maskovaně
(`[mailer] staging: příjemci mimo STAGING_EMAIL_ALLOWLIST …`). Prázdný / neplatný allowlist = server nenastartuje.
Doručení ověřuje `scripts/staging/smoke.sh` přes seznam odeslaných zpráv Resend API (`GET /emails`). Viz `scripts/staging/README.md`.

**Riziko:** chybějící `SMTP_HOST` znamená tiché selhání odesílání vstupenek (viz §1.12 #3). Po nasazení je třeba zkontrolovat log `[mailer] provider=… authed=true` (`mailer.ts:79-81`).

---

## 3. GitHub secrets

Všechna `secrets.X` z `.github/workflows/*.yml` (v `.github/actions/**` žádná nejsou). `ci.yml` a `schema-drift-guard.yml` nepoužívají žádná secrets (`ci.yml:8`, `schema-drift-guard.yml:11`).

| Secret | Workflow / job (soubor:řádek) | Účel | Povinná? |
|---|---|---|---|
| `DATABASE_URL` | `deploy.yml` job `migrate` (`:111` migrace, `:118` rls-verify); `deploy.yml:41` (předáno do `rls-gate`, ale s `production: false` → prod verify neběží); `rls-gate.yml` job `verify-production` (`:118`, `:145`, noční); `db-backup.yml` (`:45`, `:75`, `:81`) | Migrace produkce, ověření RLS produkce, týdenní záloha | **povinná** (deploy migrace, noční RLS gate i záloha bez ní selžou) |
| `VERCEL_TOKEN` | `deploy.yml` job `deploy` (`:64`, `:68`, `:74`) | `vercel pull/build/deploy --prod` | **povinná** pro deploy |
| `NEON_API_KEY` | `rls-gate.yml` job `verify-production` (`:119`, `:153`) | Noční schema-reality scan (vytváří/maže Neon větev) | **povinná** pro noční běh (bez ní noční job padá, `rls-gate.yml:124`) |
| `AWS_ACCESS_KEY_ID` | `db-backup.yml:46,120` | Upload zálohy do S3 | **povinná** pro zálohy |
| `AWS_SECRET_ACCESS_KEY` | `db-backup.yml:47,121` | dtto | **povinná** pro zálohy |
| `AWS_S3_BUCKET` | `db-backup.yml:48,123` | Cílový bucket | **povinná** pro zálohy |
| `AWS_REGION` | `db-backup.yml:49,122` | Region bucketu | **povinná** pro zálohy |
| `BACKUP_ENCRYPTION_KEY` | `db-backup.yml:50,94,106` | Symetrické šifrování dumpu (`openssl rand -base64 32`, `db-backup.yml:22`) | **povinná** pro zálohy |
| `SLACK_WEBHOOK_URL` | `db-backup.yml:40,133` | Notifikace o selhání zálohy | volitelná |
| `TIXLY_APP_URL` | `db-backup.yml` (`HAS_OPS`, krok „Hlášení výsledku do aplikace") | Kolo 14: veřejná URL aplikace (např. `https://app.tixly.cz`) — výsledek zálohy na `/api/ops/backup-status` (heartbeat `db-backup`, e-mail provozu při selhání) | doporučená (bez ní se výsledek zálohy do aplikace nehlásí a kontrolní job ohlásí zálohu jako neprobíhající po 2 týdnech) |
| `CRON_SECRET` | `db-backup.yml` (dtto) | Kolo 14: stejná hodnota jako `CRON_SECRET` ve Vercelu (Bearer pro `/api/ops/backup-status`) | doporučená (spolu s `TIXLY_APP_URL`) |
| `GITHUB_TOKEN` | `security.yml:72` (gitleaks) | Automatický token GitHubu | automatický (nezadává se) |

**Celkem:** 12 jmen. Vlastník musí zadat 11, `GITHUB_TOKEN` je automatický (kolo 14 přidalo `TIXLY_APP_URL` a `CRON_SECRET`).

**Zjištěné problémy (z kódu):**

1. **Jeden `DATABASE_URL`, tři různé požadavky na roli.**
   - `migrate` spouští DDL (`scripts/run-migrations.sh`) a `ALTER DEFAULT PRIVILEGES` bez `FOR ROLE` (`migrations/000_baseline_globals.sql:749+`). To vyžaduje **ownera** (`neondb_owner`).
   - `db-backup` dělá `pg_dump` přes 589 tabulek s RLS a sám uvádí „role s právem číst vše, ne tixly_app" (`db-backup.yml:17`). Potřebuje tedy owner / BYPASSRLS.
   - `rls-gate.yml:132` naopak píše „produkční connection string s rolí tixly_app". `scripts/rls-verify.mjs:44-60` ale čte jen katalogy (`pg_policies`, `pg_class`, `pg_proc`), takže funguje s oběma rolemi.
   - **Závěr:** secret `DATABASE_URL` v GitHubu musí být **owner** URL. Jinak migrace i záloha selžou. Joby `deploy`/`migrate` mají `environment: production` (`deploy.yml:51,86`), takže lze případně použít environment-secret s jinou hodnotou než repo-secret.
2. **Chybí linkování Vercel projektu pro CI.** `deploy.yml` nevolá `vercel link` ani nenastavuje `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` a adresář `nextjs-boilerplate/.vercel/` není v gitu (`git ls-files` nic nevrací). Lokálně existuje, ale je ignorovaný. `vercel pull --yes` v CI proto nejspíš nebude vědět, který projekt stáhnout. Řešení: přidat secrets `VERCEL_ORG_ID` a `VERCEL_PROJECT_ID` jako env do jobu `deploy`. Vyžaduje změnu workflow, **neověřeno během**.
3. `deploy.yml` volá `rls-gate` s `production: false` (`deploy.yml:39`), takže **před** deployem se produkce nekontroluje. Kontrola produkce proběhne až po migracích v jobu `migrate` (`deploy.yml:114-118`) a v noci.
4. Pořadí v `deploy.yml`: **nejdřív deploy kódu, pak migrace** (`migrate` má `needs: [deploy]`, `deploy.yml:84`). Nový kód tak krátce běží proti starému schématu.
5. Gitleaks (`security.yml:70-72`): u repozitářů organizace vyžaduje `gitleaks-action@v2` licenční klíč. Zda je repo osobní, nebo organizační, z kódu nezjištěno.

Kde secrets zadat: GitHub → repo → Settings → Secrets and variables → Actions (`db-backup.yml:16`, `rls-gate.yml:126`).

---

## 4. Cron úlohy

### 4.1 Mechanismus autorizace

1. **Vercel Cron** volá `GET /api/cron/dispatch?job=<name>` s hlavičkou `Authorization: Bearer <CRON_SECRET>` (`src/app/api/cron/dispatch/route.ts:4-11`).
2. Dispatcher ověří `CRON_SECRET` přes `isCronAuthorized` (`src/lib/security/cron-auth.ts:12-19`). Hlavička `x-vercel-cron` se nebere v úvahu a middleware ji maže (`src/middleware.ts:115`). Bez `CRON_SECRET` vrací 403. Job musí být v `ALLOWED_JOBS` (`dispatch/route.ts:41-81`), jinak 422.
3. Dispatcher pošle `POST ${NEXT_PUBLIC_APP_URL}/api/internal/cron/<job>` s hlavičkami `x-internal-token: INTERNAL_SERVICE_TOKEN` a `Authorization: Bearer CRON_SECRET` (`dispatch/route.ts:97-111`).
4. Interní routa ověří jedno z následujících:
   - `x-internal-token` proti `INTERNAL_SERVICE_TOKEN` (inline, fail-closed), u většiny jobů,
   - `isInternalTokenAuthorized` (`release-group-invite-holds`),
   - `verifyInternalToken`, kde má přednost `INTERNAL_API_TOKEN` (`corporate-orders-overdue`, `expire-date-holds`, `seat-reservations`),
   - `isCronAuthorized` / CRON_SECRET (`recompute-dynamic-pricing`, `refresh-spotify`).

**Pozor:** dispatcher vrací Vercelu **HTTP 200 i při selhání jobu**. Skutečný stav je jen v těle JSON (`{job, status, result}`, `dispatch/route.ts:113-117`), takže Vercel dashboard ukáže úspěch i u jobu, který vrátil 403/500. Skutečný stav je nutné kontrolovat v logu nebo v těle odpovědi.

Pokud je zapnutá Vercel Deployment Protection, může blokovat self-fetch dispatcheru na produkční doménu. Z kódu nezjištěno, ověřit v nastavení projektu.

### 4.2 Registrované crony (`vercel.json`) — 29 záznamů (kolo 10: vyřazeny #7 charge-installments a #8 renew-subscriptions)

| # | Path | Schedule | Cílová routa | Co dělá | Auth cílové routy |
|---|---|---|---|---|---|
| 1 | `/api/cron/dispatch?job=expire-pending-orders` | `*/5 * * * *` | `src/app/api/internal/cron/expire-pending-orders/route.ts` | Expirace nezaplacených objednávek, uvolnění sedadel a kapacity | x-internal-token |
| 2 | `…job=release-expired-seat-holds` | `*/5 * * * *` | `…/release-expired-seat-holds` | Uvolní prošlé holdy sedadel | x-internal-token |
| 3 | `…job=send-reminders` | `*/15 * * * *` | `…/send-reminders` | E-mailové připomínky akcí (v jazyce kupce) | x-internal-token |
| 4 | `…job=abandoned-cart` | `0 */6 * * *` | `…/abandoned-cart` | E-mail k nezaplaceným objednávkám starším 30 min | x-internal-token |
| 5 | `…job=waitlist-notify` | `*/30 * * * *` | `…/waitlist-notify` | Notifikace čekací listiny při uvolnění kapacity | x-internal-token |
| 6 | `…job=bank-sync-fio` | `0 */2 * * *` | `…/bank-sync-fio` | Stažení Fio transakcí per promotér, párování převodů dle VS | x-internal-token |
| ~~7~~ | `…job=charge-installments` | `0 3 * * *` | `…/charge-installments` | Strhnutí splátek (Stripe; jinak **mock „zaplaceno"**, §1.12 #14) | x-internal-token — **Kolo 10: vyřazen z `vercel.json`** (splátky vypnuté) |
| ~~8~~ | `…job=renew-subscriptions` | `0 4 * * *` | `…/renew-subscriptions` | Obnova předplatných (**mock, bez platby**, §1.12 #15) | x-internal-token — **Kolo 10: vyřazen z `vercel.json`** (předplatné vypnuté) |
| 9 | `…job=daily-stats` | `0 6 * * *` | `…/daily-stats` | Denní statistiky e-mailem promotérům | x-internal-token |
| 10 | `…job=onboarding-reminder` | `0 9 * * *` | `…/onboarding-reminder` | Připomínka nedokončeného onboardingu promotéra (≥ 7 dní) | x-internal-token |
| 11 | `…job=process-gdpr-deletions` | `0 2 * * *` | `…/process-gdpr-deletions` | Anonymizace PII u naplánovaných žádostí o výmaz | x-internal-token |
| 12 | `…job=anomaly-detect` | `0 * * * *` | `…/anomaly-detect` | Alerty: traffic spike, refund spike, fraud cluster | x-internal-token |
| 13 | `…job=release-rolling-reserves` | `0 5 * * *` | `…/release-rolling-reserves` | Uvolní rolling reserves po uplynutí retence | x-internal-token |
| 14 | `…job=promoter-tier-evaluate` | `0 1 1 * *` | `…/promoter-tier-evaluate` | Přehodnocení tieru promotérů (objem za 90 dní) | x-internal-token |
| 15 | `…job=payouts-auto-settle` | `0 7 * * 1` | `…/payouts-auto-settle` | Týdenní výpočet výplat → `platform.payouts` (pending) | x-internal-token |
| 16 | `…job=consent-log-purge` | `0 4 * * 1` | `…/consent-log-purge` | Smaže cookie consent log starší 90 dní | x-internal-token |
| 17 | `…job=newsletter-digest` | `0 9 * * 1` | `…/newsletter-digest` | Týdenní digest akcí followerům promotéra | x-internal-token |
| 18 | `…job=verify-event-completion` | `0 8 * * *` | `…/verify-event-completion` | Den po akci podle scan rate: completed / suspicious | x-internal-token |
| 19 | `…job=recompute-dynamic-pricing` | `*/5 * * * *` | `…/recompute-dynamic-pricing` | Přepočet dynamických cen | CRON_SECRET |
| 20 | `…job=refresh-spotify` | `*/50 * * * *` | `…/refresh-spotify` | Obnova expirujících Spotify tokenů | CRON_SECRET |
| 21 | `…job=music-distribute` | `*/20 * * * *` | `…/music-distribute` | Fronta postů koncertů na Bandsintown / Songkick | x-internal-token |
| 22 | `…job=send-commemorative` | `0 10 * * *` | `…/send-commemorative` | Vzpomínkové vstupenky den po představení (volá `/api/admin/commemorative/send`) | x-internal-token |
| 23 | `…job=forgemsg-dispatch` | `*/5 * * * *` | `…/forgemsg-dispatch` | Odeslání outboxu do ForgeMsg | x-internal-token |
| 24 | `…job=forgemsg-sync-events` | `0 */6 * * *` | `…/forgemsg-sync-events` | Sync nadcházejících akcí a neprodaných míst do ForgeMsg | x-internal-token |
| 25 | `…job=forgemsg-provision` | `0 * * * *` | `…/forgemsg-provision` | Založení ForgeMsg org + klíče novým promotérům | x-internal-token |
| 26 | **`/api/admin/lastminute/check`** | `*/15 * * * *` | `src/app/api/admin/lastminute/check/route.ts` | Last-minute slevy podle obsazenosti | **Kolo 10 opraveno:** `GET` s `Authorization: Bearer CRON_SECRET` (isCronAuthorized), výjimka v middlewaru jen pro tento GET; opraven i dotaz (`lr.promoter_id` neexistoval → 42703). Bez / se špatným tajemstvím 401 (test `fix-r10-lastminute-cron.live`) |
| 27 | `…job=event-payout-release` | `0 8 * * *` | `…/event-payout-release` | Auto-payout N dní po akci (per-promotér SLA) | x-internal-token |
| 28 | `…job=release-group-invite-holds` | `*/10 * * * *` | `…/release-group-invite-holds` | Uvolní nezaplacená sedadla z AXS Invite | `isInternalTokenAuthorized` |
| 29 | `…job=expire-date-holds` | `0 * * * *` | `…/expire-date-holds` | Propadlé opce na termíny sálu, posun pořadí | `verifyInternalToken` |
| 30 | `…job=seat-reservations` | `*/15 * * * *` | `…/seat-reservations` | Rezervace s platbou na pokladně: připomínka 24 h předem, uvolnění propadlých | `verifyInternalToken` |
| 31 | `…job=corporate-orders-overdue` | `0 8 * * *` | `…/corporate-orders-overdue` | Firemní objednávky po splatnosti → `overdue` + e-mail pořadateli | `verifyInternalToken` |

Kontrola konzistence (skriptem): 30 jobů v `vercel.json` = 30 jobů v `ALLOWED_JOBS`. Každý má existující routu, žádný job v allowlistu nechybí ve `vercel.json` a naopak.

**Kontrolní body tarifu Vercel (neověřováno, jen check):**

- 17 z 29 cronů běží častěji než 1× denně (`*/5`, `*/10`, `*/15`, `*/20`, `*/30`, `*/50`, hodinově, á 2 h, á 6 h). Podle dostupných informací tarif **Hobby** omezuje crony na 1× denně a omezený počet. `DEPLOYMENT.md:15` přitom počítá s „free Hobby pro start". **Ověřit v aktuální dokumentaci a ceníku Vercelu**; pravděpodobně je nutný **Pro**, jinak deploy s tímto `vercel.json` neprojde nebo crony nepoběží.
- Ověřit limit počtu cronů na projekt pro zvolený tarif (zde 31).
- Časy v `schedule` jsou na Vercelu v UTC. Ověřit, zda to sedí s úmyslem, např. `send-commemorative` v `0 10 * * *`.

### 4.3 Cron routy, které existují, ale nejsou registrované

Nejsou v `vercel.json` ani v `ALLOWED_JOBS`, takže **nikdy neběží**:

| Routa | Co dělá | Poznámka |
|---|---|---|
| `src/app/api/internal/cron/audience-geo-snapshot/route.ts` | Noční přepočet `analytics.audience_geo` | Hlavička uvádí `0 2 * * *`, registrace chybí |
| `src/app/api/internal/cron/demand-forecast/route.ts` | Prognóza poptávky | **Záměrně vypnuto** (R-47, `dispatch/route.ts:27-32`) |
| `src/app/api/internal/cron/payouts-execute/route.ts` | Odeslání výplat (Wise / PayPal Payouts) po `payouts-auto-settle` | **Kolo 10: záměrně neregistrováno — výplaty jsou pro první ostrý provoz RUČNÍ.** Platform admin je spustí v administraci (`/api/admin/payouts/execute`); u CZK/FIO výplata přejde do stavu `awaiting_manual_transfer` (kolo 7), převod se odešle z internetového bankovnictví a admin ho potvrdí (`/api/platform/admin/payouts/[id]/confirm-transfer`). Test: dispatcher job nezná (422) |
| `src/app/api/internal/cron/publish-notify/route.ts` | Doručení sold-notifikací do externích Publish API | Hlavička uvádí á 5 min |
| `src/app/api/internal/cron/push-reminders/route.ts` | Web push připomínky (24 h / 4 h před akcí, on-sale) | — |
| `src/app/api/internal/cron/seat-upgrade-notify/route.ts` | E-mail o dostupném lepším sedadle | Komentář je rozporný: „ZŮSTÁVÁ VYPNUTÝ" (`dispatch/route.ts:21`) vs. „VRÁCENO 2026-08-08" (`:33`). V allowlistu není, fakticky tedy vypnuto |
| `src/app/api/cron/inventory-refresh/route.ts` | Refresh materialized view `catalog.mv_event_inventory_status` (hlavička: á 1 min) | GET + CRON_SECRET, šla by registrovat přímo |
| `src/app/api/cron/pricing-engine/route.ts` | Evaluace pricing rules (hlavička: á 15 min) | GET + CRON_SECRET |
| `src/app/api/cron/resale-payouts/route.ts` | Výplaty prodejcům z resale | GET + CRON_SECRET; při registraci pozor na `PAYOUT_PROVIDER=mock` (§1.12 #16) |

---

## 5. DB role a práva

### 5.1 Role, které musí v produkci existovat

| Role | Atributy (z kódu) | K čemu | Zdroj |
|---|---|---|---|
| `tixly_app` | `LOGIN NOBYPASSRLS NOCREATEDB NOCREATEROLE`; `NOSUPERUSER` není uvedeno explicitně, ale je to výchozí hodnota `CREATE ROLE` | Runtime aplikace, RLS se na ni vztahuje | `migrations/000_baseline_globals.sql:33-37` |
| `neondb_owner` | Owner objektů, na Neonu s BYPASSRLS (`scripts/schema-reality-scan.mjs:737`) | Migrace, DDL, zálohy, ops skripty | `migrations/000_baseline_globals.sql:40` (`GRANT tixly_app TO neondb_owner`), `scripts/schema-reality-scan.mjs:49` |

Jiné role (read-only, backup) migrace **nevytvářejí**. Lokální dev používá superuser `tixly` (`.env.example:8`, `scripts/prod-migrate-runner.mjs:34`); v Neon produkci jeho existence z kódu nezjištěna a není potřeba.

Heslo `tixly_app` v migracích **není** a nastavuje se ručně: `ALTER ROLE tixly_app WITH PASSWORD '<secret>';` (`migrations/000_baseline_globals.sql:13-15`).

### 5.2 Mapování env → role

| Env | Kde | Role | Pozn. |
|---|---|---|---|
| `DATABASE_URL` | Vercel (runtime) | **`tixly_app`** | `.env.example:7-17`. Pooled host je v pořádku: RLS kontext je transakčně lokální (`src/lib/db/rls-pool.ts:47-69`) |
| `DATABASE_URL_DIRECT` | Vercel (volitelně) | `tixly_app` | Ne-pooled host pro `connect()` pool (`rls-pool.ts:73`) |
| `DATABASE_URL_OPS` | lokálně / ops | owner | `scripts/prod-migrate-runner.mjs:15`, `.env.example:19` |
| `DATABASE_URL` | GitHub secret | **owner** (viz §3 bod 1) | migrace + `pg_dump` vyžadují owner |
| `DATABASE_URL_SUPER`, `DATABASE_URL_APP` | jen testy | — | `src/lib/db/rls-tenant-isolation.test.ts:25-32` |

RLS kontext: aplikace nastavuje GUC `app.current_promoter_id`, `app.current_user_id` a `app.role` přes `set_config(..., true)` v transakci (`rls-pool.ts:47-61`). Funkce `public.app_is_service()` vrací true pro `app.role IN ('service','admin','system')` (`migrations/000_baseline_20260730.sql:844-848`). Vlastní GUC si ovšem nastaví jakákoli role, takže izolace stojí na tom, že aplikace neumožní SQL injection. RLS tedy funguje jako obrana do hloubky, ne jako hranice proti kompromitované aplikaci.

### 5.3 Granty (z `000_baseline_globals.sql`)

- `GRANT USAGE` na 80 aplikačních schémat (`:42-…`).
- `GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` na 605 tabulek (sekce „granty per tabulku (605)").
- `ALTER DEFAULT PRIVILEGES IN SCHEMA … GRANT …` na tabulky, sekvence a funkce (`:749+`). Bez `FOR ROLE` se uplatní **jen na objekty vytvořené rolí, která migraci spustila**, takže migrace musí běžet jako `neondb_owner`.
- Granty na objekty extensí (PostGIS) jsou záměrně vynechané (`:23-27`).
- Dřívější díra: chyběl grant na schémata `communications` a `brands` (`:17-21`). Nutno ověřit (dotaz níže).

### 5.4 Očekávaný stav (z `nextjs-boilerplate/rls-snapshot.json`, generováno z migrací až po `506_term_cancel_postpone.sql`)

- `pg_policies`: **871** politik, všechny s `roles = {public}`.
- Tabulky (relkind `r`, mimo `pg_*`/`information_schema`): **617**, z toho **589 s RLS** a **28 bez RLS**. Bez RLS jsou: `b2b.sandbox_fixtures`, `benefit_payments.providers`, `brands.advertisers`, `brands.campaigns`, `catalog.moderation_blocklist`, `channels.channel_providers`, `marketing.editorial_articles`, `marketing.transit_partners`, `marketing.web_vitals`, `monitoring.status_incidents`, `monitoring.system_components`, `platform.config`, `platform.currencies`, `platform.dashboard_widgets`, `platform.exchange_rates`, `platform.incident_updates`, `platform.incidents`, `public.admin_audit_log`, `public.admin_impersonation_tokens`, `public.feature_flags_audit`, `public.schema_migrations`, `public.spatial_ref_sys`, `public.wallet_device_registrations`, `public.wallet_pass_updates`, `public.wallet_passes_data`, `resources.resource_hub`, `risk.fraud_rules`, `risk.velocity_limits`.
- Helpery `app_can_see_user_as_buyer` a `app_can_see_user_as_promoter`: `SECURITY DEFINER` + `search_path=pg_catalog, public` (`scripts/rls-verify.mjs:20,121-122`).
- „Obejití RLS" ve smyslu repa: funkce `SECURITY DEFINER` vlastněná ownerem (BYPASSRLS) běží bez RLS. `rls-verify` u helperů vyžaduje `SECURITY DEFINER` **se** `search_path`; helper bez `search_path` lze zneužít podstrčením schématu (`rls-verify.mjs:122`). SECURITY DEFINER funkce nalezené v migracích:
  - `identity.anonymize_user`, `identity.move_password_to_secrets`, `marketing.cleanup_expired_spotify_oauth`, `public.audit_log_immutable`, `public.audit_trigger_func` (`000_baseline_20260730.sql:655,697,777,855,868`),
  - `public.app_can_see_user_as_promoter`, `public.app_can_see_user_as_buyer` (`453_users_select_scoped.sql:55,80`),
  - `catalog.event_vat_readiness` (`494_vat_rates.sql:97`).
  - Seznam je z grepu, ne z DB. Rozhoduje výsledek dotazu 7.

Automatická kontrola: `node scripts/rls-verify.mjs` s owner nebo app URL (čte jen katalogy) porovná živou DB se snapshotem.

### 5.5 Ověřovací SQL (jen čtení)

```sql
-- 1) Atributy rolí: tixly_app MUSÍ mít rolsuper=f, rolbypassrls=f, rolcreaterole=f, rolcreatedb=f, rolcanlogin=t
SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit
FROM pg_roles WHERE rolname IN ('tixly_app','neondb_owner') ORDER BY 1;

-- 2) Spustit PŘES produkční DATABASE_URL z Vercelu: musí vrátit tixly_app / f
SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser;

-- 3) tixly_app nesmí být členem role s BYPASSRLS/SUPERUSER (opačný směr owner→app je v pořádku)
SELECT r.rolname AS granted_role, r.rolbypassrls, r.rolsuper
FROM pg_auth_members am
JOIN pg_roles r ON r.oid = am.roleid
JOIN pg_roles m ON m.oid = am.member
WHERE m.rolname = 'tixly_app';           -- očekáváno: 0 řádků

-- 4) Žádný objekt nesmí vlastnit tixly_app (vlastník tabulky RLS obchází, pokud není FORCE)
SELECT n.nspname, c.relname, c.relkind
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE pg_get_userbyid(c.relowner) = 'tixly_app';   -- očekáváno: 0

-- 5) Tabulky bez RLS v aplikačních schématech (očekáváno 28, seznam viz 5.4)
SELECT count(*) FILTER (WHERE NOT c.relrowsecurity) AS bez_rls,
       count(*) FILTER (WHERE c.relrowsecurity)     AS s_rls,
       count(*)                                     AS celkem
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema';
-- očekáváno: 28 / 589 / 617

-- 5b) jmenovitý seznam tabulek bez RLS
SELECT n.nspname || '.' || c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND NOT c.relrowsecurity
  AND n.nspname NOT LIKE 'pg\_%' AND n.nspname <> 'information_schema'
ORDER BY 1;

-- 6) Počet politik a role politik (očekáváno 871, vše {public})
SELECT count(*) AS policies, count(*) FILTER (WHERE roles::text <> '{public}') AS jine_role
FROM pg_policies;

-- 7) SECURITY DEFINER funkce mimo systémová schémata: vlastník, search_path, kdo je smí volat
SELECT n.nspname, p.proname, pg_get_userbyid(p.proowner) AS owner,
       coalesce(array_to_string(p.proconfig, ','), '') AS config,
       has_function_privilege('tixly_app', p.oid, 'EXECUTE') AS app_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY 1, 2;
-- každá musí mít search_path v config; seznam porovnat s 5.4

-- 8) Ukázkové granty (vše má vrátit t)
SELECT has_schema_privilege('tixly_app','communications','USAGE') AS communications,
       has_schema_privilege('tixly_app','brands','USAGE')         AS brands,
       has_table_privilege('tixly_app','orders.orders','SELECT,INSERT,UPDATE')  AS orders,
       has_table_privilege('tixly_app','tickets.tickets','SELECT,INSERT,UPDATE') AS tickets,
       has_table_privilege('tixly_app','catalog.events','SELECT')               AS events,
       has_table_privilege('tixly_app','identity.users','SELECT')               AS users;

-- 9) Helper funkce RLS existují
SELECT to_regprocedure('public.app_is_service()')         AS app_is_service,
       to_regprocedure('public.app_current_promoter_id()') AS cur_promoter,
       to_regprocedure('public.app_current_user_id()')     AS cur_user,
       to_regprocedure('public.app_is_platform_admin()')   AS is_admin;

-- 10) Stav migrací (poslední očekávaná: 506_term_cancel_postpone.sql)
SELECT count(*) AS aplikovano, max(filename) AS posledni FROM public.schema_migrations;

-- 11) Default privileges (měly by existovat pro neondb_owner → tixly_app)
SELECT pg_get_userbyid(defaclrole) AS za_roli, n.nspname, defaclobjtype, defaclacl
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY 2 NULLS FIRST LIMIT 20;
```

---

## 6. Doména, HTTPS, CSRF, webhooky

### 6.1 Veřejná URL

- **`APP_URL`** (server) a **`NEXT_PUBLIC_APP_URL`** (klient + dispatcher) musí obsahovat **stejnou** hodnotu `https://<doména>` bez koncového lomítka. Z URL se skládají všechny notification/return URL plateb a OAuth redirecty. Obě mají fallback `localhost` (§1.12 #1–2).
- `NEXT_PUBLIC_APP_URL` se vkládá do JS při buildu, takže po změně je nutný nový build.
- Doména `app.tixly.cz` je podle `GO-LIVE-CHECKLIST.md:87` přidaná ve Vercelu. Stav DNS se z kódu ověřit nedá.

### 6.2 CSRF / origin check

- `src/middleware.ts:137-144`: u `POST/PUT/PATCH/DELETE` s auth cookie (`accessToken`, `refreshToken`, `session_jwt`, `buyer_jwt`; `src/lib/security/csrf.ts:16`) musí `Origin` (jinak `Referer`) patřit do povolených originů. Jinak odpověď 403 `CSRF_ORIGIN_MISMATCH`. Platný `Authorization: Bearer` kontrolu přeskakuje.
- **Povolené originy** (`csrf.ts:51-58`): origin samotného požadavku (`req.nextUrl.origin`, takže fungují i white-label domény) a originy z `APP_URL` a `NEXT_PUBLIC_APP_URL`. **Jiná env pro další originy neexistuje.**
- Výjimky (`csrf.ts:18-25`): `/api/payments/*/webhook`, `/api/payments/benefit/*`, `/api/qes/webhook`, `/api/cron/*`, `/api/internal/*`, `/api/auth/oauth/callback/*`.
- Middleware maže podvržené `x-user-id` a `x-vercel-cron` (`src/middleware.ts:110,115`).
- CORS pro embed: `EMBED_ALLOWED_ORIGINS`, default `*` (`next.config.mjs:130-170`).

### 6.3 HTTPS a bezpečnostní hlavičky (`next.config.mjs:32-171`)

- **HSTS:** `max-age=63072000; includeSubDomains; preload` (`:96-99`, u embedu `:115`). `includeSubDomains` + `preload` se vztahuje na **všechny subdomény** domény, takže každá subdoména `tixly.cz` musí umět HTTPS.
- **CSP v produkci** (`:36-48`): `default-src 'self'`; `script-src 'self' 'unsafe-inline'` + GTM + `connect.facebook.net`; `connect-src 'self'` + Google Analytics + `graph.facebook.com`; `frame-ancestors 'none'`; `form-action 'self'`; `upgrade-insecure-requests`.
  - `form-action 'self'` může blokovat formuláře, které POSTují na cizí doménu. Platby jdou přes redirect na `gw_url` (`gopay-real.ts:176-179`), POST formulář na bránu z kódu nezjištěn.
  - CSP nepovoluje `js.hcaptcha.com` ani frame hCaptcha. Kdyby se widget začal používat (`src/components/security/HCaptchaWidget.tsx:63`), CSP ho zablokuje.
- **Embed** `/embed/*`: bez `X-Frame-Options`, `frame-ancestors ${EMBED_FRAME_ANCESTORS ?? '*'}` (`:78-88`).
- Další hlavičky: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP`/`CORP same-origin` (`:100-108`); `/api/*` má `no-store` a `noindex` (`:123-126`, `vercel.json:14-18`).
- Sentry tunel: `/api/monitoring` (`next.config.mjs:219`).

### 6.4 GoPay

- Notification URL se **posílá v každé platbě** (`callback.notification_url`, `src/lib/payment/gopay-real.ts:151-155`) a skládá se jako `${APP_URL}/api/payments/${providerName}/webhook` (`src/lib/payment/provider.ts:186`):
  - **Notifikace:** `https://<doména>/api/payments/gopay/webhook`. GoPay volá `GET ?id=<paymentId>` (přijímá se i POST), stav se pak ověřuje dotazem na GoPay API (`src/app/api/payments/gopay/webhook/route.ts:1-20`).
  - **Návrat kupce:** `https://<doména>/cs/order-confirmation/<orderId>` (`provider.ts:187`).
- Protože se URL posílá v requestu, v administraci GoPay ji z pohledu kódu zadávat netřeba. Zda GoPay vyžaduje whitelist domény nebo jiné nastavení v administraci, je z kódu nezjištěno, ověřit s GoPay.
- Token se žádá se scope `payment-all` (`gopay-real.ts:77-82`). Ověřit, že API přístup v GoPay tento scope povoluje.
- Produkční API: `https://gate.gopay.cz/api` (`gopay-real.ts:37`).

### 6.5 ComGate

- **URL pro předání výsledku platby (push notifikace):** `https://<doména>/api/payments/comgate/webhook` (POST, JSON i form-urlencoded). Zadává se v **klientském portálu ComGate**: kód ji v requestu neposílá (`src/lib/payment/comgate.ts:104`). Totéž uvádí `.env.example:64`. Ověření probíhá porovnáním `secret` z těla s `COMGATE_SECRET` a následným dotazem na API (`src/app/api/payments/comgate/webhook/route.ts:64-82`).
- **Návratové URL** (`url_paid`, `url_cancelled`, `url_pending`) se posílají v každé platbě. Všechny tři = `https://<doména>/cs/order-confirmation/<orderId>` (`comgate.ts:105-107`).
- Produkční API: `https://payments.comgate.cz/v2.0` (`comgate.ts:42`). Pro EUR se posílá `country: SK`, `lang: sk` (`comgate.ts:95,103`).
- Z kódu nezjištěno, zda ComGate vyžaduje whitelist IP pro API volání. Vercel funkce nemají pevnou IP, nutno ověřit v portálu ComGate.

### 6.6 Další webhooky a callbacky v `src/app/api`

| Poskytovatel | Path (na `https://<doména>`) | Kdo URL nastavuje | Env, která to zapíná | Soubor |
|---|---|---|---|---|
| Stripe | `/api/payments/stripe/webhook` (události dle `.env.example:80`: `checkout.session.completed`, `charge.refunded`, `charge.dispute.created`) | Stripe Dashboard → Webhooks | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` (bez obou odmítne) | `src/app/api/payments/stripe/webhook/route.ts:39` |
| PayPal | `/api/payments/paypal/webhook` (webhook), `/api/payments/paypal/capture?orderId=` (return URL, posílá se v requestu) | PayPal Developer → app → Webhooks | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | `src/app/api/payments/paypal/webhook/route.ts:53`, `src/lib/payment/provider.ts:165` |
| Mollie | `/api/payments/mollie/webhook` | posílá se v requestu | `MOLLIE_API_KEY` | `src/lib/payment/provider.ts:138` |
| Przelewy24 | `/api/payments/przelewy24/webhook` | posílá se v requestu | `P24_MERCHANT_ID`, `P24_CRC_KEY`, `P24_API_KEY` | `src/lib/payment/provider.ts:99` |
| Triple-A (krypto) | `/api/payments/triplea/webhook` | posílá se v requestu | `TRIPLEA_*` | `src/app/api/checkout/route.ts:2417` |
| Wise (výplaty) | `/api/payments/wise/webhook` | Wise → Settings → Webhooks (nezjištěno, zda se registruje přes API) | `WISE_API_KEY`, `WISE_PROFILE_ID`, `WISE_WEBHOOK_PUBLIC_KEY` | `src/app/api/payments/wise/webhook/route.ts:50` |
| Pluxee | `/api/payments/benefit/pluxee/callback?external_id=` | posílá se v requestu | `PLUXEE_*` | `src/lib/payment/benefit-providers/pluxee.ts:62` |
| Edenred / MultiSport / Gallery Beta | `/api/payments/benefit/callback?...` → **v produkci vždy 403** | — | — (nefunkční v prod) | `src/app/api/payments/benefit/callback/route.ts:32-37` |
| Benefit return | `/api/payments/benefit/return?...` | — | — | **routa neexistuje** (adresář `src/app/api/payments/benefit/` má jen `callback/` a `pluxee/`) → kupec po návratu dostane 404 |
| DocuSign (QES) | `/api/qes/webhook` | posílá se v requestu (`webhookUrl`) | `QES_PROVIDER=docusign` + `DOCUSIGN_*` | `src/app/api/admin/qes/sign-request/route.ts:101` |
| Google OAuth | redirect URI `/api/auth/oauth/callback/google` | Google Cloud Console → OAuth client → Authorized redirect URIs | `GOOGLE_CLIENT_ID/SECRET` | `src/app/api/auth/oauth/google/route.ts:27` |
| Facebook OAuth | `/api/auth/oauth/callback/facebook`; admin FB propojení `/api/admin/facebook/oauth/callback` | Meta for Developers → Facebook Login → Valid OAuth Redirect URIs | `FACEBOOK_APP_ID/SECRET` | `src/app/api/auth/oauth/facebook/route.ts:21` |
| Apple Sign in | `/api/auth/oauth/callback/apple` (form_post) | Apple Developer → Service ID → Return URLs | `APPLE_SERVICE_ID` | `src/app/api/auth/oauth/apple/route.ts:26` |
| Spotify | `/api/buyer/spotify/callback` | Spotify Developer Dashboard → Redirect URIs | `SPOTIFY_CLIENT_ID/SECRET` | `src/lib/spotify/oauth.ts:57` |
| PSD2 banky | `/api/admin/bank-credentials/psd2/callback` | developer portál banky (whitelist redirect URL, `.env.example:185-188`) | `KB_/CS_/CSOB_PSD2_*` | `src/app/api/admin/bank-credentials/psd2/authorize/route.ts:35` |

---

## 7. Shrnutí pro vlastníka

Minimální sada pro ostrý provoz, v pořadí, v jakém je potřeba ji připravit:

1. **Vercel tarif:** 17 cronů běží častěji než 1× denně, tarif Hobby to podle všeho nepovolí. Ověřit a případně přejít na **Pro**. Současně ověřit, že Deployment Protection neblokuje produkční doménu (self-fetch dispatcheru).
2. **Doména a DNS:** doména aplikace (např. `app.tixly.cz`) ve Vercelu a HTTPS na všech subdoménách (HSTS `includeSubDomains; preload`).
3. **Databáze (Neon):**
   - heslo pro `tixly_app` (`ALTER ROLE tixly_app WITH PASSWORD …`),
   - URL `tixly_app` (pooled) do Vercelu jako `DATABASE_URL`, volitelně ne-pooled jako `DATABASE_URL_DIRECT`,
   - URL `neondb_owner` do GitHub secret `DATABASE_URL`,
   - spustit ověřovací SQL z §5.5.
4. **Vygenerovat secrety** (`openssl rand -hex 32`, u JWT `-hex 64`) a uložit do Vercel env: `JWT_SECRET`, `ENCRYPTION_KEY` (po nasazení neměnit), `CRON_SECRET`, `INTERNAL_SERVICE_TOKEN`, `IP_HASH_SALT`, `HMAC_SECRET`. Doporučeně i `EMAIL_VERIFY_SECRET`, `TICKET_MAGIC_SECRET`, `NFC_SIGNING_KEY`, `RESELLER_JWT_SECRET`. **Nenastavovat** `INTERNAL_API_TOKEN` ani `NEXT_PUBLIC_INTERNAL_API_SECRET`.
5. **URL:** `APP_URL` = `NEXT_PUBLIC_APP_URL` = `https://<doména>`.
6. **Platební brána:** smlouva a produkční přístupy **GoPay** (`GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `PAYMENT_PROVIDER=gopay`) **nebo ComGate** (`COMGATE_MERCHANT`, `COMGATE_SECRET`, `PAYMENT_PROVIDER=comgate`).
   - **Nenastavovat** `COMGATE_TEST`, `GOPAY_SANDBOX` ani `ALLOW_MOCK_PAYMENTS`.
   - U ComGate zadat v portálu URL notifikace `https://<doména>/api/payments/comgate/webhook`.
7. **E-mail (Resend):**
   - účet a doména `tixly.cz` ověřená přes SPF, DKIM a DMARC (hodnoty z Resend),
   - `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, `SMTP_PASS=re_…`,
   - `EMAIL_FROM` a `MAIL_FROM` na ověřené doméně,
   - `RESEND_API_KEY` + `PLATFORM_ADMIN_EMAIL`.
8. **Provozní přepínače:** `TICKET_PDF_PRODUCTION_MODE=1`, `MODERATION_AUTO_PUBLISH_DISABLED=1`. Doporučeně `ANTHROPIC_API_KEY` (moderace), `REDIS_URL` (Upstash), `BLOB_READ_WRITE_TOKEN` (uploady), `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN`, omezit `EMBED_ALLOWED_ORIGINS`/`EMBED_FRAME_ANCESTORS`.
9. **GitHub secrets:**
   - `VERCEL_TOKEN` a doplnit `VERCEL_ORG_ID`/`VERCEL_PROJECT_ID` (vyžaduje úpravu `deploy.yml`, §3 bod 2),
   - `DATABASE_URL` (owner), `NEON_API_KEY`,
   - pro zálohy: AWS účet + S3 bucket (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, `AWS_REGION`) a `BACKUP_ENCRYPTION_KEY`,
   - volitelně `SLACK_WEBHOOK_URL`.
10. **Před spuštěním vyřešit, co z kódu nefunguje** (není to otázka klíčů):
    - cron `/api/admin/lastminute/check` (GET → 405),
    - neregistrovaný `payouts-execute` (výplaty promotérům se samy neodešlou),
    - mock `charge-installments` / `renew-subscriptions` (splátky a předplatné bez reálné platby, nevypínat jen klíčem),
    - chybějící `/api/payments/benefit/return`,
    - benefit karty mimo Pluxee nefungují (403).
11. **Volitelné integrace** podle obchodních potřeb: Stripe/PayPal/Mollie/P24/Triple-A, Wise, Pluxee, BulkGate SMS, Google/Apple/FB přihlášení (redirect URI z §6.6), Apple/Google Wallet, DocuSign, ForgeMsg, Spotify, Bandsintown/Songkick, DPP.
