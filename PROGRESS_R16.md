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
