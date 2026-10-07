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

## Krok 3 — ověření (průběh)
- Systém ukončil kvůli paměti blok „build + reset + screenshoty" (build doběhl, exit 0) → dál po menších krocích:
  zvlášť reset demo, zvlášť server + screenshoty.
- Screenshoty: viz `logs/r15/3_screens_summary.md` (oprava písma 7ac57953 → 25/28 shodných, zbytek šum hran).
  Tabulka rout po upgradu (build po opravě písma) beze změny ○/ƒ.
- Live (r15a z migrací, po 20 souborech, 1 worker): n00 83, n01 49, n02 73, n03 37 (bez simulátoru); g00 163 + opt-in
  přeskočen, g01 77, fix-r3-webhook-pool 2/2 (se simulátorem) → 106 souborů zelených + 1 opt-in, 484 testů (= kolo 14).
- Build bez sítě (čistý klon, 7ac57953, Next 15.5.27): OK, 0 síťových spojení (`3_build_no_network.console.txt`).
- Audity: první běh na pozadí ukončil systém kvůli paměti (volno 0,8 GB — ffmpeg a jiné procesy mimo session);
  smyčka pak běžela bez serveru → výsledky zahozeny (`3_audits_summary_killed.txt`). Znovu po blocích v popředí na čerstvé
  r15a: 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b všechny zápisy 0 řádků (shodné s kolem 13/14), 08 2
  (166 rout × 3 aktéři), 09 12, 10 7, 11 8, 12 5 PASS, 0 FAIL (= kolo 14). Při prvním pokusu o 01–03 při 0,8 GB volné
  paměti trval první /api/health 41 s (další 20–43 ms) → 01 timeout; po uvolnění paměti vše prošlo.
- Turné nad čerstvou r15a 10/10 (`3_tour.txt`, `logs/r15/tour`).
- golden-path-r13-keep spadl: úvodní POST přihlášení timeout 10 s. Měření studeného startu (`3_coldstart_*.txt`):
  Next 14 první požadavek 0,23 s, Next 15 21–23 s (jednou sonda portu 109 s). register() 64–684 ms. CPU profil
  (`logs/r15/cpuprof`, `analyze-cpuprofile.mjs`): prvních ~30 s plné CPU v loadComponents všech rout — Next 15
  experimental.preloadEntriesOnStart (výchozí true) načte a vykoná moduly všech 1124 rout při startu, Next 14 líně.
  Oprava: preloadEntriesOnStart: false → první požadavek 0,25 s. (Vysvětluje i dřívější 41 s u /api/health a timeout 01.)
- Po preloadEntriesOnStart: false a rebuildu: golden-path-r13-keep 10/10 (`3_keep.txt`).
- Offline skener: bod 5 jednou spadl (strict mode — 2 pole skeneru). Měření počtu polí po znovuotevření offline
  (`3_offline_poll*.txt`): Next 15 ve 2 ze 4 bězích stránku po načtení dokreslí na klientu (serverová kopie skrytá
  ~650 ms, viditelné vždy jen jedno pole), Next 14 0 ze 3 běhů. Funkce beze změny. Spec čeká na jediné pole.
  Přihlášení ve specu má stejný souboj s hydratací i na Next 14 (poll14a). Finální běh 6/6 (`3_offline.txt`).
- Zátěž (scénář kola 14: 300 kupců / 60 s, 500 míst, PgBouncer pool 10; `logs/r15/load/`): první běh Next 15 hold
  p95 4,57 s vs kolo 14 0,16 s → stejný test teď na Next 14 (čistý klon f2af248a) hold 6,74 s → zhoršení je stavem
  stroje (volno 0,6 GB, 3 procesy python ~60 000 s CPU a Docker mimo session), ne upgradem. Střídavě Next 14 (4 běhy) /
  Next 15 (5 běhů): p95 průměr/medián — hold +7,0/+11,2 %, checkout +7,7/+10,8 %, webhook +2,2/+4,6 %, page −16/−22 %,
  plan +62,8 % (průměr, jediný běh 4,11 s) / −15,3 % (medián). Konzistence Next 15 OK ve všech 5 bězích (Next 14 jednou
  496/500 vstupenek). `3_load_compare.md`, `3_load_tables.md`. CPU profil Next 15 při zátěži `load/cpuprof`.
- npm audit po upgradu: 2 critical (vitest/tinypool — testy), 26 high, 28 moderate, 1 low; next = moderate (zabudovaný
  postcss). Před upgradem: 3 critical (vč. next), 27 high. Tabulka `3_npm_audit_table.md`.
- Závěrečně: tsc 0, lint bez nové chyby (971 < 1008), unit 712 (`9_unit.txt`). fix-r11 „GET /api/health/redis":
  přerušované vypršení 20 s — bez instrumentace 3 ze 7 plných běhů, s výpisy času 0 z 9 (import ~1 s, GET ~4 s);
  falešné časovače vyloučeny; příčina nepotvrzena, limit neoslaben; rozhodne CI.
