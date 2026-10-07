# Kolo 15 — upgrade Next.js 14 → 15 (bezpečnostní advisories) bez změny chování a vzhledu

Větev `fix/round15-next15-2026-10-07` z `f2af248a` → PR #13 do `integrate/2026-10-04`, sloučeno jako **e6f45c68**.
Výstupy `logs/r15/`, průběh `PROGRESS_R15.md`. Názvy, menu a vzhled beze změny.

## 1. Verze a advisories

| balíček | před | po |
|---|---|---|
| next | 14.2.35 | **15.5.27** (nejnovější vydaná 15.5.x) |
| react / react-dom | 18.3.1 | 19.2.8 (Next 15.5.27 má pro App Router zabudovaný React 19.2.0-canary-0bdb9206-20250818) |
| @types/react / @types/react-dom | 18.3.28 / 18.3.7 | 19.2.18 / 19.2.7 |
| eslint-config-next | 14.2.35 | 15.5.27 |
| eslint-plugin-react-hooks | 4.6 | 5.2.0 (shodná s eslint-config-next 15 — jinak konflikt pluginů v ESLint) |
| @testing-library/react | 14.3.1 | 16.3.3 (+ @testing-library/dom 10.4.2; v14 jen React 18) |
| @sentry/nextjs | 8.55.2 | 8.55.2 beze změny — podporuje next ^15, nejnovější 8.x |

Ověření (`logs/r15/0_advisories_next.txt`):
- GitHub Advisory Database: **next@15.5.27 — 0 advisories**; next@14.2.35 — 2 critical (GHSA-2xp9-vwfh-vxw4,
  GHSA-p293-qw3h-jr36) + 8 high. react@19.2.8 a react-dom@19.2.8 — 0.
- Zabudovaná kopie React Server Components se sleduje pod balíčkem `next` (např. critical GHSA-9qr9-h5gf-34mp je
  `next` < 15.5.7) — pro 15.5.27 žádný.
- `npm audit`: next před upgradem **critical**, po upgradu moderate (jen přes zabudovaný postcss 8.4.31; žádný critical
  ani high). Na 16 se nepřecházelo.

## 2. Změny kódu po skupinách

| skupina | souborů | co a proč |
|---|---|---|
| Asynchronní request API | 414 (codemod) + 5 ručně | `@next/codemod@15.5.27 next-async-request-api`: params/searchParams jako Promise (await / React.use), `await cookies()/headers()`. Ručně: 4 routy, kde codemod hlásil „ctx is passed as an argument" (events/[id]/alert, seats, seats/hold, tickets/transfer/[token]) a lokální obal `withUser` v my/tickets/[ticketId]/transfer, který codemod nepozná (params.ticketId by byl undefined) — vnější handler params awaitne, vnitřní logika beze změny. |
| Typy React 19 | 94 (codemod) + 1 | `types-react-codemod scoped-jsx` (globální JSX → `import type { JSX } from 'react'`); RefObject v admin/onboarding. Jen typy. |
| Testy | 11 | volání handlerů s `params: Promise.resolve(...)` (tak je volá Next 15). |
| Konfigurace (chování Next 14) | next.config.mjs | `serverExternalPackages: ['pdfkit']` (starý klíč Next 15 ignoruje → pdfkit by se bundloval); `outputFileTracingRoot` = adresář projektu (výchozí Next 14; Next 15 by z lockfilů vzal tixly/); `instrumentationHook` zrušen (v 15 výchozí); `experimental.staleTimes {dynamic: 30, static: 300}` (výchozí Next 14, ověřeno ve zdrojích obou verzí; Next 15 má dynamic 0); `experimental.preloadEntriesOnStart: false` — Next 15 při `next start` načítal a vykonával moduly všech 1124 rout, první požadavek 21–23 s (jednou 109 s) proti 0,23 s v Next 14 (CPU profil `logs/r15/cpuprof`); po vypnutí 0,25 s. |
| Cachování | 1 routa | `/api/public/push/vapid-key`: `dynamic = 'force-static'` (Next 14 GET bez request předgeneroval). fetch: chování změřeno na minimální aplikaci v obou verzích (počítací upstream) — Next 14 ukládal jen GET fetch v routě bez přístupu k request a v dynamické stránce bez cookies()/headers(); inventura 143 serverových fetch (`2_fetch_inventory.json`, `2_fetch_callers.json`): žádná cesta aplikace do této skupiny nespadá → bez explicitního cache. |
| Písmo | src/app/layout.tsx | Next 15.5 nehashuje název rodiny v @font-face z next/font (`__Inter_65423c` → `Inter`); CSS aplikace má doslovně `Inter`, takže by text nově používal webfont místo systémového písma (CDP getPlatformFontsForNode: isCustomFont false → true). Nepoužitý next/font Inter odstraněn (proměnnou --font-inter nic nepoužívalo) → vykreslení jako v Next 14. Vedlejší efekt: odpadl preload souborů Inter, které Next 14 stahoval a nepoužil. |
| Lint | .eslintrc.json | `@next/next/no-html-link-for-pages` vypnuto: plugin 15 ho nově uplatňuje na app/ (v 14 jen pages/, který projekt nemá → nehlásilo nic); záměna `<a>` za `<Link>` by změnila navigaci. import/order po codemodech. |
| IP klienta | komentář | Next 15 neplní `req.ip`; použije se `x-real-ip` = totéž co oficiální `ipAddress()` z @vercel/functions (ověřeno ve zdroji). |

## 3. Pixelové porovnání

28 obrazovek (22 z kola 13 + veřejný program, inscenace, checkout v 1440 a 390 px), přesné porovnání bez tolerance,
čerstvé demo DB před každou sadou (`logs/r15/3_screens_summary.md`, `before/`, `after/`, `diff/`).
- První porovnání 0/28 — všechny texty jiným písmem (viz skupina Písmo) → opraveno.
- Po opravě **25/28 pixelově shodných**. Zbytek 5–46 px s odchylkou ≤ 6/255 na antialiasovaných hranách (kruh avataru,
  zaoblené rohy) ve 07-firemni a 09-reporty, sada se mezi běhy mění (02/07/09, 07/09, 07/09/13); stejný typ šumu i mezi
  běhy Next 14 (13-saly 46 px v 1 ze 3 běhů). HTML a geometrie hlavičky shodné na 3 desetinná místa, CSS po sjednocení
  zápisu barev významově totožné → vzniká při rastrování v prohlížeči. **Neopraveno** — v aplikaci jsem příčinu nenašel.
- Dynamický obsah: žádný (data termínů relativní k vytvoření demo dat, všechny sady týž den).
- První reference byla poškozená výpadkem sítě při buildu (ETIMEDOUT u Google Fonts) — pořízena znovu.

## 4. Statické / dynamické vykreslení rout

`routes-before.txt` vs `routes-after.txt` (z `next build`): **1124 rout, 1119 ƒ, 5 ○ — beze změny**. Bez zásahu se
změnila jediná routa (`/api/public/push/vapid-key` ○ → ƒ, výchozí GET handler v Next 15) — vráceno `force-static`.
prerender-manifest obou verzí shodný (5 rout, stejné revalidate). „Generating static pages" 388 → 386 je jen počet
stránek, o jejichž předgenerování se build pokusil — výstup shodný.

## 5. Zátěžový test (scénář kola 14)

Stroj byl dnes zatížený procesy mimo session (volno 0,6–0,8 GB, 3 procesy python ~60 000 s CPU, Docker), takže
čísla z kola 14 se nedala zopakovat ani na Next 14. Proto střídavé srovnání Next 14 (čistý klon f2af248a, 4 běhy) a
Next 15 (5 běhů) na stejné DB a PgBouncer (pool 10) — `logs/r15/load/3_load_compare.md`, `3_load_tables.md`:

| krok | kolo 14 p95 | Next 14 dnes p95 průměr / medián | Next 15 dnes p95 průměr / medián | Next 15 vs 14 průměr / medián |
|---|---|---|---|---|
| stránka | 365 ms | 1,02 s / 994 ms | 859 ms / 776 ms | −16,2 % / −21,9 % |
| plánek | 133 ms | 875 ms / 849 ms | 1,43 s / 719 ms | +62,8 % / −15,3 % |
| hold | 163 ms | 5,86 s / 5,69 s | 6,27 s / 6,33 s | +7,0 % / +11,2 % |
| checkout | 491 ms | 6,31 s / 6,52 s | 6,80 s / 7,23 s | +7,7 % / +10,8 % |
| platba | 2 ms | 2 ms / 2 ms | 2 ms / 2 ms | −14,6 % / −11,7 % |
| webhook | 2,59 s | 31,95 s / 31,09 s | 32,65 s / 32,51 s | +2,2 % / +4,6 % |

Průměr plánku táhne jediný běh Next 15 (4,11 s); zbylé 4 běhy (0,60–1,04 s) leží v rozsahu Next 14 (0,48–1,33 s).
Konzistence Next 15 OK ve všech 5 bězích (bez přeprodeje); Next 14 v jednom běhu vydal 496 vstupenek z 500.
Absolutní srovnání s kolem 14 (hranice +20 %) za těchto podmínek ověřit nešlo — doporučuji běh zopakovat na klidném stroji.

## 6. Zbývající zranitelnosti (npm audit po upgradu)

Celkem 57: 2 critical, 26 high, 28 moderate, 1 low (před upgradem 58: 3 critical vč. next, 27 high). Úplná tabulka
`logs/r15/3_npm_audit_table.md`; souhrn:

| balíček | závažnost | přímá/tranzitivní | potřebná verze | dopad |
|---|---|---|---|---|
| vitest, tinypool | critical | přímá / tranzitivní | vitest 5.0.3 (major) | jen testy |
| @sentry/nextjs (+ @sentry/node, webpack-plugin, bundler-plugin-core, unplugin, rollup, 16 × @opentelemetry/*, @prisma/instrumentation, uuid) | high / moderate | přímá / tranzitivní | @sentry/nextjs 11.5.0 (major) | runtime SDK bez SENTRY_DSN neaktivní; plugin jen build |
| @typescript-eslint/* (5), eslint-config-next, @next/eslint-plugin-next, fast-glob, globby, minimatch | high | přímá / tranzitivní | @typescript-eslint 8.71.1 (major) | jen vývoj (lint) |
| tailwindcss, postcss, braces, micromatch, chokidar, postcss-nested, postcss-selector-parser | high / moderate | přímá / tranzitivní | tailwindcss 4.3.3 (major), postcss přes next 16 | jen build CSS |
| @vitest/ui, vite, vite-node, esbuild | high / moderate | přímá / tranzitivní | vitest 5 (major) | jen testy |
| @vercel/blob, undici, @fastify/busboy | moderate / high | přímá / tranzitivní | @vercel/blob 2.8.1 (major) | runtime: nahrávání souborů |
| nodemailer | high | přímá | 10.0.16 (major) | runtime: e-maily |
| node-forge | high | přímá | oprava neexistuje | runtime: kryptografie |
| next | moderate | přímá | (postcss) next 16 | build: vlastní CSS aplikace |
| @simplewebauthn/server | low | přímá | 14.0.3 (major) | runtime: passkey |

Všechny opravy vyžadují major verzi (mimo rozsah „bez změny chování") nebo neexistují.

## 7. Sady, CI, Vercel, PR

Lokálně (`PROGRESS_R15.md`, `logs/r15/`):

| co | výsledek |
|---|---|
| typecheck | 0 (i s vygenerovanými `.next/types` po buildu) |
| lint | bez nové chyby nad baseline (971 < 1008) |
| unit | 712 passed, 13 skipped. Přerušované vypršení `fix-r11 › GET /api/health/redis` (limit 20 s): bez instrumentace 3 ze 7 plných běhů, s výpisy času 0 z 9 (import ~1 s, GET ~4 s); falešné časovače vyloučeny; příčina nepotvrzena, limit neoslaben; v CI prošlo |
| live (po 20 souborech) | 106 souborů, 484 testů + checkout-stress opt-in (= kolo 14) |
| build / build bez sítě | OK / OK, 0 síťových spojení |
| audity 01–12 vč. 07b, 08 | 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b zápisy 0 řádků, 08 2 (166 rout × 3 aktéři), 09 12, 10 7, 11 8, 12 5 PASS — 0 FAIL |
| turné | 10/10 |
| golden-path-r13-keep | 10/10 (napoprvé spadl na pomalém prvním požadavku → preloadEntriesOnStart) |
| offline skener | 6/6 (bod 5: na Next 15 se stránka otevřená offline z cache ve 2 ze 4 běhů dokreslí na klientu — serverová kopie formuláře ~650 ms skrytá v DOM, viditelné vždy jedno pole, funkce beze změny; Next 14 0 ze 3; spec čeká na jediné pole) |
| tabulka rout | beze změny ○/ƒ |
| screenshoty | 25/28 shodných |

Další zjištění: přihlašovací formulář smaže e-mail napsaný před hydratací, když se po hydrataci vyplní heslo — stejně
v Next 14 i 15 (`logs/r15/3_hydration_race.txt`); testy nyní čekají na hydrataci. Při 0,8 GB volné paměti systém dvakrát
ukončil blok (screenshoty, audity) — pokračováno po menších blocích.

**PR #13** (`fix/round15-next15-2026-10-07` @ 6bab0533 → `integrate/2026-10-04`), CI: Install · typecheck · lint ·
unit pass, Live sada pass, Build bez sítě pass, Schema drift pass (RLS verify se spouští jen při změně migrací);
**Vercel – nextjs-boilerplate pass, Vercel – tixly pass**. Sloučeno `gh pr merge --merge` → **e6f45c68**, lokální
integrate fast-forward. PR #2 otevřený, nesloučený, 0 selhaných kontrol.
