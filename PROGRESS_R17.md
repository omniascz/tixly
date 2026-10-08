# PROGRESS — kolo 17 (zátěžový test na GitHub Actions)

Větev `fix/round17-loadtest-2026-10-08` z `e14cbad2`. Výstupy `logs/r17/`.

## Krok 1 — workflow
- `.github/workflows/loadtest.yml` (workflow_dispatch, vstupy `ref`, `runs`), `.github/scripts/loadtest-version.sh`,
  `e2e/load/r17-errors.mjs` (5xx po krocích z k6 --out json), `e2e/load/r17-summarize.mjs` (JSON, Markdown, brána).
- actionlint 1.7.12 (+ shellcheck 0.11.0): 0 nálezů. shellcheck skriptu: 0.
- Souhrn ověřen na datech kola 14 (summary_native_after_1/2): mediány p95 = tabulka kola 14 (365/133/163/491/2 ms/2,59 s).
