# Kolo 21 — tokeny z URL (hlavička `referer`, parametry dotazu) se nedostanou do Sentry

Větev `fix/round21-sentry-url-tokens-2026-10-15` z `origin/integrate/2026-10-04` (9b2e17e7), sloučena **PR #18** (`--merge`)
→ `2203c81c`. Průběh `PROGRESS_R21.md`, výstupy `logs/r21/`. Migrace žádné, závislosti beze změny, UI beze změny.

## 1. Krok 0 — výchozí stav
- HEADy (`logs/r21/0_state.md`):
  - integrate/2026-10-04: lokálně i na originu `9b2e17e7`;
  - master: lokálně `3ab73410` (záměrně jiný, neměněn), na originu `d4b43f4f`;
  - fix/round18-staging-2026-10-14: `716fe3c9` (= očekáváno).
- Cizí commity po 9b2e17e7 nejsou: na integrate, origin/master ani lokálním masteru.
- Necommitnuté změny před začátkem: žádné.
- CI a Vercel na 9b2e17e7 (PR #2 CLEAN):
  - zelené: CI, Security, RLS Gate, Schema Drift Guard, Vercel – nextjs-boilerplate, Vercel – tixly;
  - „RLS verify (produkce)" záměrně skipping.
- `staging.keys.env` neexistuje. `git check-ignore` ho chytí pravidlem `.gitignore:105`.
- Ověření Kola 20 (`logs/r21/0_verify_r20.txt`):
  - `telemetry: false` je uvnitř `withSentryConfig` (`next.config.mjs:236`);
  - golden-path-r20-order-confirmation: **3 passed**;
  - build: 0 spojení mimo localhost.

## 2. Krok 1 — tajemství v URL (`logs/r21/1_url_secrets.md`)
- **V parametru dotazu: 63 míst.**
  - 53 jsou vlastní stránky a API;
  - 10 jsou odchozí volání třetím stranám (FB, GA4, Songkick, Bandsintown, qrserver).
  - Zpráva commitu 75e5494d uvádí chybně 61; opraveno v PROGRESS.
- **V segmentu cesty: 33 míst** (31 vlastních, 2 odchozí: Fio a Przelewy24).
- **Maskované názvy parametrů (27)**, přesná shoda bez ohledu na velikost písmen:
  - povinné: `token, code, key, secret, signature, sig, hash, otp, password, access_token, refresh_token, sessionId, session_id`;
  - doplněné ze soupisu: `state, queueToken, seatHoldToken, lotteryToken, lotteryEntryId, groupInvitation, waitlistId, orderId, next, redirect, client_secret, api_secret, apikey, app_id`.
  - Parametr `data` (otpauth secret v URL obrázku api.qrserver.com) jsem vyřadil. Název je příliš obecný a hodnota neodchází přes Sentry.
- **Kandidáti na další kolo (tajemství v cestě, neopraveno):**
  - vstupenky a dárky: `/{locale}/t/{token}`, `/api/public/tickets/{token}/totp`, `/charity/claim/{token}` + `/api/charity/claim/{token}`, `/foyer/pickup/{token}`, `/gift/{token}` + `/api/gift/{token}`, `/season-pass/{passToken}` + `/api/season-passes/{passToken}`;
  - skupiny, losování, změny termínu, hodnocení: `/group/{token}` + `/api/group-invitations/{token}` + `/api/buyer/group-invitations/{token}/claim`, `/lottery/result/{token}` + `/api/lottery/entry/{token}`, `/reschedule/{token}` + `/api/reschedule/{token}`, `/review/{token}` + `/api/reviews/{token}`;
  - převody a nabídky: `/tickets/transfer/{token}` + `/api/tickets/transfer/{token}`, `/transfer/accept/{token}` + `/api/transfer/accept/{token}`, `/nabidka/{token}` + `/api/offers/{token}`;
  - platby a fronta: `/party/{token}` + `/api/checkout/party-split/{token}`, `/api/queue/{eventId}/status/{token}`, `/api/vouchers/{code}/pdf`, `/api/buyer/gift-cards/{code}`;
  - ostatní: `/api/buyer/announcements/{token}/respond`, `/cs/order-confirmation/{orderId}`;
  - odchozí: Fio `…/rest/(last|periods|set-last-id)/{token}/…`, Przelewy24 `…/trnRequest/{token}`.

## 3. Krok 2 — maskování (RED → GREEN)

| bod | RED: obálek s tokenem; atribut / pole (`logs/r21/2_red.txt`) | GREEN (`logs/r21/2_green.txt`) | commit |
|---|---|---|---|
| (a) `/cs/reset-password?token=` (token z Mailpitu, 64 znaků) → odeslání nového hesla | **11**; `http.request.header.referer` 26, `http.target` 2, `next.span_name` 1 | 0; spanů s cestou /cs/reset-password 30 | RED `ccee24f5`, GREEN `700c8af8` |
| (b) `/cs/events/<id>/seats/kategorie?token=…&seats=…` → seat-prices | **14**; `http.request.header.referer` 26, `http.target` 2, `next.span_name` 1 | 0; spanů s /seats/kategorie 38 | RED `ccee24f5`, GREEN `700c8af8` |
| (c) `POST /api/ops/sentry-check?token=<vygenerovaný>` + Referer `…?token=…` → 500 | **3**; span referer 2, `http.target` 2, `next.span_name` 1, událost `request.headers.referer` 1 | 0; událost dorazila | RED `ccee24f5`, GREEN `700c8af8` |

Oprava je v commitu `b7af4622`. Spec mezi RED a GREEN beze změny (`git diff ccee24f5 -- spec` je prázdný).

Na starém kódu už SDK samo filtrovalo `url.full` (6×), `url.query` (6×), `request.url` (1×) a `request.query_string` (1×) na `token=[Filtered]`. Výchozí snippet SDK „token" ale na hodnoty hlaviček nepůsobí.

**Změna `nextjs-boilerplate/src/lib/observability/scrub-pii.ts`** (úplný diff `logs/r21/2_scrub_diff.txt`):
- **Před:**
  - `scrubText` = `s.replace(EMAIL_RE,'[email]').replace(PHONE_RE,'[telefon]')`;
  - `urlQueryParams: { deny: DENY_V10 }`;
  - `scrubSentrySpan` maže jen `SPAN_DROP_ATTR`, ostatní řetězce prožene `scrubText`.
- **Po:**
  - nový `URL_SECRET_PARAMS` (27 názvů) a `URL_SECRET_RE` = `(^|[?&#;]|%3F|%26|%23)(názvy)(=|%3D)(hodnota až po & # ; %26 %23)`, flag `gi`;
  - `scrubText` navíc `.replace(URL_SECRET_RE, '$1$2$3[skryto]')`;
  - nový `stripUrlQuery(url)` uřízne URL na prvním `?` nebo `#`;
  - `REFERER_KEY = /(?:^|[._-])referr?er$/i`: referer v událostech (`scrubValue`) i ve spanech (`scrubSentrySpan`) → `scrubText(stripUrlQuery(v))`, i pro pole hodnot;
  - `query_string` jako dvojice `[název, hodnota]` → `[název, '[skryto]']`;
  - `urlQueryParams: { deny: [...DENY_V10, ...URL_SECRET_PARAMS] }`;
  - stávající maskování (e-mail, telefon, citlivé klíče, IP, cookie, authorization) je beze změny.

**Párování `urlQueryParams.deny`** (`logs/r21/2_sdk_deny.md`):
- Podřetězec bez ohledu na velikost písmen. `@sentry/core` 11.7.0, `build/esm/utils/data-collection/filterKeyValueData.js:19`: `const matchesConfiguredTerm = terms.some((term) => lowerKey.includes(term.toLowerCase()));`
- Navíc se vždy odmítají snippety `SENSITIVE_KEY_SNIPPETS` (`filtering-snippets.js:2-24`: auth, token, secret, session, password, key, …).
- Filtr se uplatní jen na URL a dotaz, ne na hodnotu hlavičky referer.

**Unit testy** (`tests/r21-sentry-url-tokens.test.ts`, 16 testů):
- pokrývají referer s dotazem, `url.full`/`url.query`/`http.target`/`span.name`, URL-kódovaný token i vnořenou URL, fragment, `query_string` bez otazníku i jako dvojice, jiný název parametru beze změny, zachování starého maskování a `deny`;
- RED na starém `scrub-pii.ts`: 15 z 16 selhalo (`2_unit_red.txt`);
- GREEN: r21 + r14 + r19 = **28/28** (`2_unit_green.txt`); r14 a r19 beze změny.

**golden-path-r19-sentry11: 1 passed** (`logs/r21/2_sentry11.txt`):
- (a) 500 a událost dorazila;
- (b) 502 a událost dorazila;
- (c) chyba z prohlížeče prošla tunelem (200);
- (d)+(e) žádné nálezy;
- (f) 401 ×3;
- 204 spanů (38 z prohlížeče);
- 0 spojení mimo localhost.

**`token=` v obálkách golden-path-r13-keep (+ r16, r20)** (`logs/r21/9_golden_summary.txt`):
- před opravou (`logs/r20/9_golden_envelopes.jsonl.raw.jsonl`): 2× `token=` se skutečnou hodnotou;
- po opravě: **0** — jen 7× `token=[skryto]`;
- totéž v obálkách turné: 7× `[skryto]`, 0 hodnot.

## 4. Kompletní sada, CI, sloučení
- Migrace od nuly: FAILED_FILES=0 (r21a ×4).
- tsc 0.
- Lint **967** (baseline 1008, nevzrostlo).
- Unit **735 passed + 13 skip** (80 souborů).
- Live po částech **487 passed + 1 skip / 108 souborů** (n00 83, n01 49, n02 73, n03 40, g00 163+1, g01 77, webhook_pool 2).
- Build OK. Build bez sítě v čistém klonu `2ca1fee9` OK.
- Audity 01–12 vč. 07b a 08: **0 FAIL** (`9_audits_summary.txt`).
- Turné **10/10**.
- golden-path:
  - r13-keep + r16-prehydration + r20-order-confirmation: **25 passed**;
  - r21-sentry-url-tokens: 1 passed;
  - r19-sentry11: 1 passed.
- Offline skener **6/6**.
- golden-path-buyer a golden-path-benefit jsem podle zadání nespouštěl.
- Gitleaks lokálně: 10 fingerprintů testovacích dat. Triáž je v `logs/r21/9_gitleaks_triage.md`, záznamy v `.gitleaksignore` (commit `f24b9678`). Pak „no leaks found".
- **PR #18** na `f24b9678` — všechny kontroly zelené:
  - CI: Install·typecheck·lint·unit, Live sada, Build bez sítě;
  - Schema drift;
  - ruční Security 38746044263: Gitleaks + Dependency audit ×4;
  - ruční RLS Gate 38746111686: RLS verify z migrací (produkce skipped);
  - Vercel – nextjs-boilerplate, Vercel – tixly.
- Sloučeno `--merge` → `2203c81c`. Lokální tixly/ jsem fast-forwardem posunul na integrate.

## 5. Co nebylo ověřeno
- Skutečné sentry.io: ověřeno jen proti lokálnímu simulátoru (zakázáno). Chování ingestu Sentry (serverové scrubbery) je mimo test.
- Tajemství v segmentu cesty (33 míst) se do Sentry dál dostávají v `url.full`, `http.target`, refereru (cesta zůstává) i v názvech spanů. V tomto kole záměrně neopraveno.
- Postřehy ze soupisu jsem neověřil testem:
  - share-card přijme libovolný `?token=`;
  - `/api/buyer/announcements/{token}/respond` funguje bez přihlášení;
  - checkout přijme `lotteryEntryId` bez vazby na kupce;
  - `admin/live` předává JWT v `?token=`;
  - TOTP secret odchází v URL obrázku na api.qrserver.com.
- Spany z prohlížeče s refererem ověřuje jen unit test a stejná funkce v `beforeSendSpan` klienta. Golden r19 poslal 38 spanů z prohlížeče, ale e2e kontrola tokenů r21 běžela na serverových spanech a událostech.
