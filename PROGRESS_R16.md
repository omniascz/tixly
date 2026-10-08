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
