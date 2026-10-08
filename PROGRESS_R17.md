# PROGRESS — kolo 17 (zátěžový test na GitHub Actions)

Větev `fix/round17-loadtest-2026-10-08` z `e14cbad2`. Výstupy `logs/r17/`.

## Krok 1 — workflow
- `.github/workflows/loadtest.yml` (workflow_dispatch, vstupy `ref`, `runs`), `.github/scripts/loadtest-version.sh`,
  `e2e/load/r17-errors.mjs` (5xx po krocích z k6 --out json), `e2e/load/r17-summarize.mjs` (JSON, Markdown, brána).
- actionlint 1.7.12 (+ shellcheck 0.11.0): 0 nálezů. shellcheck skriptu: 0.
- Souhrn ověřen na datech kola 14 (summary_native_after_1/2): mediány p95 = tabulka kola 14 (365/133/163/491/2 ms/2,59 s).
- Spuštění: `gh workflow run loadtest.yml` → 404 (soubor není na master). Push se změnou souboru workflow zaregistruje
  (job se přeskočí), pak `gh workflow run 378352523 --ref fix/round17-loadtest-2026-10-08 -f ref=…` funguje.
- Běh 37765704022 selhal: actions/checkout neumí zkrácený hash → celá historie + překlad v gitu (9cf15e70).
- Zkušební běh 37766203272 (e14cbad2): vše zelené; runner 2 vCPU Xeon Platinum 8573C, 7,8 GB, Ubuntu 24.04.5, Node 24.21.0;
  konzistence 3/3 OK, 5xx 0; p95 hold 1,54 s / checkout 1,78 s (medián).

## Krok 2 — srovnání
- Spuštěno: f2af248a 37767338789, 37767386803; e14cbad2 37767375587, 37767402384.

## Krok 3 — baseline_ref
- Vstup `baseline_ref`: srovnávací verze (git worktree `base`) se měří první, testovaná po ní, stejný runner; brána
  `r17-summarize.mjs --gate` (zhoršení mediánu p95 > 20 % a zároveň > 25 ms, nebo selhání konzistence → exit 1).
  Bez baseline_ref brána `--check` (jen konzistence). Ověřeno lokálně: shoda → 0, obrácené pořadí → 1 (3 kroky), rozbitá konzistence → 1.
