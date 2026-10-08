# Kolo 16 — přihlášení před hydratací, zátěž, runtime závislosti, kolísavý test

Větev `fix/round16-2026-10-08` z `8699f453` → PR #14 do `integrate/2026-10-04`, sloučeno jako **10396c66**.
Výstupy `logs/r16/`, průběh `PROGRESS_R16.md`. Vzhled, názvy a menu beze změny.

## 1. Krok 1 — hodnoty napsané před hydratací se mazaly

**Příčiny (dvě):**
1. Řízená pole (`value`/`onChange`): co uživatel napíše před dokončením hydratace, zůstane v DOM, ale stav formuláře
   je prázdný; při dalším vykreslení (např. vyplnění hesla) React hodnotu pole přepíše prázdným stavem. Ověřeno
   na Next 14 i 15 (kolo 15, `logs/r15/3_hydration_race.txt`).
2. 48 klientských stránek mělo z codemodu Next 15 `const params = use(props.params)`. `use()` na Promise při hydrataci
   jednou pozastaví vykreslení; přijde-li mezitím aktualizace kontextu, React nezahydratovaný obsah zahodí a vykreslí
   znovu — vznikne nové pole a napsaný text zmizí (sonda: na stránce rezervací element vyměněn, na stránce bez `use()` ne).

**Opravy (commity):**
- `46156a44` — sdílené `components/ui/input.tsx` po připojení porovná hodnotu v DOM se stavem a rozdíl předá formuláři
  jeho vlastním `onChange` (jako by uživatel právě psal). Neblokuje psaní, žádná načítací obrazovka; neřízená pole,
  checkbox/radio/file beze změny.
- `4456d9a7` — 48 klientských stránek čte params synchronně přes `useParams<T>()` (stejné hodnoty jako v Next 14);
  tabulka rout beze změny (1124 / 1119 ƒ / 5 ○).
- `26b5685a` — B2B přihlášení bylo nedostupné: middleware přesměroval `/b2b/login` na neexistující `/cs/b2b/login` (404);
  výjimka `/b2b/` jako u `/reseller/` (starší chyba, ne z upgradu).

**Opravené formuláře:** přihlášení — administrace (vlastník), pokladna (role Pokladna), skener (personál), kupec
(společný `/cs/login`); prodejce (`/reseller/login`); B2B (`/b2b/login`); registrace kupce; registrace pořadatele;
zapomenuté heslo; nové heslo (odkaz z e-mailu); checkout; vyhledávání rezervací na pokladně; pole skeneru.

**Test** `e2e/tests/golden-path-r16-prehydration.spec.ts` — pomalá síť (CDP 150 kB/s, 250 ms), první pole vyplněné před
hydratací (ověřeno: element bez React fiber), další po ní, odeslání; kontrola odeslaných údajů a úspěchu akce:
**RED 12/12** (`e4f03ecf`, `logs/r16/1_prehydration_red.txt`) → **GREEN 12/12** (`1_prehydration_green.txt`, v závěrečné
sadě znovu 12/12).

## 2. Krok 2 — zátěžový test: vynechán

Kontrola před během (`logs/r16/load_check.ps1`, `2_load_checks.txt`), 6× během 1 h:

| kontrola | čas | CPU celkem | CPU mimo session | volná paměť |
|---|---|---|---|---|
| 1 | 09:57 | 27,8 % | 4,3 % | 2 605 MB |
| 2 | 10:08 | 24,4 % | 14,1 % | 2 207 MB |
| 3 | 10:18 | 18,2 % | 3,5 % | 3 358 MB |
| 4 | 10:29 | 29,8 % | 4,7 % | 1 990 MB |
| 5 | 10:39 | 27,8 % | 8,6 % | 2 121 MB |
| 6 | 10:51 | 32,6 % | 6,8 % | 1 720 MB |

Podmínka volného stroje (CPU cizích procesů ≤ 20 % a volná paměť ≥ 4 GB) nebyla splněna ani jednou — volná paměť
nikdy nedosáhla 4 GB (procesy python ×3–5, Docker Desktop, Chrome mimo session). Kontrolní smyčku navíc systém kolem
10:4x ukončil kvůli nedostatku paměti (mezikontrola v 10:44: 580 MB volno, cizí CPU 20,2 %); 6. kontrola provedena
ručně 10 min po 5. Test proto neproběhl a tabulka p95 kolo 14 → kolo 16 není k dispozici.

## 3. Krok 3 — runtime závislosti

| balíček | výsledek |
|---|---|
| **nodemailer** | 8.0.11 → **10.0.16** (`d4af1e31`). GitHub Advisory DB: 8.0.11 4× high, 9.1.1 3× high, 10.0.16 žádné → nejnižší major bez high = 10. Breaking: 9.0 ověřuje TLS při stahování příloh z URL (aplikace posílá jen buffery), 10.0 Node ≥ 20 a vlastní typy (úprava jen typů v staging-allowlist a mailer). Ověření: 31 skutečných zpráv zachycených z kódu aplikace (vstupenky s PDF a pkpass ×5, rezervace ×12, faktura PDF + ISDOC ×3, upozornění ×10, denní souhrn ×1) přehráno přes 8.0.11 i 10.0.16 do simulátoru Mailpit → **31/31 totožných** (surový MIME bez Message-ID/Date a hlavičky Received od simulátoru, normalizované hranice MIME; dekódované části podle SHA-256) — `logs/r16/mail/3_replay_compare.md`; živé testy e-mailů s 10.0.16 35/35. |
| **@vercel/blob** | za běhu používán (titulní obrázek akce, artwork fanouškovské vstupenky, fotky výhledu z místa — volá je administrace při `BLOB_READ_WRITE_TOKEN`) → 0.27.3 → **2.0.1** (`1b294b17`, `c1c32cdc`): nejnižší verze bez high (0.x, 1.x i 2.0.0 nesou undici ^5 s high advisory, např. GHSA-vxpw-j846-p89q; 2.0.1 undici ^6.23 → 6.29.0 bez high; samotný balíček 0 advisories). Breaking 1.0: server API v11 má výchozí bez náhodné přípony a bez přepsání (0.27 = API v9: obojí zapnuté) → explicitně `addRandomSuffix: true` (titulní obrázek, výhledy) a `allowOverwrite: true` (všechny tři; artwork má pevný název). Test `fix-r16-blob-upload` proti falešnému Blob API: 0.27.3 3/3, 2.0.1 bez úprav 3/3 RED, s úpravou 3/3 GREEN. |
| **node-forge** | beze změny. Jediné použití `lib/wallet/apple-pass.ts` = **jen podepisování** pkpass (`pkcs7.createSignedData` + `sign`, `pki.certificateFromPem`, `pki.privateKeyFromPem`, `util.createBuffer`, `asn1.toDer`). Jediný advisory pro 1.4.0 — [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) (high, oprava neexistuje) — se týká **ověřování** podpisu RSA PKCS#1 v1.5; aplikace ověřování nevolá. |
| **@sentry/nextjs** | neupgradováno. Upgrade 8.55 → 11 by obnášel (`logs/r16/sentry/3_sentry_v11_upgrade.md`, zdroj oficiální migrační průvodci): import `withSentryConfig` z `@sentry/nextjs/config`; odstranit `hideSourceMaps` (v 9 bez náhrady); `disableLogger` → `webpack.treeshake.removeDebugLogging`; nastavit `release.name` (v 9 už ne z Build ID); `tunnelRoute` v 11 prochází middlewarem → přidat `/api/monitoring` mezi veřejné cesty, jinak se chyby z prohlížeče ztratí; `sendDefaultPii` nahrazeno `dataCollection` s povolenějšími výchozími hodnotami → nastavit restriktivně (jinak by Sentry sbíral víc osobních údajů); Node ≥ 20.19, TypeScript ≥ 5.0.4 (splněno). Ověření: simulátor Sentry z kola 14 (0 osobních údajů), `sentry-check`, build bez sítě, pixelové porovnání. |
| dev závislosti | beze změny (vitest, tailwind, eslint). |

## 4. Krok 4 — kolísavý test fix-r11 GET /api/health/redis

**Rozbor:** `GET` je omezen časovačem 4 s (`withTimeout`) a `disconnect()` node-redis během připojování vrací hned
(socket se nastaví až po události `connect`, `@redis/client` socket.js). V neúspěšných bězích kola 15 vitest ukončil test
vlastním časovačem po 20 s — časovače vlákna tedy běžely a `GET`, pokud začal, by skončil do 4–5 s. Jediný krok uvnitř
20s okna, který časovač neomezuje, byl první `await import()` modulu routy (transformace přes RPC v hlavním procesu
vitestu + vyhodnocení modulů redis/pg), sdílený se souběžnými testovacími soubory; v kole 15 trvala fáze environment
158–189 s (dnes 28 s). Měření dnes (33 plných běhů — běžně, s plným vytížením CPU, s 606 MB volné paměti, 6 vláken + CPU +
RAM): import 0,37–0,96 s, GET 4,01–4,04 s, **0 selhání** — příčina je proto odvozena vyloučením, přímo zachycena nebyla.

**Oprava** (`3c08b80f`, v testu): moduly obou health rout se načtou předem v `beforeAll` (vlastní limit 120 s); limit testu
20 s i odpovědi 5,5 s beze změny. **10 po sobě jdoucích plných běhů unit sady: 10/10** (712 testů každý,
`logs/r16/4_unit_10runs.txt`).

## 5. Změny textů v UI

Žádné. Opravy nepřidaly ani nezměnily žádný text.

## 6. Sady, CI, Vercel, PR

| co | výsledek |
|---|---|
| typecheck | 0 |
| lint | bez nové chyby nad baseline (967 < 1008) |
| unit | 712 passed, 13 skipped; 10/10 plných běhů |
| live (po 20 souborech) | 107 souborů, 487 testů + checkout-stress opt-in |
| build / build bez sítě | OK, tabulka rout beze změny / OK, 0 síťových spojení |
| audity 01–12 vč. 07b, 08 | 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b zápisy 0 řádků (= kola 13–15), 08 2 (166 rout × 3 aktéři), 09 12, 10 7, 11 8, 12 5 PASS — 0 FAIL |
| turné | 10/10 |
| golden-path-r13-keep | 10/10 |
| formuláře před hydratací | 12/12 |
| offline skener | 6/6 |

**PR #14** (`fix/round16-2026-10-08` @ a91bf5d8 → `integrate/2026-10-04`), CI: Install · typecheck · lint · unit pass,
Live sada pass, Build bez sítě pass, Schema drift pass; **Vercel – nextjs-boilerplate pass, Vercel – tixly pass**.
Sloučeno `gh pr merge --merge` → **10396c66**, lokální integrate fast-forward. PR #2 otevřený, nesloučený, 0 selhaných
kontrol.
