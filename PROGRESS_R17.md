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

## Krok 2 — srovnání (`logs/r17/2_compare.md`, `logs/r17/compare.mjs`, artefakty `logs/r17/runs/`)
- Samostatné běhy: f2af248a 37767338789 (Xeon 8573C), 37767386803 (EPYC 9V45); e14cbad2 37767375587, 37767402384 (oba EPYC 7763).
  Mediány p95: hold 358 ms → 3,25 s, checkout 476 ms → 3,36 s, webhook 2,90 → 22,7 s — ALE oba běhy Next 15 dostaly
  nejpomalejší stroj (EPYC 7763), Next 14 rychlejší. Stejný model CPU (Xeon 8573C) dával Next 14 hold 0,23–1,19 s
  v jednom VM a 1,40–2,38 s v jiném → rozptyl mezi VM až 3×, 2 běhy na verzi ho nevyrovnají.
- Párové běhy (obě verze na TOMTÉŽ stroji, baseline_ref): 37767610402 Xeon 8573C (14→15), 37770078757 EPYC 7763
  (15→14, obrácené pořadí), 37770629805 EPYC 9V74 (14→15). Rozdíl Next 15 proti 14 po strojích: hold +6,2 / +15,9 /
  −6,3 %, checkout +13,7 / +12,9 / +8,0 %, webhook +7,7 / −0,8 / +13,7 %, page +3,1 / −8,1 / −4,9 %, plan −0,2 / +11,6 /
  −26,6 %. Žádný krok nezhoršen o víc než 20 % → nic k opravě.
- 37769287280 a 37769296735: next build Next 15 spadl na „JavaScript heap out of memory" (~1,9 GB) → build s heapem
  4 GB (a8d9b19e), oba spuštěny znovu (37770629805, 37770078757).
- Konzistence 33/33 měřených běhů OK (500 = 500 = 500, místo 2× 0, osiřelé holdy 0, pending 0); 5xx 0; chyby 0.
- Cíl p95 hold/checkout < 1,5 s: na rychlém stroji (EPYC 9V74) splněn oběma verzemi, na Xeon 8573C hraniční,
  na EPYC 7763 nesplněn oběma (~3 s) → vlastnost runneru (2 vCPU sdílí k6 300 VU + server + Postgres), neopravuje se.

## Krok 3 — baseline_ref
- Vstup `baseline_ref`: srovnávací verze (git worktree `base`) se měří první, testovaná po ní, stejný runner; brána
  `r17-summarize.mjs --gate` (zhoršení mediánu p95 > 20 % a zároveň > 25 ms, nebo selhání konzistence → exit 1).
  Bez baseline_ref brána `--check` (jen konzistence). Ověřeno lokálně: shoda → 0, obrácené pořadí → 1 (3 kroky), rozbitá konzistence → 1.
- Naživo: brána prošla ve 3 párových bězích (exit 0); na skutečném artefaktu 37770629805 s prohozenými verzemi selže
  (plan +36,3 %, +50 ms → exit 1) — `logs/r17/3_gate_evidence.txt`.

## Závěr
- PR #15 → integrate **e19c91e0** (CI + oba Vercel pass); ROUND17_REPORT.md.
