# PROGRESS — kolo 13 (vrácení UX z kola 12, zachování oprav chyb a bezpečnosti)

Větev `fix/round13-revert-ux-2026-10-06` z `2a1c9102` (integrate po kole 12). Referenční UI `d0bbcb00`. Výstupy `logs/r13/`.

## Krok 1 — tabulka rozhodnutí
- `logs/r13/rozhodnuti.md` (ZACHOVAT / VRÁTIT po souborech a bodech 1–11), diff kola 12 `logs/r13/0_diff_r12_src.patch`.

## Krok 2 — vrácení (b230caa9 aplikace, c7e7a3f3 testy)
- Soubory UX kola 12 obnoveny z d0bbcb00, znovu doplněna jen logika bodů 1–10 (viz rozhodnuti.md). tsc 0, lint bez nárůstu.
- `golden-path-r13-keep.spec.ts` (body 1–10): na výsledku 10/10 (`logs/r13/2_keep_run3.txt`); na d0bbcb00 padají všechny
  kromě storna firemní objednávky (okno už v d0bbcb00) — `logs/r13/2_keep_red_d0bbcb00*.txt`.

## Krok 3 + 4 — rozdíl proti d0bbcb00 a screenshoty
- `git diff d0bbcb00` v aplikaci jen body 1–10 (logs/r13/3_diff_ui_vs_d0bbcb00.patch).
- `golden-path-r13-screens.spec.ts`: 22 obrazovek (admin menu desktop/mobil, akce, inscenace+termíny, termín, editor, blokace,
  firemní, promo, reporty, zrušení/přesun, pokladna desktop/mobil, skener desktop/mobil, sály, web úvod/akce/místa desktop/mobil)
  proti d0bbcb00 (čistý klon) a výsledku nad stejnou DB r13demo. 19 pixelově shodných; rozdíl jen 02-akce-seznam (bod 7 „Zrušeno",
  posun sloupce šířkou štítku) a 11-pokladna 1440/390 (bod 9 město). `logs/r13/4_screens_compare.txt`, `logs/r13/screens/`.
