# PROGRESS — kolo 16 (přihlášení před hydratací, zátěž, runtime závislosti, kolísavý test)

Větev `fix/round16-2026-10-08` z `8699f453`. Výstupy `logs/r16/`, skripty `logs/r16/*.sh` (z kola 15: r16demo, r16a,
r16load). Procesy jen vlastní; ukončovat přes PowerShell podle příkazové řádky (next start, serve_*, fake-gopay).

## Krok 1 — hodnoty před hydratací
- Formuláře: /cs/login (administrace, pokladna, skener, kupec — společný formulář), /reseller/login, /b2b/login,
  /cs/register, /cs/register-promoter, /cs/forgot-password, /cs/reset-password, checkout, rezervace na pokladně
  (vyhledávání), pole skeneru. Všechny textová pole přes sdílené `components/ui/input.tsx` (řízená, value/onChange).
- Spec `e2e/tests/golden-path-r16-prehydration.spec.ts` (CDP throttling 150 kB/s, 250 ms).
- RED (8699f453, `logs/r16/1_prehydration_red.txt`): 12/12 selhalo — přihlášení (4 role) e-mail prázdný po vyplnění
  hesla; prodejce, registrace ×2, zapomenuté heslo, checkout: požadavek neodešel (povinné pole vymazáno); rezervace:
  odesláno q=""; skener: kód vymazán; B2B: /b2b/login → 307 /cs/b2b/login → 404 (middleware bez výjimky pro /b2b/ —
  B2B portál nedostupný, starší chyba, ne z upgradu).
- Příčiny: (1) řízená pole — React po hydrataci nastaví hodnotu ze stavu ('') při dalším vykreslení → oprava ve sdíleném
  `components/ui/input.tsx`: po připojení předá hodnotu z DOM formuláři jeho onChange; (2) 48 klientských stránek s
  `use(props.params)` z codemodu Next 15 — use() při hydrataci pozastaví vykreslení a aktualizace kontextu pak React
  donutí obsah vykreslit znovu (nový element, napsaný text pryč; ověřeno sondou: element vyměněn na rezervacích, na
  stránce bez use() ne) → `useParams<T>()` (synchronní jako Next 14; skript `logs/r16/use_params_transform.py`);
  rezervace/zrusit (jen tlačítko) ponechána; (3) middleware: výjimka /b2b/ z jazykového prefixu.
- GREEN 12/12 (`1_prehydration_green.txt`); tsc 0, lint bez nárůstu, unit 712; tabulka rout beze změny (1124/1119/5).

## Krok 2 — zátěž: VYNECHÁNA (stroj nebyl volný)
- `logs/r16/load_check.ps1` + `load_wait.sh` (6× po 10 min), log `2_load_checks.txt`: 09:57–10:51 ani jednou volný —
  volná paměť 580–3358 MB (< 4 GB), CPU procesů mimo session 2,1–20,2 % (python ×3–5, Docker, Chrome). Kontrolní
  smyčku systém v 10:4x ukončil kvůli nedostatku paměti; 6. kontrola ručně v 10:51 (10 min po 5.). Test vynechán.

## Krok 3 — runtime závislosti
- nodemailer 8.0.11 → **10.0.16** (GitHub Advisory DB: 8.0.11 4× high, 9.1.1 3× high, 10.0.16 žádné; nejnižší major bez high
  = 10; `3_nodemailer_advisories.txt`). Breaking: 9.0 TLS ověřování při stahování příloh z URL — aplikace přílohy z URL
  nepoužívá (jen buffery); 10.0 Node ≥ 20, TS/ESM+CJS — beze změny kódu, jen typy (staging-allowlist: vstupní tvar adres
  z nodemaileru 10, rekurzivní flatten; mailer: envelope.from false as const).
- Ověření obsahu: 31 skutečných SendMailOptions zachycených z kódu aplikace (preload `logs/r16/mail/mail-capture.cjs`
  nad 4 živými testy: vstupenky s PDF/pkpass ×5, rezervace ×12, faktura PDF+ISDOC ×3, upozornění ×10, denní souhrn ×1)
  přehráno přes nodemailer 8.0.11 i 10.0.16 do Mailpitu → **31/31 totožných** (surový MIME bez Message-ID/Date/Received
  a s normalizovanými hranicemi + SHA-256 dekódovaných částí; `logs/r16/mail/3_replay_compare.md`). Aplikace s v10:
  4 živé testy 35/35 (obsah e-mailů a příloh v Mailpitu, ISDOC XML), unit 712.
- @vercel/blob: za běhu používán (titulní obrázek akce, artwork fanouškovské vstupenky, fotky výhledu — UI je volá,
  s BLOB_READ_WRITE_TOKEN). 0.27.3 → **2.0.1** = nejnižší verze bez high (0.x/1.x/2.0.0 nesou undici ^5 — high
  GHSA-vxpw-j846-p89q aj.; 2.0.1+ undici ^6.23 → 6.29.0, bez high; samotný @vercel/blob 0 advisories). Breaking 1.0:
  server API v11 má výchozí addRandomSuffix=false a zakázané přepsání (0.27 = API v9: obojí zapnuté) → explicitně
  addRandomSuffix: true (titulní obrázek, výhledy) a allowOverwrite: true (všechny tři; artwork má pevný název).
  Test fix-r16-blob-upload: 0.27.3 3/3, 2.0.1 bez úprav RED 3/3, s úpravou GREEN 3/3.
- node-forge 1.4.0: jediné použití `lib/wallet/apple-pass.ts` (pkcs7.createSignedData + sign, pki.certificateFromPem,
  pki.privateKeyFromPem, util.createBuffer, asn1.toDer) = jen PODEPISOVÁNÍ pkpass. Jediný advisory pro 1.4.0
  GHSA-86w9-cpqp-85rv (high, oprava neexistuje) se týká OVĚŘOVÁNÍ podpisu RSA PKCS#1 v1.5 (`3_forge_GHSA-86w9-cpqp-85rv.txt`);
  aplikace verify nevolá → beze změny.
- @sentry/nextjs: neupgradováno; co by 11 obnášelo `logs/r16/sentry/3_sentry_v11_upgrade.md`.

## Krok 4 — kolísavý test fix-r11 GET /api/health/redis
- Měření (`4_timing.txt`, 33 plných běhů: běžně, s plným vytížením CPU, s nedostatkem RAM (606 MB volno), 6 vláken + CPU +
  RAM): import routy 0,37–0,96 s, GET 4,01–4,04 s — selhání se dnes nevyvolalo (0/33).
- Rozbor: GET je omezen časovačem 4 s (withTimeout); node-redis disconnect() při připojování vrací hned (socket je až po
  'connect'; socket.js). V neúspěšných bězích kola 15 vitest ukončil test vlastním časovačem po 20 s → časovače vlákna
  běžely → GET, pokud začal, skončil by do 4–5 s. Jediný krok v 20s okně, který časovač neomezuje, je první
  `await import()` modulu routy (transformace přes RPC v hlavním procesu vitestu + vyhodnocení redis/pg), sdílený se
  souběžnými soubory; v kole 15 trvala fáze environment 158–189 s (dnes 28 s). Příčina odvozena vyloučením, ne přímo
  zachycena.
- Oprava v testu: moduly obou health rout se načtou v beforeAll (limit 120 s); limit testu 20 s i odpovědi 5,5 s beze
  změny. Ověření: 10 po sobě jdoucích plných běhů unit sady 10/10 (`4_unit_10runs.txt`).

## Závěrečná sada
- tsc 0, lint bez nové chyby (967 < 1008), unit 712 (10/10 plných běhů v kroku 4).
- live (r16a, po 20, 1 worker): n00 83, n01 49, n02 73, n03 40 (+ fix-r16-blob-upload), g00 163 + opt-in, g01 77,
  webhook-pool 2 → 107 souborů + 1 opt-in, 487 testů.
- build OK, tabulka rout beze změny (1124/1119/5); build bez sítě (čistý klon 3c08b80f) OK, 0 spojení.
- audity 01 26, 02 36, 03 23, 04 14, 05 8, 06 21, 07 6, 07b zápisy 0 řádků (= kolo 13–15), 08 2, 09 12, 10 7, 11 8, 12 5 — 0 FAIL.
- turné 10/10, golden-path-r13-keep 10/10, formuláře před hydratací 12/12, offline skener 6/6.

## Závěr
- PR #14 → CI vše pass, Vercel nextjs-boilerplate i tixly pass → sloučeno 10396c66, lokální integrate fast-forward.
- ROUND16_REPORT.md na integrate.
