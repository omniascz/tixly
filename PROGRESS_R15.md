# PROGRESS — kolo 15 (upgrade Next.js 14 → 15 bez změny chování a vzhledu)

Větev `fix/round15-next15-2026-10-07` z `f2af248a`. Výstupy `logs/r15/`. Skripty `logs/r15/*.sh` (z kola 14: demo
`reset_demo.sh` → r15demo, server `serve_r15.sh [build]` :3200, `serve_r15a.sh`, `live_chunk.sh`, `with_gopay.sh`,
`run_audits.sh`). Jeden těžký proces naráz; procesy ukončovat přes PowerShell (next start na Windows).

## Cíl verze
- next 15.5.27 = nejnovější 15.5.x; GitHub Advisory DB pro next@15.5.27: 0 advisories; pro 14.2.35: 2 critical,
  8 high (`logs/r15/0_advisories_next.txt`). React 19 (průvodce upgradem na 15 pro App Router).

## Krok 1 — referenční snímek (f2af248a)
- Spec `e2e/tests/golden-path-r15-screens.spec.ts`: 22 obrazovek kola 13 + program, inscenace, checkout (1440+390);
  skener 1440+390 je v sadě (12-skener).
- r15demo z `create.sh --local`, build na f2af248a (Next 14.2.35) → `logs/r15/routes-before.txt` (tabulka z next build),
  normalizovaně `routes-before.norm.txt`: 1124 rout, 1119 ƒ dynamických, 5 ○ statických.
- Screenshoty `logs/r15/before/` (28 PNG). Determinismus: druhý běh na stejném kódu → 28/28 pixelově shodných
  (`1_compare_before_self.txt`), porovnávací skript `e2e/r15-compare.mjs` (přesné, bez tolerance).

## Krok 2 — upgrade
- Balíčky: next 14.2.35 → 15.5.27, react/react-dom 18.3.1 → 19.2.8 (Next 15.5.27 zabudovaný React 19.2.0-canary),
  @types/react 18.3.28 → 19.2.18, @types/react-dom 18.3.7 → 19.2.7, eslint-config-next 14.2.35 → 15.5.27,
  eslint-plugin-react-hooks 4.6 → 5.2.0 (shodná s eslint-config-next 15, jinak konflikt pluginů),
  @testing-library/react 14 → 16.3.3 (+ @testing-library/dom 10, React 19). @sentry/nextjs 8.55.2 beze změny (podporuje
  Next 15, nejnovější 8.x). Advisories: next@15.5.27 0, react@19.2.8 0, react-dom@19.2.8 0.
- Skupina 1 (codemody): @next/codemod 15.5.27 next-async-request-api → 414 souborů (params/searchParams Promise,
  await cookies()/headers()); 4 místa „@next-codemod-error" (wrappery předávající ctx) + lokální withUser v
  my/tickets/[ticketId]/transfer ručně (codemod HOC nepozná — params by byl undefined); types-react-codemod scoped-jsx
  → 94 souborů (JSX → import type { JSX }); RefObject v onboarding; 11 testových souborů params → Promise.resolve.
  Lint: pravidlo @next/next/no-html-link-for-pages v pluginu 15 nově kontroluje app/ (v 14 jen pages/, který projekt
  nemá) → vypnuto = stejná kontrola jako v 14 (záměna <a> za <Link> by změnila navigaci); import/order po codemodu.
- Skupina 2 (konfigurace a cachování): serverExternalPackages (dřív experimental.serverComponentsExternalPackages —
  jinak by se pdfkit začal bundlovat), outputFileTracingRoot = adresář projektu (Next 14 výchozí; 15 by vzal tixly/),
  instrumentationHook zrušen (v 15 výchozí), experimental.staleTimes {dynamic 30, static 300} (Next 14 výchozí, ověřeno
  ve zdrojích obou verzí). vapid-key: dynamic = 'force-static' (Next 14 GET bez request předgeneroval).
- Cachování fetch změřeno (scratchpad cp14/cp15, počítací upstream, 2 volání na vzor): Next 14 ukládal jen GET fetch
  v routě bez přístupu k request (i s force-dynamic) a v dynamické stránce bez cookies()/headers(); modul s POST/DELETE/
  PATCH/OPTIONS nebo čtení request → neukládal. Next 15 neukládá nic. Inventura 143 serverových fetch (98 souborů,
  `logs/r15/2_fetch_inventory.json`, volající `2_fetch_callers.json`): žádná naše cesta nespadá do „ukládal" → beze
  změny. req.ip v 15 neplněné → x-real-ip = totéž co oficiální ipAddress() z @vercel/functions.
- Ověření: tsc 0 (i s .next/types po buildu), lint bez nové chyby (971 < 1008), unit 712. Přerušované selhání
  fix-r11 „GET /api/health/redis" (limit 20 s) ve 2 z 8 plných běhů; měření v 5 bězích: import 0,9–1,7 s, GET 4,04 s —
  příčina nepotvrzena, limit neoslaben, sledovat v CI.
