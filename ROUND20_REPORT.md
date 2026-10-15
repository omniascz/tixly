# Kolo 20 — pád stránky potvrzení zaplacené objednávky + telemetry: false build pluginu Sentry (2026-10-15)

Větev `fix/round20-order-confirmation-2026-10-15` z `origin/integrate/2026-10-04` (`da9a8aeb`), sloučeno PR #17 (`c8ab017d`).
Výstupy v `logs/r20/`, průběh v `PROGRESS_R20.md`. Žádné migrace, žádné změny závislostí, žádné změny UI ani textů.

## 1. Krok 0 — výchozí stav

- **HEADy:** integrate/2026-10-04 lokálně = origin = `da9a8aeb`; master lokálně `3ab73410` (záměrně jiný, nezměněn), origin/master `d4b43f4f`; fix/round18-staging-2026-10-14 `716fe3c9` (= očekáváno, beze změny).
- **Cizí commity** po da9a8aeb na integrate ani na master: žádné.
- **Necommitnuté změny:** žádné.
- **CI/Vercel na da9a8aeb:** CI, Schema Drift Guard, RLS Gate a Security = success. PR #2 CLEAN, všechny kontroly zelené včetně Vercel – nextjs-boilerplate a Vercel – tixly; „RLS verify (produkce vs snapshot)" se přeskakuje (záměrně).
- **staging.keys.env:** neexistuje (`.gitignore:105` platí).
- **Ověření Kola 19** (`logs/r20/0_verify_r19.txt`): `npm ls @sentry/nextjs` = 11.7.0; `tests/r14-sentry-scrub.test.ts` 5/5 a `tests/r19-sentry-scrub.test.ts` 7/7 prošly.

## 2. Krok 1 — pád stránky potvrzení zaplacené objednávky

Test: `e2e/tests/golden-path-r20-order-confirmation.spec.ts`. Kupec koupí místo přes simulátor GoPay, aplikace běží jako `next start` nad DB postavenou z migrací pod rolí tixly_app s RLS. Ovladač pg ani dotaz se nemockují.

| bod | RED (log) | GREEN | commit |
|---|---|---|---|
| (a) HTTP 200 + číslo objednávky | ano — HTTP 500, chybová stránka (`logs/r20/1_red.txt`) | 200, `<code>` s id objednávky | RED `0b8e8a3b` → GREEN `b57c2bc8` |
| (b) žádný TypeError v logu serveru | ano — 2× `TypeError: d.event_date_start.replace is not a function` | 0 | `0b8e8a3b` → `b57c2bc8` |
| (c) odkaz calendar.google.com, `dates` v UTC podle `date_start` z DB | ano — odkaz chybí (0 odkazů) | `20261119T190000Z/20261119T190000Z` = `date_start` přečtené z DB | `0b8e8a3b` → `b57c2bc8` |
| (d) nezaplacená objednávka: odkaz chybí | ne (prošlo i na starém kódu) | prošlo | — |
| null (zaplacená objednávka bez akce) | ne (prošlo i na starém kódu) | prošlo | — |

`event_date_start` může být NULL jen u objednávky bez akce (`event_id` NULL), protože `catalog.events.date_start` je NOT NULL. Test tento případ pokrývá: vloží zaplacenou objednávku stejného tvaru, jaký zakládá `api/vouchers/holders/[paymentId]/confirm`.

**Změna page.tsx** (`logs/r20/1_page_diff.txt`):
- ř. 36 `event_date_start: string | null;` → ř. 36–37: komentář „Kolo 20" a `event_date_start: Date | string | null;`
- nové ř. 145–147: `const eventStartIso = order.event_date_start ? new Date(order.event_date_start).toISOString() : null;` a `const gcalStart = eventStartIso ? eventStartIso.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '') : null;`
- ř. 187 a 189 → 191 a 193: `{eventStartIso && (` a `formatDate(eventStartIso, locale)`. Je to tentýž okamžik, takže výstup formatDate se nemění.
- ř. 359 → 363: `{isPaid && gcalStart && order.event_title ? (`
- ř. 369 → 373: `&dates=${gcalStart}/${gcalStart}` místo `order.event_date_start.replace(/[-:]/g, '').replace('T', 'T').slice(0, 15) + 'Z'` (2×)
- `paid_at` a `expires_at` jsem nechal beze změny. Na `paid_at` se žádná metoda řetězce nevolá a `expires_at` jde přes `new Date()`. `ItemRow` žádná data nemá.
- tsc 0. Lint souboru: 3 chyby `import/order`, stejné jako před změnou.

**Grep 1.4:** 18 výskytů, **0 kandidátů** na stejnou vadu (`logs/r20/1_grep_dates.md`). Všechny hodnoty jsou buď přetypované v SQL na `::text`, nebo přicházejí přes JSON či ze vstupu uživatele. Postřeh pro další kolo: `<timestamptz>::text` + `slice(0, 10)` vrací datum v časové zóně relace DB (lokálně UTC), ne v Europe/Prague. Týká se date-holds, offers, theatre-reports a songkick.

**Turné** (`golden-path-r8-theatre-tour`): řádky `event_date_start.replace` v logu serveru:
- **před opravou: 2** (`logs/r19/9_server_tour.txt`; 2× i v mém RED běhu `logs/r20/1_red_run_server.txt`);
- **po opravě: 0** (`logs/r20/9_tour_server.txt`, turné 10/10).

Obálky Sentry z turné obsahují 0× „replace is not a function" (Kolo 19: 2×).

**golden-path-buyer a golden-path-benefit: NEPROŠLY** (4 testy selhaly, 3 se nespustily; `logs/r20/1_green.txt`). Asserty jsem podle zadání neměnil. Všechna selhání nastanou ještě před stránkou potvrzení, v kódu, který kolo 20 nemění:
- buyer čeká text „Cenové kategorie", který v `src` není (0 výskytů);
- benefit: `POST /api/auth/login` druhého účtu vrací 403 `CSRF_ORIGIN_MISMATCH`, dále „No usable event found";
- benefit: kód chyby je `NOT_FOUND` místo očekávaného `PAYMENT_NOT_FOUND`.

V kolech 10–19 se tyto specy nespouštěly. Pro tento běh jsem postavil DB `r20rich`: migrace od nuly plus data demo tabulek, která jsem jen přečetl z lokální vývojové DB tixly-postgres a termíny posunul do budoucna (`logs/r20/rich_from_dev.sh`).

## 3. Krok 2 — telemetrie build pluginu Sentry

- **RED** (`logs/r20/2_red.txt`, commit `524ed2ad`): nezměněný build (`npm run build`, SENTRY_DSN a NEXT_PUBLIC_SENTRY_DSN na `http://r20p…@127.0.0.1:3995/1`, bez SENTRY_AUTH_TOKEN) provedl **5 pokusů** o spojení mimo localhost, všechny na **`o1.ingest.sentry.io:443`**. Jde o DSN telemetrie v `@sentry/bundler-plugins/build/cjs/core/sentry/telemetry.js:16`; výchozí hodnota je `telemetry: userOptions.telemetry ?? true` (`options-mapping.js:17`). Pojistka `logs/r20/net-guard.cjs` je zablokovala dřív, než spojení odešlo, takže na sentry.io nic neodešlo. Druhý build (s opravou kroku 1) provedl 3 pokusy.
- **GREEN** (`logs/r20/2_green.txt`, commit `d206dd6c`): **0 pokusů** o spojení mimo localhost. Totéž platí pro build s tunelem jako v Kole 19 (`logs/r20/2_sentry11_net_summary.txt`).
- **Změna next.config.mjs:** ř. 235–236, uvnitř `withSentryConfig` přibyl komentář `// Kolo 20: build plugin neposílá vlastní telemetrii na sentry.io (výchozí true)` a `telemetry: false,`. Nic jiného v konfiguraci Sentry se nezměnilo.
- **Tabulka rout shodná: ano** — 1124 rout, 1119 ƒ / 5 ○, diff s `logs/r19/3_routes.norm.txt` je prázdný.
- **golden-path-r19-sentry11: 1 passed** (`logs/r20/2_sentry11.txt`):
  - (a) 500 a událost s release = SHA;
  - (b) 502 a událost;
  - (c) tunel `/api/monitoring` vrátil 200 a událost dorazila;
  - (d)+(e) 0 nálezů v 59 obálkách;
  - (f) 401/401/401.
- `tests/r19-sentry-scrub.test.ts` 7/7.

## 4. Kompletní sada, CI a sloučení

- **Migrace od nuly:** FAILED_FILES=0 (r20a, 4× čerstvě; r20demo, r20rich).
- **tsc:** 0 (`9_tsc.txt`).
- **lint:** 967 chyb při baseline 1008, nevzrostlo (`9_lint.txt`).
- **unit:** 78 souborů, 719 passed, 13 skipped (`9_unit.txt`).
- **live:** 487 testů ve 108 souborech (`live/`) — n00 83, n01 49, n02 73, n03 40, g00 163 + 1 skip, g01 77, webhook-pool 2.
  - Části g00/g01 jsem napoprvé omylem spustil bez simulátoru GoPay (`*_bez_gopay.txt`, fetch failed). Zopakoval jsem je se simulátorem na čerstvé r20a a prošly.
- **Build:** OK, routy identické. **Build bez sítě** v čistém klonu `30160486`: OK, 0 spojení (`9_build_no_network.console.txt`).
- **Audity** (`9_audits_summary.txt`): 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b 0 zápisů (všech 5 čítačů 0), 08 2, 09 12, 10 7, 11 8, 12 5 — **0 FAIL**.
- **Turné:** 10/10 (`9_tour.txt`).
  - První běh spadl v kroku 4 na `ECONNRESET` bez chyby v logu serveru (`9_tour_run1_econnreset.txt`). Druhý běh na čerstvé r20a prošel.
- **golden-path-r13-keep + r16-prehydration:** 22/22 (`9_golden.txt`).
- **Offline skener:** 6/6 (`9_offline.txt`).
- **CI PR #17 na `8795cb43`:** všechno pass — Install · typecheck · lint · unit, Live sada, Build bez sítě, Schema drift, RLS Gate (ručně: RLS verify z migrací pass, produkce skipped), Security (ručně: Gitleaks + Dependency audit ×4).
  - První ruční Security na `279e1c6a` selhal na Gitleaks: 9 fingerprintů v logech kola 20. Triáž je v `logs/r20/9_gitleaks_triage.md`: shareToken/token z live testů, idempotency_key auditu 03, fixture offline skeneru, DSN simulátoru a reset token v obálce simulátoru. **Skutečné tajemství 0.** Nálezy jsem doplnil do `.gitleaksignore` (commit `8795cb43`).
- **Vercel** – nextjs-boilerplate: pass. Vercel – tixly: pass.
- **Sloučený PR: #17** (`gh pr merge --merge`) → merge commit `c8ab017d`. Lokální tixly/ jsem fast-forwardnul na integrate.
- **Poslední commit na integrate:** commit s ROUND20_REPORT.md, hash je uvedený na konci souboru.
- **PR #2:** OPEN, CLEAN, MERGEABLE. Na `c8ab017d` jsou všechny kontroly zelené (CI ×3, Dependency audit ×4, RLS verify z migrací, Schema drift, Gitleaks, Vercel – nextjs-boilerplate, Vercel – tixly); „RLS verify (produkce)" skipping. Nesloučen, master nepushnut.

## 5. Co nebylo ověřeno a proč

- **golden-path-buyer a golden-path-benefit** nejsou zelené. Specy jsou zastaralé vůči současnému UI a API (text, CSRF, kód chyby) a podle zadání jsem neměnil asserty. Na buildu bez opravy jsem je nespouštěl; jejich selhání ale nastávají v krocích před navigací na order-confirmation, které page.tsx neovlivňuje.
- **Skutečné sentry.io** (zakázáno): nevím, zda by Vercel build s `telemetry: false` opravdu neposílal nic. Ověřeno je to jen lokálně s pojistkou net-guard.
- **Produkce, Vercel preview s DSN a skutečná brána:** stránku potvrzení jsem ověřil jen lokálně (simulátor GoPay, DB z migrací). Časová zóna serveru výpočet `dates` neovlivní, protože se počítá přes `toISOString()`.
- **Text data na stránce (formatDate):** že je stejný jako dřív, jsem odvodil z kódu (`new Date(iso)` je tentýž okamžik). Před a po jsem to neporovnával, protože na starém kódu stránka zaplacené objednávky padala.
- **Postřeh mimo rozsah:** serverový span Sentry nese hlavičku `referer` s celou URL včetně dotazu (v obálce byl reset token z testu) a `scrub-pii.ts` ji nemaže. Zapsáno do NEXT_STEPS.md jako kandidát, neopravováno.
- **Spany z prohlížeče přes tunel:** 0 (v Kole 19 jich bylo 38). Odpovídá to vzorkování `tracesSampleRate: 0.1`; nejde o assert specy.
- **Staging** v tomto kole nebyl (`staging.keys.env` chybí).
